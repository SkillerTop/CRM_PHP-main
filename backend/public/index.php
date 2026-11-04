<?php

declare(strict_types=1);

// The API answers JSON only: a warning printed into the body ("display_errors=1" in a
// development php.ini) breaks every response it lands in. Errors go to the log instead.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', dirname(__DIR__) . '/storage/logs/php-errors.log');

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
