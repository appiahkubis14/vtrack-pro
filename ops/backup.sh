#!/usr/bin/env bash
# Encrypted database backup for V-Track Pro.
#
#   BACKUP_PASSPHRASE_FILE=/etc/vtrack/backup.pass  ops/backup.sh
#
# What it does: dumps the main database (the ledger lives here) and the tracking database, encrypts each dump with
# AES-256 (gpg, symmetric), writes a checksum file, deletes copies older than RETENTION_DAYS and, if OFFSITE_DIR is
# set, copies the new files there (mount a second disk, an SFTP/rclone mount or an object-storage mount at that path).
#
# Settings (environment, all optional): DB_HOST DB_PORT DB_USERNAME DB_PASSWORD DB_DATABASE (default vtrack)
#   TS_DATABASE (default vtrack_ts; set to "" to skip) BACKUP_DIR (default /var/backups/vtrack) RETENTION_DAYS (default 14)
#   OFFSITE_DIR BACKUP_PASSPHRASE_FILE (required: a file holding the passphrase, mode 600)
# Keep the passphrase AND the FIELD_ENCRYPTION_KEY somewhere other than the server. Without them a backup is unreadable.
set -euo pipefail

: "${BACKUP_PASSPHRASE_FILE:?Set BACKUP_PASSPHRASE_FILE to a file containing the backup passphrase}"
[ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "Passphrase file $BACKUP_PASSPHRASE_FILE is missing or empty" >&2; exit 1; }
if [ "$(stat -c '%a' "$BACKUP_PASSPHRASE_FILE")" != "600" ] && [ "$(stat -c '%a' "$BACKUP_PASSPHRASE_FILE")" != "400" ]; then
  echo "Passphrase file must be readable only by its owner (chmod 600)" >&2; exit 1
fi
export PGHOST="${DB_HOST:-localhost}" PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USERNAME:-vtrack}" PGPASSWORD="${DB_PASSWORD:?Set DB_PASSWORD}"
MAIN_DB="${DB_DATABASE:-vtrack}"
TS_DB="${TS_DATABASE-vtrack_ts}"
DIR="${BACKUP_DIR:-/var/backups/vtrack}"
KEEP="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$DIR"

dump() { # name database
  local name="$1" db="$2" out="$DIR/${1}-${STAMP}.dump.gpg"
  echo "Backing up $db -> $out"
  pg_dump --format=custom --no-owner "$db" \
    | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --output "$out"
  [ -s "$out" ] || { echo "Backup file $out is empty" >&2; exit 1; }
  (cd "$DIR" && sha256sum "$(basename "$out")" >> "SHA256SUMS-${STAMP}")
}

dump main "$MAIN_DB"
[ -n "$TS_DB" ] && dump tracking "$TS_DB" || true

find "$DIR" -type f \( -name '*.dump.gpg' -o -name 'SHA256SUMS-*' \) -mtime "+$KEEP" -delete
if [ -n "${OFFSITE_DIR:-}" ]; then
  mkdir -p "$OFFSITE_DIR"
  cp -p "$DIR"/*-"$STAMP".dump.gpg "$DIR/SHA256SUMS-$STAMP" "$OFFSITE_DIR"/
  echo "Copied to $OFFSITE_DIR"
fi
echo "Backup finished: $STAMP"
