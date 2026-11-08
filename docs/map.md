# Live map

Open **Live Map** in the sidebar. Everything below works for the roles that may read the map (admin, fleet manager, hub manager for their own hubs, dispatcher, finance, auditor, viewer). Admin, fleet manager and dispatcher can also change zones, places, icons and destinations.

## What it does

| Area | Feature |
|---|---|
| Live tracking | Positions arrive over a websocket and are re-read from the server at a refresh rate you choose (5 s to 2 min, saved in your browser). Heading arrow, icon per vehicle type, colour by status: **green moving, amber idle, red stopped, grey offline**. |
| Clustering | Nearby vehicles join into one numbered marker; a click zooms in. Can be switched off in Layers. |
| Asset list | Search by plate, driver or hub; filter by status; click to centre and open the vehicle; **Follow** keeps it centred. |
| Popup | Speed, heading, GPS time and age, current address, driver, hub, engine and battery, geofences it is inside, destination with ETA. |
| Geofences | Draw circles, polygons and rectangles (Zones tab). Edit details or reshape. Semi-transparent, in the colour you pick. Vehicles inside a zone get a ring and the zone list shows how many are inside. |
| Mobile geofence | A circle can follow a vehicle (choose it in the form, or "Zone around it" in the popup). |
| Alerts | Entry and exit show as a toast with a sound (mute button in the Alerts tab) and a list of the last 24 hours. |
| Places | Right-click the map to add a depot, hub, customer, fuel, charging, parking or service point. |
| Layers | Street, satellite, terrain; live traffic; weather radar; plate labels; recent trails. |
| Tools | Distance measure (click points), full screen, address or coordinate search, cursor latitude/longitude, fit all vehicles. |
| Replay | Pick vehicle and period, load route: speed-coloured trail, animated marker, 1x to 64x, scrubber, stats, and every stop with duration and address (idling is marked). |
| Heatmap | Replay tab, "Heatmap (whole fleet)" for the chosen period. |
| Destination and ETA | Set a destination from a vehicle popup. ETA uses road distance from the routing service and the vehicle's own recent driving speed. |

## Settings (server environment)

| Variable | Purpose |
|---|---|
| `MAP_REFRESH_SECONDS` | Default refresh rate (30). |
| `MAP_OFFLINE_MINUTES` | Silence longer than this shows as offline (10). |
| `GEOCODER_URL` | Nominatim-compatible address service. Default is the public OpenStreetMap one. |
| `GEOCODER_COUNTRY` | Country filter for search (`gh`). |
| `GEOCODER_CONTACT` | Your email or site; sent in the User-Agent, which OpenStreetMap requires. |
| `ROUTING_URL` | OSRM server for ETA. Default is the public OSRM demo server, which is for testing only: run your own for production. If routing fails the ETA falls back to straight-line distance x 1.3 and says so. |
| `MAP_TRAFFIC_TILE_URL` | Traffic tiles (see below). |
| `MAP_TRAFFIC_ATTRIBUTION` | Credit line the provider requires. |
| `MAP_WEATHER_TILE_URL` | Optional weather tiles; default is RainViewer radar. |

## Things to know before going live

1. **Live traffic needs a provider key.** There is no free, legal, keyless live-traffic map. Until `MAP_TRAFFIC_TILE_URL` is set the Traffic switch is greyed out and says why. TomTom, HERE and Google all sell tile access; check their terms for fleet use and for caching.
2. **Weather radar** (RainViewer) is free but coarse (it stops sharpening at zoom 7), shows the last two hours only, and its terms are for personal and educational use. For a paid product use a commercial weather tile service in `MAP_WEATHER_TILE_URL`.
3. **Address search and base maps.** The public Nominatim and OpenStreetMap tile servers allow light use only (about one search per second, no bulk). The server already queues and caches searches. For many users host your own, or use a paid provider. Satellite imagery comes from Esri's public service and terrain from OpenTopoMap; both need their attribution kept (it is shown on the map).
4. **ETA** is an estimate: road distance divided by the vehicle's recent driving pace. It does not know about traffic unless the routing service does.
5. **Known gap:** the devices websocket (`joinDevice`) does not check that the device belongs to the caller's organisation. The map does not use it. Fix before exposing that gateway publicly.

