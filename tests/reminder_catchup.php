<?php

declare(strict_types=1);

use CRM\Config\Config;
use CRM\Config\Env;
use CRM\Database\Database;
use CRM\Domain\AuditLogger;
use CRM\Domain\IcsGenerator;
use CRM\Domain\Mailer;
use CRM\Domain\ReminderService;
use CRM\Security\AuthContext;

$backendRoot = dirname(__DIR__) . '/backend';
require $backendRoot . '/src/autoload.php';
Env::load($backendRoot . '/.env');
Config::bootstrap($backendRoot);

if (strtolower((string) Config::get('MAIL_TRANSPORT', 'log')) !== 'log') {
    fwrite(STDERR, "Reminder catch-up test requires MAIL_TRANSPORT=log.\n");
    exit(2);
}

$db = Database::connection();
$task = $db->query(
    "SELECT id FROM tasks
     WHERE name LIKE 'Catch-up reminder %' AND is_archived = 0
     ORDER BY id DESC LIMIT 1"
)->fetchColumn();
if ($task === false) {
    throw new RuntimeException('Run tests/api_smoke.py first: catch-up task is missing.');
}

$reminder = $db->prepare(
    "SELECT id FROM task_reminders
     WHERE task_id = :task_id AND state <> 'sent'
     ORDER BY id DESC LIMIT 1"
);
$reminder->execute(['task_id' => $task]);
$reminderId = $reminder->fetchColumn();
if ($reminderId === false) {
    throw new RuntimeException('Pending reminder for catch-up task is missing.');
}

$manager = $db->prepare(
    'SELECT m.id, m.user_id, m.email
     FROM tasks t JOIN lookups m ON m.id = t.manager_lookup_id
     WHERE t.id = :task_id'
);
$manager->execute(['task_id' => $task]);
$managerBefore = $manager->fetch();
if (!$managerBefore) {
    throw new RuntimeException('Task manager is missing.');
}

$testRecipient = $db->prepare(
    'UPDATE lookups SET user_id = NULL, email = :email WHERE id = :id'
);
$testRecipient->execute(['email' => 'reminder.catchup@example.com', 'id' => $managerBefore['id']]);

$makeDue = $db->prepare(
    "UPDATE task_reminders
     SET scheduled_at = UTC_TIMESTAMP(6) - INTERVAL 3 HOUR, state = 'pending', attempts = 0,
         recipient_email = NULL, error_message = NULL, locked_at = NULL, sent_at = NULL,
         updated_at = UTC_TIMESTAMP(6)
     WHERE id = :id"
);
$makeDue->execute(['id' => $reminderId]);

try {
    $auth = new AuthContext($db);
    $service = new ReminderService($db, new AuditLogger($db, $auth), new Mailer(), new IcsGenerator());
    $first = $service->run();

    $state = $db->prepare('SELECT state, attempts, sent_at FROM task_reminders WHERE id = :id');
    $state->execute(['id' => $reminderId]);
    $afterFirst = $state->fetch();
    if (!$afterFirst || $afterFirst['state'] !== 'sent' || $afterFirst['sent_at'] === null) {
        throw new RuntimeException('Due reminder was not sent by catch-up run.');
    }

    $second = $service->run();
    $state->execute(['id' => $reminderId]);
    $afterSecond = $state->fetch();
    if (!$afterSecond || $afterSecond['state'] !== 'sent' || (int) $afterSecond['attempts'] !== (int) $afterFirst['attempts']) {
        throw new RuntimeException('Second scheduler run duplicated the sent reminder.');
    }

    $audit = $db->prepare(
        "SELECT COUNT(*) FROM change_events
         WHERE entity_type = 'Task' AND entity_id = :task_id AND action = 'REMINDER SENT'"
    );
    $audit->execute(['task_id' => $task]);
    if ((int) $audit->fetchColumn() !== 1) {
        throw new RuntimeException('Expected exactly one REMINDER SENT audit event.');
    }
} finally {
    $restoreManager = $db->prepare(
        'UPDATE lookups SET user_id = :user_id, email = :email WHERE id = :id'
    );
    $restoreManager->execute([
        'user_id' => $managerBefore['user_id'],
        'email' => $managerBefore['email'],
        'id' => $managerBefore['id'],
    ]);
}

echo json_encode([
    'status' => 'ok',
    'task_id' => (int) $task,
    'reminder_id' => (int) $reminderId,
    'first_run' => $first,
    'second_run' => $second,
], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
