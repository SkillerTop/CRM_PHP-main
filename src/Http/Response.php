<?php

declare(strict_types=1);

namespace CRM\Http;

final class Response
{
    /** @param array<string, mixed>|list<mixed> $payload */
    public static function json(array $payload, int $status = 200, array $headers = []): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        foreach ($headers as $name => $value) {
            header($name . ': ' . $value);
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function noContent(): never
    {
        http_response_code(204);
        exit;
    }

    public static function text(string $content, string $contentType, int $status = 200, array $headers = []): never
    {
        http_response_code($status);
        header('Content-Type: ' . $contentType);
        header('X-Content-Type-Options: nosniff');
        foreach ($headers as $name => $value) {
            header($name . ': ' . $value);
        }
        echo $content;
        exit;
    }

    public static function download(string $path, string $downloadName, string $mime): never
    {
        if (!is_file($path)) {
            throw new ApiException(404, 'file_not_found', 'Файл не найден.');
        }
        http_response_code(200);
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string) filesize($path));
        header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($downloadName));
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }
}

