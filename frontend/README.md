# Client Data CRM — frontend

React/TypeScript-интерфейс для PHP API из корня репозитория. Браузер обращается только к `/api/backend/*`; server-side route проксирует запросы в PHP, поэтому cookie-сессия и CSRF работают с одного origin.

## Локальный запуск

Сначала подготовьте БД и запустите PHP API по инструкции [RUN_AND_TEST.md](../docs/RUN_AND_TEST.md). Затем:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

По умолчанию `.env.example` направляет шлюз на `http://127.0.0.1:8080`. Интерфейс откроется на адресе, который напечатает dev-сервер (обычно `http://localhost:3000`).

## Проверка

```powershell
npm run build
node --test tests/rendered-html.test.mjs
```

Секреты и адрес PHP API не должны встраиваться в клиентский JavaScript: `CRM_BACKEND_URL` читается только серверным route handler.