## Testing with a simulated tracker

```bash
cd backend
node scripts/simulate-tracker.js --imei 860000000XXXXX --from 5.6037,-0.1870 --to 5.6300,-0.1500 --speed 30 --interval 2 --loop
```

The device must exist (Devices page) and be linked to a vehicle. `node scripts/map-e2e.js` runs the full backend check (85 tests) against a test API.

## Upgrade steps

```bash
cd backend && npm run migration:run     # adds migration 028 (places, destinations, vehicle icon, mobile geofence)
# restart the API, then hard-refresh the browser (Ctrl+Shift+R)
```

---

# Advanced map (migration 029)

Everything below is on the **Live Map** page: the side panel tabs **Dispatch, Health, Tasks, Setup**, extra layers, and more in each vehicle's popup.

## What each feature does, and what it needs

| Feature | How it works | Needs |
|---|---|---|
| **Road snapping** | Live positions of moving vehicles are shown on the nearest road (within 40 m). Replay has a "Snap the route to the road" switch (OSRM map matching). A point is only moved if the move is small, and is left alone when the heading or speed disagree with the road. Distances are recomputed on the snapped path. | `ROUTING_URL` pointing at your **own** OSRM (the public demo is not for production). Without it the raw GPS is used and replay says so. |
| **CAN / OBD readings** | Popup shows fuel, charge, RPM, coolant, motor temperature, battery voltage and fault codes. | A tracker or gateway that sends the readings (see ingestion below). |
| **Breakdown risk** | **Rule-based, not machine learning.** Score 0-100 from coolant/motor temperature, fault codes, low charge or fuel, tracker battery and overdue maintenance; the reasons are always shown. Health tab, wrench badge on the marker, and a "high-risk areas" heat layer built from where faults were reported. Vehicles far from a hub (`MAP_REMOTE_KM`, default 15) are flagged "remote": do not dispatch them there. | Vehicles sending readings. A learned model needs months of history first. |
| **Dispatch, ETA, delay risk** | Give a vehicle a destination with a deadline and customer. Every minute the server recalculates the ETA, detects leaving the route (twice more than 250 m away, then replans), arrival (80 m), congestion (pace under 60% of free flow) and "may miss its deadline". Late or at-risk jobs show up to 3 other free vehicles and a route suggestion. | `ROUTING_URL`. Switch off with `DISPATCH_WATCHER=off`. |
| **Customer messages** | Sent when the ETA moves by 10 minutes or 25%, after a reroute, and on arrival. Every attempt is stored. | `CUSTOMER_NOTIFY_WEBHOOK_URL` (a URL that receives JSON `{channel, to, message, ...}`; optional `CUSTOMER_NOTIFY_WEBHOOK_TOKEN` sent as a bearer token). Connect it to your SMS or WhatsApp provider. Until set, messages are listed as "not sent". |
| **Route options with reasoning** | Up to 3 road routes with time, distance, energy or fuel, CO2 and a plain-language "why". Choose Fastest, Balanced or Greenest. Electricity CO2 uses `GRID_CO2_KG_PER_KWH` (default 0.4). | `ROUTING_URL`. Traffic is only reflected through the vehicle's own recent pace. |
| **Vehicle groups, zone rules** | Zone rule: just notify, **restricted** (entering is a violation), **allowed area** (leaving is a violation) or **low-emission zone** (non-electric vehicles violate). A zone can be limited to groups. Violations are high-priority alerts and mark the vehicle on the map. | Set a vehicle's fuel type for LEZ rules. |
| **Bulk import** | Setup > Import geofences: CSV (`name,lat,lng,radius` or `name,polygon`) or GeoJSON, up to 1000 rows, with a "check first" dry run, duplicate-name skipping and a per-row error list. **Shapefiles are not read directly**: convert with QGIS or `ogr2ogr -f GeoJSON out.geojson in.shp`. | |
| **Zone checklists** | Tasks tab: attach a checklist to a zone (on entry or exit). The driver gets it under "My tasks" in the rider portal, ticks items, adds a photo and a note; the map updates live. Unfinished ones expire. | Drivers log in as the rider role. |
| **Moving zones** | A circle that follows a vehicle. Other vehicles inside it get an orange ring and a notice. | |
| **Video** | Per vehicle, links from your dashcam provider: live (HLS, MP4 or provider page) and a clip template with `{from}`/`{to}` filled with the last 10 seconds. **V-Track stores links only, no video.** https only. | A dashcam provider with such links. |
| **Sensor assets** | Trailers, coolers, generators: marker turns red on temperature, door or battery alarms. | A tracker posting readings (below). |
| **Charging points** | Free bays shown on the marker and popup, with the last update time. | Updated by hand or by the charger system (`PUT /api/map/pois/:id/availability`). |
| **Role-based view** | Setup > Who sees which hubs limits a person to chosen hubs: fleet, live feed, history, heatmap, tasks and dispatch. Hub managers are always limited to their own hubs. | |
| **Driver privacy** | Setup > Driver privacy hours: outside working hours the vehicle shows only "Off duty": no position, history, heatmap, live updates, readings or events. Supports shifts that cross midnight and time zones. | |

