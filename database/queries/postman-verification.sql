-- Выполнять только на тестовой базе после прогонки Postman-коллекции.

-- 1. Роли и защита pending-регистраций.
SELECT id, full_name, email, role, is_active, pending_approval, must_change_password
FROM users
ORDER BY pending_approval DESC, id;

-- 2. Last Contact Date должен совпадать с максимальной датой неархивированной задачи.
SELECT c.id, c.name, c.last_contact_date, MAX(t.contact_date) AS expected_last_contact_date
FROM companies c
LEFT JOIN tasks t ON t.company_id = c.id AND t.is_archived = 0
GROUP BY c.id, c.name, c.last_contact_date
HAVING NOT (c.last_contact_date <=> MAX(t.contact_date));

-- 3. Контакт задачи обязан принадлежать той же компании (результат должен быть пустым).
SELECT t.id AS task_id, t.company_id AS task_company_id, k.id AS contact_id, k.company_id AS contact_company_id
FROM tasks t
JOIN contacts k ON k.id = t.contact_person_id
WHERE t.company_id <> k.company_id;

-- 4. Состояние и catch-up очереди напоминаний.
SELECT state, COUNT(*) AS amount, MIN(scheduled_at) AS oldest, MAX(scheduled_at) AS newest
FROM task_reminders
GROUP BY state
ORDER BY state;

-- 5. Карточка задачи и Audit используют один ChangeEvent.
SELECT entity_id AS task_id, COUNT(*) AS change_count
FROM change_events
WHERE entity_type = 'Task'
GROUP BY entity_id
ORDER BY change_count DESC;

-- 6. Последний активный Admin (должен существовать хотя бы один).
SELECT COUNT(*) AS active_admins
FROM users
WHERE role = 'admin' AND is_active = 1 AND pending_approval = 0;

-- 7. Поиск проблемных manager/email для напоминаний.
SELECT m.id, m.value, m.user_id, u.email AS user_email, m.email AS fallback_email
FROM lookups m
LEFT JOIN users u ON u.id = m.user_id AND u.is_active = 1 AND u.pending_approval = 0
WHERE m.type = 'cjn_manager' AND m.is_active = 1
  AND COALESCE(u.email, m.email, '') = '';

-- 8. ChangeEvent старше 24 месяцев не должен автоматически удаляться приложением.
SELECT MIN(created_at) AS oldest_event, MAX(created_at) AS newest_event, COUNT(*) AS total_events
FROM change_events;
