<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Config\Config;
use CRM\Domain\AuditLogger;
use CRM\Domain\Mailer;
use CRM\Domain\ManagerUserLinker;
use CRM\Domain\SystemSettings;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Security\Password;
use CRM\Security\RateLimiter;
use CRM\Support\Arr;
use CRM\Support\Clock;
use CRM\Support\Validator;
use PDO;
use Throwable;

final class AuthController
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly AuditLogger $audit,
        private readonly RateLimiter $limiter,
        private readonly Mailer $mailer,
        private readonly SystemSettings $settings,
        private readonly ManagerUserLinker $managerUsers
    ) {
    }

    public function login(Request $request): never
    {
        $data = $request->json();
        $email = mb_strtolower((string) Arr::string($data, 'email', ''));
        $password = (string) Arr::string($data, 'password', '');
        Validator::ensure([
            'email' => Validator::required($email) ?: Validator::email($email),
            'password' => Validator::required($password),
        ]);

        $rateKey = $request->ip();
        $this->limiter->ensureAllowed('login_ip', $rateKey);
        $stmt = $this->db->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();
        $valid = $user && (bool) $user['is_active'] && !(bool) $user['pending_approval'] && Password::verify($password, $user['password_hash']);
        if (!$valid) {
            $this->limiter->failure('login_ip', $rateKey);
            $this->audit->log(
                'LOGIN FAILED',
                'User',
                $user ? (int) $user['id'] : null,
                $user ? (string) $user['full_name'] : $email,
                detail: ['ip' => $request->ip()],
                actorName: $email
            );
            throw new ApiException(401, 'invalid_credentials', 'Неверные учётные данные или аккаунт не активирован.');
        }

        $this->limiter->clear('login_ip', $rateKey);
        $this->managerUsers->ensureForUser((int) $user['id']);
        $now = Clock::dbNow();
        $update = $this->db->prepare('UPDATE users SET last_login_at = :now, updated_at = updated_at WHERE id = :id');
        $update->execute(['now' => $now, 'id' => $user['id']]);
        $session = $this->auth->createSession((int) $user['id'], $request);
        $this->audit->log('LOGIN', 'User', (int) $user['id'], (string) $user['full_name'], detail: ['ip' => $request->ip()], actorUserId: (int) $user['id'], actorName: (string) $user['full_name']);

        Response::json([
            'data' => [
                'user' => $this->publicUser($user),
                'csrf_token' => $session['csrf_token'],
                'session_expires_at' => $session['expires_at'],
            ],
        ]);
    }

    public function logout(): never
    {
        $this->auth->logout();
        Response::noContent();
    }

    public function me(): never
    {
        $user = $this->auth->user();
        Response::json(['data' => [
            'user' => $user,
            'permissions' => $this->permissions((string) $user['role']),
            'csrf_token' => $this->auth->csrfToken(),
        ]]);
    }

    public function register(Request $request): never
    {
        $data = $request->json();
        $name = (string) Arr::string($data, 'full_name', '');
        $email = mb_strtolower((string) Arr::string($data, 'email', ''));
        $password = (string) Arr::string($data, 'password', '');
        $confirmation = (string) Arr::string($data, 'password_confirmation', '');
        Validator::ensure([
            'full_name' => Validator::required($name) ?: Validator::max($name, 150),
            'email' => Validator::required($email) ?: (Validator::email($email) ?: Validator::max($email, 255)),
            'password' => Validator::password($password),
            'password_confirmation' => $password !== $confirmation ? 'Пароли не совпадают.' : '',
        ]);
        $ipRateKey = $request->ip();
        $this->limiter->ensureAllowed('register_ip', $ipRateKey);
        $this->limiter->ensureAllowed('register_email', $email);
        $this->limiter->record('register_ip', $ipRateKey);
        $this->limiter->record('register_email', $email);
        $this->ensureRegistrationDomain($email);

        $exists = $this->db->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $exists->execute(['email' => $email]);
        if ($exists->fetchColumn() !== false) {
            $this->registrationAccepted();
        }

        $now = Clock::dbNow();
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                "INSERT INTO users
                    (full_name, email, password_hash, role, is_active, pending_approval, must_change_password, created_at, updated_at)
                 VALUES (:full_name, :email, :password_hash, 'readonly', 0, 1, 0, :created_at, :updated_at)"
            );
            $stmt->execute([
                'full_name' => $name, 'email' => $email, 'password_hash' => Password::hash($password),
                'created_at' => $now, 'updated_at' => $now,
            ]);
            $id = (int) $this->db->lastInsertId();
            $this->audit->log('USER REGISTERED', 'User', $id, $name, detail: ['email' => $email], actorUserId: $id, actorName: $name);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if ($error instanceof \PDOException && (string) $error->getCode() === '23000') {
                $this->registrationAccepted();
            }
            throw $error;
        }

        $this->notifyAdminAboutRegistration($name, $email, $id);
        $this->registrationAccepted();
    }

    public function forgotPassword(Request $request): never
    {
        $email = mb_strtolower((string) Arr::string($request->json(), 'email', ''));
        Validator::ensure(['email' => Validator::required($email) ?: Validator::email($email)]);
        $ipRateKey = $request->ip();
        $this->limiter->ensureAllowed('forgot_password_ip', $ipRateKey);
        $this->limiter->ensureAllowed('forgot_password_email', $email);
        $this->limiter->record('forgot_password_ip', $ipRateKey);
        $this->limiter->record('forgot_password_email', $email);
        $stmt = $this->db->prepare('SELECT id, full_name, email FROM users WHERE email = :email AND is_active = 1 AND pending_approval = 0 LIMIT 1');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();
        if ($user) {
            $token = $this->createPasswordToken((int) $user['id'], 'password_reset', 60);
            $url = rtrim((string) Config::get('APP_URL', ''), '/') . '/reset-password?token=' . rawurlencode($token);
            try {
                $this->mailer->send((string) $user['email'], 'Восстановление пароля CRM', "Здравствуйте, {$user['full_name']}.\n\nСсылка действует 1 час:\n{$url}\n");
            } catch (Throwable) {
                // The public response must not reveal whether an account or SMTP transport exists.
            }
        }
        Response::json(['data' => ['message' => 'Если адрес зарегистрирован, инструкция отправлена.']]);
    }

    public function resetPassword(Request $request): never
    {
        $data = $request->json();
        $token = (string) Arr::string($data, 'token', '');
        $password = (string) Arr::string($data, 'password', '');
        $confirmation = (string) Arr::string($data, 'password_confirmation', '');
        Validator::ensure([
            'token' => Validator::required($token),
            'password' => Validator::password($password),
            'password_confirmation' => $password !== $confirmation ? 'Пароли не совпадают.' : '',
        ]);
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'SELECT * FROM password_tokens
                 WHERE token_hash = :token_hash AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(6)
                 LIMIT 1 FOR UPDATE'
            );
            $stmt->execute(['token_hash' => hash('sha256', $token)]);
            $row = $stmt->fetch();
            if (!$row) {
                throw new ApiException(400, 'invalid_token', 'Ссылка недействительна или срок её действия истёк.');
            }
            $update = $this->db->prepare(
                'UPDATE users SET password_hash = :hash, must_change_password = 0, updated_at = :now WHERE id = :id'
            );
            $update->execute(['hash' => Password::hash($password), 'now' => Clock::dbNow(), 'id' => $row['user_id']]);
            $consume = $this->db->prepare('UPDATE password_tokens SET used_at = :now WHERE user_id = :user_id AND used_at IS NULL');
            $consume->execute(['now' => Clock::dbNow(), 'user_id' => $row['user_id']]);
            $this->auth->revokeAllSessions((int) $row['user_id']);
            $user = $this->db->prepare('SELECT full_name FROM users WHERE id = :id');
            $user->execute(['id' => $row['user_id']]);
            $name = (string) $user->fetchColumn();
            $this->audit->log('FIELD CHANGE', 'User', (int) $row['user_id'], $name, 'Password', '—', 'changed', actorUserId: (int) $row['user_id'], actorName: $name);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => ['message' => 'Пароль изменён. Теперь можно войти.']]);
    }

    public function createPasswordToken(int $userId, string $purpose, int $minutes): string
    {
        $token = bin2hex(random_bytes(32));
        $now = Clock::utcNow();
        $ownsTransaction = !$this->db->inTransaction();
        if ($ownsTransaction) {
            $this->db->beginTransaction();
        }
        try {
            $lock = $this->db->prepare('SELECT id FROM users WHERE id = :id FOR UPDATE');
            $lock->execute(['id' => $userId]);
            if ($lock->fetchColumn() === false) {
                throw new ApiException(404, 'user_not_found', 'Пользователь не найден.');
            }
            $invalidate = $this->db->prepare('UPDATE password_tokens SET used_at = :now WHERE user_id = :user_id AND used_at IS NULL');
            $invalidate->execute(['now' => Clock::db($now), 'user_id' => $userId]);
            $stmt = $this->db->prepare(
                'INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at, created_at)
                 VALUES (:user_id, :token_hash, :purpose, :expires_at, :created_at)'
            );
            $stmt->execute([
                'user_id' => $userId,
                'token_hash' => hash('sha256', $token),
                'purpose' => $purpose,
                'expires_at' => Clock::db($now->modify("+{$minutes} minutes")),
                'created_at' => Clock::db($now),
            ]);
            if ($ownsTransaction) {
                $this->db->commit();
            }
        } catch (Throwable $error) {
            if ($ownsTransaction && $this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        return $token;
    }

    /** @return array<string, mixed> */
    private function publicUser(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'full_name' => (string) $user['full_name'],
            'email' => (string) $user['email'],
            'phone' => $user['phone'] ?? null,
            'photo_data_url' => $user['photo_data_url'] ?? null,
            'role' => (string) $user['role'],
            'is_active' => (bool) $user['is_active'],
            'pending_approval' => (bool) $user['pending_approval'],
            'must_change_password' => (bool) $user['must_change_password'],
            'last_login_at' => Clock::api($user['last_login_at'] ?? null),
            'updated_at' => Clock::api($user['updated_at'] ?? null),
        ];
    }

    /** @return array<string, bool> */
    private function permissions(string $role): array
    {
        return [
            'read' => true,
            'write' => in_array($role, ['admin', 'manager', 'editor'], true),
            'archive' => $role === 'admin',
            'admin' => $role === 'admin',
        ];
    }

    private function ensureRegistrationDomain(string $email): void
    {
        $domains = $this->settings->registrationDomains();
        if ($domains === []) {
            return;
        }
        $domain = mb_strtolower((string) substr(strrchr($email, '@') ?: '', 1));
        if (!in_array($domain, array_map('mb_strtolower', $domains), true)) {
            throw new ApiException(403, 'registration_domain_denied', 'Регистрация для этого адреса недоступна.');
        }
    }

    private function notifyAdminAboutRegistration(string $name, string $email, int $id): void
    {
        if (!$this->settings->bool('notify_new_registrations', Config::bool('NOTIFY_NEW_REGISTRATIONS', true))) {
            return;
        }
        $address = $this->settings->notificationEmail();
        if ($address === '') {
            return;
        }
        $url = rtrim((string) Config::get('APP_URL', ''), '/') . '/?view=users&user=' . $id;
        try {
            $this->mailer->send($address, 'Новая регистрация CRM', "Новый пользователь ожидает подтверждения.\n\n{$name}\n{$email}\n{$url}\n");
        } catch (Throwable) {
            // Registration must remain operational when SMTP is unavailable.
        }
    }

    private function registrationAccepted(): never
    {
        Response::json(['data' => ['message' => 'Если регистрация может быть принята, заявка будет доступна администратору.']], 202);
    }
}
