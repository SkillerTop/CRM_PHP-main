
## Требования платформы
- PHP 8.3 NTS для PHP-FPM;
- расширения: `pdo_mysql`, `mbstring`, `json`, `openssl`, `fileinfo`;
- MySQL 8.0+ с InnoDB;
- Apache 2.4: `mod_rewrite`, `mod_headers`, `mod_ssl`, `mod_proxy`, `mod_proxy_fcgi`, `setenvif`;
- cron/планировщик каждые 15 минут;
- SMTP relay или настроенный `mail()`; `MAIL_TRANSPORT=log` подходит только для разработки.
- Apache/PHP-FPM пример: `deploy/apache-vhost.conf.example`.
- Перед перезагрузкой Apache обязательно выполните `apachectl configtest`; production-vhost маршрутизирует API внутри `backend/public` и не зависит от `.htaccess` (`AllowOverride None`).
- Сборка безопасного PHP-архива: `deploy/build-package.ps1`. Он содержит только актуальный runtime из `backend/`; frontend разворачивается отдельной Vinext/hosting-сборкой.
- Загрузка выполняется `deploy/ftp-deploy.ps1`; хост по умолчанию — ` `, протокол — explicit FTPS.
- Для frontend proxy задайте одинаковый случайный секрет минимум 32 байта в `CRM_PROXY_SHARED_SECRET` (frontend) и `PROXY_SHARED_SECRET` (backend). Proxy отбрасывает клиентские `X-Forwarded-For`/`X-Real-IP`, принимает только нормализованный Cloudflare `CF-Connecting-IP`; backend доверяет ему только при совпадении секрета. Прямой backend следует ограничить сетью/ACL.
- Скопируйте `backend/.env.example` в `backend/.env`, замените placeholders, установите права `0600` и выполните `php backend/bin/console config:check`. Production запускается fail-closed: HTTP/CLI не стартуют с HTTP URL, debug, root/пустым паролем БД, `MAIL_TRANSPORT=log`, небезопасной cookie или коротким proxy secret. Реальный `.env` исключён из Git и deployment-архивов.

## Резервные копии
`deploy/backup.sh` удерживает общий maintenance-lock на время согласованного snapshot БД и вложений, проверяет SHA-256 manifest и сохраняет только зашифрованный `age`-bundle с отдельной контрольной суммой. Нужны `age`, `flock`, `mysqldump`, `tar`, `gzip`, `sha256sum` и публичный `BACKUP_AGE_RECIPIENT`; приватный ключ на сервере резервного копирования не хранится. `deploy/restore-backup.sh` проверяет внешний checksum, аутентифицированное шифрование `age`, внутренний manifest, безопасность путей архива и разрешает восстановление только в пустую БД/пустой каталог при `ALLOW_RESTORE=YES`. Перед production обязательно выполните тестовое восстановление в отдельном окружении.

Полный перечень маршрутов находится в [docs/API.md].
