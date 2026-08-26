<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Config\Config;
use CRM\Domain\AuditLogger;
use CRM\Domain\Mailer;
use CRM\Domain\ManagerUserLinker;
use CRM\Domain\RecordGuard;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Security\Password;
use CRM\Support\Arr;
use CRM\Support\Clock;
use CRM\Support\Validator;
use CRM\Support\Pagination;
use PDO;
use Throwable;

final class UserController
{
    private const ROLES = ['admin', 'manager', 'editor', 'readonly'];

    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer,
        private readonly AuthController $authController,
        private readonly ManagerUserLinker $managerUsers
    ) {
    }

    public function index(Request $request): never
    {
        $this->auth->requireAdmin();
        $pagination = new Pagination($request->query);
        $total = (int) $this->db->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $stmt = $this->db->prepare('SELECT * FROM users ORDER BY pending_approval DESC, is_active DESC, full_name LIMIT :limit OFFSET :offset');
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([$this, 'map'], $stmt->fetchAll()), 'meta' => $pagination->meta($total)]);
    }

    public function store(Request $request): never
    {
        $this->auth->requireAdmin();
        $input = $request->json();
        $name = (string) Arr::string($input, 'full_name', '');
        $email = mb_strtolower((string) Arr::string($input, 'email', ''));
        $role = (string) Arr::string($input, 'role', 'editor');
        $active = Arr::bool($input, 'is_active', true);
        $delivery = (string) Arr::string($input, 'delivery', 'temporary_password');
        $password = (string) Arr::string($input, 'temporary_password', '');
        Validator::ensure([
            'full_name' => Validator::required($name) ?: Validator::max($name, 150),
            'email' => Validator::required($email) ?: (Validator::email($email) ?: Validator::max($email, 255)),
            'role' => in_array($role, self::ROLES, true) ? '' : 'Неизвестная роль.',
            'delivery' => in_array($delivery, ['invite', 'temporary_password'], true) ? '' : 'Допустимы invite или temporary_password.',
            'temporary_password' => $delivery === 'temporary_password' ? Validator::password($password) : '',
        ]);
        $now = Clock::dbNow();
        $token = null;
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'INSERT INTO users
                    (full_name, email, password_hash, role, is_active, pending_approval, must_change_password,
                     created_by, updated_by, created_at, updated_at)
                 VALUES (:name, :email, :password_hash, :role, :active, 0, :must_change,
                         :created_by, :updated_by, :created_at, :updated_at)'
            );
            $stmt->execute([
                'name' => $name, 'email' => $email,
                'password_hash' => $delivery === 'temporary_password' ? Password::hash($password) : null,
                'role' => $role, 'active' => (int) $active, 'must_change' => (int) ($delivery === 'temporary_password'),
                'created_by' => $this->auth->userId(), 'updated_by' => $this->auth->userId(),
                'created_at' => $now, 'updated_at' => $now,
            ]);
            $id = (int) $this->db->lastInsertId();
            $this->managerUsers->ensureForUser($id);
            $this->audit->log('CREATE', 'User', $id, $name, detail: ['role' => $role, 'delivery' => $delivery]);
            if ($delivery === 'invite') {
                $token = $this->authController->createPasswordToken($id, 'invite', 1440);
            }
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if ($error instanceof \PDOException && (string) $error->getCode() === '23000') {
                throw new ApiException(409, 'email_exists', 'Пользователь с таким email уже существует.');
            }
            throw $error;
        }
        $warnings = [];
        if ($delivery === 'invite') {
            $url = rtrim((string) Config::get('APP_URL', ''), '/') . '/reset-password?token=' . rawurlencode($token);
            try {
                $this->mailer->send($email, 'Приглашение в Client Data CRM', "Здравствуйте, {$name}.\n\nУстановите пароль по ссылке (действует 24 часа):\n{$url}\n");
            } catch (Throwable) {
                $warnings['mail'] = 'Пользователь создан, но приглашение не отправлено. Проверьте настройки почтового сервера.';
            }
        }
        $payload = ['data' => $this->find($id)];
        if ($warnings !== []) {
            $payload['warnings'] = $warnings;
        }
        Response::json($payload, 201);
    }

    public function update(Request $request, int $id): never
    {
        $this->auth->requireAdmin();
        $input = $request->json();
        $this->db->beginTransaction();
        try {
            $before = $this->findForUpdate($id);
            RecordGuard::optimistic($before, Arr::string($input, 'updated_at'));
            $name = array_key_exists('full_name', $input) ? (string) Arr::string($input, 'full_name', '') : (string) $before['full_name'];
            $role = array_key_exists('role', $input) ? (string) Arr::string($input, 'role', '') : (string) $before['role'];
            $active = Arr::bool($input, 'is_active', (bool) $before['is_active']);
            Validator::ensure([
                'full_name' => Validator::required($name) ?: Validator::max($name, 150),
                'role' => in_array($role, self::ROLES, true) ? '' : 'Неизвестная роль.',
            ]);
            $this->protectLastAdmin($before, $role, $active);
            $stmt = $this->db->prepare(
                'UPDATE users SET full_name = :name, role = :role, is_active = :active,
                    updated_by = :actor_id, updated_at = :now WHERE id = :id'
            );
            $stmt->execute([
                'name' => $name, 'role' => $role, 'active' => (int) $active,
                'actor_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id,
            ]);
            $this->managerUsers->ensureForUser($id);
            if ($role !== $before['role']) {
                $this->audit->log('ROLE CHANGE', 'User', $id, $name, 'Role', (string) $before['role'], $role);
            }
            if ($active !== (bool) $before['is_active']) {
                $this->audit->log('FIELD CHANGE', 'User', $id, $name, 'Active', (bool) $before['is_active'] ? 'true' : 'false', $active ? 'true' : 'false');
                if (!$active) {
                    $this->auth->revokeAllSessions($id);
                }
            }
            if ($name !== $before['full_name']) {
                $this->audit->log('FIELD CHANGE', 'User', $id, $name, 'Full name', (string) $before['full_name'], $name);
            }
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => $this->find($id)]);
    }

    public function approve(Request $request, int $id): never
    {
        $this->auth->requireAdmin();
        $input = $request->json();
        $role = (string) Arr::string($input, 'role', 'editor');
        if (!in_array($role, self::ROLES, true)) {
            throw new ApiException(400, 'validation_error', 'Неизвестная роль.');
        }
        $this->db->beginTransaction();
        try {
            $before = $this->findForUpdate($id);
            if (!(bool) $before['pending_approval']) {
                throw new ApiException(409, 'not_pending', 'Пользователь не ожидает подтверждения.');
            }
            $stmt = $this->db->prepare(
                'UPDATE users SET role = :role, is_active = 1, pending_approval = 0,
                    updated_by = :actor_id, updated_at = :now WHERE id = :id'
            );
            $stmt->execute(['role' => $role, 'actor_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
            $this->managerUsers->ensureForUser($id);
            if ($role !== (string) $before['role']) {
                $this->audit->log('ROLE CHANGE', 'User', $id, (string) $before['full_name'], 'Role', (string) $before['role'], $role, ['approved' => true]);
            }
            $this->audit->log('FIELD CHANGE', 'User', $id, (string) $before['full_name'], 'Active', 'false', 'true', ['approved' => true]);
            $this->audit->log('FIELD CHANGE', 'User', $id, (string) $before['full_name'], 'Registration', 'pending', 'approved');
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        $user = $this->find($id);
        Response::json(['data' => $user]);
    }

    public function reject(int $id): never
    {
        $this->auth->requireAdmin();
        $this->db->beginTransaction();
        try {
            $user = $this->findForUpdate($id);
            if (!(bool) $user['pending_approval']) {
                throw new ApiException(409, 'not_pending', 'Удалить можно только неподтверждённую регистрацию.');
            }
            $this->audit->log('FIELD CHANGE', 'User', $id, (string) $user['full_name'], 'Registration', 'pending', 'rejected');
            $stmt = $this->db->prepare('DELETE FROM users WHERE id = :id');
            $stmt->execute(['id' => $id]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::noContent();
    }

    public function resetPassword(Request $request, int $id): never
    {
        $this->auth->requireAdmin();
        $input = $request->json();
        $delivery = (string) Arr::string($input, 'delivery', 'temporary_password');
        $password = (string) Arr::string($input, 'temporary_password', '');
        if (!in_array($delivery, ['invite', 'temporary_password'], true)) {
            throw new ApiException(400, 'validation_error', 'Допустимы invite или temporary_password.');
        }
        if ($delivery === 'temporary_password' && Validator::password($password) !== '') {
            throw new ApiException(400, 'validation_error', 'Временный пароль должен содержать минимум 8 символов.');
        }
        $token = null;
        $warning = null;
        $hash = $delivery === 'temporary_password' ? Password::hash($password) : null;
        $this->db->beginTransaction();
        try {
            $user = $this->findForUpdate($id);
            if ($delivery === 'temporary_password') {
                $stmt = $this->db->prepare('UPDATE users SET password_hash = :hash, must_change_password = 1, updated_by = :actor_id, updated_at = :now WHERE id = :id');
                $stmt->execute(['hash' => $hash, 'actor_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
                $this->auth->revokeAllSessions($id);
            } else {
                $token = $this->authController->createPasswordToken($id, 'admin_reset', 1440);
            }
            $this->audit->log('FIELD CHANGE', 'User', $id, (string) $user['full_name'], 'Password', '—', 'reset', ['delivery' => $delivery]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        if ($delivery === 'invite') {
            $url = rtrim((string) Config::get('APP_URL', ''), '/') . '/reset-password?token=' . rawurlencode($token);
            try {
                $this->mailer->send((string) $user['email'], 'Сброс пароля Client Data CRM', "Установите новый пароль по ссылке (действует 24 часа):\n{$url}\n");
            } catch (Throwable) {
                $warning = 'Ссылка создана, но письмо не отправлено. Проверьте настройки почтового сервера.';
            }
        }
        $payload = ['data' => ['message' => 'Сброс пароля подготовлен.']];
        if ($warning !== null) {
            $payload['warnings'] = ['mail' => $warning];
        }
        Response::json($payload);
    }

    public function log(Request $request, int $id): never
    {
        $this->auth->requireAdmin();
        $this->find($id);
        $pagination = new Pagination($request->query);
        $count = $this->db->prepare('SELECT COUNT(*) FROM change_events WHERE entity_type = :type AND entity_id = :id');
        $count->execute(['type' => 'User', 'id' => $id]);
        $stmt = $this->db->prepare(
            'SELECT * FROM change_events
             WHERE entity_type = :type AND entity_id = :id
             ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset'
        );
        $stmt->bindValue(':type', 'User');
        $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([AuditLogger::class, 'redactEvent'], $stmt->fetchAll()), 'meta' => $pagination->meta((int) $count->fetchColumn())]);
    }

    private function protectLastAdmin(array $before, string $newRole, bool $newActive): void
    {
        if ($before['role'] !== 'admin' || !(bool) $before['is_active'] || ($newRole === 'admin' && $newActive)) {
            return;
        }
        $rows = $this->db->query("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 AND pending_approval = 0 FOR UPDATE")->fetchAll(PDO::FETCH_COLUMN);
        $count = count($rows);
        if ($count <= 1) {
            throw new ApiException(409, 'last_active_admin', 'Нельзя изменить роль или деактивировать последнего активного Admin.');
        }
    }

    /** @return array<string, mixed> */
    private function find(int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM users WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'user_not_found', 'Пользователь не найден.');
        }
        return $this->map($row);
    }

    /** @return array<string, mixed> */
    private function findForUpdate(int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM users WHERE id = :id FOR UPDATE');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'user_not_found', 'Пользователь не найден.');
        }
        return $row;
    }

    /** @return array<string, mixed> */
    public function map(array $row): array
    {
        return [
            'id' => (int) $row['id'], 'full_name' => (string) $row['full_name'], 'email' => (string) $row['email'],
            'phone' => $row['phone'] ?? null, 'photo_data_url' => $row['photo_data_url'] ?? null,
            'role' => (string) $row['role'], 'is_active' => (bool) $row['is_active'],
            'pending_approval' => (bool) $row['pending_approval'], 'must_change_password' => (bool) $row['must_change_password'],
            'last_login_at' => Clock::api($row['last_login_at'] ?? null), 'created_at' => Clock::api($row['created_at'] ?? null),
            'updated_at' => Clock::api($row['updated_at'] ?? null),
        ];
    }
}
