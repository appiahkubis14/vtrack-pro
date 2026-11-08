# V-Track Pro Frontend

Real, fully-integrated pages — no mock data, no placeholders. Every page
calls the actual backend API and renders what comes back.

## Pages

- `login.html` — real auth against `POST /api/auth/login`, stores the JWT, supports 2FA
- `dashboard.html` — live KPIs, recent alerts (with working acknowledge), vehicle quick list
- `vehicles.html` — full list + working "Add Vehicle" form (`POST /api/vehicles`) + delete
- `devices.html` — device list with live status, quick-command buttons (`POST /api/devices/:id/command`)
- `alerts.html` — full list with working acknowledge/resolve actions and a filter toggle
- `live-map.html` — Leaflet map with **real** Socket.IO push updates (not polling) — see below

## Business pages

`hubs.html`, `consignments.html`, `owners.html`, `contracts.html`, `riders.html`, `batteries.html`, `settlements.html`
and `reports.html` cover the business layer. They share `js/vtrack-biz.js` (escaping, GHS formatting, modal forms) and
are listed under the **Business** menu. Bootstrap is served from `js/vendor/` so the pages do not depend on a CDN.
`scripts/ui-smoke.js` in the backend drives all of them in a real browser.

## Layout

This template pack (Evohus) doesn't ship a horizontal-only nav variant —
every stock page uses a sidebar+topbar combo. The horizontal top bar here
(`js/vtrack-nav.js`) is built from the template's own navbar/dropdown/badge
CSS classes, not a hidden variant that was found.

**Also worth knowing:** every stock template page's own JS entry point
(`index.js`, `dashboard-analytics.js`, etc.) references a broken absolute
URL pointing at the vendor's live demo server, with a literal Windows
backslash in the path (`assets/js/src\dashboard-analytics.js`) — meaning
dropdowns/toggles don't actually work on the original template pages when
run locally/offline. These new pages use the standard Bootstrap 5 JS bundle
from cdnjs instead, which is guaranteed to work with the same CSS classes.

## Run it

```bash
cd frontend
python3 -m http.server 8080
# or: npx serve -l 8080
```

Open `http://localhost:8080/app/login.html`. Backend must be running on
`http://localhost:3000` (the default `VTRACK_API_BASE_URL` in
`app/js/vtrack-api.js`) with `CORS_ORIGIN=http://localhost:8080` in its
`.env` (already the default).

## What "real" means here, specifically

Every endpoint these pages call was verified against a live backend
instance during development — not just written and hoped to work:

- Logged in for real, got a real JWT
- Created/listed/deleted a real vehicle through the actual form
- Sent a real GT06 binary frame over TCP, watched it flow through
  ingestion → the digital twin → a live WebSocket push to a real Socket.IO
  client with correct GPS coordinates
- Confirmed every response shape by hand (some are inconsistent - `/devices`
  returns a `[rows, count]` tuple while `/vehicles` returns
  `{ data, total, page, limit }` - `vtrack-api.js` documents this per
  endpoint rather than assuming one shape everywhere)

## Bugs this work found and fixed in the backend

Building real integration surfaced real backend bugs that a stub/mock
frontend would never have caught:

1. **`VehiclesService`/`OrganizationsService` were unimplemented stubs**
   (`NotImplementedException` on every call) — now fully implemented.
2. **GT06 login packets were parsed but never actually associated with a
   device** — every position from a real device would have been silently
   dropped forever. Fixed: login packets now decode the BCD terminal ID and
   resolve it against `devices.imei` (trying a couple of real-world BCD
   padding conventions), and the resolved device UUID is cached so
   `raw_device_data` inserts don't crash trying to put an IMEI string into
   a UUID column (which was *also* silently eating every device ACK).
3. **`DigitalTwinGateway` broadcast to Socket.IO rooms that no client
   could ever join** — added the missing `joinOrg`/`leaveOrg` handlers.
   Without this, `live-map.html`'s real-time updates would never arrive.
4. **Cross-tenant data leaks** in `AlertsController`, `DevicesController`,
   `DashboardController`, and both twin controllers — several endpoints
   either didn't scope by organization at all, or trusted a
   client-supplied `?organizationId=` query param instead of deriving it
   from the JWT (meaning any authenticated user could view another
   organization's alerts/devices/dashboard by just changing a query
   string). All fixed to derive org scope from the authenticated JWT.

None of this was found by inspection — it surfaced because the frontend
was built against a live backend and every response was actually checked.
