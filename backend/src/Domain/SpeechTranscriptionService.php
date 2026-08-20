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
            $timeout = Config::int('WHISPER_TIMEOUT_SECONDS', 180);

            $command = [$binary, $input, '--model', $model, '--model_dir', $modelDirectory, '--output_format', 'txt', '--output_dir', $workDir, '--fp16', 'False'];
            if ($language !== '') {
                $command[] = '--language';
                $command[] = $language;
            }

            $result = $this->runner->run($command, $timeout);
            if ($result->exitCode !== 0) {
                throw new ApiException(503, 'speech_engine_failed', 'Whisper не смог распознать аудио.');
            }

            $text = $this->readTranscript($workDir);
            if ($text === '') {
                throw new ApiException(422, 'speech_no_text', 'В аудио не удалось распознать текст.');
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
