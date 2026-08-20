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

        $binary = trim((string) Config::get('OCR_TESSERACT_BIN', 'tesseract'));
        $languages = trim((string) Config::get('OCR_LANGUAGES', 'eng+ukr+rus'));
        $timeout = Config::int('OCR_TIMEOUT_SECONDS', 45);
        $text = $this->runTesseract($binary, (string) $file['tmp_name'], $languages, $timeout);
        $draft = $this->parseBusinessCard($text);

        return [
            'raw_text' => $text,
            'draft' => $draft,
            'confidence' => $this->confidence($draft, $text),
        ];
    }

    /** @param array<string, mixed> $file */
    private function validateUpload(array $file): void
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            throw new ApiException(400, 'upload_failed', 'Файл визитки не был загружен.');
        }
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            throw new ApiException(400, 'upload_failed', 'Файл визитки не найден во временном хранилище.');
        }
        $limit = Config::int('OCR_MAX_FILE_MB', 8) * 1024 * 1024;
        if ((int) ($file['size'] ?? 0) <= 0 || (int) ($file['size'] ?? 0) > $limit) {
            throw new ApiException(413, 'file_too_large', 'Файл визитки слишком большой.');
        }
        $mime = (string) (mime_content_type($tmp) ?: '');
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'], true)) {
            throw new ApiException(415, 'unsupported_file_type', 'Загрузите изображение визитки: JPG, PNG, WebP, BMP или TIFF.');
        }
    }

    private function runTesseract(string $binary, string $path, string $languages, int $timeout): string
    {
        $result = $this->runner->run([$binary, $path, 'stdout', '-l', $languages, '--psm', '6'], $timeout);
        $text = $this->normalizeText($result->stdout);
        if ($result->exitCode !== 0) {
            throw new ApiException(503, 'ocr_engine_failed', 'Tesseract не смог обработать визитку.');
        }
        if ($text === '') {
            throw new ApiException(422, 'ocr_no_text', 'На изображении не удалось распознать текст.');
        }

        return $text;
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
        $website = $this->firstMatch('/(?:https?:\/\/)?(?:www\.)?(?!linkedin\.com\b)[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9][a-z0-9\-]*)+\b(?:\/[^\s,;]*)?/iu', $joined);

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
        foreach ($useful as $line) {
            if ($line === $name || $this->looksLikeCompany($line)) {
                continue;
            }
            if (preg_match('/director|manager|head|chief|ceo|cto|founder|sales|marketing|engineer|consultant|керівник|директор|менеджер|спеціаліст|инженер|руководитель|специалист/iu', $line)) {
                $position = $line;
                break;
            }
        }

        $company = '';
        foreach ($useful as $line) {
            if ($line !== $name && $line !== $position && $this->looksLikeCompany($line)) {
                $company = $line;
                break;
            }
        }
        if ($company === '') {
            foreach ($useful as $line) {
                if ($line !== $name && $line !== $position) {
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
