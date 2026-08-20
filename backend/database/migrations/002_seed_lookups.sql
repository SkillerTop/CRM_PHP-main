INSERT INTO lookups
    (type, key_code, value, sort_order, is_active, is_closed, minutes_before, requires_detail, requires_referral, created_at, updated_at)
VALUES
    ('company_type', 'shipyard', 'Shipyard', 1, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('company_type', 'ship_design', 'Ship design', 2, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('company_type', 'equipment', 'Equipment', 3, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('company_type', 'supplier', 'Supplier', 4, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('company_type', 'software_developer', 'Software developer', 5, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),

    ('client_status', 'new_lead', 'New Lead', 1, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'in_progress', 'In Progress', 2, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'quotation_sent', 'Quotation Sent', 3, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'negotiation', 'Negotiation', 4, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'awaiting_client_decision', 'Awaiting Client Decision', 5, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'active_client', 'Active Client', 6, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'repeat_client', 'Repeat Client', 7, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'on_hold', 'On Hold', 8, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'lost_declined', 'Lost / Declined', 9, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('client_status', 'inactive', 'Inactive', 10, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),

    ('task_status', 'not_started', 'Not Started', 1, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('task_status', 'started', 'Started', 2, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('task_status', 'completed', 'Completed', 3, 1, 1, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('task_status', 'canceled', 'Canceled', 4, 1, 1, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('task_status', 'deferred', 'Deferred', 5, 1, 1, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),

    ('outcome_status', 'positive', 'Positive / interested', 1, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('outcome_status', 'neutral', 'Neutral / pending', 2, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('outcome_status', 'negative', 'Negative / not interested', 3, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('outcome_status', 'no_response', 'No response', 4, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),

    ('contact_source', 'exhibition', 'Exhibition / Conference', 1, 1, 0, NULL, 1, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('contact_source', 'referral', 'Referral (word of mouth)', 2, 1, 0, NULL, 0, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('contact_source', 'inbound_linkedin', 'Inbound LinkedIn', 3, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('contact_source', 'outbound_linkedin', 'Outbound LinkedIn', 4, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('contact_source', 'inbound_web', 'Inbound (website / email)', 5, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('contact_source', 'outbound', 'Outbound (cold outreach)', 6, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('contact_source', 'partner', 'Partner', 7, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('contact_source', 'other', 'Other', 8, 1, 0, NULL, 1, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),

    ('reminder_lead_time', 'one_week', '1 week before', 1, 1, 0, 10080, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('reminder_lead_time', 'one_day', '1 day before', 2, 1, 0, 1440, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('reminder_lead_time', 'two_hours', '2 hours before', 3, 1, 0, 120, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('reminder_lead_time', 'one_hour', '1 hour before', 4, 1, 0, 60, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),

    ('cjn_manager', 'andrey_zherebetsky', 'Andrey Zherebetsky', 1, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'olga_kalnauz', 'Olga Kalnauz', 2, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'vitalii_vyshnevskyi', 'Vitalii Vyshnevskyi', 3, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'mikhail_bardin', 'Mikhail Bardin', 4, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'maksym_zarvanskyi', 'Maksym Zarvanskyi', 5, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'yurii_maksymov', 'Yurii Maksymov', 6, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'dmytro_volik', 'Dmytro Volik', 7, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'ivan_tatko', 'Ivan Tatko', 8, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'mykhailo_balanovskyi', 'Mykhailo Balanovskyi', 9, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'mariia_klimova', 'Mariia Klimova', 10, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'oleksandr_zherebetskyi', 'Oleksandr Zherebetskyi', 11, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
    ('cjn_manager', 'olga_kucherenko', 'Olga Kucherenko', 12, 1, 0, NULL, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));

INSERT INTO settings (setting_key, setting_value, updated_at)
VALUES ('notify_new_registrations', 'true', UTC_TIMESTAMP(6)), ('system_notification_email', '', UTC_TIMESTAMP(6));

