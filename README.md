# V-Track Pro

A locally owned fleet tracking and business platform for electric bikes and tricycles in Ghana: imported stock,
investor-owned vehicles, riders, hubs, battery charging, daily takings, and an append-only ledger, on top of a
GPS tracking and immobilisation core.

Backend: NestJS, PostgreSQL 16 with PostGIS, TimescaleDB, Redis, MQTT, BullMQ. Frontend: static pages on the Evohus
template, served by any web server. No third-party SaaS is required to run the business layer.

## Where to start

| You want to | Read |
|---|---|
| Understand the project and what the business needs | `docs/pdf/VTrack-Pro-Project-Idea.pdf` |
| See the system model, data model, rules and flows | `docs/pdf/VTrack-Pro-Project-Model.pdf` |
| Know the rules the code enforces, and which are still assumptions | `docs/business-rules.md` |
| Set up, run, test, deploy | `docs/runbook.md` |
| Put it on a server in Ghana, back it up, restore it | `docs/deployment-ghana.md` |
| See the endpoints of the business layer | `docs/api-business-layer.md` |
| Read older notes (v2.1, Ghana edition) | `docs/history/` |



## Quick start (local)

```bash
cp backend/.env.example backend/.env       # then set FIELD_ENCRYPTION_KEY:  openssl rand -hex 32
docker compose up -d postgres timescale redis mqtt
cd backend
npm install
npm run migration:run && npm run migration:run:timescale
npm run seed                               # demo org and user
npm run start:dev                          # API on :3000, Swagger on /docs
# in another terminal
cd ../frontend && python3 -m http.server 8080    # open http://localhost:8080/app/login.html
```

Demo login after `npm run seed`: `admin@vtrack.local` / `ChangeMe123!`. Change it anywhere but your own machine.
For a fuller demo (every role, a week of business data) run `node backend/scripts/seed-demo.js` and use the logins it prints.

## Checks

```bash
cd backend
npm run build
npm test                                   # unit tests (engines: money, settlement, ledger, schedules)
scripts/setup-test-db.sh && npm run test:int     # integration tests on a clean vtrack_test database
npx ts-node tools/check-schema.ts          # every entity column exists in the real database
```

## What's real vs. scaffolded

**Business layer (new, tested against a real database):**
- Hubs, vehicle models, consignments and stock, owners (encrypted ID and mobile money numbers), contracts with installment
  schedules and arrears, riders and assignments, batteries, swaps and charging, daily takings, daily settlement, an
  append-only double-entry ledger, and the business reports. Eight pages cover it in `frontend/app/`.
- Phase 1 also covers: grace period, safe lock and unlock with approval and reasons, rider exceptions (proposed rule),
  payouts, hub cash deposits, suppliers, write-offs, vehicle retire, logins for every role, investor and rider portals,
  an append-only audit trail, and fleet, battery, payback and route reports.
- Not built yet (later phases): real mobile money integration (the gateway is a mock), battery GPS reading, NFC, WhatsApp,
  wallet. See `docs/business-rules.md` for the open assumptions.

**Fully implemented (platform):**
- Auth: register/login/JWT+refresh rotation/2FA (TOTP + backup codes)
- Device layer: GT06 + TK103 binary/ASCII protocol parsers (with real CRC16
  and ACK framing for GT06), raw TCP listeners, protocol factory
- Position ingestion pipeline: status classification (idle/moving/stopped/
  parked), TimescaleDB storage, WebSocket broadcast, event bus for other
  modules to react to
- Geofencing: circle (haversine) + polygon/rectangle (PostGIS ST_Contains),
  schedule-aware, entry/exit/dwell detection
- Alerts: speeding + harsh-braking detection wired to the position stream,
  full acknowledge/resolve workflow
- Fuel: theft/rapid-drop/refueling detection wired to the position stream
- Trips: auto-segmentation from ignition+movement, distance/speed/fuel
  rollup via haversine route walking
- Commands: named convenience endpoints (engine/door/fuel/alarm/device),
  BullMQ queue + cron scheduler for scheduled commands
- Notifications: email/SMS/push/webhook channel implementations (webhook has
  retry+backoff)
- Reports: PDF/Excel/CSV generators
- Driver scoring + a simplified HOS tracker
- Maintenance: odometer-interval auto-scheduling
- Dashboard: real cross-module aggregate queries

**Scaffolded (real routes + DB entities, stub logic with TODOs):**
- Organizations/Vehicles: generated CRUD stubs - straightforward to fill in,
  same pattern as any other module (see `tools/generate-modules.js`)
- Alert rules (user-defined, beyond the two built-in checks) - needs an
  `alert_rules` table (see `alerts/processors/rule-engine.ts`)
- Analytics: predictive maintenance and fuel-forecast call real engines;
  driver-risk is not wired yet
- Teltonika protocol: stub only - Codec 8 parsing is substantial enough to
  warrant its own file, see the TODO in `teltonika.processor.ts`
- 2FA email verification and password-reset token storage: the auth flow
  is real but doesn't yet persist tokens to a table

**Not modeled at all:**
- Billing/Stripe integration
- Data retention/archival automation
- A real Prometheus metrics endpoint (stub returns a note)
- CI/CD pipeline, ELK/Loki log aggregation

None of this is hidden - grep for `TODO` and `NotImplementedException` across
`backend/src` to get the full list, or check each module's generated service
file (anything still throwing `NotImplementedException` hasn't been touched
since the code generator ran).

## Database

Two physical databases:
- **Main** (`vtrack`): everything except raw GPS positions. Migrations in
  `backend/src/database/migrations/`.
