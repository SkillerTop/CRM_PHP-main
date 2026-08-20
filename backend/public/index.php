<?php

declare(strict_types=1);

try {
    /** @var CRM\App $app */
    $app = require dirname(__DIR__) . '/bootstrap.php';
    $app->run();
} catch (Throwable) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode([
        'error' => ['code' => 'service_unavailable', 'message' => 'Сервис временно недоступен.'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
