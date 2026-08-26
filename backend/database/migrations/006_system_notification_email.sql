INSERT INTO settings (setting_key, setting_value, updated_at)
VALUES ('system_notification_email', 'm.zhyvotovskyi@c-job.com.ua', UTC_TIMESTAMP(6))
ON DUPLICATE KEY UPDATE
    setting_value = VALUES(setting_value),
    updated_at = VALUES(updated_at);
