<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Config\Config;
use CRM\Domain\AuditLogger;
use CRM\Domain\EntityMapper;
use CRM\Domain\IcsGenerator;
use CRM\Domain\LookupService;
use CRM\Domain\RecordGuard;
use CRM\Domain\ReminderService;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Security\ResourceGuard;
use CRM\Support\Arr;
use CRM\Support\Clock;
use CRM\Support\Pagination;
use CRM\Support\Validator;
use CRM\Support\UploadedFile;
use CRM\Support\StoredFile;
use PDO;
use Throwable;

final class TaskController
{
    public function __construct(
        private readonly PDO $db,
        private readonly AuthContext $auth,
        private readonly AuditLogger $audit,
        private readonly LookupService $lookups,
        private readonly ReminderService $reminders,
        private readonly IcsGenerator $ics,
        private readonly ResourceGuard $resources
    ) {
    }

    public function index(Request $request): never
    {
        $pagination = new Pagination($request->query);
        [$whereSql, $params] = $this->filters($request->query);
        $count = $this->db->prepare(
            "SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id = t.company_id
             JOIN lookups s ON s.id = t.status_lookup_id WHERE {$whereSql}"
        );
        $count->execute($params);
        $total = (int) $count->fetchColumn();
        $sorts = [
            'contact_date' => 't.contact_date', 'deadline' => 't.deadline', 'manager' => 'manager_value',
            'status' => 'status_value', 'company' => 'c.name', 'name' => 't.name', 'updated_at' => 't.updated_at',
        ];
        $sort = $sorts[(string) ($request->query['sort'] ?? 'contact_date')] ?? 't.contact_date';
        $dir = strtolower((string) ($request->query['dir'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';
        $stmt = $this->db->prepare(
            "SELECT t.*, c.name AS company_name, m.value AS manager_value,
                    COALESCE(u.email, m.email) AS manager_email, s.value AS status_value,
                    creator.full_name AS created_by_name, creator.email AS created_by_email,
                    s.is_closed AS status_is_closed, o.value AS outcome_status_value,
                    TRIM(CONCAT(COALESCE(k.first_name, ''), ' ', COALESCE(k.last_name, ''))) AS contact_person_name,
                    (s.is_closed = 0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)) AS is_overdue,
                    (CASE
                        WHEN m.user_id IS NOT NULL THEN u.is_active = 1 AND u.pending_approval = 0 AND u.email <> ''
                        ELSE m.email IS NOT NULL AND m.email <> ''
                     END) AS reminder_possible,
                    (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count,
                    (SELECT COUNT(*) FROM change_events ce WHERE ce.entity_type = 'Task' AND ce.entity_id = t.id) AS change_count
             FROM tasks t
             JOIN companies c ON c.id = t.company_id
             JOIN lookups m ON m.id = t.manager_lookup_id
             LEFT JOIN users u ON u.id = m.user_id
             LEFT JOIN users creator ON creator.id = t.created_by
             JOIN lookups s ON s.id = t.status_lookup_id
             LEFT JOIN lookups o ON o.id = t.outcome_status_lookup_id
             LEFT JOIN contacts k ON k.id = t.contact_person_id
             WHERE {$whereSql}
             ORDER BY {$sort} {$dir}, t.id {$dir}
             LIMIT :limit OFFSET :offset"
        );
        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([EntityMapper::class, 'task'], $stmt->fetchAll()), 'meta' => $pagination->meta($total)]);
    }

    public function forCompany(Request $request, int $companyId): never
    {
        $this->assertCompany($companyId);
        $pagination = new Pagination($request->query);
        $count = $this->db->prepare('SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id = t.company_id WHERE t.company_id = :company_id AND t.is_archived = 0 AND c.is_archived = 0');
        $count->execute(['company_id' => $companyId]);
        $stmt = $this->db->prepare($this->baseSelect() . ' WHERE t.company_id = :company_id AND t.is_archived = 0 AND c.is_archived = 0 ORDER BY t.contact_date DESC, t.id DESC LIMIT :limit OFFSET :offset');
        $stmt->bindValue(':company_id', $companyId, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([EntityMapper::class, 'task'], $stmt->fetchAll()), 'meta' => $pagination->meta((int) $count->fetchColumn())]);
    }

    public function show(Request $request, int $id): never
    {
        Response::json(['data' => $this->detail($id, $request->query)]);
    }

