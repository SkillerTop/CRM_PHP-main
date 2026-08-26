<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Support\Clock;
use PDO;

final class ManagerUserLinker
{
    public function __construct(private readonly PDO $db)
    {
    }

    /** @return array{id:int,value:string}|null */
    public function ensureForUser(int $userId): ?array
    {
        $linked = $this->linkedManagers($userId);
        if ($linked !== []) {
            return count($linked) === 1 && (bool) $linked[0]['is_active']
                ? $this->managerResult($linked[0])
                : null;
        }

        $user = $this->activeUser($userId);
        if ($user === null) {
            return null;
        }

        $name = self::normalizeName((string) $user['full_name']);
        if ($name === '' || !$this->isUniqueActiveUserName($name, $userId)) {
            return null;
        }

        $matches = array_values(array_filter(
            $this->activeManagers(),
            static fn (array $manager): bool => self::normalizeName((string) $manager['value']) === $name
        ));
        if (count($matches) !== 1 || $matches[0]['user_id'] !== null) {
            return null;
        }

        $manager = $matches[0];
        $update = $this->db->prepare(
            "UPDATE lookups
             SET user_id = :user_id, updated_by = :updated_by, updated_at = :updated_at
             WHERE id = :manager_id AND type = 'cjn_manager' AND user_id IS NULL"
        );
        $update->execute([
            'user_id' => $userId,
            'updated_by' => $userId,
            'updated_at' => Clock::dbNow(),
            'manager_id' => $manager['id'],
        ]);
        if ($update->rowCount() !== 1) {
            return null;
        }

        return $this->managerResult($manager);
    }

    /** @return list<array<string,mixed>> */
    private function linkedManagers(int $userId): array
    {
        $stmt = $this->db->prepare(
            "SELECT id, value, is_active
             FROM lookups
             WHERE type = 'cjn_manager' AND user_id = :user_id
             ORDER BY id"
        );
        $stmt->execute(['user_id' => $userId]);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null */
    private function activeUser(int $userId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT id, full_name FROM users
             WHERE id = :id AND is_active = 1 AND pending_approval = 0
             LIMIT 1'
        );
        $stmt->execute(['id' => $userId]);
        $user = $stmt->fetch();
        return $user ?: null;
    }

    private function isUniqueActiveUserName(string $name, int $userId): bool
    {
        $rows = $this->db->query(
            'SELECT id, full_name FROM users WHERE is_active = 1 AND pending_approval = 0'
        )->fetchAll();
        $matches = array_values(array_filter(
            $rows,
            static fn (array $user): bool => self::normalizeName((string) $user['full_name']) === $name
        ));

        return count($matches) === 1 && (int) $matches[0]['id'] === $userId;
    }

    /** @return list<array<string,mixed>> */
    private function activeManagers(): array
    {
        return $this->db->query(
            "SELECT id, value, user_id
             FROM lookups
             WHERE type = 'cjn_manager' AND is_active = 1
             ORDER BY id"
        )->fetchAll();
    }

    /** @param array<string,mixed> $manager
     *  @return array{id:int,value:string}
     */
    private function managerResult(array $manager): array
    {
        return ['id' => (int) $manager['id'], 'value' => (string) $manager['value']];
    }

    private static function normalizeName(string $value): string
    {
        $collapsed = preg_replace('/\s+/u', ' ', trim($value));
        return mb_strtolower($collapsed ?? trim($value), 'UTF-8');
    }
}
