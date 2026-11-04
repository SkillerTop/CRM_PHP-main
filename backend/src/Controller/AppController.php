<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\AuditLogger;
use CRM\Domain\LookupService;
use CRM\Domain\ManagerUserLinker;
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
        private readonly LookupService $lookups,
        private readonly ManagerUserLinker $managerUsers
    ) {
    }

    public function bootstrap(Request $request): never
    {
        $user = $this->auth->user();
        $currentManager = $this->managerUsers->ensureForUser((int) $user['id']);
        $admin = $user['role'] === 'admin';
        $canWrite = in_array($user['role'], ['admin', 'manager', 'editor'], true);
        $lookupSql = 'SELECT * FROM lookups' . ($admin ? '' : ' WHERE is_active = 1') . ' ORDER BY type, sort_order, id';
        $lookupGroups = [];
        foreach ($this->db->query($lookupSql)->fetchAll() as $row) {
            $lookupGroups[(string) $row['type']][] = $this->lookups->map($row, $admin);
        }
        $countries = array_map(
            static fn (array $row): string => (string) $row['name'],
            $this->db->query('SELECT name FROM countries ORDER BY sort_order, name')->fetchAll()
        );

        $users = [];
        if ($admin) {
            $rows = $this->db->query('SELECT id, full_name, email, role, is_active, pending_approval,
                                            last_login_at, updated_at, (photo_data_url IS NOT NULL) AS has_photo
                                     FROM users ORDER BY pending_approval DESC, is_active DESC, full_name')->fetchAll();
            $users = array_map(static fn (array $row): array => [
                'id' => (int) $row['id'], 'full_name' => (string) $row['full_name'], 'email' => (string) $row['email'],
                'role' => (string) $row['role'], 'is_active' => (bool) $row['is_active'],
                'pending_approval' => (bool) $row['pending_approval'], 'last_login_at' => Clock::api($row['last_login_at'] ?? null),
                'updated_at' => Clock::api($row['updated_at'] ?? null),
                'photo_data_url' => !empty($row['has_photo']) ? '/api/users/' . (int) $row['id'] . '/photo' : null,
            ], $rows);
        } elseif ($canWrite) {
            $managerRows = $this->db->query(
                "SELECT m.user_id, m.value, m.updated_at,
                        CASE
                            WHEN m.user_id IS NOT NULL AND u.is_active = 1 AND u.pending_approval = 0 THEN u.email
                            WHEN m.user_id IS NULL THEN m.email
                            ELSE NULL
                        END AS delivery_email
                 FROM lookups m
                 LEFT JOIN users u ON u.id = m.user_id
                 WHERE m.type = 'cjn_manager' AND m.is_active = 1
                 ORDER BY m.sort_order, m.id"
            )->fetchAll();
            foreach ($managerRows as $manager) {
                if (!empty($manager['delivery_email'])) {
                    $users[] = ['id' => $manager['user_id'], 'full_name' => $manager['value'], 'email' => $manager['delivery_email'], 'role' => 'editor', 'is_active' => true, 'pending_approval' => false, 'last_login_at' => null, 'updated_at' => Clock::api($manager['updated_at'] ?? null)];
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
            'identity' => $user, 'current_manager' => $currentManager, 'csrf_token' => $this->auth->csrfToken(),
            'companies' => [],
            'contacts' => [],
            'tasks' => [], 'comments' => [], 'attachments' => [],
            'lookups' => $lookupGroups, 'countries' => $countries, 'users' => $users, 'audit' => $events,
        ]]);
    }
}
