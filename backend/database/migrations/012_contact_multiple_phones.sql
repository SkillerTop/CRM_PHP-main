-- Contacts may keep several phone numbers in one field, separated by "; "
-- (for example a mobile and an office number from a scanned business card).
ALTER TABLE contacts
    MODIFY COLUMN phone VARCHAR(100) NULL;
