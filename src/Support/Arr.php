<?php

declare(strict_types=1);

namespace CRM\Support;

final class Arr
{
    public static function string(array $data, string $key, ?string $default = null): ?string
    {
        if (!array_key_exists($key, $data) || $data[$key] === null) {
            return $default;
        }
        return trim((string) $data[$key]);
    }

    public static function nullableString(array $data, string $key): ?string
    {
        $value = self::string($data, $key);
        return $value === '' ? null : $value;
    }

    public static function int(array $data, string $key, ?int $default = null): ?int
    {
        if (!array_key_exists($key, $data) || $data[$key] === '' || $data[$key] === null) {
            return $default;
        }
        return filter_var($data[$key], FILTER_VALIDATE_INT) !== false ? (int) $data[$key] : $default;
    }

    public static function bool(array $data, string $key, bool $default = false): bool
    {
        if (!array_key_exists($key, $data)) {
            return $default;
        }
        return filter_var($data[$key], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
    }

    /** @return list<int> */
    public static function intList(array $data, string $key): array
    {
        $values = $data[$key] ?? [];
        if (!is_array($values)) {
            return [];
        }
        return array_values(array_unique(array_map('intval', array_filter(
            $values,
            static fn ($value): bool => filter_var($value, FILTER_VALIDATE_INT) !== false
        ))));
    }
}

