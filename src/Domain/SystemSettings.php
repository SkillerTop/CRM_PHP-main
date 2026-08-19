<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use PDO;

final class SystemSettings
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function get(string $key, ?string $default = null): ?string
    {
        $stmt = $this->db->prepare('SELECT setting_value FROM settings WHERE setting_key = :key');
        $stmt->execute(['key' => $key]);
        $value = $stmt->fetchColumn();
        return $value === false ? $default : ($value === null ? null : (string) $value);
    }

    public function bool(string $key, bool $default): bool
    {
        $value = $this->get($key);
        if ($value === null || $value === '') {
            return $default;
        }
        return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
    }

    public function notificationEmail(): string
    {
        $address = trim((string) $this->get(
            'system_notification_email',
            (string) Config::get('SYSTEM_NOTIFICATION_EMAIL', '')
        ));
        if ($address !== '') {
            return $address;
        }

        $address = $this->db->query(
            "SELECT email FROM users
             WHERE role = 'admin' AND is_active = 1 AND pending_approval = 0
             ORDER BY id LIMIT 1"
        )->fetchColumn();
        return $address === false ? '' : (string) $address;
    }

    /** @return list<string> */
    public function registrationDomains(): array
    {
        $domains = $this->db->query(
            'SELECT domain FROM registration_domains WHERE is_active = 1 ORDER BY domain'
        )->fetchAll(PDO::FETCH_COLUMN);
        if ($domains === [] && !$this->bool('registration_domains_managed', false)) {
            return array_map('mb_strtolower', Config::csv('REGISTRATION_ALLOWED_DOMAINS'));
        }
        return array_map(static fn (mixed $domain): string => mb_strtolower((string) $domain), $domains);
    }
}
