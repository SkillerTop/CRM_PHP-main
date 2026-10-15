ALTER TABLE tasks
    ADD COLUMN parent_task_id BIGINT UNSIGNED NULL AFTER company_id,
    ADD KEY ix_tasks_parent (parent_task_id, is_archived),
    ADD CONSTRAINT fk_tasks_parent
        FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
        ON DELETE CASCADE;
