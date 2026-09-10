-- Promote the requested account back to Admin. Matching by the stable manager name
-- keeps the migration safe across installations where the login email differs.
UPDATE users
SET role = 'admin', updated_at = UTC_TIMESTAMP(6)
WHERE full_name = 'Vitalii Vyshnevskyi'
ORDER BY id
LIMIT 1;

-- Consolidate the relationship workflow into the five requested active statuses.
UPDATE companies c
JOIN lookups old_status ON old_status.id = c.status_lookup_id
JOIN lookups new_status ON new_status.type = 'client_status'
    AND new_status.key_code = CASE old_status.key_code
        WHEN 'in_progress' THEN 'new_lead'
        WHEN 'negotiation' THEN 'quotation_sent'
        WHEN 'awaiting_client_decision' THEN 'quotation_sent'
        WHEN 'repeat_client' THEN 'active_client'
        WHEN 'inactive' THEN 'lost_declined'
        ELSE old_status.key_code
    END
SET c.status_lookup_id = new_status.id
WHERE old_status.type = 'client_status'
  AND old_status.key_code IN ('in_progress', 'negotiation', 'awaiting_client_decision', 'repeat_client', 'inactive');

UPDATE lookups
SET is_active = CASE
        WHEN key_code IN ('new_lead', 'quotation_sent', 'active_client', 'on_hold', 'lost_declined') THEN 1
        ELSE 0
    END,
    sort_order = CASE key_code
        WHEN 'new_lead' THEN 1
        WHEN 'quotation_sent' THEN 2
        WHEN 'active_client' THEN 3
        WHEN 'on_hold' THEN 4
        WHEN 'lost_declined' THEN 5
        ELSE sort_order
    END,
    updated_at = UTC_TIMESTAMP(6)
WHERE type = 'client_status';

ALTER TABLE companies
    ADD COLUMN nda_status ENUM('Not Signed', 'Company-wide', 'Project-specific', 'Expired')
    NOT NULL DEFAULT 'Not Signed' AFTER linkedin;
