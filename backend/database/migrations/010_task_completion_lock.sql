ALTER TABLE tasks
    ADD COLUMN completed_at DATETIME(6) NULL AFTER deadline,
    ADD KEY ix_tasks_completed_at (completed_at);

UPDATE tasks t
JOIN lookups s ON s.id = t.status_lookup_id
SET t.completed_at = COALESCE(
    (SELECT MAX(ce.created_at) FROM change_events ce
     WHERE ce.entity_type = 'Task' AND ce.entity_id = t.id
       AND ce.field_name = 'Status' AND ce.value_to = 'Completed'),
    t.updated_at
)
WHERE s.type = 'task_status'
  AND s.key_code = 'completed'
  AND t.completed_at IS NULL;
