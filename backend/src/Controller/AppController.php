<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\AuditLogger;
use CRM\Domain\EntityMapper;
use CRM\Domain\LookupService;
use CRM\Http\Response;
use CRM\Http\Request;
use CRM\Security\AuthContext;
use CRM\Support\Clock;
use PDO;

final class AppController
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly LookupService $lookups
    ) {
    }

    public function bootstrap(Request $request): never
    {
        $admin = $this->auth->user()['role'] === 'admin';
        $canWrite = in_array($this->auth->user()['role'], ['admin', 'manager', 'editor'], true);
        // Bootstrap is intentionally metadata-only. Records are loaded through paginated endpoints.
        $includeRecords = false;
        $archiveWhere = !$includeRecords ? ' WHERE 1 = 0' : ($admin ? '' : ' WHERE c.is_archived = 0');
        $companies = $this->db->query(
            "SELECT c.*, ct.value AS type_value, cs.value AS status_value,
                    mgr.value AS manager_value, mgr.email AS manager_email,
                    creator.full_name AS created_by_name, creator.email AS created_by_email
             FROM companies c
             JOIN lookups ct ON ct.id = c.type_lookup_id
             JOIN lookups cs ON cs.id = c.status_lookup_id
             JOIN lookups mgr ON mgr.id = c.manager_lookup_id
             LEFT JOIN users creator ON creator.id = c.created_by{$archiveWhere}
             ORDER BY c.name, c.id"
        )->fetchAll();

        $contactWhere = !$includeRecords ? ' WHERE 1 = 0' : ($admin ? '' : ' WHERE k.is_archived = 0 AND c.is_archived = 0');
        $contacts = $this->db->query(
            "SELECT k.*, c.name AS company_name, src.value AS source_value, ini.value AS initiated_by_value,
                    mgr.value AS manager_value, mgr.email AS manager_email,
                    creator.full_name AS created_by_name, creator.email AS created_by_email
             FROM contacts k JOIN companies c ON c.id = k.company_id
             LEFT JOIN lookups src ON src.id = k.source_lookup_id
             LEFT JOIN lookups ini ON ini.id = k.initiated_by_lookup_id
             JOIN lookups mgr ON mgr.id = k.manager_lookup_id
             LEFT JOIN users creator ON creator.id = k.created_by{$contactWhere}
             ORDER BY k.last_name, k.first_name, k.id"
        )->fetchAll();

        $taskWhere = !$includeRecords ? ' WHERE 1 = 0' : ($admin ? '' : ' WHERE t.is_archived = 0 AND c.is_archived = 0');
        $tasks = $this->db->query(
            "SELECT t.*, c.name AS company_name, m.value AS manager_value, m.email AS manager_email,
                    s.value AS status_value, s.is_closed AS status_is_closed, o.value AS outcome_status_value,
                    creator.full_name AS created_by_name, creator.email AS created_by_email,
                    TRIM(CONCAT(COALESCE(k.first_name, ''), ' ', COALESCE(k.last_name, ''))) AS contact_person_name,
                    (s.is_closed = 0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)) AS is_overdue,
                    (CASE
                        WHEN m.user_id IS NOT NULL THEN manager_user.is_active = 1 AND manager_user.pending_approval = 0 AND manager_user.email <> ''
                        ELSE m.email IS NOT NULL AND m.email <> ''
                    END) AS reminder_possible,
                    (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count,
                    (SELECT COUNT(*) FROM change_events ce WHERE ce.entity_type = 'Task' AND ce.entity_id = t.id) AS change_count
             FROM tasks t JOIN companies c ON c.id = t.company_id
             JOIN lookups m ON m.id = t.manager_lookup_id JOIN lookups s ON s.id = t.status_lookup_id
             LEFT JOIN users manager_user ON manager_user.id = m.user_id
             LEFT JOIN lookups o ON o.id = t.outcome_status_lookup_id
             LEFT JOIN contacts k ON k.id = t.contact_person_id
             LEFT JOIN users creator ON creator.id = t.created_by{$taskWhere}
             ORDER BY t.contact_date DESC, t.id DESC"
        )->fetchAll();

        $leadRows = $includeRecords ? $this->db->query(
            'SELECT trl.task_id, l.id, l.value FROM task_reminder_leads trl
             JOIN lookups l ON l.id = trl.reminder_lead_lookup_id ORDER BY l.sort_order, l.id'
        )->fetchAll() : [];
        $leads = [];
        foreach ($leadRows as $row) {
            $leads[(int) $row['task_id']][] = ['id' => (int) $row['id'], 'value' => (string) $row['value']];
        }
        $mappedTasks = [];
        foreach ($tasks as $row) {
            $task = EntityMapper::task($row);
            $task['reminder_leads'] = $leads[(int) $row['id']] ?? [];
            $mappedTasks[] = $task;
        }

        $commentWhere = $admin ? '' : ' AND tc.is_hidden = 0';
        $commentScope = $includeRecords ? 't.is_archived = 0 AND c.is_archived = 0' : '1 = 0';
        $comments = $this->db->query(
            "SELECT tc.* FROM task_comments tc JOIN tasks t ON t.id = tc.task_id
             JOIN companies c ON c.id = t.company_id
             WHERE {$commentScope}{$commentWhere}
             ORDER BY tc.created_at, tc.id"
        )->fetchAll();
        $mappedComments = array_map(static fn (array $row): array => [
            'id' => (int) $row['id'], 'task_id' => (int) $row['task_id'],
            'author_user_id' => $row['author_user_id'] === null ? null : (int) $row['author_user_id'],
            'author' => (string) $row['author_name'], 'text' => (string) $row['text'], 'is_hidden' => (bool) $row['is_hidden'],
            'created_at' => Clock::api((string) $row['created_at']),
        ], $comments);

        $attachmentRows = $this->db->query(
            'SELECT ta.* FROM task_attachments ta
             JOIN tasks t ON t.id = ta.task_id JOIN companies c ON c.id = t.company_id
             WHERE ta.deleted_at IS NULL AND ' . ($includeRecords ? 't.is_archived = 0 AND c.is_archived = 0' : '1 = 0') . '
             ORDER BY ta.created_at, ta.id'
        )->fetchAll();
        $attachments = array_map(static fn (array $row): array => [
            'id' => (int) $row['id'], 'task_id' => (int) $row['task_id'],
            'original_name' => (string) $row['original_name'], 'mime_type' => (string) $row['mime_type'],
            'size_bytes' => (int) $row['size_bytes'], 'author_user_id' => (int) $row['author_user_id'],
            'author_name' => (string) $row['author_name'], 'created_at' => Clock::api((string) $row['created_at']),
        ], $attachmentRows);

        $lookupSql = 'SELECT * FROM lookups' . ($admin ? '' : ' WHERE is_active = 1') . ' ORDER BY type, sort_order, id';
        $lookupGroups = [];
        foreach ($this->db->query($lookupSql)->fetchAll() as $row) {
            $lookupGroups[(string) $row['type']][] = $this->lookups->map($row, $admin);
        }

        $users = [];
        if ($admin) {
            $rows = $this->db->query('SELECT * FROM users ORDER BY pending_approval DESC, is_active DESC, full_name')->fetchAll();
            $users = array_map(static fn (array $row): array => [
                'id' => (int) $row['id'], 'full_name' => (string) $row['full_name'], 'email' => (string) $row['email'],
                'role' => (string) $row['role'], 'is_active' => (bool) $row['is_active'],
                'pending_approval' => (bool) $row['pending_approval'], 'last_login_at' => Clock::api($row['last_login_at'] ?? null),
                'updated_at' => Clock::api($row['updated_at'] ?? null), 'photo_data_url' => $row['photo_data_url'] ?? null,
            ], $rows);
        } elseif ($canWrite) {
            foreach ($lookupGroups['cjn_manager'] ?? [] as $manager) {
                if (!empty($manager['email'])) {
                    $users[] = ['id' => $manager['user_id'], 'full_name' => $manager['value'], 'email' => $manager['email'], 'role' => 'editor', 'is_active' => true, 'pending_approval' => false, 'last_login_at' => null, 'updated_at' => $manager['updated_at']];
                }
            }
        }

        $events = [];
        if ($admin) {
            $rows = $this->db->query('SELECT * FROM change_events ORDER BY created_at DESC, id DESC LIMIT 500')->fetchAll();
            $events = array_map(static function (array $row): array {
                $row = AuditLogger::redactEvent($row);
                return [
                    'id' => (int) $row['id'], 'timestamp' => Clock::api((string) $row['created_at']),
                    'actor_user_id' => $row['actor_user_id'] === null ? null : (int) $row['actor_user_id'],
                    'actor' => (string) $row['actor_name'], 'action' => (string) $row['action'],
                    'entity_type' => (string) $row['entity_type'], 'entity_id' => $row['entity_id'] === null ? null : (int) $row['entity_id'],
                    'entity_label' => (string) $row['entity_label'], 'field' => $row['field_name'],
                    'from' => $row['value_from'], 'to' => $row['value_to'],
                ];
            }, $rows);
        }

        Response::json(['data' => [
            'identity' => $this->auth->user(), 'csrf_token' => $this->auth->csrfToken(),
            'companies' => array_map([EntityMapper::class, 'company'], $companies),
            'contacts' => array_map([EntityMapper::class, 'contact'], $contacts),
            'tasks' => $mappedTasks, 'comments' => $mappedComments, 'attachments' => $attachments,
            'lookups' => $lookupGroups, 'users' => $users, 'audit' => $events,
        ]]);
    }
}
