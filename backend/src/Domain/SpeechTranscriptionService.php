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

            $python = AiRuntimePaths::python(trim((string) Config::get('WHISPER_PYTHON_BIN', 'python3')));
            $script = $this->localPath(trim((string) Config::get('WHISPER_SCRIPT', 'ai/faster_whisper_transcribe.py')));
            $model = AiRuntimePaths::model(trim((string) Config::get('WHISPER_MODEL', 'large-v3-turbo')));
            $language = $this->normalizeLanguage(trim((string) Config::get('WHISPER_LANGUAGE', '')));
            $modelDirectory = $this->modelDirectory();
            $timeout = Config::int('WHISPER_TIMEOUT_SECONDS', 900);
            if (!is_file($script)) {
                throw new ApiException(503, 'speech_engine_not_configured', 'Скрипт Faster-Whisper не найден по указанному пути.');
            }

            $command = [
                $python,
                $script,
                '--input',
                $input,
                '--model',
                $model,
                '--cache-dir',
                $modelDirectory,
                '--device',
                trim((string) Config::get('WHISPER_DEVICE', 'cuda')),
                '--compute-type',
                trim((string) Config::get('WHISPER_COMPUTE_TYPE', 'float16')),
                '--beam-size',
                (string) Config::int('WHISPER_BEAM_SIZE', 5),
            ];
            if ($language !== '') {
                $command[] = '--language';
                $command[] = $language;
            }
            $initialPrompt = trim((string) Config::get('WHISPER_INITIAL_PROMPT', ''));
            if ($initialPrompt !== '') {
                $command[] = '--initial-prompt';
                $command[] = $initialPrompt;
            }
            $ffmpeg = trim((string) Config::get('WHISPER_FFMPEG_BIN', ''));
            if ($ffmpeg !== '') {
                $command[] = '--ffmpeg-bin';
                $command[] = $this->localPath($ffmpeg);
            }

            $result = $this->runner->run($command, $timeout);
            $this->assertEngineSucceeded($result);

            $payload = json_decode(trim($result->stdout), true);
            if (!is_array($payload)) {
                throw new ApiException(503, 'speech_engine_failed', 'Faster-Whisper вернул некорректный ответ.');
            }
            $text = trim(preg_replace('/\s+/u', ' ', (string) ($payload['text'] ?? '')) ?? '');
            if ($text === '') {
                throw new ApiException(
                    422,
                    'speech_no_text',
                    'Речь не распознана. Проверьте выбранный микрофон и говорите не менее 2 секунд.'
                );
            }

            return [
                'text' => $text,
                'language' => trim((string) ($payload['language'] ?? '')) ?: null,
                'model' => basename(str_replace('\\', '/', $model)),
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
        $configured = trim((string) Config::get('WHISPER_MODEL_DIR', '.runtime/whisper-models'));
        $directory = $this->localPath($configured);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new ApiException(500, 'model_storage_unavailable', 'Не удалось подготовить папку моделей Whisper.');
        }

        return $directory;
    }

    private function localPath(string $value): string
    {
        if (str_starts_with($value, '/') || str_starts_with($value, '\\') || preg_match('/^[A-Za-z]:[\\\\\/]/', $value) === 1) {
            return $value;
        }
        return Config::root($value);
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
        if (preg_match('/"error"\s*:\s*"([A-Za-z0-9_]+)"/', $output, $matches) === 1) {
            $failureType = $matches[1];
        } elseif (preg_match('/\bdue to\s+([A-Za-z0-9_]+):/i', $output, $matches) === 1) {
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
