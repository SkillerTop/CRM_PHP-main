# REST API

Базовый URL: `/api`. Ответы JSON, кроме CSV, `.ics` и скачивания вложений. Все маршруты, кроме health/login/register/forgot/reset, требуют сессию. Все аутентифицированные `POST`, `PUT`, `PATCH`, `DELETE` требуют `X-CSRF-Token`.

## Auth и профиль

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/health` | public | состояние API/БД |
| POST | `/auth/login` | public | вход, cookie и CSRF |
| POST | `/auth/logout` | auth | выход |
| GET | `/auth/me` | auth | пользователь, права, CSRF |
| POST | `/auth/register` | public | заявка Read-only, inactive/pending; всегда `202` с одинаковым ответом для нового и уже занятого email |
| POST | `/auth/forgot-password` | public | одноразовая ссылка на 1 час |
| POST | `/auth/reset-password` | public | установка пароля по токену |
| GET/PUT | `/profile` | auth | профиль; роль не принимается |
| PUT | `/profile/password` | auth | смена пароля и отзыв других сессий |

Пока `must_change_password=true`, сервер разрешает только `GET /auth/me`, `POST /auth/logout` и `PUT /profile/password`; остальные защищённые маршруты возвращают `403 password_change_required`.
Новый пароль должен отличаться от текущего. Поле `deadline` задачи принимает дату и время, а не дату без времени.

## CRM

| Метод | Путь | Примечание |
|---|---|---|
| GET/POST | `/companies` | `type`, `status`, `q`, `page`, `sort`, `dir`; `include_archived=1` только Admin |
| GET/PUT | `/companies/{id}` | PUT требует `updated_at` |
| POST | `/companies/{id}/archive` | Admin; `{archived, updated_at}` |
| GET | `/companies/{id}/contacts` | вкладка карточки |
| GET | `/companies/{id}/tasks` | вкладка карточки |
| GET | `/companies/{id}/log` | ChangeEvent компании |
| POST | `/ocr/business-card` | multipart `file`; Tesseract OCR, возвращает `raw_text`, `draft`, `confidence`; запись не сохраняется автоматически |
| GET/POST | `/contacts` | `company`, `source`, `status`, `has_linkedin`, `q`, `page`, `sort`, `dir`; `include_archived=1` только Admin; contact `status`: `active`/`inactive` |
| GET/PUT | `/contacts/{id}` | перенос в другую компанию — только Admin; `status` принимает `active` или `inactive` |
| POST | `/contacts/{id}/archive` | Admin |
| GET | `/contacts/{id}/log` | ChangeEvent контакта |
| GET/POST | `/tasks` | `manager`, `company`, `state`, `page`, `sort`, `dir`; `include_archived=1` только Admin |
| GET/PUT | `/tasks/{id}` | одинаковый набор полей для create/edit |
| POST | `/tasks/{id}/archive` | Admin |
| GET/POST | `/tasks/{id}/comments` | комментарии immutable |
| PATCH | `/tasks/{id}/comments/{commentId}` | Admin: `{hidden:true}` |
| GET | `/tasks/{id}/log` | фильтр единого ChangeEvent |
| GET | `/tasks/{id}/reminder.ics` | Outlook-compatible event |
| POST | `/tasks/{id}/attachments` | multipart, поле `file`, до 20 МБ |
| GET/DELETE | `/tasks/{id}/attachments/{attachmentId}` | delete: автор или Admin |
| POST | `/speech/transcribe` | multipart `file`; Whisper CLI, возвращает распознанный текст для вставки в поле |

`state` для задач: `actual` (по умолчанию), `overdue`, `completed`, `deferred`, `canceled`, `all`.

## Сводные и административные

| Метод | Путь | Доступ |
|---|---|---|
| GET | `/dashboard` | auth |
| GET | `/app/bootstrap` | auth; компактный начальный снимок для frontend: CSRF, identity, справочники, роли и аудит. Записи загружаются отдельными страницами по 50, детали комментариев и вложений — при открытии задачи |
| GET | `/pipeline` | auth |
| GET | `/search?q=` | auth; не более 25 результатов каждого типа |
| GET | `/lookups` | auth, активные значения всех типов |
| GET | `/lookups/{type}` | auth; `include_inactive=1` только Admin |
| POST | `/lookups/{type}` | Admin |
| PUT | `/lookups/{type}/{id}` | Admin, `updated_at` |
| GET | `/lookups/{type}/{id}/log` | Admin; история из общего ChangeEvent |
| GET/POST | `/users` | Admin |
| PUT | `/users/{id}` | Admin, `updated_at` |
| POST | `/users/{id}/approve` | Admin |
| DELETE | `/users/{id}` | Admin, только pending registration |
| POST | `/users/{id}/reset-password` | Admin |
| GET | `/users/{id}/log` | Admin; история из общего ChangeEvent |
| GET | `/audit` | Admin; filters + `format=csv` |
| GET/PUT | `/settings` | Admin; адрес системных уведомлений, уведомление о регистрациях, разрешённые email-домены |

Типы справочников: `company_type`, `client_status`, `task_status`, `outcome_status`, `contact_source`, `reminder_lead_time`, `cjn_manager`.

Деактивированное значение нельзя назначить новой записи. Существующая запись, которая уже ссылается на такое значение, продолжает читаться и может быть отредактирована без принудительной замены исторического значения.

Для напоминаний email связанного User имеет приоритет над fallback email менеджера. Если связанный User деактивирован или ожидает подтверждения, fallback не используется и задача возвращается с `reminder_possible: false`.

Audit filters: `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `user`, `action`, `entity_type`, `page`; для CSV добавьте `format=csv` (не более 10 000 строк за выгрузку).

## Оптимистическая блокировка

`PUT` и архивирование передают `updated_at`, полученный последним GET. Если запись уже менялась, сервер отвечает 409:

```json
{
  "error": {
    "code": "edit_conflict",
    "message": "Запись изменена другим пользователем. Обновите данные и повторите правки.",
    "details": {"server_updated_at": "2026-08-06T10:20:30.123456Z"}
  }
}
```

## Возможные дубликаты

Компания с совпадающим именем и контакт с совпадающим email возвращают 409 `possible_duplicate`. Чтобы осознанно сохранить, повторите запрос с `allow_duplicate: true`.
