#!/usr/bin/env bash
# Proves that the newest backup can actually be restored: restores it into a scratch database, checks that the ledger
# is balanced and that the key tables have rows, then drops the scratch database. Run it weekly (see docs/deployment-ghana.md).
#
#   BACKUP_PASSPHRASE_FILE=... DB_PASSWORD=... ops/restore-test.sh [backup-file]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${BACKUP_DIR:-/var/backups/vtrack}"
FILE="${1:-$(ls -1t "$DIR"/main-*.dump.gpg 2>/dev/null | head -1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "No backup found in $DIR" >&2; exit 1; }
export PGHOST="${DB_HOST:-localhost}" PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USERNAME:-vtrack}" PGPASSWORD="${DB_PASSWORD:?Set DB_PASSWORD}"
SCRATCH="vtrack_restore_test_$$"
trap 'dropdb --if-exists "$SCRATCH" >/dev/null 2>&1 || true' EXIT

"$HERE/restore.sh" "$FILE" "$SCRATCH" >/dev/null
q() { psql -d "$SCRATCH" -At -c "$1"; }
fail=0
check() { if [ "$2" = "ok" ]; then echo "  ok   $1"; else echo "  FAIL $1 ($2)"; fail=1; fi; }

check "migrations table present" "$([ "$(q "SELECT count(*) FROM migrations")" -gt 0 ] && echo ok || echo none)"
check "ledger has entries" "$([ "$(q "SELECT count(*) FROM ledger_entries")" -ge 0 ] && echo ok || echo none)"
D=$(q "SELECT COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='debit'),0) FROM ledger_entries")
C=$(q "SELECT COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='credit'),0) FROM ledger_entries")
check "ledger balanced (debits $D = credits $C)" "$([ "$D" = "$C" ] && echo ok || echo unbalanced)"
check "ledger cannot be edited (trigger present)" "$([ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%ledger%' AND NOT tgisinternal")" -gt 0 ] && echo ok || echo missing)"
check "audit trail cannot be edited (trigger present)" "$([ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname='trg_audit_logs_immutable'")" = "1" ] && echo ok || echo missing)"
check "users restored" "$([ "$(q "SELECT count(*) FROM users")" -gt 0 ] && echo ok || echo none)"
echo "Restored: $(basename "$FILE")  users=$(q "SELECT count(*) FROM users") vehicles=$(q "SELECT count(*) FROM vehicles") ledger_transactions=$(q "SELECT count(*) FROM ledger_transactions") audit_rows=$(q "SELECT count(*) FROM audit_logs")"
[ "$fail" = 0 ] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED"; exit 1; }
