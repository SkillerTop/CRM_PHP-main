<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;

final class AiRuntimePaths
{
    public static function local(string $value): string
    {
        if (str_starts_with($value, '/') || str_starts_with($value, '\\') || preg_match('/^[A-Za-z]:[\\\\\/]/', $value) === 1) {
            return $value;
        }
        return Config::root($value);
    }

    public static function python(string $value): string
    {
        if (!str_contains($value, '/') && !str_contains($value, '\\')) {
            return $value;
        }
        $path = self::local($value);
        // A venv directory is portable configuration; its interpreter is OS-specific.
        if (is_dir($path)) {
            return $path . (PHP_OS_FAMILY === 'Windows' ? '/Scripts/python.exe' : '/bin/python');
        }
        return $path;
    }

    public static function model(string $value): string
    {
        // Keep named models and Hugging Face repository IDs supported, while
        // resolving explicitly relative model directories independently of cwd.
        return str_starts_with($value, '.') || is_dir(Config::root($value))
            ? self::local($value)
            : $value;
    }
}
