<?php

declare(strict_types=1);

namespace CRM\Database;

use CRM\Config\Config;
use PDO;
use RuntimeException;

final class MigrationRunner
{
    public function __construct(private readonly PDO $db)
    {
    }

    /** @return list<string> */
    public function run(): array
    {
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
                migration VARCHAR(255) PRIMARY KEY,
                applied_at DATETIME(6) NOT NULL
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci'
        );
        $applied = $this->db->query('SELECT migration FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        $files = glob(Config::root('database/migrations/*.sql')) ?: [];
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
            foreach ($this->split($sql) as $statement) {
                $this->db->exec($statement);
            }
            $stmt = $this->db->prepare('INSERT INTO schema_migrations (migration, applied_at) VALUES (:migration, UTC_TIMESTAMP(6))');
            $stmt->execute(['migration' => $name]);
            $completed[] = $name;
        }
        return $completed;
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

