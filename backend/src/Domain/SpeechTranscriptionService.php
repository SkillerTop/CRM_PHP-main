<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use CRM\Http\ApiException;

final class SpeechTranscriptionService
{
    public function __construct(private readonly ProcessRunner $runner)
    {
    }

    /** @param array<string, mixed> $file */
    public function transcribe(array $file): array
    {
        $this->validateUpload($file);

        $workDir = Config::root('storage/tmp/speech/' . bin2hex(random_bytes(8)));
        if (!mkdir($workDir, 0770, true) && !is_dir($workDir)) {
            throw new ApiException(500, 'tmp_unavailable', 'Не удалось подготовить временную папку для аудио.');
        }

        $input = $workDir . DIRECTORY_SEPARATOR . 'voice.' . $this->extension($file);
        try {
            if (!move_uploaded_file((string) $file['tmp_name'], $input)) {
                throw new ApiException(400, 'upload_failed', 'Аудиофайл не был сохранён для обработки.');
            }

            $binary = trim((string) Config::get('WHISPER_BIN', 'whisper'));
            $model = trim((string) Config::get('WHISPER_MODEL', 'base'));
            $language = $this->normalizeLanguage(trim((string) Config::get('WHISPER_LANGUAGE', '')));
            $modelDirectory = $this->modelDirectory();
            $timeout = Config::int('WHISPER_TIMEOUT_SECONDS', 900);

            $command = [
                $binary,
                $input,
                '--model',
                $model,
                '--model_dir',
                $modelDirectory,
                '--output_format',
                'txt',
                '--output_dir',
                $workDir,
                '--fp16',
                'False',
                '--verbose',
                'False',
            ];
            if ($language !== '') {
                $command[] = '--language';
                $command[] = $language;
            }

            $environment = [];
            $ffmpeg = trim((string) Config::get('WHISPER_FFMPEG_BIN', ''));
            if ($ffmpeg !== '') {
                if (!is_file($ffmpeg)) {
                    throw new ApiException(503, 'speech_engine_not_configured', 'FFmpeg для Whisper не найден по указанному пути.');
                }
                $currentPath = (string) (getenv('PATH') ?: getenv('Path') ?: '');
                $environment['PATH'] = dirname($ffmpeg) . ($currentPath !== '' ? PATH_SEPARATOR . $currentPath : '');
            }

            $result = $this->runner->run($command, $timeout, $environment);
            $this->assertEngineSucceeded($result);

            $text = $this->readTranscript($workDir);
            if ($text === '') {
                throw new ApiException(
                    422,
                    'speech_no_text',
                    'Речь не распознана. Проверьте выбранный микрофон и говорите не менее 2 секунд.'
                );
            }

            return [
                'text' => $text,
                'language' => $language !== '' ? $language : null,
            ];
        } finally {
            $this->cleanup($workDir);
        }
    }

    /** @param array<string, mixed> $file */
    private function validateUpload(array $file): void
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            throw new ApiException(400, 'upload_failed', 'Аудиофайл не был загружен.');
        }
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            throw new ApiException(400, 'upload_failed', 'Аудиофайл не найден во временном хранилище.');
        }
        $limit = Config::int('WHISPER_MAX_FILE_MB', 25) * 1024 * 1024;
        if ((int) ($file['size'] ?? 0) <= 0 || (int) ($file['size'] ?? 0) > $limit) {
            throw new ApiException(413, 'file_too_large', 'Аудиофайл слишком большой.');
        }
        $mime = (string) (mime_content_type($tmp) ?: '');
        if (!str_starts_with($mime, 'audio/') && !in_array($mime, ['video/webm', 'application/octet-stream'], true)) {
            throw new ApiException(415, 'unsupported_file_type', 'Загрузите аудио или запись с микрофона.');
        }
    }

    /** @param array<string, mixed> $file */
    private function extension(array $file): string
    {
        $name = strtolower((string) ($file['name'] ?? ''));
        $extension = pathinfo($name, PATHINFO_EXTENSION);
        return preg_match('/^[a-z0-9]{2,8}$/', $extension) === 1 ? $extension : 'webm';
    }

    private function modelDirectory(): string
    {
        $configured = trim((string) Config::get('WHISPER_MODEL_DIR', ''));
        $directory = $configured !== '' ? $configured : Config::root('.runtime/whisper-models');
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new ApiException(500, 'model_storage_unavailable', 'Не удалось подготовить папку моделей Whisper.');
        }

        return $directory;
    }

    private function normalizeLanguage(string $language): string
    {
        $value = mb_strtolower($language);
        return match ($value) {
            '', 'auto' => '',
            'english' => 'en',
            'ukrainian' => 'uk',
            'russian' => 'ru',
            default => $language,
        };
    }

    private function readTranscript(string $workDir): string
    {
        $files = glob($workDir . DIRECTORY_SEPARATOR . '*.txt') ?: [];
        foreach ($files as $path) {
            $text = trim((string) file_get_contents($path));
            if ($text !== '') {
                return preg_replace('/\s+/u', ' ', $text) ?? $text;
            }
        }
        return '';
    }

    private function assertEngineSucceeded(ProcessResult $result): void
    {
        $output = trim($result->stdout . "\n" . $result->stderr);
        if (!$this->engineReportedFailure($result)) {
            return;
        }

        $this->writeDiagnostic($result, $output);
        throw new ApiException(
            503,
            'speech_engine_failed',
            'Whisper не смог обработать запись. Проверьте формат аудио и повторите попытку.'
        );
    }

    private function engineReportedFailure(ProcessResult $result): bool
    {
        $output = trim($result->stdout . "\n" . $result->stderr);
        return $result->exitCode !== 0
            || preg_match('/\bSkipping\b.+\bdue to\b/is', $output) === 1
            || str_contains($output, 'Traceback (most recent call last)');
    }

    private function writeDiagnostic(ProcessResult $result, string $output): void
    {
        $directory = Config::root('storage/logs');
        if (!is_dir($directory)) {
            @mkdir($directory, 0770, true);
        }

        $failureType = 'unknown';
        if (preg_match('/\bdue to\s+([A-Za-z0-9_]+):/i', $output, $matches) === 1) {
            $failureType = $matches[1];
        } elseif (stripos($output, 'ffmpeg') !== false) {
            $failureType = 'media_decode';
        } elseif (str_contains($output, 'Traceback (most recent call last)')) {
            $failureType = 'python_exception';
        }

        // Store only non-content diagnostics: no audio, transcript, paths, or
        // raw engine output are retained.
        $line = sprintf(
            "%s Whisper failure: exit=%d type=%s output_sha256=%s\n",
            date(DATE_ATOM),
            $result->exitCode,
            $failureType,
            hash('sha256', $output)
        );
        @file_put_contents($directory . '/app.log', $line, FILE_APPEND | LOCK_EX);
    }

    private function cleanup(string $workDir): void
    {
        if (!is_dir($workDir)) {
            return;
        }
        foreach (glob($workDir . DIRECTORY_SEPARATOR . '*') ?: [] as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }
        @rmdir($workDir);
        $parent = dirname($workDir);
        if (is_dir($parent) && (glob($parent . DIRECTORY_SEPARATOR . '*') ?: []) === []) {
            @rmdir($parent);
        }
    }
}
