FROM node:22-bookworm AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nvidia/cuda:12.9.1-cudnn-runtime-ubuntu24.04

# PaddlePaddle GPU wheel built for CUDA 12.9 (required for RTX 50-series / Blackwell).
ARG PADDLE_VERSION=3.4.0
ARG PADDLE_INDEX=https://www.paddlepaddle.org.cn/packages/stable/cu129/

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PADDLE_HOME=/var/www/backend/storage/paddle-cache \
    PADDLE_PDX_CACHE_HOME=/var/www/backend/storage/paddle-cache \
    HF_HOME=/var/www/backend/storage/huggingface-cache \
    XDG_CACHE_HOME=/var/www/backend/storage/cache

# php8.3-curl/xml: website lookup (outbound HTTPS, DOM parsing); php8.3-intl:
# transliteration for OCR name matching and international domain names.
RUN apt-get update && apt-get install -y --no-install-recommends \
    apache2 libapache2-mod-php8.3 php8.3-cli php8.3-mysql php8.3-mbstring \
    php8.3-curl php8.3-xml php8.3-zip php8.3-intl python3 python3-venv \
    ca-certificates curl libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

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
COPY deploy/check-ai.php /var/www/deploy/check-ai.php
COPY deploy/docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/docker/php.ini /etc/php/8.3/apache2/conf.d/99-crm.ini
COPY deploy/docker/entrypoint.sh /usr/local/bin/crm-entrypoint
RUN chmod +x /usr/local/bin/crm-entrypoint \
    && a2enmod rewrite headers \
    && mkdir -p /var/www/backend/storage/tmp /var/www/backend/storage/uploads /var/www/backend/storage/logs \
    && chown -R www-data:www-data /var/www/backend/storage

WORKDIR /var/www/backend
EXPOSE 80
ENTRYPOINT ["crm-entrypoint"]
CMD ["apachectl", "-D", "FOREGROUND"]
