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
use PDO;
use Throwable;

final class ContactController
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
        [$whereSql, $params] = $this->filters($request->query);
        $count = $this->db->prepare("SELECT COUNT(*) FROM contacts k JOIN companies c ON c.id = k.company_id LEFT JOIN lookups src ON src.id = k.source_lookup_id LEFT JOIN lookups ini ON ini.id = k.initiated_by_lookup_id WHERE {$whereSql}");
        $count->execute($params);
        $total = (int) $count->fetchColumn();
        $sorts = [
            'first_name' => 'k.first_name', 'last_name' => 'k.last_name', 'company' => 'c.name',
            'position' => 'k.position', 'source' => 'source_value', 'initiated_by' => 'initiated_by_value',
            'email' => 'k.email', 'updated_at' => 'k.updated_at',
        ];
        $sort = $sorts[(string) ($request->query['sort'] ?? 'last_name')] ?? 'k.last_name';
        $dir = strtolower((string) ($request->query['dir'] ?? 'asc')) === 'desc' ? 'DESC' : 'ASC';
        $stmt = $this->db->prepare(
            "SELECT k.*, c.name AS company_name, src.value AS source_value, ini.value AS initiated_by_value,
                    mgr.value AS manager_value, mgr.email AS manager_email,
                    creator.full_name AS created_by_name, creator.email AS created_by_email
             FROM contacts k
             JOIN companies c ON c.id = k.company_id
             LEFT JOIN lookups src ON src.id = k.source_lookup_id
             LEFT JOIN lookups ini ON ini.id = k.initiated_by_lookup_id
             JOIN lookups mgr ON mgr.id = k.manager_lookup_id
             LEFT JOIN users creator ON creator.id = k.created_by
             WHERE {$whereSql}
             ORDER BY {$sort} {$dir}, k.id {$dir}
             LIMIT :limit OFFSET :offset"
        );
        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([EntityMapper::class, 'contact'], $stmt->fetchAll()), 'meta' => $pagination->meta($total)]);
    }

    public function forCompany(int $companyId): never
    {
        $this->assertCompany($companyId);
        $stmt = $this->db->prepare(
            'SELECT k.*, c.name AS company_name, src.value AS source_value, ini.value AS initiated_by_value,
                    mgr.value AS manager_value, mgr.email AS manager_email,
                    creator.full_name AS created_by_name, creator.email AS created_by_email
             FROM contacts k JOIN companies c ON c.id = k.company_id
             LEFT JOIN lookups src ON src.id = k.source_lookup_id
             LEFT JOIN lookups ini ON ini.id = k.initiated_by_lookup_id
             JOIN lookups mgr ON mgr.id = k.manager_lookup_id
             LEFT JOIN users creator ON creator.id = k.created_by
             WHERE k.company_id = :company_id AND k.is_archived = 0 AND c.is_archived = 0
             ORDER BY k.last_name, k.first_name'
        );
        $stmt->execute(['company_id' => $companyId]);
        Response::json(['data' => array_map([EntityMapper::class, 'contact'], $stmt->fetchAll())]);
    }

    public function show(int $id): never
    {
        Response::json(['data' => EntityMapper::contact($this->find($id, true))]);
    }

    public function store(Request $request): never
    {
        $this->auth->requireWrite();
        $input = $request->json();
        $data = $this->validated($input);
        $this->duplicateGuard($data['email'], null, Arr::bool($input, 'allow_duplicate'));
        $now = Clock::dbNow();
        $stmt = $this->db->prepare(
            'INSERT INTO contacts
                (company_id, first_name, last_name, position, phone, email, linkedin, source_lookup_id,
                 source_detail, referred_by, initiated_by_lookup_id, manager_lookup_id, initiated_by_text, photo_data_url,
                 is_archived, created_by, updated_by, created_at, updated_at)
             VALUES (:company_id, :first_name, :last_name, :position, :phone, :email, :linkedin, :source_id,
                     :source_detail, :referred_by, :initiated_by_id, :manager_id, :initiated_by_text, :photo_data_url,
                     0, :created_by, :updated_by, :created_at, :updated_at)'
        );
        $stmt->execute($data + [
            'created_by' => $this->auth->userId(), 'updated_by' => $this->auth->userId(),
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $id = (int) $this->db->lastInsertId();
        $label = trim($data['first_name'] . ' ' . ($data['last_name'] ?? ''));
        $this->audit->log('CREATE', 'Contact', $id, $label, detail: ['company_id' => $data['company_id']]);
        Response::json(['data' => EntityMapper::contact($this->find($id, true))], 201);
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
            $this->duplicateGuard($data['email'], $id, Arr::bool($input, 'allow_duplicate'));
            if ((int) $before['company_id'] !== (int) $data['company_id']) {
                $this->auth->requireAdmin();
            }
            $stmt = $this->db->prepare(
                'UPDATE contacts SET company_id = :company_id, first_name = :first_name, last_name = :last_name,
                    position = :position, phone = :phone, email = :email, linkedin = :linkedin,
                    source_lookup_id = :source_id, source_detail = :source_detail, referred_by = :referred_by,
                    initiated_by_lookup_id = :initiated_by_id, manager_lookup_id = :manager_id,
                    initiated_by_text = :initiated_by_text, photo_data_url = :photo_data_url,
                    updated_by = :user_id, updated_at = :now
                 WHERE id = :id'
            );
            $stmt->execute($data + ['user_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
            $after = $this->findForUpdate($id);
            $label = trim($data['first_name'] . ' ' . ($data['last_name'] ?? ''));
            $this->audit->logDiff('Contact', $id, $label, $before, $after, [
                'company_id' => 'Company', 'first_name' => 'First name', 'last_name' => 'Last name',
                'position' => 'Position', 'phone' => 'Phone', 'email' => 'Email', 'linkedin' => 'LinkedIn',
                'source_lookup_id' => 'First Contact Source', 'source_detail' => 'Source detail',
                'referred_by' => 'Referred By', 'initiated_by_lookup_id' => 'Initiated By',
                'manager_lookup_id' => 'CJN Manager', 'initiated_by_text' => 'Initiated By (manual)', 'photo_data_url' => 'Photo',
            ], function (string $field, mixed $value): string {
                if ($field === 'company_id') {
                    $stmt = $this->db->prepare('SELECT name FROM companies WHERE id = :id');
                    $stmt->execute(['id' => $value]);
                    return (string) ($stmt->fetchColumn() ?: '—');
                }
                return str_ends_with($field, '_lookup_id') ? $this->lookups->label($value === null ? null : (int) $value) : ($value === null || $value === '' ? '—' : (string) $value);
            });
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => EntityMapper::contact($this->find($id, true))]);
    }

    public function archive(Request $request, int $id): never
    {
        $this->auth->requireAdmin();
        $input = $request->json();
        $archived = Arr::bool($input, 'archived', true);
        $this->db->beginTransaction();
        try {
            $contact = $this->findForUpdate($id);
            RecordGuard::optimistic($contact, Arr::string($input, 'updated_at'));
            $stmt = $this->db->prepare('UPDATE contacts SET is_archived = :archived, updated_by = :user_id, updated_at = :now WHERE id = :id');
            $stmt->execute(['archived' => (int) $archived, 'user_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
            $this->audit->log('ARCHIVE', 'Contact', $id, trim($contact['first_name'] . ' ' . ($contact['last_name'] ?? '')), detail: ['archived' => $archived]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => EntityMapper::contact($this->find($id, true))]);
    }

    public function log(int $id): never
    {
        $this->find($id, true);
        $stmt = $this->db->prepare('SELECT * FROM change_events WHERE entity_type = :type AND entity_id = :id ORDER BY created_at DESC, id DESC');
        $stmt->execute(['type' => 'Contact', 'id' => $id]);
        Response::json(['data' => $stmt->fetchAll()]);
    }

    /** @return array<string, mixed> */
    private function validated(array $input, ?array $current = null): array
    {
        $companyId = Arr::int($input, 'company_id');
        $firstName = (string) Arr::string($input, 'first_name', '');
        $email = mb_strtolower((string) Arr::nullableString($input, 'email'));
        $email = $email === '' ? null : $email;
        $linkedin = Validator::normalizeUrl(Arr::nullableString($input, 'linkedin'));
        $sourceId = Arr::int($input, 'source_id');
        $initiatedById = Arr::int($input, 'initiated_by_id');
        $managerId = Arr::int($input, 'manager_id');
        $initiatedByText = Arr::nullableString($input, 'initiated_by_text');
        $source = $sourceId ? $this->lookups->getForAssignment(
            $sourceId,
            'contact_source',
            isset($current['source_lookup_id']) ? (int) $current['source_lookup_id'] : null
        ) : null;
        $sourceDetail = $source && $source['requires_detail'] ? Arr::nullableString($input, 'source_detail') : null;
        $referredBy = $source && $source['requires_referral'] ? Arr::nullableString($input, 'referred_by') : null;
        Validator::ensure([
            'company_id' => $companyId === null ? 'Обязательное поле.' : '',
            'first_name' => Validator::required($firstName) ?: Validator::max($firstName, 100),
            'last_name' => Validator::max(Arr::nullableString($input, 'last_name'), 100),
            'position' => Validator::max(Arr::nullableString($input, 'position'), 150),
            'phone' => Validator::phone(Arr::nullableString($input, 'phone')) ?: Validator::max(Arr::nullableString($input, 'phone'), 50),
            'email' => Validator::email($email) ?: Validator::max($email, 255),
            'linkedin' => Validator::url($linkedin),
            'source_detail' => $source && $source['requires_detail'] ? Validator::required($sourceDetail) : '',
            'referred_by' => $source && $source['requires_referral'] ? Validator::required($referredBy) : '',
            'manager_id' => $managerId === null ? 'Обязательное поле.' : '',
            'initiated_by' => $initiatedById === null ? Validator::required($initiatedByText) : '',
        ]);
        $this->assertCompany((int) $companyId);
        if ($initiatedById !== null) {
            $this->lookups->getForAssignment(
                $initiatedById,
                'cjn_manager',
                isset($current['initiated_by_lookup_id']) ? (int) $current['initiated_by_lookup_id'] : null
            );
        }
        $this->lookups->getForAssignment(
            (int) $managerId,
            'cjn_manager',
            isset($current['manager_lookup_id']) ? (int) $current['manager_lookup_id'] : null
        );
        return [
            'company_id' => $companyId,
            'first_name' => $firstName,
            'last_name' => Arr::nullableString($input, 'last_name'),
            'position' => Arr::nullableString($input, 'position'),
            'phone' => Arr::nullableString($input, 'phone'),
            'email' => $email,
            'linkedin' => $linkedin,
            'source_id' => $sourceId,
            'source_detail' => $sourceDetail,
            'referred_by' => $referredBy,
            'initiated_by_id' => $initiatedById,
            'manager_id' => $managerId,
            'initiated_by_text' => $initiatedById === null ? $initiatedByText : null,
            'photo_data_url' => Arr::nullableString($input, 'photo_data_url'),
        ];
    }

    /** @return array{0:string,1:array<string,mixed>} */
    private function filters(array $query): array
    {
        $where = ['k.is_archived = 0', 'c.is_archived = 0'];
        $params = [];
        foreach (['company' => 'k.company_id', 'source' => 'k.source_lookup_id'] as $queryKey => $column) {
            $value = filter_var($query[$queryKey] ?? null, FILTER_VALIDATE_INT);
            if ($value !== false && $value !== null) {
                $where[] = "{$column} = :{$queryKey}";
                $params[$queryKey] = $value;
            }
        }
        $hasLinkedin = (string) ($query['has_linkedin'] ?? 'any');
        if ($hasLinkedin === 'has') {
            $where[] = "k.linkedin IS NOT NULL AND k.linkedin <> ''";
        } elseif ($hasLinkedin === 'no') {
            $where[] = "(k.linkedin IS NULL OR k.linkedin = '')";
        }
        $q = trim((string) ($query['q'] ?? ''));
        if ($q !== '') {
            $where[] = '(k.first_name LIKE :q1 OR k.last_name LIKE :q2 OR k.email LIKE :q3 OR k.phone LIKE :q4 OR k.position LIKE :q5 OR ini.value LIKE :q6)';
            foreach (range(1, 6) as $number) {
                $params['q' . $number] = '%' . $q . '%';
            }
        }
        return [implode(' AND ', $where), $params];
    }

    private function duplicateGuard(?string $email, ?int $exceptId, bool $allow): void
    {
        if ($email === null || $email === '') {
            return;
        }
        $sql = 'SELECT k.id, k.first_name, k.last_name, c.id AS company_id, c.name AS company_name
                FROM contacts k JOIN companies c ON c.id = k.company_id
                WHERE k.email = :email';
        $params = ['email' => $email];
        if ($exceptId !== null) {
            $sql .= ' AND k.id <> :id';
            $params['id'] = $exceptId;
        }
        $sql .= ' LIMIT 1';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $duplicate = $stmt->fetch();
        if ($duplicate && !$allow) {
            throw new ApiException(409, 'possible_duplicate', "Контакт с таким email уже существует в компании {$duplicate['company_name']}.", [
                'duplicate' => ['id' => (int) $duplicate['id'], 'company_id' => (int) $duplicate['company_id'], 'company' => $duplicate['company_name']],
                'retry_with' => ['allow_duplicate' => true],
            ]);
        }
    }

    private function assertCompany(int $id): void
    {
        $stmt = $this->db->prepare('SELECT id FROM companies WHERE id = :id AND is_archived = 0');
        $stmt->execute(['id' => $id]);
        if ($stmt->fetchColumn() === false) {
            throw new ApiException(400, 'invalid_company', 'Компания не найдена или заархивирована.');
        }
    }

    /** @return array<string, mixed> */
    private function find(int $id, bool $includeArchived): array
    {
        $stmt = $this->db->prepare(
            'SELECT k.*, c.name AS company_name, src.value AS source_value, ini.value AS initiated_by_value,
                    mgr.value AS manager_value, mgr.email AS manager_email,
                    creator.full_name AS created_by_name, creator.email AS created_by_email
             FROM contacts k JOIN companies c ON c.id = k.company_id
             LEFT JOIN lookups src ON src.id = k.source_lookup_id LEFT JOIN lookups ini ON ini.id = k.initiated_by_lookup_id
             JOIN lookups mgr ON mgr.id = k.manager_lookup_id LEFT JOIN users creator ON creator.id = k.created_by
             WHERE k.id = :id' . ($includeArchived ? '' : ' AND k.is_archived = 0')
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'contact_not_found', 'Контакт не найден.');
        }
        return $row;
    }

    /** @return array<string, mixed> */
    private function findForUpdate(int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM contacts WHERE id = :id FOR UPDATE');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'contact_not_found', 'Контакт не найден.');
        }
        return $row;
    }
}
