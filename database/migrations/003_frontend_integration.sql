ALTER TABLE users
    ADD COLUMN phone VARCHAR(50) NULL AFTER email,
    ADD COLUMN photo_data_url MEDIUMTEXT NULL AFTER phone;

ALTER TABLE companies
    ADD COLUMN manager_lookup_id BIGINT UNSIGNED NULL AFTER status_lookup_id,
    ADD COLUMN logo_data_url MEDIUMTEXT NULL AFTER linkedin;

UPDATE companies
SET manager_lookup_id = (
    SELECT id FROM lookups WHERE type = 'cjn_manager' AND is_active = 1 ORDER BY sort_order, id LIMIT 1
)
WHERE manager_lookup_id IS NULL;

ALTER TABLE companies
    MODIFY manager_lookup_id BIGINT UNSIGNED NOT NULL,
    ADD KEY ix_companies_manager (manager_lookup_id, is_archived),
    ADD CONSTRAINT fk_companies_manager FOREIGN KEY (manager_lookup_id) REFERENCES lookups(id);

ALTER TABLE contacts
    ADD COLUMN manager_lookup_id BIGINT UNSIGNED NULL AFTER initiated_by_lookup_id,
    ADD COLUMN initiated_by_text VARCHAR(150) NULL AFTER manager_lookup_id,
    ADD COLUMN photo_data_url MEDIUMTEXT NULL AFTER initiated_by_text;

UPDATE contacts
SET manager_lookup_id = COALESCE(
    initiated_by_lookup_id,
    (SELECT id FROM lookups WHERE type = 'cjn_manager' AND is_active = 1 ORDER BY sort_order, id LIMIT 1)
)
WHERE manager_lookup_id IS NULL;

ALTER TABLE contacts
    MODIFY manager_lookup_id BIGINT UNSIGNED NOT NULL,
    ADD KEY ix_contacts_manager (manager_lookup_id, is_archived),
    ADD CONSTRAINT fk_contacts_manager FOREIGN KEY (manager_lookup_id) REFERENCES lookups(id);

ALTER TABLE tasks
    ADD COLUMN priority ENUM('Normal', 'Medium', 'High') NOT NULL DEFAULT 'Normal' AFTER status_lookup_id;
