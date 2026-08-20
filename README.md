
## Требования платформы
- PHP 8.3 NTS для PHP-FPM;
- расширения: `pdo_mysql`, `mbstring`, `json`, `openssl`, `fileinfo`;
- MySQL 8.0+ с InnoDB;
- Apache 2.4: `mod_rewrite`, `mod_proxy`, `mod_proxy_fcgi`, `setenvif`;
- cron/планировщик каждые 15 минут;
- SMTP relay или настроенный `mail()`; `MAIL_TRANSPORT=log` подходит только для разработки.
- Apache/PHP-FPM пример: `deploy/apache-vhost.conf.example`.
- Сборка безопасного PHP-архива: `deploy/build-package.ps1`. Он содержит только актуальный runtime из `backend/`; frontend разворачивается отдельной Vinext/hosting-сборкой.
- Загрузка выполняется `deploy/ftp-deploy.ps1`; хост по умолчанию — ` `, протокол — explicit FTPS.

## Резервные копии
Пример `deploy/backup.sh` создаёт ежедневный gzip-дамп MySQL, отдельный `tar.gz` каталога `backend/storage/uploads` и удаляет обе категории копий старше 30 дней. После настройки обязательно выполните тестовое восстановление БД и вложений в отдельное окружение. НЕОБХОДИМО ПРОВЕРИТЬ!

Полный перечень маршрутов находится в [docs/API.md].
