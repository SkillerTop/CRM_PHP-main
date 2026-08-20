ALTER TABLE contacts
    ADD COLUMN contact_status ENUM('active', 'inactive') NOT NULL DEFAULT 'active' AFTER initiated_by_lookup_id,
    ADD KEY ix_contacts_status (contact_status, company_id, is_archived);
