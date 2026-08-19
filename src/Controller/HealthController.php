<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Http\Response;
use CRM\Support\Clock;
use PDO;
use Throwable;

final class HealthController
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function show(): never
    {
        try {
            $this->db->query('SELECT 1')->fetchColumn();
            $heartbeat = $this->db->prepare("SELECT setting_value FROM settings WHERE setting_key = 'scheduler_last_run_at'");
            $heartbeat->execute();
            $lastRun = $heartbeat->fetchColumn();
            $scheduler = 'not_started';
            if (is_string($lastRun) && $lastRun !== '') {
                $lastRunAt = new \DateTimeImmutable($lastRun, new \DateTimeZone('UTC'));
                $scheduler = $lastRunAt >= Clock::utcNow()->modify('-30 minutes') ? 'ok' : 'stale';
            }
            Response::json(['data' => [
                'status' => 'ok', 'database' => 'ok', 'scheduler' => $scheduler,
                'scheduler_last_run_at' => is_string($lastRun) && $lastRun !== '' ? Clock::api($lastRun) : null,
                'scheduler_expected_interval_minutes' => 15,
            ]]);
        } catch (Throwable) {
            Response::json(['error' => ['code' => 'unhealthy', 'message' => 'Сервис временно недоступен.']], 503);
        }
    }
}
