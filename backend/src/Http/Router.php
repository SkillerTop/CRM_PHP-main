<?php

declare(strict_types=1);

namespace CRM\Http;

final class Router
{
    /** @var list<array{method:string, pattern:string, handler:callable}> */
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $this->routes[] = [
            'method' => strtoupper($method),
            'pattern' => rtrim($pattern, '/') ?: '/',
            'handler' => $handler,
        ];
    }

    public function dispatch(Request $request): mixed
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== $request->method) {
                continue;
            }

            $regex = preg_replace('/\{([A-Za-z_][A-Za-z0-9_]*)\}/', '(?P<$1>[^/]+)', $route['pattern']);
            if (!preg_match('#^' . $regex . '$#', $request->path, $matches)) {
                continue;
            }

            $params = array_filter($matches, static fn ($key): bool => is_string($key), ARRAY_FILTER_USE_KEY);
            return ($route['handler'])($request, $params);
        }

        throw new ApiException(404, 'route_not_found', 'Эндпоинт не найден.');
    }
}