    public function store(Request $request): never
    {
        $this->auth->requireWrite();
        $input = $request->json();
        $data = $this->validated($input);
        $now = Clock::dbNow();
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'INSERT INTO tasks
                    (company_id, name, contact_date, manager_lookup_id, contact_person_id, description,
                     status_lookup_id, priority, outcome_status_lookup_id, outcome_notes, deadline, is_archived,
                     created_by, updated_by, created_at, updated_at)
                 VALUES (:company_id, :name, :contact_date, :manager_id, :contact_person_id, :description,
                         :status_id, :priority, :outcome_status_id, :outcome_notes, :deadline, 0,
                         :created_by, :updated_by, :created_at, :updated_at)'
            );
            $stmt->execute($data['record'] + [
                'created_by' => $this->auth->userId(), 'updated_by' => $this->auth->userId(),
                'created_at' => $now, 'updated_at' => $now,
            ]);
            $id = (int) $this->db->lastInsertId();
            $this->reminders->syncTask($id, $data['reminder_lead_ids']);
            $this->recalculateLastContact((int) $data['record']['company_id']);
            $this->audit->log('CREATE', 'Task', $id, (string) $data['record']['name'], detail: ['company_id' => $data['record']['company_id']]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        $payload = ['data' => $this->detail($id)];
        if ($data['deadline_in_past']) {
            $payload['warnings'] = ['deadline' => 'Дедлайн в прошлом: напоминания для уже прошедших моментов помечены skipped.'];
        }
        Response::json($payload, 201);
    }

