#!/bin/sh
set -eu

mkdir -p /var/www/backend/storage/tmp /var/www/backend/storage/uploads \
    /var/www/backend/storage/paddle-cache /var/www/backend/storage/whisper-cache
chown -R www-data:www-data /var/www/backend/storage

exec "$@"
