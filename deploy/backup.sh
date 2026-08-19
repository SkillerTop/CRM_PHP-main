#!/usr/bin/env sh
set -eu

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${DB_DATABASE:?DB_DATABASE is required}"
: "${DB_USERNAME:?DB_USERNAME is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${BACKUP_DIR:=/var/backups/client-data-crm}"
: "${PROJECT_ROOT:=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
: "${UPLOAD_DIR:=$PROJECT_ROOT/storage/uploads}"

umask 077
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/${DB_DATABASE}_${stamp}.sql.gz"

MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USERNAME" \
  --single-transaction \
  --routines \
  --triggers \
  --default-character-set=utf8mb4 \
  "$DB_DATABASE" | gzip -9 > "$target"

uploads_target="$BACKUP_DIR/uploads_${stamp}.tar.gz"
if [ -d "$UPLOAD_DIR" ]; then
  tar -C "$UPLOAD_DIR" -czf "$uploads_target" .
else
  printf 'Warning: upload directory does not exist: %s\n' "$UPLOAD_DIR" >&2
fi

find "$BACKUP_DIR" -type f -name "${DB_DATABASE}_*.sql.gz" -mtime +30 -delete
find "$BACKUP_DIR" -type f -name 'uploads_*.tar.gz' -mtime +30 -delete
printf 'Backup created: %s\n' "$target"
if [ -f "$uploads_target" ]; then
  printf 'Upload backup created: %s\n' "$uploads_target"
fi

