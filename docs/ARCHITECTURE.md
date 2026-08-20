# Архитектура CRM

## Backend

- `backend/public/index.php` — единственная публичная точка входа API.
- `backend/src/Http` — HTTP-запросы, ответы и маршрутизация.
- `backend/src/Controller` — контроллеры API по доменам CRM.
- `backend/src/Domain` — бизнес-правила, маппинг, аудит, напоминания и почта.
- `backend/src/Database` — подключение к БД и выполнение миграций.
- `backend/src/Security` — авторизация, пароли и ограничение запросов.
- `backend/src/Config` — загрузка окружения и конфигурации.
- `backend/database/migrations` — последовательные SQL-миграции.

## Frontend

- `frontend/src/app/CRMApp.tsx` — композиция приложения и orchestration серверных операций.
- `frontend/app` — Next/Vinext route surface: страницы, layout и API-proxy.
- `frontend/src/shared/components` — переиспользуемые визуальные компоненты.
- `frontend/src/shared/hooks` — клиентские React-хуки, связанные с состоянием интерфейса.
- `frontend/src/shared/api/api-client.ts` — единый HTTP-клиент фронтенда.
- `frontend/src/shared/utils` — чистые функции дат, URL-фильтров и других общих преобразований.
- `frontend/src/styles/globals.css` — общая дизайн-система и адаптивные правила.
- `frontend/src/features` — целевые границы для постепенного выноса крупных CRM-разделов из `CRMApp.tsx`.
- `frontend/tests` — проверки поведения и responsive-ограничений.

## Правило дальнейших изменений

Новый переиспользуемый UI-код помещается в `frontend/src/shared/components`, состояние и эффекты — в `frontend/src/shared/hooks`, интеграция с API — в `frontend/src/shared/api` или отдельный сервисный модуль. Бизнес-правила не дублируются во фронтенде и должны оставаться в `backend/src/Domain`/`backend/src/Controller`.
