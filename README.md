
## Требования платформы
- PHP 8.3 NTS для PHP-FPM;
- расширения: `pdo_mysql`, `mbstring`, `json`, `openssl`, `fileinfo`;
- MySQL 8.0+ с InnoDB;
- Apache 2.4: `mod_rewrite`, `mod_headers`, `mod_ssl`, `mod_proxy`, `mod_proxy_fcgi`, `setenvif`;
- cron/планировщик каждые 15 минут;
- SMTP relay или настроенный `mail()`; `MAIL_TRANSPORT=log` подходит только для разработки.
- Apache/PHP-FPM пример: `deploy/apache-vhost.conf.example`; production DocumentRoot — `backend/public`.
- Перед перезагрузкой Apache обязательно выполните `apachectl configtest`; production-vhost отдаёт SPA и маршрутизирует `/api/*` через соседний `backend/public/index.php` без CORS.
- Полный безопасный архив создаётся через `deploy/build-package.ps1`: PHP и собранный frontend уже объединены в `backend/public`. Инкрементальный frontend-архив с той же структурой создаётся через `deploy/build-frontend-package.ps1`.
- Загрузка выполняется `deploy/ftp-deploy.ps1`; хост по умолчанию — ` `, протокол — explicit FTPS.
- Frontend обращается напрямую к same-origin `/api/*`; серверные адреса и `PROXY_SHARED_SECRET` в JavaScript не передаются. Backend-параметр `PROXY_SHARED_SECRET` остаётся только серверным секретом, а `TRUSTED_PROXIES` должен содержать исключительно реальные reverse proxy перед Apache/PHP.
- Скопируйте `backend/.env.example` в `backend/.env`, замените placeholders, установите права `0600` и выполните `php backend/bin/console config:check`. Production запускается fail-closed: HTTP/CLI не стартуют с HTTP URL, debug, root/пустым паролем БД, `MAIL_TRANSPORT=log`, небезопасной cookie или коротким proxy secret. Реальный `.env` исключён из Git и deployment-архивов.

## Резервные копии
`deploy/backup.sh` удерживает общий maintenance-lock на время согласованного snapshot БД и вложений, проверяет SHA-256 manifest и сохраняет только зашифрованный `age`-bundle с отдельной контрольной суммой. Нужны `age`, `flock`, `mysqldump`, `tar`, `gzip`, `sha256sum` и публичный `BACKUP_AGE_RECIPIENT`; приватный ключ на сервере резервного копирования не хранится. `deploy/restore-backup.sh` проверяет внешний checksum, аутентифицированное шифрование `age`, внутренний manifest, безопасность путей архива и разрешает восстановление только в пустую БД/пустой каталог при `ALLOW_RESTORE=YES`. Перед production обязательно выполните тестовое восстановление в отдельном окружении.

Полный перечень маршрутов находится в [docs/API.md].
