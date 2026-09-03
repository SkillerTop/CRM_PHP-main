<?php

declare(strict_types=1);

namespace CRM\Config;

use RuntimeException;

final class EnvironmentValidator
{
    public static function validate(): void
    {
        $errors = self::errors();
        if ($errors !== []) {
            throw new RuntimeException("Invalid backend environment:\n- " . implode("\n- ", $errors));
        }
    }

    /** @return list<string> */
    public static function errors(): array
    {
        $errors = [];
        $environment = strtolower(trim((string) Config::get('APP_ENV', '')));
        if (!in_array($environment, ['production', 'development', 'test'], true)) {
            $errors[] = 'APP_ENV must be production, development, or test.';
        }
        $production = $environment === 'production';
        $url = trim((string) Config::get('APP_URL', ''));
        if (filter_var($url, FILTER_VALIDATE_URL) === false) {
            $errors[] = 'APP_URL must be an absolute URL.';
        } elseif ($production && parse_url($url, PHP_URL_SCHEME) !== 'https') {
            $errors[] = 'APP_URL must use HTTPS in production.';
        }
        if ($production && Config::bool('APP_DEBUG', false)) {
            $errors[] = 'APP_DEBUG must be false in production.';
        }
        $timezone = (string) Config::get('APP_TIMEZONE', 'Europe/Kyiv');
        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            $errors[] = 'APP_TIMEZONE must be a valid IANA timezone identifier.';
        }

        if ($production && PHP_OS_FAMILY !== 'Windows') {
            $envFile = Config::root('.env');
            if (is_file($envFile)) {
                $permissions = fileperms($envFile);
                if ($permissions === false || ($permissions & 0077) !== 0) {
                    $errors[] = 'backend/.env must not be accessible by group or other users (use chmod 600).';
                }
            }
        }

        foreach (['DB_HOST', 'DB_DATABASE', 'DB_USERNAME'] as $required) {
            if (trim((string) Config::get($required, '')) === '') {
                $errors[] = "{$required} is required.";
            }
        }
        if ($production && trim((string) Config::get('DB_PASSWORD', '')) === '') {
            $errors[] = 'DB_PASSWORD is required in production.';
        }
        if ($production && strtolower((string) Config::get('DB_USERNAME', '')) === 'root') {
            $errors[] = 'DB_USERNAME must not be root in production.';
        }
        self::integer($errors, 'DB_PORT', 1, 65535, 3306);

        $sameSite = strtolower((string) Config::get('SESSION_SAMESITE', 'lax'));
        if (!in_array($sameSite, ['lax', 'strict', 'none'], true)) {
            $errors[] = 'SESSION_SAMESITE must be Lax, Strict, or None.';
        }
        if (($production || $sameSite === 'none') && !Config::bool('SESSION_SECURE', true)) {
            $errors[] = 'SESSION_SECURE must be true in production and with SameSite=None.';
        }
        self::integer($errors, 'SESSION_IDLE_HOURS', 1, 168, 12);

        $mail = strtolower((string) Config::get('MAIL_TRANSPORT', ''));
        if (!in_array($mail, ['smtp', 'mail', 'log'], true)) {
            $errors[] = 'MAIL_TRANSPORT must be smtp, mail, or log.';
        }
        if ($production && $mail === 'log') {
            $errors[] = 'MAIL_TRANSPORT=log is forbidden in production.';
        }
        if ($mail === 'smtp') {
            if (trim((string) Config::get('SMTP_HOST', '')) === '') {
                $errors[] = 'SMTP_HOST is required for smtp transport.';
            }
            if (!in_array(strtolower((string) Config::get('SMTP_ENCRYPTION', 'tls')), ['tls', 'ssl'], true)) {
                $errors[] = 'SMTP_ENCRYPTION must be tls or ssl.';
            }
            self::integer($errors, 'SMTP_PORT', 1, 65535, 587);
        }
        if (filter_var((string) Config::get('MAIL_FROM_ADDRESS', ''), FILTER_VALIDATE_EMAIL) === false) {
            $errors[] = 'MAIL_FROM_ADDRESS must be a valid email address.';
        }

        $proxySecret = (string) Config::get('PROXY_SHARED_SECRET', '');
        if ($production && strlen($proxySecret) < 32) {
            $errors[] = 'PROXY_SHARED_SECRET must contain at least 32 bytes in production.';
        }
        foreach (['DB_PASSWORD', 'SMTP_PASSWORD', 'PROXY_SHARED_SECRET'] as $secret) {
            $value = strtolower(trim((string) Config::get($secret, '')));
            if ($production && in_array($value, ['change-me', 'changeme', 'replace-me', 'password'], true)) {
                $errors[] = "{$secret} still contains a placeholder value.";
            }
        }

        foreach ([
            ['LOGIN_MAX_ATTEMPTS', 1, 100, 5], ['LOGIN_WINDOW_MINUTES', 1, 1440, 15],
            ['LOGIN_BLOCK_MINUTES', 1, 1440, 15], ['OCR_MAX_REQUESTS_PER_HOUR', 1, 1000, 20],
            ['WHISPER_MAX_REQUESTS_PER_HOUR', 1, 1000, 10], ['UPLOAD_MAX_REQUESTS_PER_HOUR', 1, 10000, 100],
            ['UPLOAD_MAX_BYTES', 1024, 104857600, 20971520], ['UPLOAD_STORAGE_MAX_BYTES', 1048576, PHP_INT_MAX, 10737418240],
            ['OCR_MAX_FILE_MB', 1, 100, 8], ['WHISPER_MAX_FILE_MB', 1, 500, 25],
            ['OCR_TIMEOUT_SECONDS', 1, 300, 45], ['WHISPER_TIMEOUT_SECONDS', 1, 900, 900],
            ['AI_MAX_TIMEOUT_SECONDS', 1, 900, 900], ['AI_MAX_OUTPUT_BYTES', 1024, 10485760, 1048576],
        ] as [$key, $minimum, $maximum, $default]) {
            self::integer($errors, $key, $minimum, $maximum, $default);
        }

        $uploadDir = str_replace('\\', '/', (string) Config::get('UPLOAD_DIR', 'storage/uploads'));
        if ($uploadDir === '' || str_starts_with($uploadDir, '/') || preg_match('/^[A-Za-z]:/', $uploadDir) || in_array('..', explode('/', $uploadDir), true)) {
            $errors[] = 'UPLOAD_DIR must be a relative path inside backend.';
        }
        return array_values(array_unique($errors));
    }

    /** @param list<string> $errors */
    private static function integer(array &$errors, string $key, int $minimum, int $maximum, int $default): void
    {
        $raw = Config::get($key, (string) $default);
        if (filter_var($raw, FILTER_VALIDATE_INT) === false || (int) $raw < $minimum || (int) $raw > $maximum) {
            $errors[] = "{$key} must be an integer between {$minimum} and {$maximum}.";
        }
    }
}
