<?php

declare(strict_types=1);

use CRM\Config\Config;
use CRM\Config\Env;
use CRM\Database\Database;
use CRM\Domain\ManagerUserLinker;
use CRM\Support\Clock;

$backendRoot = dirname(__DIR__) . '/backend';
require $backendRoot . '/src/autoload.php';

Env::load($backendRoot . '/.env');
Config::bootstrap($backendRoot);

$db = Database::connection();
$db->beginTransaction();

try {
    $suffix = bin2hex(random_bytes(6));
    $now = Clock::dbNow();
    $insertUser = $db->prepare(
        "INSERT INTO users
            (full_name, email, role, is_active, pending_approval, must_change_password, created_at, updated_at)
         VALUES (:name, :email, 'editor', 1, 0, 0, :created_at, :updated_at)"
    );
    $insertManager = $db->prepare(
        "INSERT INTO lookups
            (type, key_code, value, sort_order, is_active, is_closed, requires_detail, requires_referral, created_at, updated_at)
         VALUES ('cjn_manager', :key_code, :value, 9999, 1, 0, 0, 0, :created_at, :updated_at)"
    );

    $name = "Auto Link {$suffix}";
    $insertUser->execute(['name' => "  AUTO   LINK {$suffix}  ", 'email' => "auto-link-{$suffix}@example.test", 'created_at' => $now, 'updated_at' => $now]);
    $userId = (int) $db->lastInsertId();
    $insertManager->execute(['key_code' => "auto_link_{$suffix}", 'value' => $name, 'created_at' => $now, 'updated_at' => $now]);
    $managerId = (int) $db->lastInsertId();

    $linker = new ManagerUserLinker($db);
    $manager = $linker->ensureForUser($userId);
    if ($manager === null || $manager['id'] !== $managerId || $manager['value'] !== $name) {
        throw new RuntimeException('The unique normalized manager name was not linked to the user.');
    }
    $linkedUser = $db->prepare('SELECT user_id FROM lookups WHERE id = :id');
    $linkedUser->execute(['id' => $managerId]);
    $linkedUserId = $linkedUser->fetchColumn();
    if ((int) $linkedUserId !== $userId) {
        throw new RuntimeException('The manager lookup did not retain the linked user id.');
    }

    $ambiguousName = "Ambiguous User {$suffix}";
    foreach (["Ambiguous User {$suffix}", " ambiguous   user {$suffix} "] as $index => $duplicateName) {
        $insertUser->execute([
            'name' => $duplicateName,
            'email' => "ambiguous-{$index}-{$suffix}@example.test",
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        if ($index === 0) {
            $ambiguousUserId = (int) $db->lastInsertId();
        }
    }
    $insertManager->execute(['key_code' => "ambiguous_{$suffix}", 'value' => $ambiguousName, 'created_at' => $now, 'updated_at' => $now]);
    $ambiguousManagerId = (int) $db->lastInsertId();
    if ($linker->ensureForUser($ambiguousUserId) !== null) {
        throw new RuntimeException('An ambiguous user name was linked automatically.');
    }
    $linkedUser->execute(['id' => $ambiguousManagerId]);
    $ambiguousLinkedUser = $linkedUser->fetchColumn();
    if ($ambiguousLinkedUser !== null) {
        throw new RuntimeException('The ambiguous manager lookup must remain unlinked.');
    }

    echo "Manager/user auto-link regression: OK\n";
} finally {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
}
