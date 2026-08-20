<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Http\Response;
use PDO;

final class DashboardController
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function dashboard(): never
    {
        $kpi = $this->db->query(
            "SELECT
                (SELECT COUNT(*) FROM companies WHERE is_archived = 0) AS companies,
                (SELECT COUNT(*) FROM contacts k JOIN companies c ON c.id = k.company_id WHERE k.is_archived = 0 AND c.is_archived = 0) AS contacts,
                (SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id = t.company_id WHERE t.is_archived = 0 AND c.is_archived = 0) AS tasks_total,
                (SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id = t.company_id JOIN lookups s ON s.id = t.status_lookup_id
                 WHERE t.is_archived = 0 AND c.is_archived = 0 AND s.is_closed = 0) AS open_tasks,
                (SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id = t.company_id JOIN lookups s ON s.id = t.status_lookup_id
                 WHERE t.is_archived = 0 AND c.is_archived = 0 AND s.is_closed = 0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)) AS overdue"
        )->fetch();
        $funnel = $this->db->query(
            "SELECT s.id AS status_id, s.value AS status, s.sort_order, COUNT(c.id) AS count
             FROM lookups s JOIN companies c ON c.status_lookup_id = s.id AND c.is_archived = 0
             WHERE s.type = 'client_status'
             GROUP BY s.id, s.value, s.sort_order HAVING COUNT(c.id) > 0 ORDER BY s.sort_order"
        )->fetchAll();
        $maximum = max(array_map(static fn (array $row): int => (int) $row['count'], $funnel) ?: [0]);
        foreach ($funnel as &$row) {
            $row['status_id'] = (int) $row['status_id'];
            $row['sort_order'] = (int) $row['sort_order'];
            $row['count'] = (int) $row['count'];
            $row['percent_of_max'] = $maximum > 0 ? round($row['count'] * 100 / $maximum, 1) : 0;
        }
        unset($row);
        $managers = $this->db->query(
            "SELECT m.id AS manager_id, m.value AS manager, COUNT(t.id) AS task_count
             FROM tasks t JOIN companies c ON c.id = t.company_id AND c.is_archived = 0
             JOIN lookups m ON m.id = t.manager_lookup_id
             WHERE t.is_archived = 0 GROUP BY m.id, m.value ORDER BY task_count DESC, m.value"
        )->fetchAll();
        foreach ($managers as &$row) {
            $row['manager_id'] = (int) $row['manager_id'];
            $row['task_count'] = (int) $row['task_count'];
        }
        Response::json(['data' => [
            'kpi' => array_map('intval', $kpi ?: []),
            'funnel' => $funnel,
            'manager_activity' => $managers,
        ]]);
    }

    public function pipeline(): never
    {
        $statuses = $this->db->query(
            "SELECT s.id, s.value, s.sort_order, s.is_active
             FROM lookups s
             WHERE s.type = 'client_status' AND (
                s.is_active = 1 OR EXISTS (
                    SELECT 1 FROM companies c WHERE c.status_lookup_id = s.id AND c.is_archived = 0
                )
             )
             ORDER BY s.sort_order, s.id"
        )->fetchAll();
        $companies = $this->db->query(
            'SELECT c.id, c.name, c.city, c.country, c.last_contact_date, c.status_lookup_id AS status_id,
                    t.value AS type FROM companies c JOIN lookups t ON t.id = c.type_lookup_id
             WHERE c.is_archived = 0 ORDER BY c.name'
        )->fetchAll();
        $grouped = [];
        foreach ($companies as $company) {
            $company['id'] = (int) $company['id'];
            $company['status_id'] = (int) $company['status_id'];
            $grouped[$company['status_id']][] = $company;
        }
        foreach ($statuses as &$status) {
            $status['id'] = (int) $status['id'];
            $status['sort_order'] = (int) $status['sort_order'];
            $status['is_active'] = (bool) $status['is_active'];
            $status['companies'] = $grouped[$status['id']] ?? [];
            $status['count'] = count($status['companies']);
        }
        Response::json(['data' => $statuses]);
    }
}

