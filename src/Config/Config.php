<?php

declare(strict_types=1);

namespace CRM\Config;

final class Config
{
    private static string $root;

    public static function bootstrap(string $root): void
    {
        self::$root = rtrim($root, '/\\');
        date_default_timezone_set((string) self::get('APP_TIMEZONE', 'Europe/Kyiv'));
    }

    public static function root(string $path = ''): string
    {
        return self::$root . ($path !== '' ? DIRECTORY_SEPARATOR . ltrim($path, '/\\') : '');
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $value = getenv($key);
        return $value === false ? $default : $value;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null || $value === false || $value === '') {
            return $default;
        }

        return filter_var($value, FILTER_VALIDATE_BOOL);
    }

    public static function int(string $key, int $default): int
    {
        $value = self::get($key);
        return is_numeric($value) ? (int) $value : $default;
    }

    /** @return list<string> */
    public static function csv(string $key): array
    {
        $value = trim((string) self::get($key, ''));
        if ($value === '') {
            return [];
        }

        return array_values(array_filter(array_map(
            static fn (string $item): string => trim($item),
            explode(',', $value)
        )));
    }
}

