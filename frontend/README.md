# Client Data CRM — frontend

Статический React/TypeScript SPA для PHP API из корня репозитория. В production браузер обращается напрямую к `/api/*` на том же домене; отдельный Node.js, Vinext или Cloudflare Worker не требуется.

## Локальный запуск

Сначала подготовьте БД и запустите PHP API по инструкции [RUN_AND_TEST.md](../docs/RUN_AND_TEST.md). Затем:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

`CRM_BACKEND_URL` используется только локальным Vite-сервером как адрес PHP API. Значение по умолчанию — `http://127.0.0.1:8080`; в клиентскую production-сборку оно не встраивается.

## Сборка и проверка

```powershell
npm run lint
npm test
```

Готовая статическая версия находится в `frontend/dist`:

```text
dist/
├── .htaccess
├── index.html
├── assets/
├── favicon.svg
└── og.png
```

Для FTP-пакета из корня репозитория выполните:

```powershell
& .\deploy\build-frontend-package.ps1
```

Скрипт создаст `deploy/client-data-crm-frontend.zip`. В корень домена нужно загружать содержимое `dist` или содержимое архива, а не саму папку `dist`.

## Production-размещение

Ожидаемая структура корня домена:

```text
/
├── .htaccess
├── index.html
├── assets/
├── favicon.svg
├── og.png
└── backend/
    └── public/
        └── index.php
```

Корневой `.htaccess` направляет `/api/*` в `backend/public/index.php`, блокирует прямой HTTP-доступ к `backend/` и возвращает `index.html` для frontend-маршрутов, включая `/reset-password`.

Если Apache virtual host доступен для редактирования, используйте `deploy/apache-vhost.conf.example` вместо `.htaccess`. Не применяйте оба набора rewrite-правил одновременно.
