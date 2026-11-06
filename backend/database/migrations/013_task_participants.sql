-- Extra people on an activity besides the contact person and the responsible manager:
-- other contacts of the task's company and/or any CJN managers. Each row is exactly one of the two.
CREATE TABLE IF NOT EXISTS task_participants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT UNSIGNED NOT NULL,
    contact_id BIGINT UNSIGNED NULL,
    manager_lookup_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_task_participants_contact (task_id, contact_id),
    UNIQUE KEY uq_task_participants_manager (task_id, manager_lookup_id),
    CONSTRAINT fk_task_participants_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_participants_contact FOREIGN KEY (contact_id) REFERENCES contacts(id),
    CONSTRAINT fk_task_participants_manager FOREIGN KEY (manager_lookup_id) REFERENCES lookups(id),
    CONSTRAINT chk_task_participants_one_kind CHECK ((contact_id IS NULL) <> (manager_lookup_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
