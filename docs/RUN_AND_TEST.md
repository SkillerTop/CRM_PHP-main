
Локальный запуск

Backend из корня проекта:

```powershell
$php = (Resolve-Path ".runtime\php\php.exe").Path
& $php -S 127.0.0.1:8080 -t public public/index.php
```

Frontend:

```powershell
Set-Location frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

Production

- примените `php bin/console migrate` до переключения трафика;
- backend `.env`: `APP_ENV=production`, `APP_DEBUG=false`, `SESSION_SECURE=true`, публичный HTTPS `APP_URL`;
- frontend runtime: `CRM_BACKEND_URL` должен указывать на доступный frontend-серверу HTTPS endpoint PHP API;
- соберите frontend командой `npm run build`, затем запустите `npm run start`;
- оставьте cron из корневого README для напоминаний и cleanup;
- не публикуйте `.env`, `.env.local`, пароли или содержимое `storage/uploads`.

После развёртывания проверьте: health, вход, смену пароля, создание/изменение/архивирование записи, конфликт `updated_at`, роли Read-only/Admin, комментарий, `.ics` и Audit CSV.

Регрессионная проверка функционала ТЗ v3.1

После запуска backend и frontend выполните под Admin следующие сценарии:

1. В **Users & Roles** создайте одного пользователя через email invitation и второго через temporary password. Для приглашения `APP_URL` должен указывать на frontend (локально `http://localhost:3000`), а полученная ссылка должна открывать `/reset-password?token=...`.
2. Откройте **Settings** и сохраните разрешённые домены регистрации, адрес системных уведомлений и флаг уведомления о новых регистрациях.
3. Создайте компанию и контакт с уже существующим именем/email: интерфейс должен предупредить о дубликате и разрешить повторное сохранение.
4. На время остановите PHP API, заполните формы компании, контакта и задачи и нажмите сохранение. Модальное окно и введённые значения должны сохраниться, кнопка должна измениться на **Try again**. После запуска API повторите отправку.
5. Создайте задачу без дедлайна, затем задачу с дедлайном и напоминаниями. Для менеджера без User/email должна отображаться пометка **Reminder impossible**.
6. В карточке задачи загрузите PDF, DOC/DOCX, XLS/XLSX или изображение до 20 МБ, скачайте и удалите его. Admin также должен иметь возможность скрыть и восстановить комментарий.
7. Проверьте глобальный поиск по компании, контакту, инициатору, менеджеру и тексту комментария: результаты должны быть разбиты на Companies, Contacts и Tasks со счётчиками.
8. Проверьте фильтры Audit Log: период, пользователь, действие и сущность; CSV должен учитывать эти же фильтры.
9. Перетащите компанию между колонками Pipeline и убедитесь, что статус изменился и в Audit Log появилась запись.
10. Войдите как Read-only и откройте `/?view=users`, `/?view=lookups` и `/?view=audit`: интерфейс должен показать отдельное сообщение **403 · Access forbidden**, а соответствующие API должны отвечать HTTP 403.

Автоматическая локальная проверка frontend после изменений:

```powershell
Set-Location frontend
npm run lint
npm run build
node --test tests/rendered-html.test.mjs tests/responsive-layout.test.mjs
```
