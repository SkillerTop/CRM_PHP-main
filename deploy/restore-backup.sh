#!/usr/bin/env sh
set -eu

: "${1:?Usage: restore-backup.sh /path/to/backup.bundle.tar.age}"
: "${ALLOW_RESTORE:?Set ALLOW_RESTORE=YES after verifying the target environment}"
[ "$ALLOW_RESTORE" = 'YES' ] || { printf 'ALLOW_RESTORE must equal YES.\n' >&2; exit 1; }
: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${RESTORE_DATABASE:?RESTORE_DATABASE is required}"
: "${DB_USERNAME:?DB_USERNAME is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is required}"
: "${RESTORE_UPLOAD_DIR:?RESTORE_UPLOAD_DIR is required and must be empty}"

case "$RESTORE_DATABASE" in *[!A-Za-z0-9_]*) printf 'RESTORE_DATABASE contains unsafe characters.\n' >&2; exit 1 ;; esac

for command in mysql gzip tar sha256sum age mktemp; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing required command: %s\n' "$command" >&2; exit 1; }
done

encrypted=$1
checksum="${encrypted}.sha256"
[ -f "$encrypted" ] && [ -f "$checksum" ] || { printf 'Backup or checksum sidecar is missing.\n' >&2; exit 1; }
if [ -e "$RESTORE_UPLOAD_DIR" ] && [ -n "$(find "$RESTORE_UPLOAD_DIR" -mindepth 1 -print -quit)" ]; then
  printf 'RESTORE_UPLOAD_DIR must be absent or empty.\n' >&2
  exit 1
fi

table_count=$(MYSQL_PWD="$DB_PASSWORD" mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USERNAME" --batch --skip-column-names \
  -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${RESTORE_DATABASE}';")
[ "$table_count" = '0' ] || { printf 'RESTORE_DATABASE must exist and contain no tables.\n' >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT HUP INT TERM
expected=$(awk '{print $1}' "$checksum")
actual=$(sha256sum "$encrypted" | awk '{print $1}')
[ "$expected" = "$actual" ] || { printf 'Encrypted backup checksum mismatch.\n' >&2; exit 1; }

age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$work/bundle.tar" "$encrypted"
tar -tf "$work/bundle.tar" | while IFS= read -r member; do
  case "$member" in /*|../*|*/../*|*/..) printf 'Unsafe archive member: %s\n' "$member" >&2; exit 1 ;; esac
done
tar -C "$work" -xf "$work/bundle.tar"
(
  cd "$work"
  sha256sum -c MANIFEST.sha256
)

database_file=$(find "$work" -maxdepth 1 -type f -name '*.sql.gz' -print -quit)
uploads_file=$(find "$work" -maxdepth 1 -type f -name '*.uploads.tar.gz' -print -quit)
[ -n "$database_file" ] && [ -n "$uploads_file" ] || { printf 'Backup payload is incomplete.\n' >&2; exit 1; }

gzip -dc "$database_file" > "$work/database.sql"
MYSQL_PWD="$DB_PASSWORD" mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USERNAME" "$RESTORE_DATABASE" < "$work/database.sql"
mkdir -p "$RESTORE_UPLOAD_DIR"
tar -C "$RESTORE_UPLOAD_DIR" -xzf "$uploads_file"
printf 'Restore completed into database %s and %s\n' "$RESTORE_DATABASE" "$RESTORE_UPLOAD_DIR"
