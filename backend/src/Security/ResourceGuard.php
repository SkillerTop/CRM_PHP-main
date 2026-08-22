<?php

declare(strict_types=1);

namespace CRM\Security;

use CRM\Config\Config;
use CRM\Http\ApiException;
use CRM\Support\Clock;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Throwable;

final class ResourceGuard
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function consume(string $scope, int $userId, int $maximum, int $windowMinutes = 60): void
    {
        $maximum = max(1, $maximum);
        $windowMinutes = max(1, $windowMinutes);
        $keyHash = hash('sha256', (string) $userId);
        $now = Clock::utcNow();

        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('SELECT * FROM auth_attempts WHERE scope = :scope AND key_hash = :key_hash FOR UPDATE');
            $stmt->execute(['scope' => 'resource_' . $scope, 'key_hash' => $keyHash]);
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
            if ($attempts > $maximum) {
                $this->db->rollBack();
                throw new ApiException(429, 'resource_rate_limited', 'Лимит ресурсоёмких операций исчерпан. Повторите позже.', [
                    'retry_after_seconds' => max(1, $windowStart->modify("+{$windowMinutes} minutes")->getTimestamp() - time()),
                ]);
            }

            $upsert = $this->db->prepare(
                'INSERT INTO auth_attempts (scope, key_hash, attempts, window_started_at, blocked_until, updated_at)
                 VALUES (:scope, :key_hash, :attempts, :window_started_at, NULL, :updated_at)
                 ON DUPLICATE KEY UPDATE attempts = VALUES(attempts), window_started_at = VALUES(window_started_at),
                    blocked_until = NULL, updated_at = VALUES(updated_at)'
            );
            $upsert->execute([
                'scope' => 'resource_' . $scope,
                'key_hash' => $keyHash,
                'attempts' => $attempts,
                'window_started_at' => Clock::db($windowStart),
                'updated_at' => Clock::db($now),
            ]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }

    public function exclusive(string $scope, callable $operation): mixed
    {
        $lockName = 'crm_resource_' . substr(hash('sha256', $scope), 0, 40);
        $stmt = $this->db->prepare('SELECT GET_LOCK(:name, 0)');
        $stmt->execute(['name' => $lockName]);
        if ((int) $stmt->fetchColumn() !== 1) {
            throw new ApiException(429, 'resource_busy', 'Сервис занят другой операцией. Повторите позже.');
        }
        try {
            return $operation();
        } finally {
            $release = $this->db->prepare('SELECT RELEASE_LOCK(:name)');
            $release->execute(['name' => $lockName]);
        }
    }

    public function storeWithinQuota(int $incomingBytes, callable $operation): mixed
    {
        $uploadRoot = Config::root((string) Config::get('UPLOAD_DIR', 'storage/uploads'));
        $storageRoot = Config::root('storage');
        if (!is_dir($storageRoot) && !mkdir($storageRoot, 0770, true) && !is_dir($storageRoot)) {
            throw new ApiException(500, 'storage_unavailable', 'Хранилище недоступно.');
        }
        $lock = fopen($storageRoot . '/.upload-quota.lock', 'c+');
        if ($lock === false || !flock($lock, LOCK_EX)) {
            if (is_resource($lock)) {
                fclose($lock);
            }
            throw new ApiException(503, 'storage_busy', 'Не удалось зарезервировать место в хранилище.');
        }
        try {
            $limit = max(1, Config::int('UPLOAD_STORAGE_MAX_BYTES', 10 * 1024 * 1024 * 1024));
            if ($this->directoryBytes($uploadRoot) + max(0, $incomingBytes) > $limit) {
                throw new ApiException(507, 'storage_quota_exceeded', 'Квота файлового хранилища исчерпана.');
            }
            return $operation();
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function directoryBytes(string $root): int
    {
        if (!is_dir($root)) {
            return 0;
        }
        $bytes = 0;
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS)
        );
        foreach ($iterator as $entry) {
            if ($entry->isFile() && !$entry->isLink()) {
                $bytes += $entry->getSize();
            }
        }
        return $bytes;
    }
}
