# Docker deployment

One image runs the whole CRM: Node.js + TypeScript backend, the built React
frontend, Faster-Whisper (voice input) on an NVIDIA GPU, and outbound website
lookup for new companies. Compose adds:

| Service     | Starts                        | Purpose |
|-------------|-------------------------------|---------|
| `app`       | always                        | Web app on `CRM_BIND:CRM_PORT` (default `127.0.0.1:8080`); applies DB migrations on start |
| `ollama`    | always                        | Qwen3-VL (`OCR_VLM_MODEL`, default `qwen3-vl:4b-instruct`) for the business-card scan; internal only |
| `scheduler` | always                        | `reminders:run` + `cleanup` every 15 minutes (replaces the host crontab) |
| `db`        | `--profile local-db`          | MySQL 8.4 in a volume; leave it off to use an existing database server |
| `proxy`     | `--profile https`             | Caddy with automatic HTTPS for `CRM_DOMAIN` |

## Host requirements

- Linux with Docker Engine + Compose v2.20 or newer (or Docker Desktop with WSL2).
- NVIDIA driver supporting CUDA 12.9 (RTX 50-series needs it) and the NVIDIA
  Container Toolkit. Check first:
  `docker run --rm --gpus all nvidia/cuda:12.9.1-cudnn-runtime-ubuntu24.04 nvidia-smi`
- Model weights on the host (not baked into the image), in `CRM_MODELS_DIR`
  (default `./.runtime/models`):
  - `faster-whisper-large-v3-turbo/` (model.bin, config.json, tokenizer.json, …)
  Copy it from the development machine's `.runtime/models`.
- Qwen3-VL is pulled into the `ollama-data` volume once (≈3.3 GB for 4b, ≈6 GB for 8b):
  `docker compose --env-file .env.docker exec ollama ollama pull qwen3-vl:4b-instruct`
- About 20 GB free disk space for the image (CUDA, PaddlePaddle, two Python environments).
- Outbound HTTPS from the container for the company website lookup.

## Configure

```sh
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

Edit `.env.docker`: replace every `replace-…` value, set `APP_URL` and `CRM_DOMAIN`
to the public address, SMTP settings, and the database:

- **Existing database** (for example the current hosted MySQL): set `DB_HOST`,
  `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`. Do not use `--profile local-db`.
  The server must accept connections from the Docker host.
- **Bundled MySQL**: keep `DB_HOST=db`, set `MYSQL_ROOT_PASSWORD`, and add
  `--profile local-db` to every command below.

`PROXY_SHARED_SECRET` (`openssl rand -hex 32`) lets the app trust client IPs
forwarded by the proxy; production refuses to start without it.

## Build and start

Always pass `--env-file .env.docker` (Compose reads its variables from it).

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker build
docker compose --env-file .env.docker --profile https up -d          # + --profile local-db if needed
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker exec -u www-data app node dist/cli.js config:check
```

The configuration check validates runtime settings. Use the OCR test profile below to exercise Qwen3-VL with sample cards and the application UI to test speech inference.

The Python OCR runner is bind-mounted into `app` (see `compose.yaml`). Changes to TypeScript backend code require rebuilding the image.

To try the repository's OCR code on your own photos without touching `app`, put them
into `.runtime/ocr-test/` (or set `OCR_TEST_DIR`) and run a one-off container; it
prints what `POST /api/ocr/business-card` would return for each card:

```sh
docker compose --env-file .env.docker --profile ocr-test run --rm ocr-test
```

Without `--profile https`, put your own reverse proxy (nginx, Apache, Traefik) in
front of `127.0.0.1:8080`. It must terminate TLS, allow 32 MB request bodies and
15-minute timeouts, and either send `X-CRM-Proxy-Secret: <PROXY_SHARED_SECRET>`
with `X-Forwarded-For`, or have its address listed in `TRUSTED_PROXIES`.

First admin on a new database:

```sh
docker compose --env-file .env.docker exec -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD='temporary-password' -e ADMIN_NAME='Admin' app node dist/cli.js create-admin
```

The password must be changed at first login.

## Update to a new build

```sh
git pull
docker compose --env-file .env.docker build
docker compose --env-file .env.docker --profile https up -d
```

Migrations run automatically when `app` starts (`RUN_MIGRATIONS=true`), including
`012_contact_multiple_phones.sql`. Set `RUN_MIGRATIONS=false` to run them by hand
with `docker compose … exec app node dist/cli.js migrate`.

## Data and backups

- `app-storage` volume: uploads (business cards, attachments), logs, model caches.
- `db-data` volume: MySQL data (only with `local-db`).
- `caddy-data`: TLS certificates.

Back up `app-storage` and the database (`mysqldump`) with the existing backup
procedure; the image itself holds no data or secrets.

## Without an NVIDIA GPU

Set `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE_TYPE=int8` in `.env.docker` and remove
the `deploy.resources` blocks from the `app` and `ollama` services.
Expect OCR to take tens of seconds and voice input minutes per recording.

## Troubleshooting

- `docker compose … logs -f app` shows Node.js errors and migration output.
- Health check: `curl -fsS http://127.0.0.1:8080/api/health`.
- `Backend environment is invalid` at start: run
  `docker compose … run --rm -e RUN_MIGRATIONS=false app node dist/cli.js config:check`
  for the exact setting.
- A GPU inference error: check the driver, `nvidia-smi` inside a CUDA
  container, and the NVIDIA Container Toolkit.
