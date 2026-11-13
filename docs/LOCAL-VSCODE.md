# Run locally in Visual Studio Code (Windows, no Docker)

Open the `node-js-v.3.5` folder itself in VS Code. Node.js 24 is required. The frontend uses Vite on `http://127.0.0.1:5173`; it proxies `/api` to the Node backend on port 8080.

## 1. Start MySQL

Install and start a local MySQL 8 server. It must listen on `127.0.0.1:3306`. The Node backend uses the existing MySQL schema; it cannot run the CRM without a database. Create an empty database and a local user in the MySQL command-line client (replace the example password):

```sql
CREATE DATABASE crm_client_data CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'crm'@'localhost' IDENTIFIED BY 'choose-a-local-password';
CREATE USER 'crm'@'127.0.0.1' IDENTIFIED BY 'choose-a-local-password';
GRANT ALL PRIVILEGES ON crm_client_data.* TO 'crm'@'localhost';
GRANT ALL PRIVILEGES ON crm_client_data.* TO 'crm'@'127.0.0.1';
```

The MySQL 8.4 Windows MSI and configurator are available from [MySQL's Windows installation guide](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html). If MySQL is already installed, use its current host, port, database, and user instead.

## 2. Set local environment and install dependencies

Run these commands in VS Code's PowerShell terminal, from the repository root:

```powershell
Copy-Item backend/.env.example backend/.env
notepad backend/.env
npm --prefix backend-node ci
npm --prefix frontend ci
```

Set `DB_PASSWORD` in `backend/.env` to the password chosen above. Keep `APP_ENV=development`, `SESSION_SECURE=false`, and `MAIL_TRANSPORT=log` for local HTTP development. `backend/.env` is ignored by Git.

## 3. Prepare the database and first administrator

In VS Code, run **Terminal → Run Task → CRM: migrate database**. The task builds the TypeScript backend and applies the existing migrations. Then create the first account in the terminal:

```powershell
Set-Location backend-node
$env:ADMIN_EMAIL = 'admin@example.com'
$env:ADMIN_NAME = 'Admin'
$env:ADMIN_PASSWORD = 'choose-a-temporary-password'
node --env-file=../backend/.env dist/cli.js create-admin
Remove-Item Env:ADMIN_PASSWORD,Env:ADMIN_EMAIL,Env:ADMIN_NAME
Set-Location ..
```

Use a unique temporary password of at least eight characters. The CRM asks the administrator to change it after login.

## 4. Launch the app

To start both services in one VS Code terminal, run `npm run dev` from the repository root. Stop both with Ctrl+C. Run `npm run setup` once to install both sets of dependencies before the first start. The combined command uses TypeScript directly; no separate build is needed.

Alternatively, start them separately for VS Code's backend debugger:

Select **Run and Debug → CRM: backend (Node.js) → F5**. VS Code builds the backend before starting it; TypeScript source maps enable breakpoints in `backend-node/src`.

Run **Terminal → Run Task → CRM: frontend (Vite)** in a second VS Code terminal. Open `http://127.0.0.1:5173`. The Vite proxy sends API calls to the Node backend. A healthy API returns JSON at `http://127.0.0.1:8080/api/health`.

Local mail delivery is suppressed by `MAIL_TRANSPORT=log`. OCR and speech require separate Python/model and Ollama setup; the core CRM can start without them.
