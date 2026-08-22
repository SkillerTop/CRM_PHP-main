<?php

declare(strict_types=1);

namespace CRM\Http;

use CRM\Config\Config;

final class Request
{
    private ?array $jsonBody = null;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        private readonly array $server,
        private readonly array $post,
        private readonly array $files,
        private readonly string $rawBody
    ) {
    }

    public static function capture(): self
    {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = rawurldecode((string) (parse_url($uri, PHP_URL_PATH) ?: '/'));

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            rtrim($path, '/') ?: '/',
            $_GET,
            $_SERVER,
            $_POST,
            $_FILES,
            (string) file_get_contents('php://input')
        );
    }

    /** @return array<string, mixed> */
    public function input(): array
    {
        $contentType = strtolower((string) $this->header('Content-Type', ''));
        if (str_contains($contentType, 'application/json')) {
            return $this->json();
        }

        return $this->post;
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        if ($this->jsonBody !== null) {
            return $this->jsonBody;
        }
        if ($this->rawBody === '') {
            return $this->jsonBody = [];
        }

        $decoded = json_decode($this->rawBody, true);
        if (!is_array($decoded)) {
            throw new ApiException(400, 'invalid_json', 'Тело запроса содержит некорректный JSON.');
        }

        return $this->jsonBody = $decoded;
    }

    public function header(string $name, mixed $default = null): mixed
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        if (isset($this->server[$key])) {
            return $this->server[$key];
        }
        if (strtolower($name) === 'content-type') {
            return $this->server['CONTENT_TYPE'] ?? $default;
        }

        return $default;
    }

    public function bearerToken(): ?string
    {
        $header = (string) $this->header('Authorization', '');
        return preg_match('/^Bearer\s+(.+)$/i', $header, $match) ? trim($match[1]) : null;
    }

    public function ip(): string
    {
        $remote = trim((string) ($this->server['REMOTE_ADDR'] ?? '0.0.0.0'));
        $proxySecret = (string) Config::get('PROXY_SHARED_SECRET', '');
        $providedSecret = (string) $this->header('X-CRM-Proxy-Secret', '');
        if ($proxySecret !== '' && $providedSecret !== '' && hash_equals($proxySecret, $providedSecret)) {
            $forwarded = trim((string) $this->header('X-Forwarded-For', ''));
            if (!str_contains($forwarded, ',')) {
                return $this->validIp($forwarded) ?? ($this->validIp($remote) ?? '0.0.0.0');
            }
            return $this->validIp($remote) ?? '0.0.0.0';
        }
        $trustedProxies = Config::csv('TRUSTED_PROXIES');
        if (!in_array($remote, $trustedProxies, true)) {
            return $this->validIp($remote) ?? '0.0.0.0';
        }

        $forwarded = (string) $this->header('X-Forwarded-For', '');
        $addresses = array_map('trim', explode(',', $forwarded));
        for ($index = count($addresses) - 1; $index >= 0; $index--) {
            $candidate = $this->validIp($addresses[$index]);
            if ($candidate !== null && !in_array($candidate, $trustedProxies, true)) {
                return $candidate;
            }
        }

        return $this->validIp($remote) ?? '0.0.0.0';
    }

    private function validIp(string $value): ?string
    {
        return filter_var($value, FILTER_VALIDATE_IP) !== false ? substr($value, 0, 64) : null;
    }

    /** @return array<string, mixed>|null */
    public function file(string $name): ?array
    {
        $file = $this->files[$name] ?? null;
        return is_array($file) ? $file : null;
    }
}

