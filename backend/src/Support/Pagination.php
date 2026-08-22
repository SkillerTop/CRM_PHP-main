<?php

declare(strict_types=1);

namespace CRM\Support;

final class Pagination
{
    public readonly int $page;
    public readonly int $perPage;

    public function __construct(array $query, int $default = 50, int $maximum = 100, string $prefix = '')
    {
        $pageKey = $prefix === '' ? 'page' : $prefix . '_page';
        $perPageKey = $prefix === '' ? 'per_page' : $prefix . '_per_page';
        $this->page = max(1, (int) ($query[$pageKey] ?? 1));
        $requested = (int) ($query[$perPageKey] ?? $default);
        $this->perPage = max(1, min($maximum, $requested));
    }

    public function offset(): int
    {
        return ($this->page - 1) * $this->perPage;
    }

    /** @return array<string, int> */
    public function meta(int $total): array
    {
        return [
            'page' => $this->page,
            'per_page' => $this->perPage,
            'total' => $total,
            'pages' => max(1, (int) ceil($total / $this->perPage)),
        ];
    }
}

