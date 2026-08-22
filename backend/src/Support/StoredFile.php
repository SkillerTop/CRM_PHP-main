<?php

declare(strict_types=1);

namespace CRM\Support;

use CRM\Config\Config;
use CRM\Http\ApiException;

final class StoredFile
{
    /** @return array{original:string,quarantine:string} */
    public static function quarantine(string $relativePath): array
    {
        $original = self::absolute($relativePath);
        if (!is_file($original)) {
            throw new ApiException(404, 'attachment_file_not_found', 'Файл вложения отсутствует в хранилище.');
        }
        $trash = self::root() . DIRECTORY_SEPARATOR . '.trash';
        if (!is_dir($trash) && !mkdir($trash, 0770, true) && !is_dir($trash)) {
            throw new ApiException(500, 'storage_unavailable', 'Не удалось подготовить карантин удаления.');
        }
        $quarantine = $trash . DIRECTORY_SEPARATOR . bin2hex(random_bytes(24)) . '.deleted';
        if (!rename($original, $quarantine)) {
            throw new ApiException(500, 'attachment_delete_failed', 'Не удалось безопасно удалить вложение.');
        }
        return ['original' => $original, 'quarantine' => $quarantine];
    }

    public static function restore(array $paths): void
    {
        if (is_file($paths['quarantine'] ?? '') && !rename($paths['quarantine'], $paths['original'])) {
            throw new \RuntimeException('Unable to restore quarantined attachment after rollback.');
        }
    }

    public static function purge(array $paths): void
    {
        if (is_file($paths['quarantine'] ?? '') && !unlink($paths['quarantine'])) {
            throw new \RuntimeException('Unable to purge quarantined attachment.');
        }
        self::removeEmptyParents(dirname((string) ($paths['original'] ?? '')));
    }

    public static function purgeRelative(string $relativePath): void
    {
        $path = self::absolute($relativePath);
        if (is_file($path) && !unlink($path)) {
            throw new \RuntimeException('Unable to purge stored attachment.');
        }
        self::removeEmptyParents(dirname($path));
    }

    public static function absolute(string $relativePath): string
    {
        $relative = str_replace('\\', '/', trim($relativePath));
        if ($relative === '' || str_contains($relative, "\0") || str_starts_with($relative, '/') || preg_match('/^[A-Za-z]:/', $relative)) {
            throw new ApiException(500, 'invalid_stored_path', 'Некорректный путь вложения в хранилище.');
        }
        $segments = explode('/', $relative);
        if (in_array('..', $segments, true) || in_array('.', $segments, true)) {
            throw new ApiException(500, 'invalid_stored_path', 'Некорректный путь вложения в хранилище.');
        }
        return self::root() . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $segments);
    }

    private static function root(): string
    {
        return rtrim(Config::root((string) Config::get('UPLOAD_DIR', 'storage/uploads')), '/\\');
    }

    private static function removeEmptyParents(string $directory): void
    {
        $root = self::root();
        while ($directory !== $root && str_starts_with($directory, $root . DIRECTORY_SEPARATOR) && is_dir($directory)) {
            if ((glob($directory . DIRECTORY_SEPARATOR . '*') ?: []) !== []) {
                break;
            }
            @rmdir($directory);
            $directory = dirname($directory);
        }
    }
}
