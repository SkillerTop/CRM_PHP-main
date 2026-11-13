# Node.js + TypeScript backend

`src/server.ts` registers all 67 API routes from the PHP reference router. Domain modules group authentication, profiles, companies, contacts, tasks, users, audit, lookups, and settings. Shared modules handle database queries, validation, storage quotas, rate limiting, images, mail, reminders, AI process execution, and safe website requests.

The server uses the existing MySQL schema and storage paths. `src/cli.ts` implements `config:check`, `migrate`, `migrate:resolve`, `create-admin`, `reminders:run`, and `cleanup`. The Docker image builds TypeScript, installs runtime Node dependencies and the two Python AI environments, and serves the compiled frontend.

## Build and checks

```sh
npm ci
npm run build
npm test
```

With a configured MySQL instance, use `node --env-file=../backend/.env dist/cli.js migrate` and `node --env-file=../backend/.env dist/server.js`. `PORT` defaults to `8080`. Production configuration is checked before the server starts.

The tests compare the complete route list and representative OCR cards against the PHP reference. Database-backed contract tests and a full browser walkthrough require a configured MySQL instance; the current workspace has no local MySQL service.