## Sending readings (CAN, sensors, assets)

Your gateway or tracker server posts JSON with the header `x-ingest-key` equal to `TELEMETRY_INGEST_KEY` (at least 16 characters; the endpoint is closed until it is set):

```bash
curl -X POST https://YOUR-HOST/api/map/ingest/telemetry \
  -H "x-ingest-key: $TELEMETRY_INGEST_KEY" -H "content-type: application/json" \
  -d '{"imei":"860000000XXXXX","latitude":5.6037,"longitude":-0.187,"speed":24,"heading":90,"ignition":true,
       "obd":{"coolant_temp":97,"rpm":2300,"soc":64,"dtc":["P0217"]},"sensors":{"temperature":4.5}}'

curl -X POST https://YOUR-HOST/api/map/ingest/assets/ASSET_ID \
  -H "x-ingest-key: $TELEMETRY_INGEST_KEY" -H "content-type: application/json" \
  -d '{"latitude":5.6,"longitude":-0.2,"temperatureC":3.5,"doorOpen":false,"batteryPct":80}'
```

Recognised reading names (several spellings each): `coolant_temp`, `rpm`, `soc`, `fuel_level`, `battery_voltage`, `motor_temp`, `dtc` (list), `temperature`, `door_open`, `humidity`.

## Environment variables (new)

| Variable | Meaning |
|---|---|
| `TELEMETRY_INGEST_KEY` | Secret for the two ingest endpoints (16+ characters). |
| `CUSTOMER_NOTIFY_WEBHOOK_URL`, `CUSTOMER_NOTIFY_WEBHOOK_TOKEN` | Where customer messages are sent. |
| `MAP_SNAP_LIVE` | `false` turns off snapping of live positions (replay snapping stays). |
| `MAP_REMOTE_KM` | Distance from a hub counted as "remote" (default 15). |
| `GRID_CO2_KG_PER_KWH` | CO2 factor for electricity (default 0.4). |
| `DISPATCH_WATCHER` | `off` stops the per-minute ETA/route/arrival check. |

## Known limits

- The **alerts** page and its socket are not filtered by hub or by privacy hours (only the map is). Do not rely on hub limits to hide alerts.
- The generic devices websocket (`joinDevice`) does not check ownership (not used by the map).
- A zone created and then limited to a group applies to every vehicle for a moment between the two steps (up to a few seconds).
- Dedicated lane-level positioning is not possible from GPS alone; snapping places a vehicle on the road centreline.

## Upgrade steps

```bash
cd backend && npm run migration:run     # adds migration 029 (groups, zone rules, checklists, delivery fields, privacy, cameras, assets)
# set TELEMETRY_INGEST_KEY (and CUSTOMER_NOTIFY_WEBHOOK_URL if you want customer messages), restart the API, hard-refresh (Ctrl+Shift+R)
```

Checks: `node scripts/map-e2e.js` (85) and `node scripts/map-adv-e2e.js` (116) against a test API; see the header of each file for how to start it.
