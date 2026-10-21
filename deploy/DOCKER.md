# Docker deployment (NVIDIA GPU)

The Compose stack contains the CRM web app with Faster-Whisper and PaddleOCR,
MySQL, and the reminder/cleanup scheduler. The app image uses CUDA 12.9 and
cuDNN 9. Speech remains `cuda`/`float16`; OCR remains `gpu`. There is no CPU
fallback in the Compose configuration.

## Prerequisites

- Linux Docker host or Docker Desktop with Linux containers and NVIDIA GPU
  passthrough. Install a driver compatible with CUDA 12.9 and configure the
  NVIDIA Container Toolkit. Verify `docker run --rm --gpus all
  nvidia/cuda:12.9.1-cudnn-runtime-ubuntu24.04 nvidia-smi` first.
- The existing weights under `backend/ai/models/`, including
  `faster-whisper-large-v3-turbo/model.bin` and all five PaddleOCR
  `official_models` directories. Compose mounts this directory read-only and
  keeps caches in the `app-storage` volume.
- Enough disk space for the CUDA image, two Python environments, model weights,
  and the MySQL volume. The application image does not contain secrets or model
  weights.

## First start

From the repository root, copy `.env.docker.example` to `.env.docker`. Replace
the three example secrets with unique values. For deployment behind HTTPS,
set the public `APP_URL`, `APP_ENV=production`, `SESSION_SECURE=true`, and a
working SMTP/mail transport. Keep `.env.docker` private.

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up --build -d db app
docker compose --env-file .env.docker exec app php bin/console migrate
docker compose --env-file .env.docker up -d scheduler
docker compose --env-file .env.docker exec -u www-data app php /var/www/deploy/check-ai.php
```

For a fresh local database, create an admin account by supplying
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `ADMIN_NAME` to
`docker compose exec -e ... app php bin/console create-admin`. The initial
password must be changed at first login. Open the configured `APP_URL` and
verify card upload and microphone input in the actual CRM interface.

The app listens on `${CRM_PORT:-8080}` on the Docker host. The database has no
published port. `app-storage` holds uploads and temporary files; `db-data`
holds MySQL. Back up both volumes according to the existing backup procedure.
The scheduler waits for a healthy app before starting.

If `check-ai.php` fails on CUDA visibility, check the host driver, GPU
passthrough, and container toolkit. It performs real inference with both
models and must report `cuda` and `gpu` respectively. A host without NVIDIA
GPU access cannot pass this check or run the GPU-only Compose stack.
