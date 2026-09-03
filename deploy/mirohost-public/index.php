<?php

declare(strict_types=1);

/*
 * Mirohost deployment front controller.
 *
 * Upload this file as backend/public/index.php only when nginx forwards every
 * request (including index.html and /assets/*) to PHP. The regular project
 * entry point at backend/public/index.php intentionally remains unchanged.
 */

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
$parsedPath = parse_url($uri, PHP_URL_PATH);
$requestPath = rawurldecode(is_string($parsedPath) && $parsedPath !== '' ? $parsedPath : '/');
if (!str_starts_with($requestPath, '/')) {
    $requestPath = '/' . $requestPath;
}

$isApiRequest = $requestPath === '/api' || str_starts_with($requestPath, '/api/');
$frontendRoot = __DIR__;
$frontendIndex = $frontendRoot . DIRECTORY_SEPARATOR . 'index.html';

$sendSecurityHeaders = static function (): void {
    header_remove('X-Powered-By');
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(self), microphone=(self), geolocation=()');
    header("Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'");
};

$sendFrontendError = static function (int $status, string $code, string $message) use ($sendSecurityHeaders): never {
    $sendSecurityHeaders();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(
        ['error' => ['code' => $code, 'message' => $message]],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
};

$mimeTypes = [
    'aff' => 'text/plain; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'dic' => 'text/plain; charset=utf-8',
    'gif' => 'image/gif',
    'html' => 'text/html; charset=utf-8',
    'ico' => 'image/x-icon',
    'jpeg' => 'image/jpeg',
    'jpg' => 'image/jpeg',
    'js' => 'text/javascript; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'map' => 'application/json; charset=utf-8',
    'png' => 'image/png',
    'svg' => 'image/svg+xml',
    'txt' => 'text/plain; charset=utf-8',
    'webmanifest' => 'application/manifest+json; charset=utf-8',
    'webp' => 'image/webp',
    'woff' => 'font/woff',
    'woff2' => 'font/woff2',
];

$serveFrontendFile = static function (string $file, string $publicPath) use (
    $method,
    $mimeTypes,
    $sendFrontendError,
    $sendSecurityHeaders
): never {
    $extension = strtolower((string) pathinfo($file, PATHINFO_EXTENSION));
    $contentType = $mimeTypes[$extension] ?? null;
    if ($contentType === null || !is_file($file) || !is_readable($file)) {
        $sendFrontendError(404, 'static_file_not_found', 'Статический файл не найден.');
    }

    $size = filesize($file);
    $modified = filemtime($file);
    if ($size === false || $modified === false) {
        $sendFrontendError(500, 'static_file_unavailable', 'Статический файл временно недоступен.');
    }

    $sendSecurityHeaders();
    header('Content-Type: ' . $contentType);
    header('Content-Length: ' . $size);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $modified) . ' GMT');
    $etag = '"' . hash('sha256', $modified . ':' . $size . ':' . basename($file)) . '"';
    header('ETag: ' . $etag);

    $hashedAsset = str_starts_with($publicPath, '/assets/')
        && preg_match('/-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/', basename($publicPath)) === 1;
    header($extension === 'html'
        ? 'Cache-Control: no-cache, no-store, must-revalidate'
        : ($hashedAsset
            ? 'Cache-Control: public, max-age=31536000, immutable'
            : 'Cache-Control: public, max-age=3600'));

    $ifNoneMatch = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
    $ifModifiedSince = strtotime((string) ($_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? ''));
    if (($ifNoneMatch !== '' && hash_equals($etag, $ifNoneMatch))
        || ($ifNoneMatch === '' && $ifModifiedSince !== false && $ifModifiedSince >= $modified)) {
        http_response_code(304);
        header_remove('Content-Length');
        exit;
    }

    http_response_code(200);
    if ($method === 'HEAD') {
        exit;
    }

    if (readfile($file) === false) {
        exit(1);
    }
    exit;
};

/* Activate the SPA layer only after index.html has been uploaded. */
if (!$isApiRequest && is_file($frontendIndex)) {
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        header('Allow: GET, HEAD');
        $sendFrontendError(405, 'method_not_allowed', 'Для frontend-маршрута разрешены только GET и HEAD.');
    }

    $relativePath = ltrim(str_replace('\\', '/', $requestPath), '/');
    $segments = array_values(array_filter(explode('/', $relativePath), static fn (string $part): bool => $part !== ''));
    $containsHiddenSegment = array_filter($segments, static fn (string $part): bool => str_starts_with($part, '.')) !== [];
    $extension = strtolower((string) pathinfo($relativePath, PATHINFO_EXTENSION));

    if (str_contains($relativePath, "\0") || $containsHiddenSegment || $extension === 'php') {
        $sendFrontendError(404, 'static_file_not_found', 'Статический файл не найден.');
    }

    if ($relativePath !== '') {
        $root = realpath($frontendRoot);
        $candidate = realpath($frontendRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath));
        $insideRoot = $root !== false
            && $candidate !== false
            && str_starts_with($candidate, $root . DIRECTORY_SEPARATOR);
        if ($insideRoot && is_file($candidate)) {
            $serveFrontendFile($candidate, $requestPath);
        }

        if (str_starts_with($requestPath, '/assets/') || $extension !== '') {
            $sendFrontendError(404, 'static_file_not_found', 'Статический файл не найден.');
        }
    }

    $serveFrontendFile($frontendIndex, '/index.html');
}

/* Original backend entry point, used unchanged for /api/* and as a safe fallback. */
try {
    header_remove('X-Powered-By');
    /** @var CRM\App $app */
    $app = require dirname(__DIR__) . '/bootstrap.php';
    $app->run();
} catch (Throwable) {
    header_remove('X-Powered-By');
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode([
        'error' => ['code' => 'service_unavailable', 'message' => 'Сервис временно недоступен.'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
