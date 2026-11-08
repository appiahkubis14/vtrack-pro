#!/usr/bin/env bash
# Creates a clean "vtrack_test" database, runs every migration, and checks the schema.
# Usage: scripts/setup-test-db.sh   (uses DB_* from .env; needs a role allowed to create databases)
set -euo pipefail
cd "$(dirname "$0")/.."
# read only the DB_* lines; sourcing the whole file breaks on values with spaces
for k in DB_HOST DB_PORT DB_USERNAME DB_PASSWORD; do
  v=$(grep -E "^$k=" .env 2>/dev/null | head -1 | cut -d= -f2- || true)
  [ -n "${v:-}" ] && export "$k=$v"
done
export PGPASSWORD="${DB_PASSWORD:-vtrack123}"
PSQL=(psql -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USERNAME:-vtrack}")
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS vtrack_test" -c "CREATE DATABASE vtrack_test"
"${PSQL[@]}" -d vtrack_test -c "CREATE EXTENSION IF NOT EXISTS postgis" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
DB_DATABASE=vtrack_test npm run -s migration:run >/dev/null
DB_DATABASE=vtrack_test npx ts-node tools/check-schema.ts
