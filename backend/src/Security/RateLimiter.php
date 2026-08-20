<?php

declare(strict_types=1);

namespace CRM\Security;

use CRM\Config\Config;
use CRM\Http\ApiException;
use CRM\Support\Clock;
use DateTimeImmutable;
use DateTimeZone;
use PDO;

final class RateLimiter
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function ensureAllowed(string $scope, string $key): void
    {
        $stmt = $this->db->prepare('SELECT * FROM auth_attempts WHERE scope = :scope AND key_hash = :key_hash');
        $stmt->execute(['scope' => $scope, 'key_hash' => hash('sha256', $key)]);
        $row = $stmt->fetch();
        if ($row && $row['blocked_until'] !== null) {
            $blockedUntil = new DateTimeImmutable((string) $row['blocked_until'], new DateTimeZone('UTC'));
            if ($blockedUntil > Clock::utcNow()) {
                throw new ApiException(429, 'rate_limited', 'Слишком много попыток. Повторите позже.', [
                    'retry_after_seconds' => max(1, $blockedUntil->getTimestamp() - time()),
                ]);
            }
        }
    }

    public function failure(string $scope, string $key): void
    {
        $this->record($scope, $key);
    }

    public function record(string $scope, string $key): void
    {
        $hash = hash('sha256', $key);
        $now = Clock::utcNow();
        $windowMinutes = Config::int('LOGIN_WINDOW_MINUTES', 15);
        $max = Config::int('LOGIN_MAX_ATTEMPTS', 5);
        $blockMinutes = Config::int('LOGIN_BLOCK_MINUTES', 15);

        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('SELECT * FROM auth_attempts WHERE scope = :scope AND key_hash = :key_hash FOR UPDATE');
            $stmt->execute(['scope' => $scope, 'key_hash' => $hash]);
            $row = $stmt->fetch();
            $attempts = 1;
            $windowStart = $now;
            if ($row) {
                $existingStart = new DateTimeImmutable((string) $row['window_started_at'], new DateTimeZone('UTC'));
                if ($existingStart >= $now->modify("-{$windowMinutes} minutes")) {
                    $attempts = (int) $row['attempts'] + 1;
                    $windowStart = $existingStart;
                }
            }
            $blockedUntil = $attempts >= $max ? Clock::db($now->modify("+{$blockMinutes} minutes")) : null;
            $upsert = $this->db->prepare(
                'INSERT INTO auth_attempts (scope, key_hash, attempts, window_started_at, blocked_until, updated_at)
                 VALUES (:scope, :key_hash, :attempts, :window_started_at, :blocked_until, :updated_at)
                 ON DUPLICATE KEY UPDATE attempts = VALUES(attempts), window_started_at = VALUES(window_started_at),
                    blocked_until = VALUES(blocked_until), updated_at = VALUES(updated_at)'
            );
            $upsert->execute([
                'scope' => $scope,
                'key_hash' => $hash,
                'attempts' => $attempts,
                'window_started_at' => Clock::db($windowStart),
                'blocked_until' => $blockedUntil,
                'updated_at' => Clock::db($now),
            ]);
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }

    public function clear(string $scope, string $key): void
    {
        $stmt = $this->db->prepare('DELETE FROM auth_attempts WHERE scope = :scope AND key_hash = :key_hash');
        $stmt->execute(['scope' => $scope, 'key_hash' => hash('sha256', $key)]);
    }
}
