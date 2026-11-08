# Runbook

## Environments
| | Needs |
|---|---|
| Development | Docker for postgres, timescale, redis, mqtt (or local installs), Node 20+ |
| Test | a Postgres 16 with PostGIS, a role that can create databases |
| Production | all of the above, plus `NODE_ENV=production` and the secrets below |

## Secrets (production refuses to start without them)
- `JWT_SECRET`, `JWT_REFRESH_SECRET`: different random values, at least 32 characters.
- `FIELD_ENCRYPTION_KEY`: `openssl rand -hex 32`. **Back it up separately.** Encrypted owner and rider data cannot be
  read without it, and there is no recovery if it is lost.
- Database and Redis passwords. Replace every `change-me` and `vtrack123` value.

## First setup
```bash
cd backend
npm ci
npm run migration:run && npm run migration:run:timescale
npm run seed          # development only
```

## Tests
```bash
npm run build
npm test                                    # unit
scripts/setup-test-db.sh && npm run test:int     # integration, on a clean vtrack_test database
npx ts-node tools/check-schema.ts           # entities against the real schema
node scripts/ui-smoke.js                    # browser run of the admin business pages (see the file's header)
```
Whole-system checks (need the API running on the test database and the demo data):
```bash
DB_DATABASE=vtrack_test PORT=3000 node dist/src/main.js &
API=http://localhost:3000/api node scripts/http-e2e.js     # 128 checks over HTTP as admin, hub manager, investor and rider
node scripts/seed-demo.js                                   # demo organisation with a week of data; prints the logins
node scripts/ui-roles.js /tmp/screens                       # opens every page as every role in a browser and saves screenshots
```
Integration tests never touch the main database.

## Rolling back
`npm run migration:revert` undoes the last migration; migrations 026 and 027 have tested `down()` methods. Take a backup first, because
reverting the business layer drops its tables.

## Demo data
`node scripts/seed-demo.js` creates a demo organisation (two hubs, stock, owners, contracts, riders, a week of settlements, a locked
vehicle, a grace period, an exception, payouts) and five logins (administrator, finance, hub manager, investor, rider) that share the
password printed at the end. Use it for inspection only, never in production.

## Daily operation
- Hub managers record takings and charging during the day, then use **Daily Settlements** to calculate and close the day.
- Finance reviews the **Arrears** report and the trial balance (it must always show balanced).
- A wrong figure after close is corrected with a ledger reversal and a new entry, never by editing.

## Backups
`ops/backup.sh` (encrypted, checksummed, with retention and an optional off-site copy), `ops/restore.sh` and
`ops/restore-test.sh` (restores the newest backup into a scratch database and checks the ledger balances). Schedule, off-site
copies and the restore procedure are in `docs/deployment-ghana.md`. Test a restore before go-live.

## Production
`ops/docker-compose.prod.yml` (HTTPS web server, API, databases not exposed, nightly backup) with `ops/.env.production.example`.
Migrations run from the compiled build: `node scripts/migrate.js timescale`. Step by step for a Ghana server: `docs/deployment-ghana.md`.
