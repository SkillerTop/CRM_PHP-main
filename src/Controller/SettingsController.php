<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Config\Config;
use CRM\Domain\AuditLogger;
use CRM\Domain\SystemSettings;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Support\Arr;
use CRM\Support\Clock;
use CRM\Support\Validator;
use PDO;
use Throwable;

final class SettingsController
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly AuditLogger $audit,
        private readonly SystemSettings $settings
    ) {
    }

    public function show(): never
    {
        $this->auth->requireAdmin();
        Response::json(['data' => $this->payload()]);
    }

    public function update(Request $request): never
    {
        $this->auth->requireAdmin();
        $input = $request->json();
        $email = Arr::nullableString($input, 'system_notification_email');
        $notify = Arr::bool($input, 'notify_new_registrations', true);
        $domains = $this->domains($input['registration_allowed_domains'] ?? []);
        Validator::ensure(['system_notification_email' => Validator::email($email)]);

        $before = $this->payload();
        $this->db->beginTransaction();
        try {
            $this->upsert('system_notification_email', $email ?? '');
            $this->upsert('notify_new_registrations', $notify ? 'true' : 'false');
            $this->upsert('registration_domains_managed', 'true');

            $this->db->exec('UPDATE registration_domains SET is_active = 0');
            $upsert = $this->db->prepare(
                'INSERT INTO registration_domains
                    (domain, is_active, created_by, updated_by, created_at, updated_at)
                 VALUES (:domain, 1, :created_by, :updated_by, :created_at, :updated_at)
                 ON DUPLICATE KEY UPDATE is_active = 1, updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)'
            );
            foreach ($domains as $domain) {
                $now = Clock::dbNow();
                $upsert->execute([
                    'domain' => $domain,
                    'created_by' => $this->auth->userId(),
                    'updated_by' => $this->auth->userId(),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            $after = $this->payload();
            foreach ([
                'system_notification_email' => 'System notification email',
                'notify_new_registrations' => 'Notify new registrations',
                'registration_allowed_domains' => 'Registration allowed domains',
            ] as $field => $label) {
                $old = is_array($before[$field]) ? implode(', ', $before[$field]) : (string) $before[$field];
                $new = is_array($after[$field]) ? implode(', ', $after[$field]) : (string) $after[$field];
                if ($old !== $new) {
                    $this->audit->log('FIELD CHANGE', 'Setting', null, 'Registration settings', $label, $old ?: '—', $new ?: '—');
                }
            }
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }

        Response::json(['data' => $this->payload()]);
    }

    private function upsert(string $key, string $value): void
    {
        $stmt = $this->db->prepare(
            'INSERT INTO settings (setting_key, setting_value, updated_by, updated_at)
             VALUES (:key, :value, :actor_id, :now)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value),
                updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)'
        );
        $stmt->execute([
            'key' => $key,
            'value' => $value,
            'actor_id' => $this->auth->userId(),
            'now' => Clock::dbNow(),
        ]);
    }

    /** @return list<string> */
    private function domains(mixed $value): array
    {
        if (!is_array($value)) {
            throw new ApiException(400, 'validation_error', 'registration_allowed_domains должен быть массивом.');
        }
        $domains = [];
        foreach ($value as $item) {
            $domain = mb_strtolower(trim((string) $item));
            if ($domain === '' || preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $domain) !== 1) {
                throw new ApiException(400, 'validation_error', 'Некорректный домен регистрации.', ['fields' => ['registration_allowed_domains' => $domain]]);
            }
            $domains[] = $domain;
        }
        $domains = array_values(array_unique($domains));
        sort($domains, SORT_STRING);
        return $domains;
    }

    /** @return array<string, mixed> */
    private function payload(): array
    {
        return [
            'system_notification_email' => $this->settings->notificationEmail(),
            'notify_new_registrations' => $this->settings->bool(
                'notify_new_registrations',
                Config::bool('NOTIFY_NEW_REGISTRATIONS', true)
            ),
            'registration_allowed_domains' => $this->settings->registrationDomains(),
        ];
    }
}