- **TimescaleDB** (`vtrack_ts`): just the `positions` hypertable, partitioned
  by day with a 7-day compression policy. Migrations in
  `backend/src/database/migrations-timescale/`. Kept separate because
  TimescaleDB isn't available as a managed RDS/Cloud SQL engine the way
  plain Postgres+PostGIS is - so in production these often end up on
  different infrastructure entirely.

## Extending a scaffolded module

Every "plain CRUD" module (organizations, vehicles, fuel, geofences, alerts,
notifications, trips, drivers, maintenance, reports, analytics, dashboard,
audit) was generated by `backend/tools/generate-modules.js` from a route
table. To add a new module or endpoint:

1. Add an entry to the `MODULES` array in that script (or a new module's own
   controller/service by hand, following the same pattern).
2. Run `node tools/generate-modules.js` (add `--force` to regenerate files
   that already exist - **this will overwrite any hand-written logic**, so
   only force-regenerate modules you haven't customized yet).
3. Wire a TypeORM entity + real repository calls into the generated service,
   replacing the `NotImplementedException` stubs.

## Known route-ordering gotcha

NestJS/Express matches routes in registration order. Static paths like
`GET /geofences/active` must be registered **before** `GET /geofences/:id`,
or the `:id` route shadows them. The generator now sorts routes to avoid
this automatically; if you add routes by hand, keep literal-segment paths
above param routes in the same controller.

## Deployment

- `docker-compose.yml` at the repo root: full local dev stack.
- `infrastructure/kubernetes/`: Deployment/Service/Ingress/ConfigMap for a
  real cluster. `secrets.yaml` is a template - populate via `kubectl create
  secret` or a secrets manager, never commit real values.
- `infrastructure/terraform/`: placeholder only - the doc's spec calls for
  AWS/EKS + RDS + ElastiCache; fill in resources once you've picked a cloud.
- No CI/CD pipeline is included yet.

## v2.0 upgrade

A v2.0 upgrade has been layered on top of v1 — see
[`docs/v2-architecture.md`](docs/v2-architecture.md) for the full design
(executive summary, assumptions, architecture diagram, and 22 sections
covering everything from the ingestion gateway to the migration plan).

**Implemented in this codebase** (real, compiling code — not just design):
- **Digital Twin** (`modules/twin/`): Redis-backed live vehicle state,
  replacing TimescaleDB as the hot lookup path for the live map. Snapshot
  persistence + recovery, WebSocket broadcast on every update.
- **EV Energy Management** (`modules/energy/`): EV state/charging session/
  schedule entities, a real smart-charging scheduler algorithm
  (cheapest-hours-first, respects charger power + temperature safety), and
  the full EV REST API from the spec.
- **Multi-tracker sensor fusion** (`modules/fusion/`): device roles + trust
  levels, a conflict-resolving fusion algorithm (explicit override -> role
  priority -> trust level -> recency), conflict detection + broadcast.
- **Geofence hysteresis** (`geofences/engines/geofence-hysteresis.engine.ts`):
  replaces v1's simple in-memory dwell logic with proper entry/exit
  debounce, buffer zones, accuracy filtering, and cooldown — persisted to
  Postgres so it survives restarts.
- **Command state machine + SMS wake-up fallback** (`modules/commands/`):
  full `created -> approved -> queued -> waiting_for_device -> sent ->
  delivered -> acknowledged -> executed` lifecycle with an approval
  workflow for high-risk commands and a BullMQ-driven timeout watcher that
  triggers an SMS wake-up for sleeping devices.
- **Map matching** (`modules/trips/engines/map-matching.engine.ts`): a real,
  tested (6/6 passing) nearest-segment-projection matcher with continuity
  smoothing, wired to `GET /trips/:id/snapped-route` and
  `POST /geospatial/map-match`.
- **Fleet graph** (`modules/fusion/graph/fleet-graph.engine.ts`): a real,
  tested (8/8 passing) in-memory graph engine implementing the same
  relationship queries Apache AGE's Cypher would, wired to
  `GET /vehicles/:id/asset-chain`.
- **5 new migrations** (012-016): multi-tracker tables, EV/energy tables,
  command logs + SMS logs + OBD/CAN/anomaly schema (schema-only, see below),
  trip stops/events, geofence hysteresis config.

**Built and verified as standalone components, outside the NestJS app**
(each has its own README with exact commands and verified test output):
- **`ingestion-gateway/`** — a real, compiled, running Rust TCP gateway.
  Sent it an actual GT06 binary frame over TCP from a test script and
  confirmed the parsed telemetry landed correctly in a live Redis Stream.
  Dependency-free by necessity (see its README — the sandbox's Cargo was
  too old for crates.io's current index), not by design; swap in
  `tokio`+`redis`+`rdkafka` on a real toolchain per the doc's target
  architecture.
- **`ml-service/`** — a real FastAPI service backed by an actual trained
  scikit-learn `IsolationForest`, not a mock. Verified live: a normal
  driving scenario scored 0.45 (not anomalous), a theft-like scenario
  scored 0.73 (correctly flagged, with the right explanation).

**Design-only, in `docs/v2-architecture.md`** (genuinely infeasible without
infrastructure this sandbox doesn't have — no docker, so no Kafka/Redpanda,
no Apache AGE extension build, no OSRM binary+map data): the Kafka topic
architecture and the WASM protocol parser plugin design. Both have full
skeletons/interfaces in the doc and a phased, zero-downtime migration plan
from v1's in-process ingestion to the decoupled v2 architecture.