    public function update(Request $request, int $id): never
    {
        $this->auth->requireWrite();
        $input = $request->json();
        $this->db->beginTransaction();
        try {
            $before = $this->findForUpdate($id);
            RecordGuard::optimistic($before, Arr::string($input, 'updated_at'));
            $oldLeads = $this->leadIds($id);
            $data = $this->validated($input, $before, $oldLeads);
            if ((int) $before['company_id'] !== (int) $data['record']['company_id']) {
                throw new ApiException(400, 'company_change_forbidden', 'Перенос задачи в другую компанию не поддерживается.');
            }
            $stmt = $this->db->prepare(
                'UPDATE tasks SET name = :name, contact_date = :contact_date, manager_lookup_id = :manager_id,
                    contact_person_id = :contact_person_id, description = :description, status_lookup_id = :status_id, priority = :priority,
                    outcome_status_lookup_id = :outcome_status_id, outcome_notes = :outcome_notes, deadline = :deadline,
                    updated_by = :user_id, updated_at = :now WHERE id = :id'
            );
            $updateRecord = $data['record'];
            unset($updateRecord['company_id']);
            $stmt->execute($updateRecord + ['user_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
            $after = $this->findForUpdate($id);
            $this->audit->logDiff('Task', $id, (string) $data['record']['name'], $before, $after, [
                'name' => 'Task title', 'contact_date' => 'Contact Date', 'status_lookup_id' => 'Status',
                'outcome_status_lookup_id' => 'Outcome status', 'deadline' => 'Deadline',
                'manager_lookup_id' => 'CJN Manager', 'contact_person_id' => 'Contact Person',
                'description' => 'Description', 'priority' => 'Priority', 'outcome_notes' => 'Outcome notes',
            ], function (string $field, mixed $value): string {
                if (str_ends_with($field, '_lookup_id')) {
                    return $this->lookups->label($value === null ? null : (int) $value);
                }
                if ($field === 'contact_person_id') {
                    return $this->contactLabel($value === null ? null : (int) $value);
                }
                if ($field === 'deadline') {
                    return Clock::api($value === null ? null : (string) $value) ?? '—';
                }
                return $value === null || $value === '' ? '—' : (string) $value;
            });
            if ($oldLeads !== $data['reminder_lead_ids']) {
                $this->audit->log(
                    'FIELD CHANGE', 'Task', $id, (string) $data['record']['name'], 'Reminder lead time',
                    $this->lookups->labels($oldLeads), $this->lookups->labels($data['reminder_lead_ids'])
                );
            }
            $this->reminders->syncTask($id, $data['reminder_lead_ids']);
            $this->recalculateLastContact((int) $before['company_id']);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        $payload = ['data' => $this->detail($id)];
        if ($data['deadline_in_past']) {
            $payload['warnings'] = ['deadline' => 'Дедлайн в прошлом: новые напоминания не будут отправлены задним числом.'];
        }
        Response::json($payload);
    }

    public function archive(Request $request, int $id): never
    {
        $this->auth->requireAdmin();
        $input = $request->json();
        $archived = Arr::bool($input, 'archived', true);
        $this->db->beginTransaction();
        try {
            $task = $this->findForUpdate($id);
            RecordGuard::optimistic($task, Arr::string($input, 'updated_at'));
            $stmt = $this->db->prepare('UPDATE tasks SET is_archived = :archived, updated_by = :user_id, updated_at = :now WHERE id = :id');
            $stmt->execute(['archived' => (int) $archived, 'user_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $id]);
            $this->reminders->reschedule($id);
            $this->recalculateLastContact((int) $task['company_id']);
            $this->audit->log('ARCHIVE', 'Task', $id, (string) $task['name'], detail: ['archived' => $archived]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => $this->detail($id)]);
    }

    public function comments(Request $request, int $taskId): never
    {
        $this->find($taskId, $this->canViewArchived());
        $pagination = new Pagination($request->query);
        $visibility = $this->canViewArchived() ? '' : ' AND tc.is_hidden = 0';
        $count = $this->db->prepare('SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = :task_id' . $visibility);
        $count->execute(['task_id' => $taskId]);
        $stmt = $this->db->prepare(
            'SELECT tc.*, u.full_name AS author_current_name FROM task_comments tc
             LEFT JOIN users u ON u.id = tc.author_user_id WHERE tc.task_id = :task_id' . $visibility . ' ORDER BY tc.created_at, tc.id LIMIT :limit OFFSET :offset'
        );
        $stmt->bindValue(':task_id', $taskId, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map(fn (array $row): array => $this->mapComment($row), $stmt->fetchAll()), 'meta' => $pagination->meta((int) $count->fetchColumn())]);
    }

    public function addComment(Request $request, int $taskId): never
    {
        $this->auth->requireWrite();
        $task = $this->find($taskId, false);
        $text = (string) Arr::string($request->json(), 'text', '');
        Validator::ensure(['text' => Validator::required($text) ?: Validator::max($text, 10000)]);
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'INSERT INTO task_comments
                    (task_id, author_user_id, author_name, text, is_hidden, created_by, updated_by, created_at, updated_at)
                 VALUES (:task_id, :author_id, :author_name, :text, 0, :created_by, :updated_by, :created_at, :updated_at)'
            );
            $stmt->execute([
                'task_id' => $taskId, 'author_id' => $this->auth->userId(), 'author_name' => $this->auth->actorName(),
                'text' => $text, 'created_by' => $this->auth->userId(), 'updated_by' => $this->auth->userId(),
                'created_at' => Clock::dbNow(), 'updated_at' => Clock::dbNow(),
            ]);
            $id = (int) $this->db->lastInsertId();
            $this->audit->log('COMMENT', 'Task', $taskId, (string) $task['name'], detail: ['comment_id' => $id]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        $comment = $this->db->prepare('SELECT * FROM task_comments WHERE id = :id');
        $comment->execute(['id' => $id]);
        Response::json(['data' => $this->mapComment($comment->fetch())], 201);
    }

    public function commentVisibility(Request $request, int $taskId, int $commentId): never
    {
        $this->auth->requireAdmin();
        $task = $this->find($taskId, true);
        $hidden = Arr::bool($request->json(), 'hidden', true);
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('UPDATE task_comments SET is_hidden = :hidden, updated_by = :user_id, updated_at = :now WHERE id = :id AND task_id = :task_id');
            $stmt->execute(['hidden' => (int) $hidden, 'user_id' => $this->auth->userId(), 'now' => Clock::dbNow(), 'id' => $commentId, 'task_id' => $taskId]);
            if ($stmt->rowCount() === 0) {
                throw new ApiException(404, 'comment_not_found', 'Комментарий не найден.');
            }
            $this->audit->log('FIELD CHANGE', 'Task', $taskId, (string) $task['name'], 'Comment visibility', $hidden ? 'visible' : 'hidden', $hidden ? 'hidden' : 'visible', ['comment_id' => $commentId]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        Response::json(['data' => ['id' => $commentId, 'hidden' => $hidden]]);
    }

    public function log(Request $request, int $taskId): never
    {
        $this->find($taskId, $this->canViewArchived());
        $pagination = new Pagination($request->query);
        $count = $this->db->prepare('SELECT COUNT(*) FROM change_events WHERE entity_type = :type AND entity_id = :id');
        $count->execute(['type' => 'Task', 'id' => $taskId]);
        $stmt = $this->db->prepare('SELECT * FROM change_events WHERE entity_type = :type AND entity_id = :id ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset');
        $stmt->bindValue(':type', 'Task');
        $stmt->bindValue(':id', $taskId, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $pagination->perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $pagination->offset(), PDO::PARAM_INT);
        $stmt->execute();
        Response::json(['data' => array_map([$this, 'mapEvent'], $stmt->fetchAll()), 'meta' => $pagination->meta((int) $count->fetchColumn())]);
    }

    public function calendar(int $taskId): never
    {
        $task = $this->find($taskId, false);
        if ($task['deadline'] === null) {
            throw new ApiException(409, 'deadline_required', 'Для задачи не задан дедлайн.');
        }
        Response::text(
            $this->ics->forTask($task),
            'text/calendar; charset=UTF-8',
            200,
            ['Content-Disposition' => "attachment; filename*=UTF-8''task-{$taskId}.ics"]
        );
    }

    public function uploadAttachment(Request $request, int $taskId): never
    {
        $this->auth->requireWrite();
        $task = $this->find($taskId, false);
        $file = $request->file('file');
        if ($file === null || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new ApiException(400, 'upload_failed', 'Файл не получен или загрузка завершилась ошибкой.');
        }
        $maximum = Config::int('UPLOAD_MAX_BYTES', 20 * 1024 * 1024);
        $validatedFile = UploadedFile::validate($file, $maximum);
        $size = (int) $file['size'];
        $this->resources->consume('upload', $this->auth->userId(), Config::int('UPLOAD_MAX_REQUESTS_PER_HOUR', 100));
        $original = basename((string) $file['name']);
        $extension = $validatedFile['extension'];
        $mime = $validatedFile['mime'];
        $id = $this->resources->storeWithinQuota($size, function () use ($taskId, $task, $file, $extension, $original, $mime, $size): int {
            $relativeDirectory = 'tasks/' . $taskId . '/' . gmdate('Y/m');
            $baseUpload = Config::root((string) Config::get('UPLOAD_DIR', 'storage/uploads'));
            $directory = $baseUpload . '/' . $relativeDirectory;
            if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
                throw new ApiException(500, 'storage_unavailable', 'Не удалось подготовить каталог вложений.');
            }
            $storedName = bin2hex(random_bytes(20)) . '.' . $extension;
            $relativePath = $relativeDirectory . '/' . $storedName;
            $absolutePath = $directory . '/' . $storedName;
            if (!move_uploaded_file((string) $file['tmp_name'], $absolutePath)) {
                throw new ApiException(500, 'upload_failed', 'Не удалось сохранить вложение.');
            }
            $this->db->beginTransaction();
            try {
                $stmt = $this->db->prepare(
                    'INSERT INTO task_attachments
                        (task_id, original_name, stored_path, mime_type, size_bytes, author_user_id, author_name,
                         created_by, updated_by, created_at, updated_at)
                     VALUES (:task_id, :original_name, :stored_path, :mime_type, :size_bytes, :author_id, :author_name,
                             :created_by, :updated_by, :created_at, :updated_at)'
                );
                $stmt->execute([
                    'task_id' => $taskId, 'original_name' => $original, 'stored_path' => $relativePath,
                    'mime_type' => $mime, 'size_bytes' => $size, 'author_id' => $this->auth->userId(),
                    'author_name' => $this->auth->actorName(), 'created_by' => $this->auth->userId(),
                    'updated_by' => $this->auth->userId(), 'created_at' => Clock::dbNow(), 'updated_at' => Clock::dbNow(),
                ]);
                $id = (int) $this->db->lastInsertId();
                $this->audit->log('FIELD CHANGE', 'Task', $taskId, (string) $task['name'], 'Attachment', '—', $original, ['attachment_id' => $id]);
                $this->db->commit();
                return $id;
            } catch (Throwable $error) {
                if ($this->db->inTransaction()) {
                    $this->db->rollBack();
                }
                @unlink($absolutePath);
                throw $error;
            }
        });
        Response::json(['data' => $this->attachment($id)], 201);
    }

    public function downloadAttachment(int $taskId, int $attachmentId): never
    {
        $this->find($taskId, $this->canViewArchived());
        $attachment = $this->attachmentRow($attachmentId, $taskId);
        Response::download(
            StoredFile::absolute((string) $attachment['stored_path']),
            (string) $attachment['original_name'],
            (string) $attachment['mime_type']
        );
    }

    public function deleteAttachment(int $taskId, int $attachmentId): never
    {
        $this->auth->requireWrite();
        $task = $this->find($taskId, $this->canViewArchived());
        $attachment = $this->attachmentRow($attachmentId, $taskId);
        if ($this->auth->user()['role'] !== 'admin' && (int) $attachment['author_user_id'] !== $this->auth->userId()) {
            throw new ApiException(403, 'forbidden', 'Удалить вложение может только его автор или Admin.');
        }
        $quarantine = StoredFile::quarantine((string) $attachment['stored_path']);
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('DELETE FROM task_attachments WHERE id = :id AND deleted_at IS NULL');
            $stmt->execute(['id' => $attachmentId]);
            $this->audit->log('FIELD CHANGE', 'Task', $taskId, (string) $task['name'], 'Attachment', (string) $attachment['original_name'], '—', ['attachment_id' => $attachmentId]);
            $this->db->commit();
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            StoredFile::restore($quarantine);
            throw $error;
        }
        StoredFile::purge($quarantine);
        Response::noContent();
    }

    /** @return array<string, mixed> */
    private function validated(array $input, ?array $current = null, array $currentLeadIds = []): array
    {
        $companyId = Arr::int($input, 'company_id');
        $name = (string) Arr::string($input, 'name', '');
        $contactDateInput = Arr::string(
            $input,
            'contact_date',
            isset($current['contact_date']) ? (string) $current['contact_date'] : Clock::localToday()
        );
        $contactDate = Clock::parseDate($contactDateInput, 'contact_date');
        $managerId = Arr::int($input, 'manager_id');
        $contactPersonId = Arr::int($input, 'contact_person_id');
        $statusId = Arr::int($input, 'status_id') ?? $this->lookups->idByKey('task_status', 'not_started');
        $priority = (string) Arr::string($input, 'priority', isset($current['priority']) ? (string) $current['priority'] : 'Normal');
        $outcomeStatusId = Arr::int($input, 'outcome_status_id');
        $deadlineDate = Clock::parseTimestamp(Arr::string($input, 'deadline'), 'deadline', true);
        $deadline = $deadlineDate ? Clock::db($deadlineDate) : null;
        $leadIds = Arr::intList($input, 'reminder_lead_ids');
        sort($leadIds);
        Validator::ensure([
            'company_id' => $companyId === null ? 'Обязательное поле.' : '',
            'name' => Validator::required($name) ?: Validator::max($name, 255),
            'contact_date' => $contactDate === null ? 'Обязательное поле.' : '',
            'manager_id' => $managerId === null ? 'Обязательное поле.' : '',
            'status_id' => $statusId === null ? 'Обязательное поле.' : '',
            'priority' => in_array($priority, ['Normal', 'Medium', 'High'], true) ? '' : 'Неизвестный приоритет.',
        ]);
        $this->assertCompany((int) $companyId);
        $this->lookups->getForAssignment(
            (int) $managerId,
            'cjn_manager',
            isset($current['manager_lookup_id']) ? (int) $current['manager_lookup_id'] : null
        );
        $this->lookups->getForAssignment(
            (int) $statusId,
            'task_status',
            isset($current['status_lookup_id']) ? (int) $current['status_lookup_id'] : null
        );
        if ($outcomeStatusId !== null) {
            $this->lookups->getForAssignment(
                $outcomeStatusId,
                'outcome_status',
                isset($current['outcome_status_lookup_id']) ? (int) $current['outcome_status_lookup_id'] : null
            );
        }
        foreach ($leadIds as $leadId) {
            $this->lookups->get($leadId, 'reminder_lead_time', in_array($leadId, $currentLeadIds, true));
        }
        if ($contactPersonId !== null) {
            $allowArchivedContact = isset($current['contact_person_id']) && (int) $current['contact_person_id'] === $contactPersonId;
            $stmt = $this->db->prepare(
                'SELECT id FROM contacts WHERE id = :id AND company_id = :company_id' .
                ($allowArchivedContact ? '' : ' AND is_archived = 0')
            );
            $stmt->execute(['id' => $contactPersonId, 'company_id' => $companyId]);
            if ($stmt->fetchColumn() === false) {
                throw new ApiException(400, 'invalid_contact_person', 'Контактное лицо должно принадлежать выбранной компании.');
            }
        }
        return [
            'record' => [
                'company_id' => $companyId, 'name' => $name, 'contact_date' => $contactDate,
                'manager_id' => $managerId, 'contact_person_id' => $contactPersonId,
                'description' => Arr::nullableString($input, 'description'), 'status_id' => $statusId, 'priority' => $priority,
                'outcome_status_id' => $outcomeStatusId, 'outcome_notes' => Arr::nullableString($input, 'outcome_notes'),
                'deadline' => $deadline,
            ],
            'reminder_lead_ids' => $leadIds,
            'deadline_in_past' => $deadlineDate !== null && $deadlineDate->setTimezone(new \DateTimeZone('UTC')) < Clock::utcNow(),
        ];
    }

    /** @return array{0:string,1:array<string,mixed>} */
    private function filters(array $query): array
    {
        $includeArchived = $this->auth->user()['role'] === 'admin' && filter_var($query['include_archived'] ?? false, FILTER_VALIDATE_BOOL);
        $where = $includeArchived ? [] : ['t.is_archived = 0', 'c.is_archived = 0'];
        $params = [];
        foreach (['manager' => 't.manager_lookup_id', 'company' => 't.company_id'] as $key => $column) {
            $value = filter_var($query[$key] ?? null, FILTER_VALIDATE_INT);
            if ($value !== false && $value !== null) {
                $where[] = "{$column} = :{$key}";
                $params[$key] = $value;
            }
        }
        $state = strtolower((string) ($query['state'] ?? 'actual'));
        match ($state) {
            'all' => null,
            'overdue' => $where[] = 's.is_closed = 0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)',
            'completed' => $where[] = "s.key_code = 'completed'",
            'deferred' => $where[] = "s.key_code = 'deferred'",
            'canceled' => $where[] = "s.key_code = 'canceled'",
            default => $where[] = 's.is_closed = 0',
        };
        return [$where === [] ? '1 = 1' : implode(' AND ', $where), $params];
    }

    private function baseSelect(): string
    {
        return "SELECT t.*, c.name AS company_name, m.value AS manager_value, COALESCE(u.email, m.email) AS manager_email, s.value AS status_value,
                       creator.full_name AS created_by_name, creator.email AS created_by_email,
                       s.is_closed AS status_is_closed, o.value AS outcome_status_value,
                       TRIM(CONCAT(COALESCE(k.first_name, ''), ' ', COALESCE(k.last_name, ''))) AS contact_person_name,
                       (s.is_closed = 0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)) AS is_overdue,
                       (CASE
                            WHEN m.user_id IS NOT NULL THEN u.is_active = 1 AND u.pending_approval = 0 AND u.email <> ''
                            ELSE m.email IS NOT NULL AND m.email <> ''
                        END) AS reminder_possible,
                       (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count,
                       (SELECT COUNT(*) FROM change_events ce WHERE ce.entity_type = 'Task' AND ce.entity_id = t.id) AS change_count
                FROM tasks t JOIN companies c ON c.id = t.company_id JOIN lookups m ON m.id = t.manager_lookup_id
                LEFT JOIN users u ON u.id = m.user_id
                LEFT JOIN users creator ON creator.id = t.created_by
                JOIN lookups s ON s.id = t.status_lookup_id LEFT JOIN lookups o ON o.id = t.outcome_status_lookup_id
                LEFT JOIN contacts k ON k.id = t.contact_person_id";
    }

    /** @return array<string, mixed> */
    private function detail(int $id, array $query = []): array
    {
        $task = EntityMapper::task($this->find($id, $this->canViewArchived()));
        $task['reminder_lead_ids'] = $this->leadIds($id);
        $task['reminder_leads'] = [];
        foreach ($task['reminder_lead_ids'] as $leadId) {
            $task['reminder_leads'][] = $this->lookups->get($leadId, 'reminder_lead_time', true);
        }
        $visibility = $this->canViewArchived() ? '' : ' AND is_hidden = 0';
        $commentsPagination = new Pagination($query, 50, 100, 'comments');
        $commentsCount = $this->db->prepare('SELECT COUNT(*) FROM task_comments WHERE task_id = :task_id' . $visibility);
        $commentsCount->execute(['task_id' => $id]);
        $comments = $this->db->prepare('SELECT * FROM task_comments WHERE task_id = :task_id' . $visibility . ' ORDER BY created_at, id LIMIT :limit OFFSET :offset');
        $comments->bindValue(':task_id', $id, PDO::PARAM_INT);
        $comments->bindValue(':limit', $commentsPagination->perPage, PDO::PARAM_INT);
        $comments->bindValue(':offset', $commentsPagination->offset(), PDO::PARAM_INT);
        $comments->execute();
        $task['comments'] = array_map(fn (array $row): array => $this->mapComment($row), $comments->fetchAll());
        $attachmentsPagination = new Pagination($query, 50, 100, 'attachments');
        $attachmentsCount = $this->db->prepare('SELECT COUNT(*) FROM task_attachments WHERE task_id = :task_id AND deleted_at IS NULL');
        $attachmentsCount->execute(['task_id' => $id]);
        $attachments = $this->db->prepare('SELECT * FROM task_attachments WHERE task_id = :task_id AND deleted_at IS NULL ORDER BY created_at, id LIMIT :limit OFFSET :offset');
        $attachments->bindValue(':task_id', $id, PDO::PARAM_INT);
        $attachments->bindValue(':limit', $attachmentsPagination->perPage, PDO::PARAM_INT);
        $attachments->bindValue(':offset', $attachmentsPagination->offset(), PDO::PARAM_INT);
        $attachments->execute();
        $task['attachments'] = array_map([$this, 'mapAttachment'], $attachments->fetchAll());
        $remindersPagination = new Pagination($query, 50, 100, 'reminders');
        $remindersCount = $this->db->prepare('SELECT COUNT(*) FROM task_reminders WHERE task_id = :task_id');
        $remindersCount->execute(['task_id' => $id]);
        $scheduled = $this->db->prepare('SELECT r.*, l.value AS lead_time FROM task_reminders r JOIN lookups l ON l.id = r.reminder_lead_lookup_id WHERE r.task_id = :task_id ORDER BY r.created_at DESC, r.id DESC LIMIT :limit OFFSET :offset');
        $scheduled->bindValue(':task_id', $id, PDO::PARAM_INT);
        $scheduled->bindValue(':limit', $remindersPagination->perPage, PDO::PARAM_INT);
        $scheduled->bindValue(':offset', $remindersPagination->offset(), PDO::PARAM_INT);
        $scheduled->execute();
        $task['reminders'] = array_map(fn (array $row): array => $this->mapReminder($row), $scheduled->fetchAll());
        $task['collections_meta'] = [
            'comments' => $commentsPagination->meta((int) $commentsCount->fetchColumn()),
            'attachments' => $attachmentsPagination->meta((int) $attachmentsCount->fetchColumn()),
            'reminders' => $remindersPagination->meta((int) $remindersCount->fetchColumn()),
        ];
        return $task;
    }

    /** @return array<string, mixed> */
    private function find(int $id, bool $includeArchived): array
    {
        $stmt = $this->db->prepare($this->baseSelect() . ' WHERE t.id = :id' . ($includeArchived ? '' : ' AND t.is_archived = 0 AND c.is_archived = 0'));
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'task_not_found', 'Задача не найдена.');
        }
        return $row;
    }

    private function canViewArchived(): bool
    {
        return $this->auth->user()['role'] === 'admin';
    }

    /** @return array<string, mixed> */
    private function findForUpdate(int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM tasks WHERE id = :id FOR UPDATE');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'task_not_found', 'Задача не найдена.');
        }
        return $row;
    }

