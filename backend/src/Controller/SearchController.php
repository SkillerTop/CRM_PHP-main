<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Http\Request;
use CRM\Http\Response;
use PDO;

final class SearchController
{
    private const MAX_RESULTS_PER_GROUP = 25;

    public function __construct(private readonly PDO $db)
    {
    }

    public function search(Request $request): never
    {
        $q = trim((string) ($request->query['q'] ?? ''));
        if ($q === '') {
            Response::json(['data' => ['query' => '', 'companies' => [], 'contacts' => [], 'tasks' => []], 'meta' => ['counts' => ['companies' => 0, 'contacts' => 0, 'tasks' => 0]]]);
        }
        $like = '%' . $q . '%';
        $companies = $this->db->prepare(
            'SELECT id, name, country, city, website, linkedin, description
             FROM companies WHERE is_archived = 0 AND
             (name LIKE :q1 OR country LIKE :q2 OR city LIKE :q3 OR description LIKE :q4 OR website LIKE :q5 OR linkedin LIKE :q6)
             ORDER BY name LIMIT ' . self::MAX_RESULTS_PER_GROUP
        );
        $companies->execute($this->needles($like, 6));
        $contacts = $this->db->prepare(
            "SELECT k.id, k.company_id, c.name AS company, k.first_name, k.last_name, k.position, k.email, k.phone, k.linkedin,
                    src.value AS source, COALESCE(ini.value, k.initiated_by_text) AS initiated_by
             FROM contacts k JOIN companies c ON c.id = k.company_id
             LEFT JOIN lookups src ON src.id = k.source_lookup_id LEFT JOIN lookups ini ON ini.id = k.initiated_by_lookup_id
             WHERE k.is_archived = 0 AND c.is_archived = 0 AND
             (k.first_name LIKE :q1 OR k.last_name LIKE :q2 OR k.email LIKE :q3 OR k.phone LIKE :q4 OR k.position LIKE :q5 OR
              k.linkedin LIKE :q6 OR src.value LIKE :q7 OR COALESCE(ini.value, k.initiated_by_text) LIKE :q8)
             ORDER BY k.last_name, k.first_name LIMIT " . self::MAX_RESULTS_PER_GROUP
        );
        $contacts->execute($this->needles($like, 8));
        $tasks = $this->db->prepare(
            "SELECT DISTINCT t.id, t.company_id, c.name AS company, t.name, t.contact_date, t.description, t.outcome_notes,
                    m.value AS manager
             FROM tasks t JOIN companies c ON c.id = t.company_id JOIN lookups m ON m.id = t.manager_lookup_id
             LEFT JOIN task_comments tc ON tc.task_id = t.id AND tc.is_hidden = 0
             WHERE t.is_archived = 0 AND c.is_archived = 0 AND
             (t.name LIKE :q1 OR t.description LIKE :q2 OR t.outcome_notes LIKE :q3 OR m.value LIKE :q4 OR tc.text LIKE :q5)
             ORDER BY t.contact_date DESC LIMIT " . self::MAX_RESULTS_PER_GROUP
        );
        $tasks->execute($this->needles($like, 5));
        $data = [
            'query' => $q,
            'companies' => $companies->fetchAll(),
            'contacts' => $contacts->fetchAll(),
            'tasks' => $tasks->fetchAll(),
        ];
        foreach (['companies', 'contacts', 'tasks'] as $group) {
            foreach ($data[$group] as &$row) {
                $row['id'] = (int) $row['id'];
                if (isset($row['company_id'])) {
                    $row['company_id'] = (int) $row['company_id'];
                }
            }
            unset($row);
        }
        Response::json(['data' => $data, 'meta' => ['counts' => [
            'companies' => count($data['companies']), 'contacts' => count($data['contacts']), 'tasks' => count($data['tasks']),
        ]]]);
    }

    /** @return array<string, string> */
    private function needles(string $value, int $count): array
    {
        $params = [];
        for ($i = 1; $i <= $count; $i++) {
            $params['q' . $i] = $value;
        }
        return $params;
    }
}
