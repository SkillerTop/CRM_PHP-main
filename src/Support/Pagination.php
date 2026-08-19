<?php

declare(strict_types=1);

namespace CRM\Support;

final class Pagination
{
    public readonly int $page;
    public readonly int $perPage;

    public function __construct(array $query, int $default = 50, int $maximum = 100)
    {
        $this->page = max(1, (int) ($query['page'] ?? 1));
        $requested = (int) ($query['per_page'] ?? $default);
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

