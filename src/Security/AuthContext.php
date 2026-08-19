<?php

declare(strict_types=1);

namespace CRM\Security;

use CRM\Config\Config;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Support\Clock;
use PDO;

final class AuthContext
{
    /** @var array<string, mixed>|null */
    private ?array $user = null;
    /** @var array<string, mixed>|null */
    private ?array $session = null;

    public function __construct(private readonly PDO $db)
    {
    }

    public function resolve(Request $request): void
    {
        $cookieName = (string) Config::get('SESSION_COOKIE', 'crm_session');
        $token = $_COOKIE[$cookieName] ?? $request->bearerToken();
        if (!is_string($token) || $token === '') {
            return;
        }

        $stmt = $this->db->prepare(
            'SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_activity_at,
                    u.id, u.full_name, u.email, u.phone, u.photo_data_url, u.role, u.is_active, u.pending_approval,
                    u.must_change_password, u.last_login_at, u.updated_at
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = :token_hash AND s.revoked_at IS NULL
             LIMIT 1'
        );
        $stmt->execute(['token_hash' => hash('sha256', $token)]);
        $row = $stmt->fetch();
        if (!$row || !(bool) $row['is_active'] || (bool) $row['pending_approval']) {
            return;
        }

        $now = Clock::utcNow();
        if ($now >= new \DateTimeImmutable((string) $row['expires_at'], new \DateTimeZone('UTC'))) {
            $this->revoke((int) $row['session_id']);
            return;
        }

        $hours = Config::int('SESSION_IDLE_HOURS', 12);
        $expires = Clock::db($now->modify("+{$hours} hours"));
        $update = $this->db->prepare(
            'UPDATE user_sessions SET last_activity_at = :now, expires_at = :expires WHERE id = :id'
        );
        $update->execute(['now' => Clock::db($now), 'expires' => $expires, 'id' => $row['session_id']]);

        $this->session = [
            'id' => (int) $row['session_id'],
            'csrf_token' => (string) $row['csrf_token'],
            'raw_token' => $token,
            'expires_at' => $expires,
        ];
        $this->user = $this->mapUser($row);
        $this->refreshCookie($token, $hours);
    }

    public function authenticated(): bool
    {
        return $this->user !== null;
    }

    /** @return array<string, mixed> */
    public function user(): array
    {
        if ($this->user === null) {
            throw new ApiException(401, 'unauthenticated', 'Требуется вход в систему.');
        }
        return $this->user;
    }

    public function userId(): int
    {
        return (int) $this->user()['id'];
    }

    public function actorName(): string
    {
        return (string) $this->user()['full_name'];
    }

    public function csrfToken(): string
    {
        return (string) ($this->session['csrf_token'] ?? '');
    }

    public function sessionId(): int
    {
        return (int) ($this->session['id'] ?? 0);
    }

    public function requireRole(string ...$roles): void
    {
        $user = $this->user();
        if (!in_array($user['role'], $roles, true)) {
            throw new ApiException(403, 'forbidden', 'Недостаточно прав для этой операции.');
        }
    }

    public function requireWrite(): void
    {
        $this->requireRole('admin', 'manager', 'editor');
    }

    public function requireAdmin(): void
    {
        $this->requireRole('admin');
    }

    public function validateCsrf(Request $request): void
    {
        $provided = (string) $request->header('X-CSRF-Token', '');
        if ($provided === '' || !hash_equals($this->csrfToken(), $provided)) {
            throw new ApiException(419, 'csrf_mismatch', 'CSRF-токен отсутствует или устарел.');
        }
    }

    /** @return array{token:string,csrf_token:string,expires_at:string} */
    public function createSession(int $userId, Request $request): array
    {
        $token = bin2hex(random_bytes(32));
        $csrf = bin2hex(random_bytes(24));
        $now = Clock::utcNow();
        $hours = Config::int('SESSION_IDLE_HOURS', 12);
        $expires = Clock::db($now->modify("+{$hours} hours"));
        $stmt = $this->db->prepare(
            'INSERT INTO user_sessions
                (user_id, token_hash, csrf_token, ip_address, user_agent, last_activity_at, expires_at, created_at)
             VALUES (:user_id, :token_hash, :csrf, :ip, :user_agent, :activity_at, :expires, :created_at)'
        );
        $stmt->execute([
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'csrf' => $csrf,
            'ip' => $request->ip(),
            'user_agent' => substr((string) $request->header('User-Agent', ''), 0, 500),
            'activity_at' => Clock::db($now),
            'created_at' => Clock::db($now),
            'expires' => $expires,
        ]);
        $this->refreshCookie($token, $hours);
        return ['token' => $token, 'csrf_token' => $csrf, 'expires_at' => Clock::api($expires) ?? ''];
    }

    public function logout(): void
    {
        if ($this->session !== null) {
            $this->revoke((int) $this->session['id']);
        }
        $this->clearCookie();
    }

    public function revokeOtherSessions(int $userId): void
    {
        $stmt = $this->db->prepare(
            'UPDATE user_sessions SET revoked_at = :now
             WHERE user_id = :user_id AND revoked_at IS NULL AND id <> :current_id'
        );
        $stmt->execute(['now' => Clock::dbNow(), 'user_id' => $userId, 'current_id' => $this->sessionId()]);
    }

    public function revokeAllSessions(int $userId): void
    {
        $stmt = $this->db->prepare('UPDATE user_sessions SET revoked_at = :now WHERE user_id = :user_id AND revoked_at IS NULL');
        $stmt->execute(['now' => Clock::dbNow(), 'user_id' => $userId]);
    }

    private function revoke(int $sessionId): void
    {
        $stmt = $this->db->prepare('UPDATE user_sessions SET revoked_at = :now WHERE id = :id AND revoked_at IS NULL');
        $stmt->execute(['now' => Clock::dbNow(), 'id' => $sessionId]);
    }

    private function refreshCookie(string $token, int $hours): void
    {
        if (PHP_SAPI === 'cli') {
            return;
        }
        setcookie((string) Config::get('SESSION_COOKIE', 'crm_session'), $token, [
            'expires' => time() + ($hours * 3600),
            'path' => '/',
            'secure' => Config::bool('SESSION_SECURE', true),
            'httponly' => true,
            'samesite' => (string) Config::get('SESSION_SAMESITE', 'Lax'),
        ]);
    }

    private function clearCookie(): void
    {
        if (PHP_SAPI === 'cli') {
            return;
        }
        setcookie((string) Config::get('SESSION_COOKIE', 'crm_session'), '', [
            'expires' => time() - 3600,
            'path' => '/',
            'secure' => Config::bool('SESSION_SECURE', true),
            'httponly' => true,
            'samesite' => (string) Config::get('SESSION_SAMESITE', 'Lax'),
        ]);
    }

    /** @return array<string, mixed> */
    private function mapUser(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'full_name' => (string) $row['full_name'],
            'email' => (string) $row['email'],
            'phone' => $row['phone'] ?? null,
            'photo_data_url' => $row['photo_data_url'] ?? null,
            'role' => (string) $row['role'],
            'is_active' => (bool) $row['is_active'],
            'pending_approval' => (bool) $row['pending_approval'],
            'must_change_password' => (bool) $row['must_change_password'],
            'last_login_at' => Clock::api($row['last_login_at'] ?? null),
            'updated_at' => Clock::api($row['updated_at'] ?? null),
        ];
    }
}