    private function assertCompany(int $id): void
    {
        $stmt = $this->db->prepare('SELECT id FROM companies WHERE id = :id AND is_archived = 0');
        $stmt->execute(['id' => $id]);
        if ($stmt->fetchColumn() === false) {
            throw new ApiException(400, 'invalid_company', 'Компания не найдена или заархивирована.');
        }
    }

    private function recalculateLastContact(int $companyId): void
    {
        $company = $this->db->prepare(
            'SELECT id, name, last_contact_date FROM companies WHERE id = :id FOR UPDATE'
        );
        $company->execute(['id' => $companyId]);
        $before = $company->fetch();
        if (!$before) {
            return;
        }

        $maximum = $this->db->prepare(
            'SELECT MAX(contact_date) FROM tasks WHERE company_id = :company_id AND is_archived = 0'
        );
        $maximum->execute(['company_id' => $companyId]);
        $after = $maximum->fetchColumn();
        $after = $after === false ? null : $after;
        if ((string) $before['last_contact_date'] === (string) $after) {
            return;
        }

        $stmt = $this->db->prepare(
            'UPDATE companies SET last_contact_date = :last_contact_date,
                updated_by = :updated_by, updated_at = :updated_at WHERE id = :company_id'
        );
        $stmt->execute([
            'last_contact_date' => $after,
            'updated_by' => $this->auth->userId(),
            'updated_at' => Clock::dbNow(),
            'company_id' => $companyId,
        ]);
        $this->audit->log(
            'FIELD CHANGE',
            'Company',
            $companyId,
            (string) $before['name'],
            'Last Contact Date',
            $before['last_contact_date'] === null ? '—' : (string) $before['last_contact_date'],
            $after === null ? '—' : (string) $after
        );
    }

