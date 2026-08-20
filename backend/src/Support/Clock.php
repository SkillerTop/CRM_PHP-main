<?php

declare(strict_types=1);

namespace CRM\Support;

use CRM\Config\Config;
use CRM\Http\ApiException;
use DateTimeImmutable;
use DateTimeZone;
use Throwable;

final class Clock
{
    public static function utcNow(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }

    public static function dbNow(): string
    {
        return self::utcNow()->format('Y-m-d H:i:s.u');
    }

    public static function localToday(): string
    {
        return self::utcNow()
            ->setTimezone(new DateTimeZone((string) Config::get('APP_TIMEZONE', 'Europe/Kyiv')))
            ->format('Y-m-d');
    }

    public static function db(DateTimeImmutable $date): string
    {
        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
    }

    public static function api(?string $dbValue): ?string
    {
        if ($dbValue === null || $dbValue === '') {
            return null;
        }
        return (new DateTimeImmutable($dbValue, new DateTimeZone('UTC')))
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\TH:i:s.u\Z');
    }

    public static function parseTimestamp(
        ?string $value,
        string $field = 'date',
        bool $requireTime = false
    ): ?DateTimeImmutable
    {
        if ($value === null || trim($value) === '') {
            return null;
        }
        try {
            $trimmed = trim($value);
            if ($requireTime && preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/', $trimmed) !== 1) {
                throw new \RuntimeException('Time component is required.');
            }
            $hasTimezone = preg_match('/(?:Z|[+-]\d{2}:?\d{2})$/i', $trimmed) === 1;
            $zone = $hasTimezone
                ? null
                : new DateTimeZone((string) Config::get('APP_TIMEZONE', 'Europe/Kyiv'));
            $date = new DateTimeImmutable($trimmed, $zone ?: new DateTimeZone('UTC'));
            $errors = DateTimeImmutable::getLastErrors();
            if (is_array($errors) && ((int) $errors['warning_count'] > 0 || (int) $errors['error_count'] > 0)) {
                throw new \RuntimeException('Invalid date or time.');
            }
            return $date;
        } catch (Throwable) {
            throw new ApiException(400, 'validation_error', "Поле {$field} содержит некорректную дату и время.", [
                'fields' => [$field => 'Некорректная дата и время.'],
            ]);
        }
    }

    public static function parseDate(?string $value, string $field): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if (!$date || $date->format('Y-m-d') !== $value) {
            throw new ApiException(400, 'validation_error', "Поле {$field} должно иметь формат YYYY-MM-DD.", [
                'fields' => [$field => 'Ожидается YYYY-MM-DD.'],
            ]);
        }
        return $value;
    }
}

