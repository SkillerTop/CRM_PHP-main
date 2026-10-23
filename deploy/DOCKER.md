# Docker deployment

One image runs the whole CRM: Apache + PHP 8.3 backend, the built React
frontend, Faster-Whisper (voice input) and PaddleOCR (business-card scan) on an
NVIDIA GPU, and outbound website lookup for new companies. Compose adds:

| Service     | Starts                        | Purpose |
|-------------|-------------------------------|---------|
| `app`       | always                        | Web app on `CRM_BIND:CRM_PORT` (default `127.0.0.1:8080`); applies DB migrations on start |
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
  - `paddleocr/official_models/` with `PP-LCNet_x1_0_doc_ori`,
    `PP-LCNet_x1_0_textline_ori`, `PP-OCRv5_server_det`, `eslav_PP-OCRv5_mobile_rec`
  Copy them from the development machine's `.runtime/models` (≈1.7 GB).
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
docker compose --env-file .env.docker exec -u www-data app php /var/www/deploy/check-ai.php
```

`check-ai.php` runs real inference with both models and must print
`"ok": true` with `"device": "cuda"` (speech) and `"device": "gpu"` (OCR).

Without `--profile https`, put your own reverse proxy (nginx, Apache, Traefik) in
front of `127.0.0.1:8080`. It must terminate TLS, allow 32 MB request bodies and
15-minute timeouts, and either send `X-CRM-Proxy-Secret: <PROXY_SHARED_SECRET>`
with `X-Forwarded-For`, or have its address listed in `TRUSTED_PROXIES`.

First admin on a new database:

```sh
docker compose --env-file .env.docker exec -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD='temporary-password' -e ADMIN_NAME='Admin' app php bin/console create-admin
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
with `docker compose … exec app php bin/console migrate`.

## Data and backups

- `app-storage` volume: uploads (business cards, attachments), logs, model caches.
- `db-data` volume: MySQL data (only with `local-db`).
- `caddy-data`: TLS certificates.

Back up `app-storage` and the database (`mysqldump`) with the existing backup
procedure; the image itself holds no data or secrets.

## Without an NVIDIA GPU

Set `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE_TYPE=int8`, `OCR_DEVICE=cpu` in
`.env.docker` and remove the `deploy.resources` block from the `app` service.
Expect OCR to take tens of seconds and voice input minutes per recording.

## Troubleshooting

- `docker compose … logs -f app` shows Apache/PHP errors and migration output.
- Health check: `curl -fsS http://127.0.0.1:8080/api/health`.
- `Backend environment is invalid` at start: run
  `docker compose … run --rm -e RUN_MIGRATIONS=false app php bin/console config:check`
  for the exact setting.
- A GPU error in `check-ai.php`: check the driver, `nvidia-smi` inside a CUDA
  container, and the NVIDIA Container Toolkit.
