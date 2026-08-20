<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use DateTimeImmutable;
use DateTimeZone;

final class IcsGenerator
{
    /** @param array<string, mixed> $task */
    public function forTask(array $task): string
    {
        $deadline = new DateTimeImmutable((string) $task['deadline'], new DateTimeZone('UTC'));
        $end = $deadline->modify('+30 minutes');
        $host = parse_url((string) Config::get('APP_URL', 'https://crm.local'), PHP_URL_HOST) ?: 'crm.local';
        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//CJN//Client Data CRM//UK',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:task-' . (int) $task['id'] . '@' . $host,
            'DTSTAMP:' . gmdate('Ymd\THis\Z'),
            'DTSTART:' . $deadline->format('Ymd\THis\Z'),
            'DTEND:' . $end->format('Ymd\THis\Z'),
            'SUMMARY:' . $this->escape('CRM deadline: ' . (string) $task['name']),
            'DESCRIPTION:' . $this->escape(
                (string) ($task['company_name'] ?? '') . ' · ' . (string) ($task['manager_value'] ?? '') . "\n" .
                (string) ($task['description'] ?? '')
            ),
            'BEGIN:VALARM',
            'TRIGGER:-PT1H',
            'ACTION:DISPLAY',
            'DESCRIPTION:' . $this->escape((string) $task['name']),
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ];
        return implode("\r\n", $lines) . "\r\n";
    }

    private function escape(string $value): string
    {
        return str_replace(["\\", ";", ",", "\r\n", "\r", "\n"], ["\\\\", "\\;", "\\,", "\\n", "\\n", "\\n"], $value);
    }
}
