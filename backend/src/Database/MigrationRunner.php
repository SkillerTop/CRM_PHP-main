<?php

declare(strict_types=1);

namespace CRM\Database;

use CRM\Config\Config;
use PDO;
use RuntimeException;

final class MigrationRunner
{
    public function __construct(private readonly PDO $db, private readonly ?string $migrationDirectory = null)
    {
    }

    /** @return list<string> */
    public function run(): array
    {
        $lock = $this->db->query("SELECT GET_LOCK('crm_schema_migrations', 0)")->fetchColumn();
        if ((int) $lock !== 1) {
            throw new RuntimeException('Another migration process is already running.');
        }
        try {
            return $this->runLocked();
        } finally {
            $this->db->query("SELECT RELEASE_LOCK('crm_schema_migrations')");
        }
    }

    /** @return list<string> */
    private function runLocked(): array
    {
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
                migration VARCHAR(255) PRIMARY KEY,
                applied_at DATETIME(6) NOT NULL
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci'
        );
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS schema_migration_steps (
                migration VARCHAR(255) NOT NULL,
                step_number INT UNSIGNED NOT NULL,
                statement_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                status VARCHAR(20) NOT NULL,
                error_message TEXT NULL,
                started_at DATETIME(6) NULL,
                applied_at DATETIME(6) NULL,
                updated_at DATETIME(6) NOT NULL,
                PRIMARY KEY (migration, step_number)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci'
        );
        $applied = $this->db->query('SELECT migration FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        $directory = $this->migrationDirectory ?? Config::root('database/migrations');
        $files = glob(rtrim($directory, '/\\') . '/*.sql') ?: [];
        sort($files, SORT_STRING);
        $completed = [];
        foreach ($files as $file) {
            $name = basename($file);
            if (in_array($name, $applied, true)) {
                continue;
            }
            $sql = file_get_contents($file);
            if ($sql === false) {
                throw new RuntimeException("Unable to read migration {$name}.");
            }
            foreach ($this->split($sql) as $index => $statement) {
                $this->runStep($name, $index + 1, $statement);
            }
            $stmt = $this->db->prepare('INSERT INTO schema_migrations (migration, applied_at) VALUES (:migration, UTC_TIMESTAMP(6))');
            $stmt->execute(['migration' => $name]);
            $completed[] = $name;
        }
        return $completed;
    }

    public function resolve(string $migration, int $step, string $resolution): void
    {
        if (!in_array($resolution, ['applied', 'retry'], true)) {
            throw new RuntimeException('Resolution must be applied or retry.');
        }
        $status = $resolution === 'applied' ? 'applied' : 'failed';
        $stmt = $this->db->prepare(
            "UPDATE schema_migration_steps SET status = :status,
                applied_at = IF(:applied = 'applied', UTC_TIMESTAMP(6), NULL),
                error_message = NULL, updated_at = UTC_TIMESTAMP(6)
             WHERE migration = :migration AND step_number = :step AND status = 'running'"
        );
        $stmt->execute(['status' => $status, 'applied' => $status, 'migration' => $migration, 'step' => $step]);
        if ($stmt->rowCount() !== 1) {
            throw new RuntimeException('Only an ambiguous running migration step can be resolved.');
        }
    }

    private function runStep(string $migration, int $step, string $statement): void
    {
        $hash = hash('sha256', $statement);
        $select = $this->db->prepare(
            'SELECT statement_hash, status FROM schema_migration_steps
             WHERE migration = :migration AND step_number = :step'
        );
        $select->execute(['migration' => $migration, 'step' => $step]);
        $row = $select->fetch();
        if ($row) {
            if (!hash_equals((string) $row['statement_hash'], $hash)) {
                throw new RuntimeException("Migration {$migration} step {$step} changed after it was journaled.");
            }
            if ($row['status'] === 'applied') {
                return;
            }
            if ($row['status'] === 'running') {
                throw new RuntimeException(
                    "Migration {$migration} step {$step} has an ambiguous running state. " .
                    "Verify the schema, then run: bin/console migrate:resolve {$migration} {$step} applied|retry"
                );
            }
        } else {
            $insert = $this->db->prepare(
                "INSERT INTO schema_migration_steps
                    (migration, step_number, statement_hash, status, updated_at)
                 VALUES (:migration, :step, :hash, 'pending', UTC_TIMESTAMP(6))"
            );
            $insert->execute(['migration' => $migration, 'step' => $step, 'hash' => $hash]);
        }

        $running = $this->db->prepare(
            "UPDATE schema_migration_steps SET status = 'running', error_message = NULL,
                started_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6)
             WHERE migration = :migration AND step_number = :step"
        );
        $running->execute(['migration' => $migration, 'step' => $step]);
        try {
            $this->db->exec($statement);
            $done = $this->db->prepare(
                "UPDATE schema_migration_steps SET status = 'applied', applied_at = UTC_TIMESTAMP(6),
                    updated_at = UTC_TIMESTAMP(6) WHERE migration = :migration AND step_number = :step"
            );
            $done->execute(['migration' => $migration, 'step' => $step]);
        } catch (\Throwable $error) {
            $failed = $this->db->prepare(
                "UPDATE schema_migration_steps SET status = 'failed', error_message = :error,
                    updated_at = UTC_TIMESTAMP(6) WHERE migration = :migration AND step_number = :step"
            );
            $failed->execute(['error' => substr($error->getMessage(), 0, 2000), 'migration' => $migration, 'step' => $step]);
            throw $error;
        }
    }

    /** @return list<string> */
    private function split(string $sql): array
    {
        $statements = [];
        $buffer = '';
        $quote = null;
        $length = strlen($sql);
        for ($i = 0; $i < $length; $i++) {
            $char = $sql[$i];
            $next = $i + 1 < $length ? $sql[$i + 1] : '';
            if ($quote === null && $char === '-' && $next === '-') {
                while ($i < $length && $sql[$i] !== "\n") {
                    $i++;
                }
                $buffer .= "\n";
                continue;
            }
            if (($char === "'" || $char === '"') && ($i === 0 || $sql[$i - 1] !== '\\')) {
                $quote = $quote === null ? $char : ($quote === $char ? null : $quote);
            }
            if ($char === ';' && $quote === null) {
                $statement = trim($buffer);
                if ($statement !== '') {
                    $statements[] = $statement;
                }
                $buffer = '';
                continue;
            }
            $buffer .= $char;
        }
        if (trim($buffer) !== '') {
            $statements[] = trim($buffer);
        }
        return $statements;
    }
}

