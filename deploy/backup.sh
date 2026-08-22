#!/usr/bin/env sh
set -eu

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${DB_DATABASE:?DB_DATABASE is required}"
: "${DB_USERNAME:?DB_USERNAME is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required (age public recipient)}"
: "${BACKUP_DIR:=/var/backups/client-data-crm}"
: "${BACKUP_RETENTION_DAYS:=30}"
: "${PROJECT_ROOT:=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
: "${UPLOAD_DIR:=$PROJECT_ROOT/backend/storage/uploads}"
: "${BACKUP_LOCK_FILE:=$PROJECT_ROOT/backend/storage/.maintenance.lock}"

case "$DB_DATABASE" in *[!A-Za-z0-9_]*) printf 'DB_DATABASE contains unsafe characters.\n' >&2; exit 1 ;; esac
case "$BACKUP_RETENTION_DAYS" in ''|*[!0-9]*) printf 'BACKUP_RETENTION_DAYS must be an integer.\n' >&2; exit 1 ;; esac

for command in mysqldump gzip tar sha256sum age flock mktemp; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing required command: %s\n' "$command" >&2; exit 1; }
done

umask 077
mkdir -p "$BACKUP_DIR" "$(dirname -- "$BACKUP_LOCK_FILE")"
work=$(mktemp -d "$BACKUP_DIR/.crm-backup.XXXXXX")
trap 'rm -rf -- "$work"' EXIT HUP INT TERM
stamp=$(date -u +%Y%m%dT%H%M%SZ)
base="${DB_DATABASE}_${stamp}"
database_file="${base}.sql.gz"
database_plain="${base}.sql"
uploads_file="${base}.uploads.tar.gz"
bundle_file="${base}.bundle.tar"
encrypted_file="${base}.bundle.tar.age"

exec 9>"$BACKUP_LOCK_FILE"
flock -x 9

MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USERNAME" \
  --single-transaction \
  --quick \
  --skip-lock-tables \
  --routines \
  --events \
  --triggers \
  --hex-blob \
  --default-character-set=utf8mb4 \
  "$DB_DATABASE" > "$work/$database_plain"
gzip -9 "$work/$database_plain"

if [ -d "$UPLOAD_DIR" ]; then
  tar -C "$UPLOAD_DIR" --exclude='./.trash' -czf "$work/$uploads_file" .
else
  tar -czf "$work/$uploads_file" --files-from /dev/null
fi

(
  cd "$work"
  sha256sum "$database_file" "$uploads_file" > MANIFEST.sha256
  printf 'created_utc=%s\ndatabase=%s\nformat=client-data-crm-backup-v1\n' "$stamp" "$DB_DATABASE" > METADATA
  tar -cf "$bundle_file" MANIFEST.sha256 METADATA "$database_file" "$uploads_file"
)

age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/$encrypted_file" "$work/$bundle_file"
rm -f -- "$work/$bundle_file" "$work/$database_file" "$work/$uploads_file" "$work/MANIFEST.sha256" "$work/METADATA"
(
  cd "$work"
  sha256sum "$encrypted_file" > "${encrypted_file}.sha256"
)

mv -- "$work/$encrypted_file" "$BACKUP_DIR/$encrypted_file"
mv -- "$work/${encrypted_file}.sha256" "$BACKUP_DIR/${encrypted_file}.sha256"
flock -u 9

find "$BACKUP_DIR" -type f -name '*.bundle.tar.age' -mtime "+$BACKUP_RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name '*.bundle.tar.age.sha256' -mtime "+$BACKUP_RETENTION_DAYS" -delete
printf 'Encrypted backup created: %s\n' "$BACKUP_DIR/$encrypted_file"
