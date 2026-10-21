<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use CRM\Http\ApiException;

final class BusinessCardOcrService
{
    public function __construct(private readonly ProcessRunner $runner)
    {
    }

    /** @param array<string, mixed> $file */
    public function recognize(array $file): array
    {
        $this->validateUpload($file);

        $python = AiRuntimePaths::python(trim((string) Config::get('OCR_PYTHON_BIN', 'python3')));
        $script = $this->localPath(trim((string) Config::get('OCR_PADDLE_SCRIPT', 'ai/paddleocr_business_card.py')));
        $language = trim((string) Config::get('OCR_LANGUAGE', 'uk'));
        $device = trim((string) Config::get('OCR_DEVICE', 'gpu'));
        $modelDirectory = $this->localPath(trim((string) Config::get('OCR_MODEL_DIR', '.runtime/paddleocr-models')));
        $timeout = Config::int('OCR_TIMEOUT_SECONDS', 45);
        if (!is_file($script)) {
            throw new ApiException(503, 'ocr_engine_not_configured', 'Скрипт PaddleOCR не найден по указанному пути.');
        }
        if (!is_dir($modelDirectory) && !mkdir($modelDirectory, 0770, true) && !is_dir($modelDirectory)) {
            throw new ApiException(500, 'model_storage_unavailable', 'Не удалось подготовить папку моделей PaddleOCR.');
        }
        $recognition = $this->runPaddleOcr($python, $script, (string) $file['tmp_name'], $language, $device, $modelDirectory, $timeout);
        $text = $recognition['text'];
        $draft = $this->parseBusinessCard($text);

        return [
            'raw_text' => $text,
            'draft' => $draft,
            'confidence' => $this->confidence($draft, $text),
            'ocr_confidence' => $recognition['average_confidence'],
            'engine' => 'PaddleOCR PP-OCRv5',
        ];
    }

