<?php

declare(strict_types=1);

use CRM\Config\Config;
use CRM\Config\Env;
use CRM\Database\Database;
use CRM\Domain\LookupService;
use CRM\Http\ApiException;

$backendRoot = dirname(__DIR__) . '/backend';
require $backendRoot . '/src/autoload.php';

Env::load($backendRoot . '/.env');
Config::bootstrap($backendRoot);

$db = Database::connection();
$db->beginTransaction();

try {
    $row = $db->query(
        "SELECT id, type FROM lookups WHERE type = 'company_type' AND is_active = 1 ORDER BY id LIMIT 1 FOR UPDATE"
    )->fetch();
    if (!$row) {
        throw new RuntimeException('An active company_type lookup is required for the regression test.');
    }

    $db->prepare('UPDATE lookups SET is_active = 0 WHERE id = :id')->execute(['id' => $row['id']]);
    $lookups = new LookupService($db);

    $retained = $lookups->getForAssignment((int) $row['id'], (string) $row['type'], (int) $row['id']);
    if ((int) $retained['id'] !== (int) $row['id']) {
        throw new RuntimeException('The existing inactive lookup was not retained.');
    }

    try {
        $lookups->getForAssignment((int) $row['id'], (string) $row['type']);
        throw new RuntimeException('A new assignment unexpectedly accepted an inactive lookup.');
    } catch (ApiException $error) {
        if ($error->errorCode !== 'invalid_lookup') {
            throw $error;
        }
    }

    echo "Lookup assignment regression: OK\n";
} finally {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
}
