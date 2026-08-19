<?php

declare(strict_types=1);

namespace CRM\Http;

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
        return substr((string) ($this->server['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 64);
    }

    /** @return array<string, mixed>|null */
    public function file(string $name): ?array
    {
        $file = $this->files[$name] ?? null;
        return is_array($file) ? $file : null;
    }
}

