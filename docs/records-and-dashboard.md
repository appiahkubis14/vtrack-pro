# Dashboard analysis, editing records, search and filters

## Dashboard: "Needs attention now"
`GET /dashboard/attention` ranks what to check first. Admin, fleet manager, hub manager, dispatcher, finance and auditor can read it; hub managers and dispatchers see only their hubs. Finance-type roles also get immobilised vehicles, rider shortfalls, contract arrears, unsettled days and a 14-day collections chart.
Checked: theft, high alerts, late deliveries, silent devices (24 h), overdue maintenance, documents expiring in 30 days, weak or faulty batteries.

## Editing
Edit is on: vehicles, devices, riders, assignments (amounts), contracts, owners, hubs, catalog products. Others already had their own forms.
- A **draft** contract can change any term. A **running** contract can change only the grace period, arrears limit and notes. The vehicle on a contract never changes.
- An IMEI never changes. A retired vehicle cannot be edited.
- **Not editable on purpose:** payments, settlements, ledger entries, audit log and signed or running financial terms. They are the record of what happened; a mistake is corrected by a new, visible entry.
- Quote line items are fixed once made: make a new quote to re-price.

## Search, filter, sort
Every list with 3 or more rows has a search box, filters for status-like columns, click-to-sort headers and paging. Lists that draw their own tables use `js/vtrack-tables.js`. The catalog has its own search.

## Security changes made on the way
Vehicles, devices, catalog, quotes and leads previously did not check role or organisation on every route. They do now: other organisations' records return 404, writes need an admin/fleet/hub role (catalog, quotes and leads: admin), and update bodies only accept listed fields.

Tests: `node scripts/edit-e2e.js` (25 checks).

## Vehicle history
Open it from **Vehicles → History**, from the plate number, or from the vehicle popup on the live map (`vehicle-history.html?id=…`).
- **Period:** 7 days, 30 days, 90 days or 1 year.
- **Cards:** distance (and change vs the period before), time moving and idle, days in use, speeds, money collected (and per km), alerts, maintenance, battery swaps, locks, zone entries, checklists, odometer.
- **What stands out:** plain-language findings, most urgent first (expired insurance, serious alerts, no movement, a big drop in distance, speeding, weak battery, theft cases).
- **Charts and map:** day-by-day distance / collections / time moving, the hours of the day it is used, alerts by type, and the route driven.
- **Timeline:** trips, alerts, maintenance, riders given and returned, battery swaps, money collected, locks and unlocks, zone entries and exits, checklists, theft cases, contract steps, tracker fitted/removed and record changes. Filter by type, search, "show older".
- **Who may see it:** admin, fleet manager, hub manager (own hubs), dispatcher, finance, auditor, viewer. A vehicle in another hub or organisation returns "not found".
- **Driver privacy:** for a vehicle with privacy on, movement, trips and zone events outside working hours are left out of the totals, the route and the timeline.
- Distance is worked out from the tracker's positions. Gaps over 10 minutes (tracker off) and GPS jumps above 160 km/h are not counted as driving.
- API: `GET /vehicles/:id/history`, `/history/events`, `/history/route` (`days` or `from`/`to`, max 400 days).

Tests: `node scripts/edit-e2e.js` now has 40 checks.

## Landing page (`frontend/public/index.html`)
Sections: hero with an animated street scene (drawn vector art, a cargo tricycle and an e-bike with live tracking pins), who it is for, problems solved, a feature grid with drawn mini-interfaces, a tabbed tour of drawn app screens (the numbers are examples), how it works, business models, trust, FAQ, quote form. All artwork is inline SVG/CSS, so there are no image files to load.
- The quote form posts to `POST /public/quotes/request`. The server only accepts name, company, phone, email, city, country (2 letters), fleet size, message and product id; status and assignment fields from a visitor are ignored.
- Edit the contact details in the `CONTACT` line near the bottom of the page (WhatsApp, email, phone). They are placeholders now.
- Hardware, testimonials and FAQ sections fill from the API when it has published entries; otherwise testimonials and hardware stay hidden and a built-in FAQ shows.
- Real photos: see `public/img/photos/README.txt`.

## Stress-test seed (`backend/scripts/seed-stress.js`)

Fills a brand-new organization with a large, realistic Ghana data set so you can stress test every screen and replay vehicle history on the map.

What it creates (about one minute): 20 hubs in 20 towns (+40 charge points), 20 suppliers, 20 vehicle models, 20 consignments (about 70 vehicles received, the rest still in transit), 20 owners, 60 contracts with payments, 40 riders and rider assignments, 24 team users (hub managers, finance, dispatchers, auditor, fleet manager) plus 4 investors, 60 batteries with fits, swaps and charge events, 10 days of collections with settlements, payouts, 20 lock requests and 20 exceptions, 20 products, 25 leads, 26 geofences, 80 map points, 40 maintenance jobs, and a tracker on 60 vehicles with 14 days of GPS tracks (about 170,000 positions, 2,400 trips, geofence entries/exits and alerts). Some trackers are offline, some bikes barely move, a few ride at night, and about 40 are moving "right now" so the live map has activity.

Run (API running, from `backend/`):

```
THROTTLE_LIMIT=1000000 node dist/src/main.js        # start the API once with the rate limit lifted (default is 100 requests/min)
node scripts/seed-stress.js                         # new random organization each run
RUN=big1 DAYS=30 TRACKED=70 node scripts/seed-stress.js
```

It reads DB_* and TS_* from `.env` (TS_* is the positions database). The login is printed at the end: `admin@stress<RUN>.vtrack.pro` / `Demo!Passw0rd#2026`. Re-running with the same `RUN` tops up the same organization; a different `RUN` makes a separate one. Failed calls are counted and printed, never fatal.

Business records go through the real API, so the same rules apply as for users. GPS rows, trackers, alerts, leads and maintenance are written to the database directly because there is no public API for them (the generic maintenance and trips modules are still stubs that answer 501).
