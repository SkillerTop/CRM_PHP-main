FROM node:24-bookworm AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-bookworm AS backend-build
WORKDIR /src/backend-node
COPY backend-node/package.json backend-node/package-lock.json ./
RUN npm ci
COPY backend-node/ ./
RUN npm run build
RUN npm prune --omit=dev

FROM nvidia/cuda:12.9.1-cudnn-runtime-ubuntu24.04
ARG PADDLE_VERSION=3.4.0
ARG PADDLE_INDEX=https://www.paddlepaddle.org.cn/packages/stable/cu129/
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PADDLE_HOME=/var/www/backend/storage/paddle-cache \
    PADDLE_PDX_CACHE_HOME=/var/www/backend/storage/paddle-cache \
    HF_HOME=/var/www/backend/storage/huggingface-cache \
    XDG_CACHE_HOME=/var/www/backend/storage/cache \
    PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ca-certificates curl gosu libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build /usr/local/bin/node /usr/local/bin/node
RUN python3 -m venv /opt/ai/whisper \
    && /opt/ai/whisper/bin/pip install --no-cache-dir --upgrade pip \
    && python3 -m venv /opt/ai/ocr \
    && /opt/ai/ocr/bin/pip install --no-cache-dir --upgrade pip
COPY backend/ai/requirements-speech.txt /tmp/requirements-speech.txt
COPY backend/ai/requirements-ocr.txt /tmp/requirements-ocr.txt
COPY deploy/docker/constraints.txt /tmp/constraints.txt
RUN /opt/ai/whisper/bin/pip install --no-cache-dir -c /tmp/constraints.txt -r /tmp/requirements-speech.txt \
    && /opt/ai/ocr/bin/pip install --no-cache-dir "paddlepaddle-gpu==${PADDLE_VERSION}" -i "${PADDLE_INDEX}" \
    && /opt/ai/ocr/bin/pip install --no-cache-dir -c /tmp/constraints.txt -r /tmp/requirements-ocr.txt \
    && rm /tmp/requirements-*.txt /tmp/constraints.txt
COPY backend/ /var/www/backend/
COPY --from=frontend-build /src/frontend/dist/ /var/www/backend/public/
COPY --from=backend-build /src/backend-node/dist/ /var/www/backend-node/dist/
COPY --from=backend-build /src/backend-node/node_modules/ /var/www/backend-node/node_modules/
COPY --from=backend-build /src/backend-node/package.json /var/www/backend-node/package.json
COPY deploy/docker/entrypoint.sh /usr/local/bin/crm-entrypoint
RUN chmod +x /usr/local/bin/crm-entrypoint \
    && mkdir -p /var/www/backend/storage/tmp /var/www/backend/storage/uploads /var/www/backend/storage/logs \
    && chown -R www-data:www-data /var/www/backend/storage
WORKDIR /var/www/backend-node
EXPOSE 8080
ENTRYPOINT ["crm-entrypoint"]
CMD ["node", "dist/server.js"]
