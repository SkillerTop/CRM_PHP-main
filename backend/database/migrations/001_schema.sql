CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL,
    role ENUM('admin', 'manager', 'editor', 'readonly') NOT NULL DEFAULT 'readonly',
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    pending_approval TINYINT(1) NOT NULL DEFAULT 0,
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    last_login_at DATETIME(6) NULL,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_users_email (email),
    KEY ix_users_pending (pending_approval, is_active),
    KEY ix_users_role_active (role, is_active),
    CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    csrf_token CHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    last_activity_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_user_sessions_token (token_hash),
    KEY ix_user_sessions_user (user_id, revoked_at),
    KEY ix_user_sessions_expiry (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_attempts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scope VARCHAR(50) NOT NULL,
    key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at DATETIME(6) NOT NULL,
    blocked_until DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_auth_attempts_scope_key (scope, key_hash),
    KEY ix_auth_attempts_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    purpose ENUM('password_reset', 'invite', 'admin_reset') NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_password_tokens_hash (token_hash),
    KEY ix_password_tokens_user (user_id, purpose),
    KEY ix_password_tokens_expiry (expires_at),
    CONSTRAINT fk_password_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NULL,
    updated_by BIGINT UNSIGNED NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE registration_domains (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    domain VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_registration_domains_domain (domain),
    CONSTRAINT fk_registration_domains_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_registration_domains_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lookups (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type ENUM('company_type', 'client_status', 'task_status', 'outcome_status', 'contact_source', 'reminder_lead_time', 'cjn_manager') NOT NULL,
    key_code VARCHAR(100) NOT NULL,
    value VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_closed TINYINT(1) NOT NULL DEFAULT 0,
    minutes_before INT UNSIGNED NULL,
    requires_detail TINYINT(1) NOT NULL DEFAULT 0,
    requires_referral TINYINT(1) NOT NULL DEFAULT 0,
    user_id BIGINT UNSIGNED NULL,
    email VARCHAR(255) NULL,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_lookups_type_key (type, key_code),
    UNIQUE KEY uq_lookups_type_value (type, value),
    KEY ix_lookups_type_active_sort (type, is_active, sort_order),
    CONSTRAINT fk_lookups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_lookups_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_lookups_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE companies (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type_lookup_id BIGINT UNSIGNED NOT NULL,
    country VARCHAR(100) NOT NULL,
    city VARCHAR(100) NULL,
    status_lookup_id BIGINT UNSIGNED NOT NULL,
    last_contact_date DATE NULL,
    website VARCHAR(255) NULL,
    linkedin VARCHAR(255) NULL,
    description LONGTEXT NULL,
    is_archived TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY ix_companies_name (name),
    KEY ix_companies_type (type_lookup_id, is_archived),
    KEY ix_companies_status (status_lookup_id, is_archived),
    KEY ix_companies_country_city (country, city),
    KEY ix_companies_last_contact (last_contact_date),
    CONSTRAINT fk_companies_type FOREIGN KEY (type_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_companies_status FOREIGN KEY (status_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_companies_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_companies_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE contacts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id BIGINT UNSIGNED NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NULL,
    position VARCHAR(150) NULL,
    phone VARCHAR(50) NULL,
    email VARCHAR(255) NULL,
    linkedin VARCHAR(255) NULL,
    source_lookup_id BIGINT UNSIGNED NULL,
    source_detail VARCHAR(255) NULL,
    referred_by VARCHAR(255) NULL,
    initiated_by_lookup_id BIGINT UNSIGNED NULL,
    is_archived TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY ix_contacts_company (company_id, is_archived),
    KEY ix_contacts_name (last_name, first_name),
    KEY ix_contacts_email (email),
    KEY ix_contacts_source (source_lookup_id),
    KEY ix_contacts_initiated_by (initiated_by_lookup_id),
    CONSTRAINT fk_contacts_company FOREIGN KEY (company_id) REFERENCES companies(id),
    CONSTRAINT fk_contacts_source FOREIGN KEY (source_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_contacts_initiated_by FOREIGN KEY (initiated_by_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_contacts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tasks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact_date DATE NOT NULL,
    manager_lookup_id BIGINT UNSIGNED NOT NULL,
    contact_person_id BIGINT UNSIGNED NULL,
    description LONGTEXT NULL,
    status_lookup_id BIGINT UNSIGNED NOT NULL,
    outcome_status_lookup_id BIGINT UNSIGNED NULL,
    outcome_notes LONGTEXT NULL,
    deadline DATETIME(6) NULL,
    is_archived TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY ix_tasks_company_contact_date (company_id, is_archived, contact_date),
    KEY ix_tasks_manager (manager_lookup_id, is_archived),
    KEY ix_tasks_status_deadline (status_lookup_id, is_archived, deadline),
    KEY ix_tasks_contact_person (contact_person_id),
    CONSTRAINT fk_tasks_company FOREIGN KEY (company_id) REFERENCES companies(id),
    CONSTRAINT fk_tasks_manager FOREIGN KEY (manager_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_tasks_contact_person FOREIGN KEY (contact_person_id) REFERENCES contacts(id),
    CONSTRAINT fk_tasks_status FOREIGN KEY (status_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_tasks_outcome FOREIGN KEY (outcome_status_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_tasks_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE task_reminder_leads (
    task_id BIGINT UNSIGNED NOT NULL,
    reminder_lead_lookup_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (task_id, reminder_lead_lookup_id),
    CONSTRAINT fk_task_reminder_leads_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_reminder_leads_lookup FOREIGN KEY (reminder_lead_lookup_id) REFERENCES lookups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE task_comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT UNSIGNED NOT NULL,
    author_user_id BIGINT UNSIGNED NULL,
    author_name VARCHAR(150) NOT NULL,
    text LONGTEXT NOT NULL,
    is_hidden TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY ix_task_comments_task (task_id, created_at),
    CONSTRAINT fk_task_comments_task FOREIGN KEY (task_id) REFERENCES tasks(id),
    CONSTRAINT fk_task_comments_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_task_comments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_task_comments_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE task_attachments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_path VARCHAR(700) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    author_user_id BIGINT UNSIGNED NULL,
    author_name VARCHAR(150) NOT NULL,
    deleted_at DATETIME(6) NULL,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY ix_task_attachments_task (task_id, deleted_at),
    CONSTRAINT fk_task_attachments_task FOREIGN KEY (task_id) REFERENCES tasks(id),
    CONSTRAINT fk_task_attachments_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_task_attachments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_task_attachments_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE task_reminders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT UNSIGNED NOT NULL,
    reminder_lead_lookup_id BIGINT UNSIGNED NOT NULL,
    deadline_snapshot DATETIME(6) NOT NULL,
    manager_lookup_id BIGINT UNSIGNED NOT NULL,
    scheduled_at DATETIME(6) NOT NULL,
    state ENUM('pending', 'processing', 'sent', 'skipped', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    recipient_email VARCHAR(255) NULL,
    error_message TEXT NULL,
    locked_at DATETIME(6) NULL,
    sent_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY ix_task_reminders_due (state, scheduled_at),
    KEY ix_task_reminders_task (task_id, created_at),
    CONSTRAINT fk_task_reminders_task FOREIGN KEY (task_id) REFERENCES tasks(id),
    CONSTRAINT fk_task_reminders_lead FOREIGN KEY (reminder_lead_lookup_id) REFERENCES lookups(id),
    CONSTRAINT fk_task_reminders_manager FOREIGN KEY (manager_lookup_id) REFERENCES lookups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE change_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_user_id BIGINT UNSIGNED NULL,
    actor_name VARCHAR(150) NOT NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id BIGINT UNSIGNED NULL,
    entity_label VARCHAR(255) NOT NULL,
    field_name VARCHAR(150) NULL,
    value_from LONGTEXT NULL,
    value_to LONGTEXT NULL,
    detail_json JSON NULL,
    created_at DATETIME(6) NOT NULL,
    KEY ix_change_events_created (created_at),
    KEY ix_change_events_entity (entity_type, entity_id, created_at),
    KEY ix_change_events_actor (actor_user_id, created_at),
    KEY ix_change_events_action (action, created_at),
    CONSTRAINT fk_change_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