    /** @param array<string, mixed> $file */
    private function validateUpload(array $file): void
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            $message = match ($error) {
                UPLOAD_ERR_INI_SIZE => 'Файл визитки превышает серверный лимит upload_max_filesize (' . ini_get('upload_max_filesize') . ').',
                UPLOAD_ERR_FORM_SIZE => 'Файл визитки превышает допустимый размер формы.',
                UPLOAD_ERR_PARTIAL => 'Файл визитки был загружен только частично. Повторите загрузку.',
                UPLOAD_ERR_NO_FILE => 'Добавьте фото или скан визитки.',
                UPLOAD_ERR_NO_TMP_DIR => 'На сервере отсутствует временная папка для загрузок.',
                UPLOAD_ERR_CANT_WRITE => 'Сервер не смог записать загруженный файл.',
                UPLOAD_ERR_EXTENSION => 'Загрузка файла остановлена расширением PHP.',
                default => 'Файл визитки не был загружен.',
            };
            $status = in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 413 : 400;
            throw new ApiException($status, 'upload_failed', $message);
        }
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            throw new ApiException(400, 'upload_failed', 'Файл визитки не найден во временном хранилище.');
        }
        $limit = Config::int('OCR_MAX_FILE_MB', 20) * 1024 * 1024;
        if ((int) ($file['size'] ?? 0) <= 0 || (int) ($file['size'] ?? 0) > $limit) {
            throw new ApiException(413, 'file_too_large', 'Файл визитки слишком большой.');
        }
        $mime = (string) (mime_content_type($tmp) ?: '');
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'], true)) {
            throw new ApiException(415, 'unsupported_file_type', 'Загрузите изображение визитки: JPG, PNG, WebP, BMP или TIFF.');
        }
    }

    /** @return array{text:string,average_confidence:?float} */
    private function runPaddleOcr(
        string $python,
        string $script,
        string $path,
        string $language,
        string $device,
        string $modelDirectory,
        int $timeout
    ): array
    {
        $result = $this->runner->run([
            $python,
            $script,
            '--input',
            $path,
            '--language',
            $language,
            '--device',
            $device,
            '--model-dir',
            $modelDirectory,
        ], $timeout);
        if ($result->exitCode !== 0) {
            throw new ApiException(503, 'ocr_engine_failed', 'PaddleOCR не смог обработать визитку.');
        }
        $payload = json_decode(trim($result->stdout), true);
        if (!is_array($payload)) {
            throw new ApiException(503, 'ocr_engine_failed', 'PaddleOCR вернул некорректный ответ.');
        }
        $text = $this->normalizeText((string) ($payload['text'] ?? ''));
        if ($text === '') {
            throw new ApiException(422, 'ocr_no_text', 'На изображении не удалось распознать текст.');
        }

        $average = isset($payload['average_confidence']) && is_numeric($payload['average_confidence'])
            ? max(0.0, min(1.0, (float) $payload['average_confidence']))
            : null;
        return ['text' => $text, 'average_confidence' => $average];
    }

    /** @return array<string, string> */
    private function parseBusinessCard(string $text): array
    {
        $lines = array_values(array_filter(array_map(
            static fn (string $line): string => trim(preg_replace('/\s+/u', ' ', $line) ?? ''),
            preg_split('/\R/u', $text) ?: []
        )));
        $joined = implode("\n", $lines);

        $email = $this->firstMatch('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/iu', $joined);
        $phone = $this->firstMatch('/(?:\+?\d[\d\s().\-]{7,}\d)/u', $joined);
        $linkedin = $this->firstMatch('/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,;]+/iu', $joined);
        $website = $this->firstMatch('/(?<![@.\p{L}\p{N}_-])(?:https?:\/\/)?(?:www\.)?(?!linkedin\.com\b)[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9][a-z0-9\-]*)+\b(?:\/[^\s,;]*)?/iu', $joined);

        $useful = [];
        foreach ($lines as $line) {
            if ($email && stripos($line, $email) !== false) {
                continue;
            }
            if ($phone && str_contains($this->digits($line), $this->digits($phone))) {
                continue;
            }
            if (preg_match('/@|https?:\/\/|www\.|linkedin\.com/iu', $line)) {
                continue;
            }
            if (mb_strlen($line) < 2 || mb_strlen($line) > 80) {
                continue;
            }
            $useful[] = $line;
        }

        $name = '';
        foreach ($useful as $line) {
            if (!$this->looksLikeCompany($line) && preg_match('/^[\p{L}][\p{L}\'.-]+(?:\s+[\p{L}][\p{L}\'.-]+){1,3}$/u', $line)) {
                $name = $line;
                break;
            }
        }

        $position = '';
        $positionLines = [];
        foreach ($useful as $index => $line) {
            if ($line === $name || $this->looksLikeCompany($line)) {
                continue;
            }
            if ($this->looksLikePosition($line)) {
                $position = $line;
                $positionLines[$index] = true;
                for ($nextIndex = $index + 1; $nextIndex < min(count($useful), $index + 3); $nextIndex++) {
                    $next = $useful[$nextIndex];
                    if ($next === $name || $this->looksLikeCompany($next) || !$this->continuesPosition($position, $next)) {
                        break;
                    }
                    $position .= ' ' . $next;
                    $positionLines[$nextIndex] = true;
                }
                break;
            }
        }

        $company = '';
        foreach ($useful as $index => $line) {
            if ($line !== $name && !isset($positionLines[$index]) && $this->looksLikeCompany($line)) {
                $company = $line;
                break;
            }
        }
        if ($company === '') {
            foreach ($useful as $index => $line) {
                if ($line !== $name && !isset($positionLines[$index])) {
                    $company = $line;
                    break;
                }
            }
        }

        [$firstName, $lastName] = $this->splitName($name);
        return array_filter([
            'first_name' => $firstName,
            'last_name' => $lastName,
            'position' => $position,
            'phone' => $phone,
            'email' => $email,
            'linkedin' => $linkedin,
            'website' => $website,
            'company' => $company,
        ], static fn (?string $value): bool => $value !== null && trim($value) !== '');
    }

    private function normalizeText(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $lines = array_map(static fn (string $line): string => trim($line), explode("\n", $text));
        return trim(implode("\n", array_filter($lines, static fn (string $line): bool => $line !== '')));
    }

    private function localPath(string $value): string
    {
        if (str_starts_with($value, '/') || str_starts_with($value, '\\') || preg_match('/^[A-Za-z]:[\\\\\/]/', $value) === 1) {
            return $value;
        }
        return Config::root($value);
    }

    private function firstMatch(string $pattern, string $text): string
    {
        return preg_match($pattern, $text, $match) === 1 ? trim($match[0]) : '';
    }

    private function digits(string $value): string
    {
        return preg_replace('/\D+/', '', $value) ?? '';
    }

    private function looksLikeCompany(string $line): bool
    {
        return preg_match('/\b(llc|ltd|inc|gmbh|corp|company|group|systems|solutions|technology|тзов|тов|ооо|компанія|компания)\b/iu', $line) === 1;
    }

    private function looksLikePosition(string $line): bool
    {
        return preg_match('/director|manager|head|chief|ceo|cto|founder|sales|marketing|engineer|consultant|керівник|директор|менеджер|спеціаліст|инженер|руководитель|специалист/iu', $line) === 1;
    }

    private function continuesPosition(string $current, string $next): bool
    {
        if ($this->looksLikePosition($next)) {
            return true;
        }
        return preg_match('/^\p{Ll}/u', $next) === 1
            && preg_match('/\b(?:of|for|in|at|and|з|із|зі|по|у|в|та|и|\p{L})\s*$/iu', $current) === 1;
    }

    /** @return array{0:string,1:string} */
    private function splitName(string $name): array
    {
        $parts = preg_split('/\s+/u', trim($name)) ?: [];
        if ($parts === []) {
            return ['', ''];
        }
        return [$parts[0], trim(implode(' ', array_slice($parts, 1)))];
    }

    /** @param array<string, string> $draft */
    private function confidence(array $draft, string $text): string
    {
        $score = 0;
        foreach (['first_name', 'email', 'phone', 'company'] as $field) {
            if (($draft[$field] ?? '') !== '') {
                $score++;
            }
        }
        if (mb_strlen($text) > 40) {
            $score++;
        }

        return $score >= 4 ? 'high' : ($score >= 2 ? 'medium' : 'low');
    }
}
