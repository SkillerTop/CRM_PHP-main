<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\AuditLogger;
use CRM\Domain\LookupService;
use CRM\Domain\RecordGuard;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Support\Arr;
use CRM\Support\Clock;
use CRM\Support\Validator;
use CRM\Support\Pagination;
use PDO;
use Throwable;

final class LookupController
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly AuditLogger $audit,
        private readonly LookupService $lookups
    ) {
    }

    public function all(Request $request): never
    {
        $includeInactive = Arr::bool($request->query, 'include_inactive');
        if ($includeInactive) {
            $this->auth->requireAdmin();
        }
        $stmt = $this->db->prepare('SELECT * FROM lookups' . ($includeInactive ? '' : ' WHERE is_active = 1') . ' ORDER BY type, sort_order, id');
        $stmt->execute();
        $grouped = [];
        $includeDeliveryFields = $this->auth->user()['role'] === 'admin';
        foreach ($stmt->fetchAll() as $row) {
            $grouped[$row['type']][] = $this->lookups->map($row, $includeDeliveryFields);
        }
        Response::json(['data' => $grouped]);
    }

    public function index(Request $request, string $type): never
    {
        LookupService::assertType($type);
        $includeInactive = Arr::bool($request->query, 'include_inactive');
        if ($includeInactive) {
            $this->auth->requireAdmin();
        }
        $pagination = new Pagination($request->query);
        $where = 'type = :type' . ($includeInactive ? '' : ' AND is_active = 1');
        $count = $this->db->prepare('SELECT COUNT(*) FROM lookups WHERE ' . $where);
        $count->execute(['type' => $type]);
        $stmt = $this->db->prepare('SELECT * FROM lookups WHERE ' . $where . ' ORDER BY sort_order, id LIMIT :limit OFFSET :offset');
        $stmt->bindValue(':type', $type);
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        $includeDeliveryFields = $this->auth->user()['role'] === 'admin';
        Response::json(['data' => array_map(fn (array $row): array => $this->lookups->map($row, $includeDeliveryFields), $stmt->fetchAll()), 'meta' => $pagination->meta((int) $count->fetchColumn())]);
    }

    public function store(Request $request, string $type): never
    {
        $this->auth->requireAdmin();
        LookupService::assertType($type);
        $input = $request->json();
        $value = (string) Arr::string($input, 'value', '');
        $key = (string) Arr::string($input, 'key', 'custom_' . bin2hex(random_bytes(5)));
        Validator::ensure([
            'value' => Validator::required($value) ?: Validator::max($value, 255),
            'key' => preg_match('/^[a-z0-9_\-]+$/', $key) === 1 ? '' : 'Только a-z, 0-9, _ и -.',
        ]);
        $sort = Arr::int($input, 'sort_order');
        if ($sort === null) {
            $max = $this->db->prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lookups WHERE type = :type');
            $max->execute(['type' => $type]);
            $sort = (int) $max->fetchColumn();
        }
        $extra = $this->extraFields($type, $input);
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'INSERT INTO lookups
                    (type, key_code, value, sort_order, is_active, is_closed, minutes_before,
                     requires_detail, requires_referral, user_id, email, created_by, updated_by, created_at, updated_at)
                 VALUES (:type, :key, :value, :sort_order, 1, :is_closed, :minutes_before,
                         :requires_detail, :requires_referral, :user_id, :email, :created_by, :updated_by, :created_at, :updated_at)'
            );
            $stmt->execute($extra + [
                'type' => $type, 'key' => $key, 'value' => $value, 'sort_order' => $sort,
                'created_by' => $this->auth->userId(), 'updated_by' => $this->auth->userId(),
                'created_at' => Clock::dbNow(), 'updated_at' => Clock::dbNow(),
            ]);
            $id = (int) $this->db->lastInsertId();
            $this->audit->log('LOOKUP CHANGE', 'Lookup', $id, $value, detail: ['operation' => 'create', 'type' => $type]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if ($error instanceof \PDOException && (string) $error->getCode() === '23000') {
                throw new ApiException(409, 'lookup_duplicate', 'Такой ключ или значение уже существует в справочнике.');
            }
            throw $error;
        }
        Response::json(['data' => $this->getRow($id)], 201);
    }

    public function update(Request $request, string $type, int $id): never
    {
        $this->auth->requireAdmin();
        LookupService::assertType($type);
        $input = $request->json();
        $this->db->beginTransaction();
        try {
            $before = $this->findForUpdate($type, $id);
            RecordGuard::optimistic($before, Arr::string($input, 'updated_at'));
            $value = array_key_exists('value', $input) ? (string) Arr::string($input, 'value', '') : (string) $before['value'];
            Validator::ensure(['value' => Validator::required($value) ?: Validator::max($value, 255)]);
            $sort = Arr::int($input, 'sort_order', (int) $before['sort_order']);
            $active = Arr::bool($input, 'is_active', (bool) $before['is_active']);
            $extra = $this->extraFields($type, $input, $before);
            $stmt = $this->db->prepare(
                'UPDATE lookups SET value = :value, sort_order = :sort_order, is_active = :is_active,
                    is_closed = :is_closed, minutes_before = :minutes_before, requires_detail = :requires_detail,
                    requires_referral = :requires_referral, user_id = :user_id, email = :email,
                    updated_by = :actor_id, updated_at = :now WHERE id = :id AND type = :type'
            );
            $stmt->execute($extra + [
                'value' => $value, 'sort_order' => $sort, 'is_active' => (int) $active,
                'actor_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id, 'type' => $type,
            ]);
            $after = $this->findForUpdate($type, $id);
            $this->audit->logDiff('Lookup', $id, $value, $before, $after, [
                'value' => 'Value', 'sort_order' => 'Sort order', 'is_active' => 'Active',
                'is_closed' => 'Closed status', 'minutes_before' => 'Minutes before',
                'requires_detail' => 'Requires detail', 'requires_referral' => 'Requires referral',
                'user_id' => 'Linked user', 'email' => 'Fallback email',
            ]);
            $this->audit->log('LOOKUP CHANGE', 'Lookup', $id, $value, detail: ['operation' => 'update', 'type' => $type]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if ($error instanceof \PDOException && (string) $error->getCode() === '23000') {
                throw new ApiException(409, 'lookup_duplicate', 'Такое значение уже существует в справочнике.');
            }
            throw $error;
        }
        Response::json(['data' => $this->getRow($id)]);
    }

    public function log(Request $request, string $type, int $id): never
    {
        $this->auth->requireAdmin();
        LookupService::assertType($type);
        $lookup = $this->getRow($id);
        if ($lookup['type'] !== $type) {
            throw new ApiException(404, 'lookup_not_found', 'Значение справочника не найдено.');
        }
        $pagination = new Pagination($request->query);
        $count = $this->db->prepare('SELECT COUNT(*) FROM change_events WHERE entity_type = :entity_type AND entity_id = :entity_id');
        $count->execute(['entity_type' => 'Lookup', 'entity_id' => $id]);
        $stmt = $this->db->prepare(
            'SELECT * FROM change_events
             WHERE entity_type = :entity_type AND entity_id = :entity_id
             ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset'
        );
        $stmt->bindValue(':entity_type', 'Lookup');
        $stmt->bindValue(':entity_id', $id, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([AuditLogger::class, 'redactEvent'], $stmt->fetchAll()), 'meta' => $pagination->meta((int) $count->fetchColumn())]);
    }

    /** @return array<string, mixed> */
    private function extraFields(string $type, array $input, array $fallback = []): array
    {
        $values = [
            'is_closed' => $type === 'task_status' ? (int) Arr::bool($input, 'is_closed', (bool) ($fallback['is_closed'] ?? false)) : 0,
            'minutes_before' => $type === 'reminder_lead_time' ? Arr::int($input, 'minutes_before', $fallback['minutes_before'] ?? null) : null,
            'requires_detail' => $type === 'contact_source' ? (int) Arr::bool($input, 'requires_detail', (bool) ($fallback['requires_detail'] ?? false)) : 0,
            'requires_referral' => $type === 'contact_source' ? (int) Arr::bool($input, 'requires_referral', (bool) ($fallback['requires_referral'] ?? false)) : 0,
            'user_id' => $type === 'cjn_manager'
                ? (array_key_exists('user_id', $input) ? Arr::int($input, 'user_id') : ($fallback['user_id'] ?? null))
                : null,
            'email' => $type === 'cjn_manager'
                ? (array_key_exists('email', $input) ? Arr::nullableString($input, 'email') : ($fallback['email'] ?? null))
                : null,
        ];
        if ($type === 'reminder_lead_time' && ($values['minutes_before'] === null || $values['minutes_before'] < 1)) {
            throw new ApiException(400, 'validation_error', 'Для Reminder Lead Time укажите minutes_before больше нуля.');
        }
        if ($values['email'] !== null && Validator::email($values['email']) !== '') {
            throw new ApiException(400, 'validation_error', 'Fallback email указан некорректно.');
        }
        if ($values['user_id'] !== null) {
            $stmt = $this->db->prepare('SELECT id FROM users WHERE id = :id');
            $stmt->execute(['id' => $values['user_id']]);
            if ($stmt->fetchColumn() === false) {
                throw new ApiException(400, 'invalid_user', 'Связанный пользователь не найден.');
            }
        }
        return $values;
    }

    /** @return array<string, mixed> */
    private function getRow(int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM lookups WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'lookup_not_found', 'Значение справочника не найдено.');
        }
        return $this->lookups->map($row);
    }

    /** @return array<string, mixed> */
    private function findForUpdate(string $type, int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM lookups WHERE id = :id AND type = :type FOR UPDATE');
        $stmt->execute(['id' => $id, 'type' => $type]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'lookup_not_found', 'Значение справочника не найдено.');
        }
        return $row;
    }
}
