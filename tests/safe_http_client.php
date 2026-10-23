<?php

declare(strict_types=1);

use CRM\Http\ApiException;
use CRM\Support\SafeHttpClient;

require dirname(__DIR__) . '/backend/src/autoload.php';

// Website lookups fetch URLs taken from scanned cards: internal targets must never be reachable.
foreach (['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'] as $address) {
    if (SafeHttpClient::isPublicIp($address)) {
        throw new RuntimeException("Internal address accepted as public: {$address}");
    }
}
foreach (['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'] as $address) {
    if (!SafeHttpClient::isPublicIp($address)) {
        throw new RuntimeException("Public address rejected: {$address}");
    }
}

// These are rejected before any DNS lookup or connection.
$client = new SafeHttpClient(2, 0);
foreach ([
    'http://127.0.0.1/' => 'lookup_blocked_address',
    'http://[::1]/' => 'lookup_blocked_address',
    'http://[::ffff:127.0.0.1]/' => 'lookup_blocked_address',
    'http://169.254.169.254/latest/meta-data/' => 'lookup_blocked_address',
    'http://localhost/' => 'lookup_blocked_address',
    'http://printer.local/' => 'lookup_blocked_address',
    'https://example.com:8443/' => 'lookup_blocked_address',
    'ftp://example.com/' => 'lookup_invalid_url',
    'file:///etc/passwd' => 'lookup_invalid_url',
    'https://user:secret@example.com/' => 'lookup_invalid_url',
    'http://2130706433/' => 'lookup_invalid_url',
] as $url => $expected) {
    try {
        $client->get($url, 1024, ['text/html']);
        throw new RuntimeException("Blocked URL was fetched: {$url}");
    } catch (ApiException $error) {
        if ($error->errorCode !== $expected) {
            throw new RuntimeException("{$url}: expected {$expected}, got {$error->errorCode}");
        }
    }
}

foreach ([
    ['../img/logo.png', 'https://a.com/x/y/page.html', 'https://a.com/x/img/logo.png'],
    ['./logo.png', 'https://a.com/x/', 'https://a.com/x/logo.png'],
    ['/logo.svg', 'https://a.com/x/y', 'https://a.com/logo.svg'],
    ['//cdn.a.com/l.png', 'https://a.com/', 'https://cdn.a.com/l.png'],
    ['logo.png', 'https://a.com', 'https://a.com/logo.png'],
] as [$link, $base, $expected]) {
    if (($actual = SafeHttpClient::absoluteUrl($link, $base)) !== $expected) {
        throw new RuntimeException("absoluteUrl({$link}, {$base}) = {$actual}, expected {$expected}");
    }
}

echo "Safe HTTP client checks passed.\n";
