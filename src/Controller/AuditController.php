<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Support\Pagination;
use CRM\Support\Clock;
use PDO;

final class AuditController
{
    public function __construct(private readonly PDO $db, private readonly AuthContext $auth)
    {
    }

    public function index(Request $request): never
    {
        $this->auth->requireAdmin();
        [$where, $params] = $this->filters($request->query);
        if (strtolower((string) ($request->query['format'] ?? '')) === 'csv') {
            $stmt = $this->db->prepare("SELECT * FROM change_events WHERE {$where} ORDER BY created_at DESC, id DESC");
            $stmt->execute($params);
            Response::text($this->csv($stmt->fetchAll()), 'text/csv; charset=UTF-8', 200, [
                'Content-Disposition' => "attachment; filename*=UTF-8''audit-log.csv",
            ]);
        }

        $pagination = new Pagination($request->query);
        $count = $this->db->prepare("SELECT COUNT(*) FROM change_events WHERE {$where}");
        $count->execute($params);
        $total = (int) $count->fetchColumn();
        $stmt = $this->db->prepare(
            "SELECT * FROM change_events WHERE {$where} ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset"
        );
        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([$this, 'map'], $stmt->fetchAll()), 'meta' => $pagination->meta($total)]);
    }

    /** @return array{0:string,1:array<string,mixed>} */
    private function filters(array $query): array
    {
        $where = ['1=1'];
        $params = [];
        if (($actor = filter_var($query['user'] ?? null, FILTER_VALIDATE_INT)) !== false && $actor !== null) {
            $where[] = 'actor_user_id = :actor';
            $params['actor'] = $actor;
        }
        foreach (['action', 'entity_type'] as $field) {
            $value = trim((string) ($query[$field] ?? ''));
            if ($value !== '') {
                $where[] = "{$field} = :{$field}";
                $params[$field] = $value;
            }
        }
        foreach (['from' => 'created_at >= :date_from', 'to' => 'created_at < DATE_ADD(:date_to, INTERVAL 1 DAY)'] as $key => $condition) {
            $value = trim((string) ($query[$key] ?? ''));
            if ($value !== '') {
                Clock::parseDate($value, $key);
                $where[] = $condition;
                $params['date_' . $key] = $value;
            }
        }
        return [implode(' AND ', $where), $params];
    }

    /** @return array<string, mixed> */
    public function map(array $row): array
    {
        return [
            'id' => (int) $row['id'], 'timestamp' => Clock::api((string) $row['created_at']),
            'actor_user_id' => $row['actor_user_id'] === null ? null : (int) $row['actor_user_id'],
            'actor' => (string) $row['actor_name'], 'action' => (string) $row['action'],
            'entity_type' => (string) $row['entity_type'], 'entity_id' => $row['entity_id'] === null ? null : (int) $row['entity_id'],
            'entity_label' => (string) $row['entity_label'], 'field' => $row['field_name'],
            'from' => $row['value_from'], 'to' => $row['value_to'],
            'detail' => $row['detail_json'] ? json_decode((string) $row['detail_json'], true) : null,
        ];
    }

    /** @param list<array<string,mixed>> $rows */
    private function csv(array $rows): string
    {
        $stream = fopen('php://temp', 'w+');
        fwrite($stream, "\xEF\xBB\xBF");
        fputcsv($stream, ['Timestamp', 'Actor', 'Action', 'Entity', 'Entity ID', 'Label', 'Field', 'From', 'To', 'Detail']);
        foreach ($rows as $row) {
            fputcsv($stream, [
                Clock::api((string) $row['created_at']), $row['actor_name'], $row['action'], $row['entity_type'],
                $row['entity_id'], $row['entity_label'], $row['field_name'], $row['value_from'], $row['value_to'], $row['detail_json'],
            ]);
        }
        rewind($stream);
        $csv = stream_get_contents($stream);
        fclose($stream);
        return (string) $csv;
    }
}

