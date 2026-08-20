<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Http\ApiException;
use CRM\Support\Clock;
use PDO;

final class LookupService
{
    public const TYPES = [
        'company_type',
        'client_status',
        'task_status',
        'outcome_status',
        'contact_source',
        'reminder_lead_time',
        'cjn_manager',
    ];

    public function __construct(private readonly PDO $db)
    {
    }

    /** @return array<string, mixed> */
    public function get(int $id, ?string $type = null, bool $allowInactive = false): array
    {
        $sql = 'SELECT * FROM lookups WHERE id = :id';
        $params = ['id' => $id];
        if ($type !== null) {
            $sql .= ' AND type = :type';
            $params['type'] = $type;
        }
        if (!$allowInactive) {
            $sql .= ' AND is_active = 1';
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(400, 'invalid_lookup', 'Указано недоступное значение справочника.');
        }
        return $this->map($row);
    }

    /** @return array<string, mixed> */
    public function getForAssignment(int $id, string $type, ?int $currentId = null): array
    {
        return $this->get($id, $type, $currentId !== null && $id === $currentId);
    }

    public function idByKey(string $type, string $key): int
    {
        $stmt = $this->db->prepare('SELECT id FROM lookups WHERE type = :type AND key_code = :key LIMIT 1');
        $stmt->execute(['type' => $type, 'key' => $key]);
        $id = $stmt->fetchColumn();
        if ($id === false) {
            throw new ApiException(500, 'lookup_seed_missing', "Не найдено системное значение {$type}/{$key}.");
        }
        return (int) $id;
    }

    public function label(?int $id): string
    {
        if ($id === null || $id === 0) {
            return '—';
        }
        $stmt = $this->db->prepare('SELECT value FROM lookups WHERE id = :id');
        $stmt->execute(['id' => $id]);
        return (string) ($stmt->fetchColumn() ?: '—');
    }

    /** @param list<int> $ids */
    public function labels(array $ids): string
    {
        if ($ids === []) {
            return '—';
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->db->prepare("SELECT id, value FROM lookups WHERE id IN ({$placeholders})");
        $stmt->execute($ids);
        $labels = [];
        foreach ($stmt->fetchAll() as $row) {
            $labels[(int) $row['id']] = (string) $row['value'];
        }
        return implode(', ', array_map(static fn (int $id): string => $labels[$id] ?? "#{$id}", $ids));
    }

    /** @return array<string, mixed> */
    public function map(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'type' => (string) $row['type'],
            'key' => (string) $row['key_code'],
            'value' => (string) $row['value'],
            'sort_order' => (int) $row['sort_order'],
            'is_active' => (bool) $row['is_active'],
            'is_closed' => (bool) $row['is_closed'],
            'minutes_before' => $row['minutes_before'] === null ? null : (int) $row['minutes_before'],
            'requires_detail' => (bool) $row['requires_detail'],
            'requires_referral' => (bool) $row['requires_referral'],
            'user_id' => $row['user_id'] === null ? null : (int) $row['user_id'],
            'email' => $row['email'],
            'created_at' => Clock::api($row['created_at'] ?? null),
            'updated_at' => Clock::api($row['updated_at'] ?? null),
        ];
    }

    public static function assertType(string $type): void
    {
        if (!in_array($type, self::TYPES, true)) {
            throw new ApiException(404, 'lookup_type_not_found', 'Неизвестный тип справочника.');
        }
    }
}
