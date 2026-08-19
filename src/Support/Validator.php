<?php

declare(strict_types=1);

namespace CRM\Support;

use CRM\Http\ApiException;

final class Validator
{
    /** @param array<string, string> $errors */
    public static function ensure(array $errors): void
    {
        $errors = array_filter($errors, static fn (string $value): bool => $value !== '');
        if ($errors !== []) {
            throw new ApiException(400, 'validation_error', 'Проверьте заполнение полей.', ['fields' => $errors]);
        }
    }

    public static function required(?string $value, string $message = 'Обязательное поле.'): string
    {
        return $value === null || trim($value) === '' ? $message : '';
    }

    public static function max(?string $value, int $length): string
    {
        return $value !== null && mb_strlen($value) > $length ? "Не более {$length} символов." : '';
    }

    public static function email(?string $value): string
    {
        return $value !== null && $value !== '' && filter_var($value, FILTER_VALIDATE_EMAIL) === false
            ? 'Некорректный email.'
            : '';
    }

    public static function url(?string $value): string
    {
        return $value !== null && $value !== '' && filter_var($value, FILTER_VALIDATE_URL) === false
            ? 'Некорректный URL.'
            : '';
    }

    public static function phone(?string $value): string
    {
        return $value !== null && $value !== '' && preg_match('/^[\d+()\-\s]+$/u', $value) !== 1
            ? 'Допустимы цифры, +, пробелы, скобки и дефисы.'
            : '';
    }

    public static function password(?string $value): string
    {
        return $value === null || mb_strlen($value) < 8 ? 'Минимум 8 символов.' : '';
    }

    public static function normalizeUrl(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }
        $value = trim($value);
        return preg_match('#^https?://#i', $value) ? $value : 'https://' . $value;
    }
}

