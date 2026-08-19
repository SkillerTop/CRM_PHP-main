
## Требования платформы
- PHP 8.3 NTS для PHP-FPM;
- расширения: `pdo_mysql`, `mbstring`, `json`, `openssl`, `fileinfo`;
- MySQL 8.0+ с InnoDB;
- Apache 2.4: `mod_rewrite`, `mod_proxy`, `mod_proxy_fcgi`, `setenvif`;
- cron/планировщик каждые 15 минут;
- SMTP relay или настроенный `mail()`; `MAIL_TRANSPORT=log` подходит только для разработки.
## Быстрый запуск
1. Скопируйте `.env.example` в `.env`, заполните БД, `APP_URL` и SMTP.
2. Создайте пустую MySQL-базу и пользователя с правами на неё.
3. Примените схему:
   ```powershell
   # PowerShell: используем PHP, поставленный в .runtime проекта
   $php = (Resolve-Path ".runtime\php\php.exe").Path
   & $php bin/console migrate
   ```
4. Укажите `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` и создайте первого Admin:
   ```powershell
   $php = (Resolve-Path ".runtime\php\php.exe").Path
   & $php bin/console create-admin
   ```
5. Запустите PHP API и frontend в двух отдельных терминалах.

   Терминал 1 — backend из корня проекта:

   ```powershell
   $php = (Resolve-Path ".runtime\php\php.exe").Path
   & $php -S 127.0.0.1:8080 -t public public/index.php
   ```

   Если PHP уже добавлен в системный `PATH`, вместо `$php` можно использовать
   обычную команду `php`.

   Backend будет доступен по адресу `http://127.0.0.1:8080`.

   Терминал 2 — frontend:

   ```powershell
   cd frontend
   Copy-Item .env.example .env.local
   npm install
   npm run dev
   ```

   Frontend откроется по адресу `http://localhost:3000`. Для bash/Git Bash
   вместо `Copy-Item` выполните `cp .env.example .env.local`.

6. Проверьте `GET http://127.0.0.1:8080/api/health`, затем откройте frontend,
   выполните вход и при необходимости импортируйте коллекции из `postman/`.

Полная пошаговая инструкция для разработки, production и тестов: [docs/RUN_AND_TEST.md](docs/RUN_AND_TEST.md).
Пароль первого администратора после входа требуется сменить. Значения `ADMIN_PASSWORD`, `DB_PASSWORD`, `SMTP_PASSWORD` и `FTP_PASSWORD` не должны попадать в Git или deploy-архив.
## Cron
```cron
*/15 * * * * cd /var/www/client-data-crm && /usr/bin/php bin/console reminders:run >> storage/logs/cron.log 2>&1
17 2 * * * cd /var/www/client-data-crm && /usr/bin/php bin/console cleanup >> storage/logs/cron.log 2>&1
```
Если хостинг допускает cron только раз в час, деактивируйте справочники `1 hour before` и `2 hours before`: они не смогут работать с заявленной точностью.
## Почта
- `MAIL_TRANSPORT=smtp` — встроенный SMTP-клиент с `tls`, `ssl` или без шифрования;
- `MAIL_TRANSPORT=mail` — системный `mail()`/sendmail;
- `MAIL_TRANSPORT=log` — письма пишутся в `storage/logs/mail.log`.
Недоступность SMTP не блокирует регистрацию или создание пользователя с временным паролем. Ошибка отправки напоминания записывается как `REMINDER FAILED`.
## Архивирование и вложения
Жёсткого удаления компаний, контактов и задач нет. Вложение при удалении скрывается через `deleted_at`, а физический файл остаётся до отдельной политики хранения/резервного копирования. Компания не архивируется, пока у неё есть открытые задачи.
## Развёртывание и FTP
- Apache/PHP-FPM пример: `deploy/apache-vhost.conf.example`.
- Сборка безопасного архива: `deploy/build-package.ps1`.
- Загрузка выполняется `deploy/ftp-deploy.ps1`; хост по умолчанию — `vs584.mirohost.net`, протокол — explicit FTPS.
Скрипт требует `FTP_USERNAME` и `FTP_PASSWORD` в окружении и не содержит секретов. Файл `.env` намеренно не загружается: создайте его на сервере через панель хостинга/защищённый канал.
## Резервные копии
Пример `deploy/backup.sh` создаёт ежедневный gzip-дамп MySQL, отдельный `tar.gz` каталога `storage/uploads` и удаляет обе категории копий старше 30 дней. После настройки обязательно выполните тестовое восстановление БД и вложений в отдельное окружение.
## Формат API
Успех:

```json
{"data": {}, "meta": {}}
```
Ошибка:
```json
{"error":{"code":"validation_error","message":"Проверьте заполнение полей.","details":{"fields":{}}}}
```
Мутации после входа требуют cookie `crm_session` и заголовок `X-CSRF-Token`; токен возвращают login и `GET /api/auth/me`. Полный перечень маршрутов находится в [docs/API.md](docs/API.md).

