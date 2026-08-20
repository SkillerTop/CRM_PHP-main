<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Http\ApiException;
use CRM\Support\Clock;

final class RecordGuard
{
    public static function optimistic(array $row, ?string $clientUpdatedAt): void
    {
        if ($clientUpdatedAt === null || trim($clientUpdatedAt) === '') {
            throw new ApiException(400, 'updated_at_required', 'Для сохранения требуется updated_at из последнего GET.', [
                'fields' => ['updated_at' => 'Обязательное поле для защиты от одновременного редактирования.'],
            ]);
        }
        $client = Clock::parseTimestamp($clientUpdatedAt, 'updated_at');
        if ($client === null || Clock::db($client) !== (string) $row['updated_at']) {
            throw new ApiException(409, 'edit_conflict', 'Запись изменена другим пользователем. Обновите данные и повторите правки.', [
                'server_updated_at' => Clock::api((string) $row['updated_at']),
            ]);
        }
    }
}

