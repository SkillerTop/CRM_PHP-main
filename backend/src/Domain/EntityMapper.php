<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Support\Clock;

final class EntityMapper
{
    /** @return array<string, mixed> */
    public static function company(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'type_id' => (int) $row['type_lookup_id'],
            'type' => $row['type_value'] ?? null,
            'country' => (string) $row['country'],
            'city' => $row['city'],
            'status_id' => (int) $row['status_lookup_id'],
            'status' => $row['status_value'] ?? null,
            'manager_id' => isset($row['manager_lookup_id']) ? (int) $row['manager_lookup_id'] : null,
            'manager' => $row['manager_value'] ?? null,
            'last_contact_date' => $row['last_contact_date'],
            'website' => $row['website'],
            'linkedin' => $row['linkedin'],
            'logo_data_url' => $row['logo_data_url'] ?? null,
            'description' => $row['description'],
            'is_archived' => (bool) $row['is_archived'],
            'created_at' => Clock::api($row['created_at'] ?? null),
            'updated_at' => Clock::api($row['updated_at'] ?? null),
            'created_by' => isset($row['created_by']) ? (int) $row['created_by'] : null,
            'updated_by' => isset($row['updated_by']) ? (int) $row['updated_by'] : null,
            'created_by_name' => $row['created_by_name'] ?? null,
        ];
    }

    /** @return array<string, mixed> */
    public static function contact(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'company_id' => (int) $row['company_id'],
            'company' => $row['company_name'] ?? null,
            'status' => (string) ($row['contact_status'] ?? 'active'),
            'first_name' => (string) $row['first_name'],
            'last_name' => $row['last_name'],
            'position' => $row['position'],
            'phone' => $row['phone'],
            'email' => $row['email'],
            'linkedin' => $row['linkedin'],
            'source_id' => isset($row['source_lookup_id']) ? (int) $row['source_lookup_id'] : null,
            'source' => $row['source_value'] ?? null,
            'source_detail' => $row['source_detail'],
            'referred_by' => $row['referred_by'],
            'initiated_by_id' => isset($row['initiated_by_lookup_id']) ? (int) $row['initiated_by_lookup_id'] : null,
            'initiated_by' => $row['initiated_by_value'] ?? ($row['initiated_by_text'] ?? null),
            'initiated_by_text' => $row['initiated_by_text'] ?? null,
            'manager_id' => isset($row['manager_lookup_id']) ? (int) $row['manager_lookup_id'] : null,
            'manager' => $row['manager_value'] ?? null,
            'photo_data_url' => $row['photo_data_url'] ?? null,
            'is_archived' => (bool) $row['is_archived'],
            'created_at' => Clock::api($row['created_at'] ?? null),
            'updated_at' => Clock::api($row['updated_at'] ?? null),
            'created_by_name' => $row['created_by_name'] ?? null,
        ];
    }

    /** @return array<string, mixed> */
    public static function task(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'company_id' => (int) $row['company_id'],
            'company' => $row['company_name'] ?? null,
            'name' => (string) $row['name'],
            'contact_date' => (string) $row['contact_date'],
            'manager_id' => (int) $row['manager_lookup_id'],
            'manager' => $row['manager_value'] ?? null,
            'contact_person_id' => isset($row['contact_person_id']) ? (int) $row['contact_person_id'] : null,
            'contact_person' => $row['contact_person_name'] ?? null,
            'description' => $row['description'],
            'status_id' => (int) $row['status_lookup_id'],
            'status' => $row['status_value'] ?? null,
            'priority' => $row['priority'] ?? 'Normal',
            'is_closed' => (bool) ($row['status_is_closed'] ?? false),
            'outcome_status_id' => isset($row['outcome_status_lookup_id']) ? (int) $row['outcome_status_lookup_id'] : null,
            'outcome_status' => $row['outcome_status_value'] ?? null,
            'outcome_notes' => $row['outcome_notes'],
            'deadline' => Clock::api($row['deadline'] ?? null),
            'is_overdue' => isset($row['is_overdue']) ? (bool) $row['is_overdue'] : false,
            'reminder_possible' => isset($row['reminder_possible']) ? (bool) $row['reminder_possible'] : null,
            'comment_count' => isset($row['comment_count']) ? (int) $row['comment_count'] : null,
            'change_count' => isset($row['change_count']) ? (int) $row['change_count'] : null,
            'is_archived' => (bool) $row['is_archived'],
            'created_at' => Clock::api($row['created_at'] ?? null),
            'updated_at' => Clock::api($row['updated_at'] ?? null),
            'created_by_name' => $row['created_by_name'] ?? null,
        ];
    }
}
