<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\AuditLogger;
use CRM\Domain\EntityMapper;
use CRM\Domain\LookupService;
use CRM\Domain\RecordGuard;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Support\Arr;
use CRM\Support\Clock;
use CRM\Support\Pagination;
use CRM\Support\Validator;
use CRM\Support\ImageDataUrl;
use PDO;
use Throwable;

final class CompanyController
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly AuditLogger $audit,
        private readonly LookupService $lookups
    ) {
    }

    public function index(Request $request): never
    {
        $pagination = new Pagination($request->query);
        $includeArchived = $this->auth->user()['role'] === 'admin' && filter_var($request->query['include_archived'] ?? false, FILTER_VALIDATE_BOOL);
        $where = $includeArchived ? [] : ['c.is_archived = 0'];
        $params = [];
        if (($type = filter_var($request->query['type'] ?? null, FILTER_VALIDATE_INT)) !== false && $type !== null) {
            $where[] = 'c.type_lookup_id = :type';
            $params['type'] = $type;
        }
        if (($status = filter_var($request->query['status'] ?? null, FILTER_VALIDATE_INT)) !== false && $status !== null) {
            $where[] = 'c.status_lookup_id = :status';
            $params['status'] = $status;
        }
        $q = trim((string) ($request->query['q'] ?? ''));
        if ($q !== '') {
            $where[] = '(c.name LIKE :q1 OR c.country LIKE :q2 OR c.city LIKE :q3 OR c.description LIKE :q4 OR c.website LIKE :q5 OR c.linkedin LIKE :q6)';
            foreach (range(1, 6) as $number) {
                $params['q' . $number] = '%' . $q . '%';
            }
        }
        $whereSql = $where === [] ? '1 = 1' : implode(' AND ', $where);
        $count = $this->db->prepare("SELECT COUNT(*) FROM companies c WHERE {$whereSql}");
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $sorts = [
            'name' => 'c.name', 'type' => 'type_value', 'country' => 'c.country', 'city' => 'c.city',
            'status' => 'status_value', 'last_contact_date' => 'c.last_contact_date', 'updated_at' => 'c.updated_at',
        ];
        $sort = $sorts[(string) ($request->query['sort'] ?? 'name')] ?? 'c.name';
        $direction = strtolower((string) ($request->query['dir'] ?? 'asc')) === 'desc' ? 'DESC' : 'ASC';
        $sql = "SELECT c.id, c.name, c.type_lookup_id, c.country, c.city, c.status_lookup_id,
                       c.manager_lookup_id, c.last_contact_date, c.website, c.linkedin, c.description,
                       c.is_archived, c.created_at, c.updated_at, c.created_by, c.updated_by,
                       ct.value AS type_value, cs.value AS status_value,
                       mgr.value AS manager_value, mgr.email AS manager_email,
                       creator.full_name AS created_by_name, creator.email AS created_by_email
                FROM companies c
                JOIN lookups ct ON ct.id = c.type_lookup_id
                JOIN lookups cs ON cs.id = c.status_lookup_id
                JOIN lookups mgr ON mgr.id = c.manager_lookup_id
                LEFT JOIN users creator ON creator.id = c.created_by
                WHERE {$whereSql}
                ORDER BY {$sort} {$direction}, c.id {$direction}
                LIMIT :limit OFFSET :offset";
        $stmt = $this->db->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([EntityMapper::class, 'company'], $stmt->fetchAll()), 'meta' => $pagination->meta($total)]);
    }

    public function show(int $id): never
    {
        Response::json(['data' => EntityMapper::company($this->find($id, $this->canViewArchived()))]);
    }

    public function store(Request $request): never
    {
        $this->auth->requireWrite();
        $data = $this->validated($request->json());
        $this->duplicateGuard($data['name'], null, Arr::bool($request->json(), 'allow_duplicate'));
        $now = Clock::dbNow();
        $stmt = $this->db->prepare(
            'INSERT INTO companies
                (name, type_lookup_id, country, city, status_lookup_id, manager_lookup_id, website, linkedin, logo_data_url, description,
                 is_archived, created_by, updated_by, created_at, updated_at)
             VALUES (:name, :type_id, :country, :city, :status_id, :manager_id, :website, :linkedin, :logo_data_url, :description,
                     0, :created_by, :updated_by, :created_at, :updated_at)'
        );
        $stmt->execute($data + [
            'created_by' => $this->auth->userId(), 'updated_by' => $this->auth->userId(),
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $id = (int) $this->db->lastInsertId();
        $this->audit->log('CREATE', 'Company', $id, $data['name'], detail: ['company_id' => $id]);
        Response::json(['data' => EntityMapper::company($this->find($id, true))], 201);
    }

    public function update(Request $request, int $id): never
    {
        $this->auth->requireWrite();
        $input = $request->json();
        $this->db->beginTransaction();
        try {
            $before = $this->findForUpdate($id);
            RecordGuard::optimistic($before, Arr::string($input, 'updated_at'));
            $data = $this->validated($input, $before);
            $this->duplicateGuard($data['name'], $id, Arr::bool($input, 'allow_duplicate'));
            $stmt = $this->db->prepare(
                'UPDATE companies SET name = :name, type_lookup_id = :type_id, country = :country, city = :city,
                    status_lookup_id = :status_id, manager_lookup_id = :manager_id, website = :website, linkedin = :linkedin,
                    logo_data_url = :logo_data_url, description = :description,
                    updated_by = :user_id, updated_at = :now WHERE id = :id'
            );
            $stmt->execute($data + ['user_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
            $after = $this->findForUpdate($id);
            $this->audit->logDiff('Company', $id, $data['name'], $before, $after, [
                'name' => 'Company Name', 'type_lookup_id' => 'Company Type', 'country' => 'Country',
                'city' => 'City', 'status_lookup_id' => 'Status', 'manager_lookup_id' => 'CJN Manager', 'website' => 'Website',
                'linkedin' => 'LinkedIn', 'logo_data_url' => 'Logo', 'description' => 'Description',
            ], fn (string $field, mixed $value): string => str_ends_with($field, '_lookup_id') ? $this->lookups->label($value === null ? null : (int) $value) : ($value === null || $value === '' ? '—' : (string) $value));
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => EntityMapper::company($this->find($id, true))]);
    }

    public function archive(Request $request, int $id): never
    {
        $this->auth->requireAdmin();
        $data = $request->json();
        $archived = Arr::bool($data, 'archived', true);
        $this->db->beginTransaction();
        try {
            $company = $this->findForUpdate($id);
            RecordGuard::optimistic($company, Arr::string($data, 'updated_at'));
            if ($archived) {
                $check = $this->db->prepare(
                    'SELECT COUNT(*) FROM tasks t JOIN lookups s ON s.id = t.status_lookup_id
                     WHERE t.company_id = :company_id AND t.is_archived = 0 AND s.is_closed = 0'
                );
                $check->execute(['company_id' => $id]);
                if ((int) $check->fetchColumn() > 0) {
                    throw new ApiException(409, 'company_has_open_tasks', 'Сначала закройте актуальные задачи компании.');
                }
            }
            $stmt = $this->db->prepare('UPDATE companies SET is_archived = :archived, updated_by = :user_id, updated_at = :now WHERE id = :id');
            $stmt->execute(['archived' => (int) $archived, 'user_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
            $this->audit->log('ARCHIVE', 'Company', $id, (string) $company['name'], detail: ['archived' => $archived]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => EntityMapper::company($this->find($id, true))]);
    }

    public function log(int $id): never
    {
        $this->find($id, $this->canViewArchived());
        $stmt = $this->db->prepare('SELECT * FROM change_events WHERE entity_type = :type AND entity_id = :id ORDER BY created_at DESC, id DESC');
        $stmt->execute(['type' => 'Company', 'id' => $id]);
        Response::json(['data' => array_map([AuditLogger::class, 'redactEvent'], $stmt->fetchAll())]);
    }

    /** @return array<string, mixed> */
    private function validated(array $input, ?array $current = null): array
    {
        $name = (string) Arr::string($input, 'name', '');
        $typeId = Arr::int($input, 'type_id');
        $country = (string) Arr::string($input, 'country', '');
        $statusId = Arr::int($input, 'status_id');
        $managerId = Arr::int($input, 'manager_id');
        $website = Validator::normalizeUrl(Arr::nullableString($input, 'website'));
        $linkedin = Validator::normalizeUrl(Arr::nullableString($input, 'linkedin'));
        Validator::ensure([
            'name' => Validator::required($name) ?: Validator::max($name, 255),
            'type_id' => $typeId === null ? 'Обязательное поле.' : '',
            'country' => Validator::required($country) ?: Validator::max($country, 100),
            'city' => Validator::max(Arr::nullableString($input, 'city'), 100),
            'status_id' => $statusId === null ? 'Обязательное поле.' : '',
            'manager_id' => $managerId === null ? 'Обязательное поле.' : '',
            'website' => Validator::url($website),
            'linkedin' => Validator::url($linkedin),
        ]);
        $this->lookups->getForAssignment((int) $typeId, 'company_type', isset($current['type_lookup_id']) ? (int) $current['type_lookup_id'] : null);
        $this->lookups->getForAssignment((int) $statusId, 'client_status', isset($current['status_lookup_id']) ? (int) $current['status_lookup_id'] : null);
        $this->lookups->getForAssignment((int) $managerId, 'cjn_manager', isset($current['manager_lookup_id']) ? (int) $current['manager_lookup_id'] : null);
        return [
            'name' => $name,
            'type_id' => $typeId,
            'country' => $country,
            'city' => Arr::nullableString($input, 'city'),
            'status_id' => $statusId,
            'manager_id' => $managerId,
            'website' => $website,
            'linkedin' => $linkedin,
            'logo_data_url' => ImageDataUrl::validate(
                Arr::nullableString($input, 'logo_data_url'), 5 * 1024 * 1024, ['image/jpeg', 'image/png', 'image/webp'],
                'invalid_company_logo', 'Логотип должен быть JPG, PNG или WebP размером не более 5 МБ.'
            ),
            'description' => Arr::nullableString($input, 'description'),
        ];
    }

    private function duplicateGuard(string $name, ?int $exceptId, bool $allow): void
    {
        $sql = 'SELECT id, name FROM companies WHERE name = :name';
        $params = ['name' => $name];
        if ($exceptId !== null) {
            $sql .= ' AND id <> :id';
            $params['id'] = $exceptId;
        }
        $sql .= ' LIMIT 1';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $duplicate = $stmt->fetch();
        if ($duplicate && !$allow) {
            throw new ApiException(409, 'possible_duplicate', 'Компания с таким названием уже существует.', [
                'duplicate' => ['id' => (int) $duplicate['id'], 'name' => $duplicate['name']],
                'retry_with' => ['allow_duplicate' => true],
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function find(int $id, bool $includeArchived = false): array
    {
        $sql = 'SELECT c.*, ct.value AS type_value, cs.value AS status_value,
                       mgr.value AS manager_value, mgr.email AS manager_email,
                       creator.full_name AS created_by_name, creator.email AS created_by_email
                FROM companies c JOIN lookups ct ON ct.id = c.type_lookup_id JOIN lookups cs ON cs.id = c.status_lookup_id
                JOIN lookups mgr ON mgr.id = c.manager_lookup_id LEFT JOIN users creator ON creator.id = c.created_by
                WHERE c.id = :id' . ($includeArchived ? '' : ' AND c.is_archived = 0');
        $stmt = $this->db->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'company_not_found', 'Компания не найдена.');
        }
        return $row;
    }

    private function canViewArchived(): bool
    {
        return $this->auth->user()['role'] === 'admin';
    }

    /** @return array<string, mixed> */
    private function findForUpdate(int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM companies WHERE id = :id FOR UPDATE');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'company_not_found', 'Компания не найдена.');
        }
        return $row;
    }
}
