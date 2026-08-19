<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Security\AuthContext;
use CRM\Support\Clock;
use PDO;

final class AuditLogger
{
    public function __construct(private readonly PDO $db, private readonly AuthContext $auth)
    {
    }

    /** @param array<string, mixed> $detail */
    public function log(
        string $action,
        string $entityType,
        ?int $entityId,
        string $entityLabel,
        ?string $field = null,
        ?string $from = null,
        ?string $to = null,
        array $detail = [],
        ?int $actorUserId = null,
        ?string $actorName = null
    ): void {
        $actorUserId ??= $this->auth->authenticated() ? $this->auth->userId() : null;
        $actorName ??= $this->auth->authenticated() ? $this->auth->actorName() : 'system';
        $stmt = $this->db->prepare(
            'INSERT INTO change_events
                (actor_user_id, actor_name, action, entity_type, entity_id, entity_label,
                 field_name, value_from, value_to, detail_json, created_at)
             VALUES
                (:actor_user_id, :actor_name, :action, :entity_type, :entity_id, :entity_label,
                 :field_name, :value_from, :value_to, :detail_json, :created_at)'
        );
        $stmt->execute([
            'actor_user_id' => $actorUserId,
            'actor_name' => $actorName,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'entity_label' => $entityLabel,
            'field_name' => $field,
            'value_from' => $from,
            'value_to' => $to,
            'detail_json' => $detail === [] ? null : json_encode($detail, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'created_at' => Clock::dbNow(),
        ]);
    }

    /**
     * @param array<string, mixed> $before
     * @param array<string, mixed> $after
     * @param array<string, string> $fieldLabels
     * @param callable(string, mixed): string|null $formatter
     */
    public function logDiff(
        string $entityType,
        int $entityId,
        string $entityLabel,
        array $before,
        array $after,
        array $fieldLabels,
        ?callable $formatter = null
    ): int {
        $count = 0;
        foreach ($fieldLabels as $field => $label) {
            $old = $before[$field] ?? null;
            $new = $after[$field] ?? null;
            if ((string) $old === (string) $new) {
                continue;
            }
            $oldText = $formatter ? $formatter($field, $old) : $this->stringify($old);
            $newText = $formatter ? $formatter($field, $new) : $this->stringify($new);
            $this->log('FIELD CHANGE', $entityType, $entityId, $entityLabel, $label, $oldText, $newText);
            $count++;
        }
        return $count;
    }

    private function stringify(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '—';
        }
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_array($value)) {
            return implode(', ', array_map('strval', $value));
        }
        return (string) $value;
    }
}

