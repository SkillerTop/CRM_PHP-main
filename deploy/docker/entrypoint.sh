#!/bin/sh
set -eu

# Storage lives in a volume: make sure the directories exist and belong to the
# web server user (skipped when the container already runs as www-data).
if [ "$(id -u)" = "0" ]; then
    mkdir -p /var/www/backend/storage/tmp /var/www/backend/storage/uploads /var/www/backend/storage/logs \
        /var/www/backend/storage/paddle-cache /var/www/backend/storage/whisper-cache \
        /var/www/backend/storage/huggingface-cache /var/www/backend/storage/cache
    chown -R www-data:www-data /var/www/backend/storage
fi

# The app container applies pending migrations before serving (RUN_MIGRATIONS=true).
# The runner takes a database lock, so parallel starts cannot apply a migration twice.
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
    attempt=1
    until php /var/www/backend/bin/console migrate; do
        if [ "$attempt" -ge 10 ]; then
            echo "Database migrations failed after $attempt attempts." >&2
            exit 1
        fi
        attempt=$((attempt + 1))
        echo "Database not ready; retrying migrations in 6 seconds ($attempt/10)." >&2
        sleep 6
    done
fi

exec "$@"