    /** @return list<int> */
    private function leadIds(int $taskId): array
    {
        $stmt = $this->db->prepare('SELECT reminder_lead_lookup_id FROM task_reminder_leads WHERE task_id = :task_id ORDER BY reminder_lead_lookup_id');
        $stmt->execute(['task_id' => $taskId]);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    private function contactLabel(?int $id): string
    {
        if ($id === null) {
            return '—';
        }
        $stmt = $this->db->prepare("SELECT TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) FROM contacts WHERE id = :id");
        $stmt->execute(['id' => $id]);
        return (string) ($stmt->fetchColumn() ?: '—');
    }

    /** @return array<string, mixed> */
    private function mapComment(array $row): array
    {
        $hidden = (bool) $row['is_hidden'];
        $admin = $this->auth->user()['role'] === 'admin';
        return [
            'id' => (int) $row['id'], 'task_id' => (int) $row['task_id'],
            'author_user_id' => $row['author_user_id'] === null ? null : (int) $row['author_user_id'],
            'author_name' => (string) $row['author_name'],
            'text' => $hidden && !$admin ? null : (string) $row['text'],
            'is_hidden' => $hidden,
            'created_at' => Clock::api((string) $row['created_at']),
        ];
    }

    /** @return array<string, mixed> */
    private function attachment(int $id, ?int $taskId = null): array
    {
        return $this->mapAttachment($this->attachmentRow($id, $taskId));
    }

    /** @return array<string, mixed> */
    private function attachmentRow(int $id, ?int $taskId = null): array
    {
        $sql = 'SELECT * FROM task_attachments WHERE id = :id AND deleted_at IS NULL';
        $params = ['id' => $id];
        if ($taskId !== null) {
            $sql .= ' AND task_id = :task_id';
            $params['task_id'] = $taskId;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        if (!$row) {
            throw new ApiException(404, 'attachment_not_found', 'Вложение не найдено.');
        }
        return $row;
    }

    /** @return array<string, mixed> */
    private function mapAttachment(array $row): array
    {
        return [
            'id' => (int) $row['id'], 'task_id' => (int) $row['task_id'],
            'original_name' => (string) $row['original_name'],
            'mime_type' => (string) $row['mime_type'], 'size_bytes' => (int) $row['size_bytes'],
            'author_user_id' => (int) $row['author_user_id'], 'author_name' => (string) $row['author_name'],
            'created_at' => Clock::api((string) $row['created_at']),
        ];
    }

    /** @return array<string, mixed> */
    public function mapEvent(array $row): array
    {
        $row = AuditLogger::redactEvent($row);
        $row['id'] = (int) $row['id'];
        $row['entity_id'] = $row['entity_id'] === null ? null : (int) $row['entity_id'];
        $row['actor_user_id'] = $row['actor_user_id'] === null ? null : (int) $row['actor_user_id'];
        $row['created_at'] = Clock::api((string) $row['created_at']);
        $row['detail'] = $row['detail_json'] ? json_decode((string) $row['detail_json'], true) : null;
        unset($row['detail_json']);
        return $row;
    }

    /** @return array<string, mixed> */
    private function mapReminder(array $row): array
    {
        $mapped = [
            'id' => (int) $row['id'],
            'lead_time' => (string) $row['lead_time'],
            'scheduled_at' => Clock::api((string) $row['scheduled_at']),
            'state' => (string) $row['state'],
            'sent_at' => Clock::api($row['sent_at'] ?? null),
            'created_at' => Clock::api((string) $row['created_at']),
            'updated_at' => Clock::api((string) $row['updated_at']),
        ];
        if ($this->auth->user()['role'] === 'admin') {
            $mapped['attempts'] = (int) $row['attempts'];
            $mapped['recipient_email'] = $row['recipient_email'];
            $mapped['error_message'] = $row['error_message'];
            $mapped['locked_at'] = Clock::api($row['locked_at'] ?? null);
        }
        return $mapped;
    }
}
