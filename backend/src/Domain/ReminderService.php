<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Support\Clock;
use PDO;
use Throwable;

final class ReminderService
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer,
        private readonly IcsGenerator $ics
    ) {
    }

    /** @param list<int> $leadIds */
    public function syncTask(int $taskId, array $leadIds): void
    {
        $delete = $this->db->prepare('DELETE FROM task_reminder_leads WHERE task_id = :task_id');
        $delete->execute(['task_id' => $taskId]);
        $insert = $this->db->prepare(
            'INSERT INTO task_reminder_leads (task_id, reminder_lead_lookup_id, created_at)
             VALUES (:task_id, :lead_id, :created_at)'
        );
        foreach ($leadIds as $leadId) {
            $insert->execute(['task_id' => $taskId, 'lead_id' => $leadId, 'created_at' => Clock::dbNow()]);
        }
        $this->reschedule($taskId);
    }

    public function reschedule(int $taskId): void
    {
        $cancel = $this->db->prepare(
            "UPDATE task_reminders SET state = 'cancelled', updated_at = :now
             WHERE task_id = :task_id AND state IN ('pending', 'failed')"
        );
        $cancel->execute(['now' => Clock::dbNow(), 'task_id' => $taskId]);

        $stmt = $this->db->prepare(
            'SELECT t.id, t.deadline, t.manager_lookup_id, t.is_archived, ts.is_closed,
                    trl.reminder_lead_lookup_id, rl.minutes_before
             FROM tasks t
             JOIN lookups ts ON ts.id = t.status_lookup_id
             JOIN task_reminder_leads trl ON trl.task_id = t.id
             JOIN lookups rl ON rl.id = trl.reminder_lead_lookup_id
             WHERE t.id = :task_id'
        );
        $stmt->execute(['task_id' => $taskId]);
        $now = Clock::utcNow();
        $insert = $this->db->prepare(
            'INSERT INTO task_reminders
                (task_id, reminder_lead_lookup_id, deadline_snapshot, manager_lookup_id,
                 scheduled_at, state, attempts, created_at, updated_at)
             VALUES (:task_id, :lead_id, :deadline, :manager_id, :scheduled_at, :state, 0, :created_at, :updated_at)'
        );
        foreach ($stmt->fetchAll() as $row) {
            if ($row['deadline'] === null || (bool) $row['is_archived'] || (bool) $row['is_closed']) {
                continue;
            }
            $deadline = new \DateTimeImmutable((string) $row['deadline'], new \DateTimeZone('UTC'));
            $scheduled = $deadline->modify('-' . (int) $row['minutes_before'] . ' minutes');
            $state = $scheduled <= $now ? 'skipped' : 'pending';
            $insert->execute([
                'task_id' => $taskId,
                'lead_id' => $row['reminder_lead_lookup_id'],
                'deadline' => $row['deadline'],
                'manager_id' => $row['manager_lookup_id'],
                'scheduled_at' => Clock::db($scheduled),
                'state' => $state,
                'created_at' => Clock::db($now),
                'updated_at' => Clock::db($now),
            ]);
        }
    }

    /** @return array{sent:int,failed:int,skipped:int} */
    public function run(int $limit = 100): array
    {
        $this->db->exec(
            "UPDATE task_reminders SET state = 'failed', error_message = 'Recovered stale processing lock',
                updated_at = UTC_TIMESTAMP(6)
             WHERE state = 'processing' AND locked_at < UTC_TIMESTAMP(6) - INTERVAL 30 MINUTE"
        );
        $summary = ['sent' => 0, 'failed' => 0, 'skipped' => 0];
        for ($i = 0; $i < $limit; $i++) {
            $reminderId = $this->claimNext();
            if ($reminderId === null) {
                break;
            }
            $result = $this->deliver($reminderId);
            $summary[$result]++;
        }
        return $summary;
    }

    private function claimNext(): ?int
    {
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->query(
                "SELECT id FROM task_reminders
                 WHERE scheduled_at <= UTC_TIMESTAMP(6)
                   AND (state = 'pending' OR (state = 'failed' AND attempts < 5 AND updated_at <= UTC_TIMESTAMP(6) - INTERVAL 15 MINUTE))
                 ORDER BY scheduled_at, id
                 LIMIT 1 FOR UPDATE SKIP LOCKED"
            );
            $id = $stmt->fetchColumn();
            if ($id === false) {
                $this->db->commit();
                return null;
            }
            $update = $this->db->prepare(
                "UPDATE task_reminders SET state = 'processing', attempts = attempts + 1,
                    locked_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6) WHERE id = :id"
            );
            $update->execute(['id' => $id]);
            $this->db->commit();
            return (int) $id;
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }

    private function deliver(int $reminderId): string
    {
        $stmt = $this->db->prepare(
            'SELECT r.*, t.name, t.description, t.deadline, t.manager_lookup_id AS current_manager_id,
                    t.is_archived, c.name AS company_name, ts.is_closed, m.value AS manager_value,
                    CASE
                        WHEN m.user_id IS NOT NULL AND u.is_active = 1 AND u.pending_approval = 0 THEN u.email
                        WHEN m.user_id IS NULL THEN m.email
                        ELSE NULL
                    END AS recipient_email
             FROM task_reminders r
             JOIN tasks t ON t.id = r.task_id
             JOIN companies c ON c.id = t.company_id
             JOIN lookups ts ON ts.id = t.status_lookup_id
             JOIN lookups m ON m.id = t.manager_lookup_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE r.id = :id'
        );
        $stmt->execute(['id' => $reminderId]);
        $row = $stmt->fetch();
        if (!$row || (bool) $row['is_archived'] || (bool) $row['is_closed'] ||
            (int) $row['current_manager_id'] !== (int) $row['manager_lookup_id'] ||
            (string) $row['deadline'] !== (string) $row['deadline_snapshot']) {
            $this->mark($reminderId, 'skipped', null, 'Task is closed, archived, or rescheduled.');
            return 'skipped';
        }
        $recipient = (string) ($row['recipient_email'] ?? '');
        if ($recipient === '' || filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) {
            $error = 'У ответственного менеджера отсутствует email.';
            $this->mark($reminderId, 'failed', null, $error);
            $this->audit->log('REMINDER FAILED', 'Task', (int) $row['task_id'], (string) $row['name'], detail: ['error' => $error], actorName: 'system');
            return 'failed';
        }

        try {
            $calendar = $this->ics->forTask($row);
            $this->mailer->send(
                $recipient,
                'CRM deadline: ' . (string) $row['name'],
                "Напоминание о задаче CRM\n\nКомпания: {$row['company_name']}\nЗадача: {$row['name']}\nДедлайн (UTC): {$row['deadline']}\n",
                [['name' => 'task-' . (int) $row['task_id'] . '.ics', 'mime' => 'text/calendar; charset=UTF-8', 'content' => $calendar]]
            );
            $this->mark($reminderId, 'sent', $recipient, null);
            $this->audit->log('REMINDER SENT', 'Task', (int) $row['task_id'], (string) $row['name'], detail: ['recipient' => $recipient], actorName: 'system');
            return 'sent';
        } catch (Throwable) {
            $failure = 'Почтовое напоминание не отправлено.';
            $this->mark($reminderId, 'failed', $recipient, $failure);
            $this->audit->log('REMINDER FAILED', 'Task', (int) $row['task_id'], (string) $row['name'], detail: ['recipient' => $recipient, 'error' => $failure], actorName: 'system');
            return 'failed';
        }
    }

    private function mark(int $id, string $state, ?string $recipient, ?string $error): void
    {
        $stmt = $this->db->prepare(
            "UPDATE task_reminders SET state = :state, recipient_email = :recipient,
                error_message = :error, sent_at = IF(:state_for_sent = 'sent', UTC_TIMESTAMP(6), sent_at),
                updated_at = UTC_TIMESTAMP(6) WHERE id = :id"
        );
        $stmt->execute([
            'state' => $state,
            'recipient' => $recipient,
            'error' => $error,
            'state_for_sent' => $state,
            'id' => $id,
        ]);
    }
}
