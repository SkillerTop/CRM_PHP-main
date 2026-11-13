# Client Data CRM

React frontend and Node.js 24 + TypeScript backend. The Node backend serves the frontend, implements all 67 `/api/*` routes, runs MySQL migrations, sends reminders, and handles scheduled cleanup. Existing MySQL tables and files in `backend/storage` are retained for migration compatibility. The Python model runners under `backend/ai` continue to perform OCR and speech inference; no PHP runtime is required by the Node app.

## Local development

For Windows and Visual Studio Code without Docker, follow [docs/LOCAL-VSCODE.md](docs/LOCAL-VSCODE.md). It includes local MySQL setup, the `.env` file, migrations, and VS Code run tasks.

After configuring `backend/.env` and installing dependencies with `npm run setup`, start the Node API and Vite frontend together with `npm run dev` from the repository root.

```sh
# Terminal 1 (from the repository root)
cd frontend && npm ci && npm run dev
# Terminal 2 (from the repository root)
cd backend-node && npm ci && npm run build
node --env-file=../backend/.env dist/cli.js migrate
node --env-file=../backend/.env dist/server.js
```

The backend listens on `PORT` (default `8080`). Development CORS permits Vite on `localhost:5173`. Configure MySQL, mail, session security, and AI paths in `backend/.env`. Run `node --env-file=../backend/.env dist/cli.js config:check` to validate configuration. Run `npm test` in `backend-node` for route, OCR, authentication, and network safety checks.

## Docker

Use [deploy/DOCKER.md](deploy/DOCKER.md) and `.env.docker.example` to build the Node application and scheduler. The app container applies migrations at startup when `RUN_MIGRATIONS=true`; the scheduler runs `reminders:run` and `cleanup` every 15 minutes. The optional Caddy profile terminates HTTPS.

## Existing deployments

The PHP implementation in `backend/src` remains in this branch as a behavior reference and for comparison against the existing database. The Node entry points are `backend-node/dist/server.js` and `backend-node/dist/cli.js`. Existing Apache and FTP deployment scripts under `deploy/` target the former PHP runtime and are not Node deployment paths. Use the Docker deployment or configure a Node process and reverse proxy explicitly.

Backups still use `deploy/backup.sh` and `deploy/restore-backup.sh` for the database and `backend/storage` volume. API routes are listed in [docs/API.md](docs/API.md).
