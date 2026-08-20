<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\AuditLogger;
use CRM\Domain\Mailer;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Security\Password;
use CRM\Support\Arr;
use CRM\Support\Clock;
use CRM\Support\Validator;
use CRM\Support\ImageDataUrl;
use PDO;
use Throwable;

final class ProfileController
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer
    ) {
    }

    public function show(): never
    {
        Response::json(['data' => $this->auth->user()]);
    }

    public function update(Request $request): never
    {
        $data = $request->json();
        $current = $this->loadUser();
        $name = array_key_exists('full_name', $data) ? (string) Arr::string($data, 'full_name', '') : (string) $current['full_name'];
        $email = array_key_exists('email', $data) ? mb_strtolower((string) Arr::string($data, 'email', '')) : (string) $current['email'];
        $phone = array_key_exists('phone', $data) ? Arr::nullableString($data, 'phone') : $current['phone'];
        $photo = array_key_exists('photo_data_url', $data) ? ImageDataUrl::validate(
            Arr::nullableString($data, 'photo_data_url'), 5 * 1024 * 1024, ['image/jpeg', 'image/png', 'image/webp'],
            'invalid_profile_photo', 'Фото должно быть JPG, PNG или WebP размером не более 5 МБ.'
        ) : $current['photo_data_url'];
        Validator::ensure([
            'full_name' => Validator::required($name) ?: Validator::max($name, 150),
            'email' => Validator::required($email) ?: (Validator::email($email) ?: Validator::max($email, 255)),
            'phone' => Validator::phone($phone) ?: Validator::max($phone, 50),
        ]);
        if ($email !== $current['email'] && !Password::verify((string) Arr::string($data, 'current_password', ''), $current['password_hash'])) {
            throw new ApiException(400, 'current_password_required', 'Для смены email укажите текущий пароль.', ['fields' => ['current_password' => 'Неверный текущий пароль.']]);
        }
        $duplicate = $this->db->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
        $duplicate->execute(['email' => $email, 'id' => $current['id']]);
        if ($duplicate->fetchColumn() !== false) {
            throw new ApiException(409, 'email_exists', 'Этот email уже используется.');
        }

        $stmt = $this->db->prepare('UPDATE users SET full_name = :name, email = :email, phone = :phone, photo_data_url = :photo, updated_at = :now, updated_by = :actor_id WHERE id = :id');
        $stmt->execute(['name' => $name, 'email' => $email, 'phone' => $phone, 'photo' => $photo, 'now' => Clock::dbNow(), 'actor_id' => $current['id'], 'id' => $current['id']]);
        if ($name !== $current['full_name']) {
            $this->audit->log('FIELD CHANGE', 'User', (int) $current['id'], $name, 'Full name', (string) $current['full_name'], $name);
        }
        if ($email !== $current['email']) {
            $this->audit->log('FIELD CHANGE', 'User', (int) $current['id'], $name, 'Email', (string) $current['email'], $email);
            try {
                $this->mailer->send((string) $current['email'], 'Логин CRM изменён', "Ваш логин CRM изменён на {$email}. Если это сделали не вы, обратитесь к администратору.");
            } catch (Throwable) {
                // Profile update is not rolled back by an unavailable mail relay.
            }
        }
        Response::json(['data' => ['message' => 'Профиль обновлён.']]);
    }

    public function password(Request $request): never
    {
        $data = $request->json();
        $currentPassword = (string) Arr::string($data, 'current_password', '');
        $newPassword = (string) Arr::string($data, 'password', '');
        $confirmation = (string) Arr::string($data, 'password_confirmation', '');
        Validator::ensure([
            'current_password' => Validator::required($currentPassword),
            'password' => Validator::password($newPassword),
            'password_confirmation' => $newPassword !== $confirmation ? 'Пароли не совпадают.' : '',
        ]);
        $current = $this->loadUser();
        if (!Password::verify($currentPassword, $current['password_hash'])) {
            throw new ApiException(400, 'invalid_current_password', 'Текущий пароль указан неверно.', ['fields' => ['current_password' => 'Неверный пароль.']]);
        }
        if (Password::verify($newPassword, $current['password_hash'])) {
            throw new ApiException(400, 'password_unchanged', 'Новый пароль должен отличаться от текущего.', [
                'fields' => ['password' => 'Укажите новый пароль, отличный от текущего.'],
            ]);
        }
        $stmt = $this->db->prepare('UPDATE users SET password_hash = :hash, must_change_password = 0, updated_at = :now, updated_by = :actor_id WHERE id = :id');
        $stmt->execute(['hash' => Password::hash($newPassword), 'now' => Clock::dbNow(), 'actor_id' => $current['id'], 'id' => $current['id']]);
        $this->auth->revokeOtherSessions((int) $current['id']);
        $this->audit->log('FIELD CHANGE', 'User', (int) $current['id'], (string) $current['full_name'], 'Password', '—', 'changed');
        Response::json(['data' => ['message' => 'Пароль изменён; остальные сессии завершены.']]);
    }

    /** @return array<string, mixed> */
    private function loadUser(): array
    {
        $stmt = $this->db->prepare('SELECT * FROM users WHERE id = :id');
        $stmt->execute(['id' => $this->auth->userId()]);
        $user = $stmt->fetch();
        if (!$user) {
            throw new ApiException(401, 'unauthenticated', 'Пользователь не найден.');
        }
        return $user;
    }
}
