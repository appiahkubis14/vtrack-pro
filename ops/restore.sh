#!/usr/bin/env bash
# Restores an encrypted backup made by backup.sh into a database.
#
#   BACKUP_PASSPHRASE_FILE=/etc/vtrack/backup.pass ops/restore.sh /var/backups/vtrack/main-20261107T020000Z.dump.gpg vtrack_restored
#
# The target database is created if it does not exist and MUST be empty. To replace the live database, stop the API,
# restore into a new name, check it with ops/restore-test.sh, then rename (or point DB_DATABASE at it) and start the API.
set -euo pipefail
FILE="${1:?Usage: restore.sh <backup.dump.gpg> <target-database>}"
TARGET="${2:?Usage: restore.sh <backup.dump.gpg> <target-database>}"
: "${BACKUP_PASSPHRASE_FILE:?Set BACKUP_PASSPHRASE_FILE}"
export PGHOST="${DB_HOST:-localhost}" PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USERNAME:-vtrack}" PGPASSWORD="${DB_PASSWORD:?Set DB_PASSWORD}"

SUMS="$(dirname "$FILE")/SHA256SUMS-$(basename "$FILE" | sed -E 's/^[a-z]+-([0-9TZ]+)\.dump\.gpg$/\1/')"
if [ -f "$SUMS" ]; then
  (cd "$(dirname "$FILE")" && grep " $(basename "$FILE")\$" "$SUMS" | sha256sum --check --quiet) || { echo "Checksum mismatch: the backup file is damaged" >&2; exit 1; }
  echo "Checksum OK"
else
  echo "Warning: no checksum file found next to the backup" >&2
fi

CREATED=0
if psql -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='$TARGET'" | grep -q 1; then
  [ "$(psql -d "$TARGET" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" = "0" ] || { echo "Database $TARGET is not empty. Restore into a new, empty database." >&2; exit 1; }
else
  createdb "$TARGET"
  CREATED=1
  # a failed restore must not leave a half-filled database behind
  trap '[ "${DONE:-0}" = 1 ] || dropdb --if-exists "$TARGET" >/dev/null 2>&1' EXIT
fi
psql -d "$TARGET" -q -c "CREATE EXTENSION IF NOT EXISTS postgis" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" 2>/dev/null || true
gpg --batch --quiet --decrypt --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" "$FILE" \
  | pg_restore --no-owner --dbname "$TARGET" --exit-on-error
DONE=1
echo "Restored $FILE into $TARGET"
