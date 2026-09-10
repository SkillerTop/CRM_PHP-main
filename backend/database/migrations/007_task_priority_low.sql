ALTER TABLE tasks
    MODIFY priority ENUM('Low', 'Normal', 'Medium', 'High') NOT NULL DEFAULT 'Low';

UPDATE tasks
SET priority = 'Low'
WHERE priority = 'Normal';

ALTER TABLE tasks
    MODIFY priority ENUM('Low', 'Medium', 'High') NOT NULL DEFAULT 'Low';
