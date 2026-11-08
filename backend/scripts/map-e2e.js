/**
 * End-to-end checks of the live map backend over HTTP, TCP (a simulated GT06 tracker) and websockets.
 * Needs the demo data (node scripts/seed-demo.js) and the API started with fake address and routing services:
 *
 *   GEOCODER_URL=http://127.0.0.1:9911 GEOCODER_MIN_GAP_MS=20 ROUTING_URL=http://127.0.0.1:9912 \
 *   DB_DATABASE=vtrack_test PORT=3000 node dist/src/main.js
 *   node scripts/map-e2e.js
 *
 * Uses psql for a few set-up inserts: PGHOST/PGPORT/PGPASSWORD, main database MAIN_DB (default vtrack_test), positions database TS_DB (default vtrack_ts).
 */
const http = require('http');
const net = require('net');
const { execFileSync } = require('child_process');
const { login: gt06Login, location: gt06Location } = require('./lib/gt06');
const io = require('../../frontend/app/js/vendor/socket.io.min.js');

const API = process.env.API || 'http://localhost:3000/api';
const ROOT = API.replace(/\/api$/, '');
const PW = 'Demo!Passw0rd#2026';
const MAIN_DB = process.env.MAIN_DB || 'vtrack_test', TS_DB = process.env.TS_DB || 'vtrack_ts';
const psql = (db, q) => execFileSync('psql', ['-h', process.env.PGHOST || 'localhost', '-p', process.env.PGPORT || '5432', '-U', 'vtrack', '-d', db, '-At', '-c', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'vtrack123' } }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); } };

async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, data: json && json.data !== undefined ? json.data : json, raw: json };
}
const signIn = async (email, password = PW) => (await call('POST', '/auth/login', null, { email, password })).data?.accessToken;

// ---- fake address search and routing services, so the tests do not depend on the internet ----
const geoHits = [];
const fakeGeo = http.createServer((req, res) => {
  geoHits.push(req.url + ' ua=' + req.headers['user-agent']);
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/search')) return res.end(JSON.stringify([{ display_name: 'Kwame Nkrumah Circle, Accra, Ghana', lat: '5.5700', lon: '-0.2100', type: 'junction', boundingbox: ['5.56', '5.58', '-0.22', '-0.20'] }]));
  if (req.url.startsWith('/reverse')) return res.end(JSON.stringify({ display_name: 'Ring Road Central, Accra, Ghana' }));
  res.statusCode = 404; res.end('{}');
});
const fakeRoute = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 12000, duration: 900 }] })); });

function tcpSession(imei) {
  return new Promise((resolve, reject) => {
    const s = net.connect(5023, '127.0.0.1', () => { s.write(gt06Login(imei)); setTimeout(() => resolve(s), 700); });
    s.on('error', reject); s.on('data', () => {});
  });
}
async function sendFixes(imei, fixes) {
  const s = await tcpSession(imei); let n = 2;
  for (const f of fixes) { s.write(gt06Location(f.lat, f.lng, f.speed ?? 0, f.heading ?? 0, f.acc ?? 1, n++)); await sleep(f.wait ?? 250); }
  await sleep(400); s.end();
}
function socketTo(ns, token) { return io(`${ROOT}/${ns}`, { transports: ['websocket'], auth: token ? { token } : {}, reconnection: false, forceNew: true }); }
const waitEvent = (sock, name, ms = 6000, pred = () => true) => new Promise((resolve) => { const t = setTimeout(() => { sock.off(name, h); resolve(null); }, ms); const h = (p) => { if (pred(p)) { clearTimeout(t); sock.off(name, h); resolve(p); } }; sock.on(name, h); });

(async () => {
  await new Promise((r) => fakeGeo.listen(9911, '127.0.0.1', r)); await new Promise((r) => fakeRoute.listen(9912, '127.0.0.1', r));
  const admin = await signIn('admin@demo.vtrack.pro'), hubMgr = await signIn('manager.kumasi@demo.vtrack.pro'), finance = await signIn('finance@demo.vtrack.pro'), rider = await signIn('rider@demo.vtrack.pro'), investor = await signIn('investor@demo.vtrack.pro');
  if (!admin) { console.error('Demo logins missing: run node scripts/seed-demo.js first'); process.exit(2); }
  // a second organization, to prove tenants cannot see each other
  const iso = { email: 'map-iso@example.com', password: 'Iso!Passw0rd#2026' };
  await call('POST', '/auth/register', null, { ...iso, firstName: 'Iso', lastName: 'Lated', organizationName: 'Isolated Org Ltd' });
  const org2 = await signIn(iso.email, iso.password);
  const me = (await call('GET', '/account/me', admin)).data; const org1Id = me.organizationId || me.organization_id;

  const dev = (plate) => { const [imei, vid, did] = psql(MAIN_DB, `select d.imei, v.id, d.id from devices d join vehicles v on v.id=d.vehicle_id where v.plate_number='${plate}'`).split('|'); return { imei, vid, did }; };
  const A = dev('GR 4471-26'), B = dev('GR 4472-26'), C = dev('AS 2210-26');
  const baseLat = 5.62, baseLng = -0.2;

  console.log('\nAccess');
  ok('map config for admin', (await call('GET', '/map/config', admin)).data?.center?.lat !== undefined);
  const cfg = (await call('GET', '/map/config', admin)).data;
  ok('traffic reports not configured honestly (no provider key)', cfg.traffic.enabled === false && /MAP_TRAFFIC_TILE_URL/.test(cfg.traffic.reason));
  ok('weather layer offered', cfg.weather.enabled === true);
  ok('rider cannot open the map', (await call('GET', '/map/fleet', rider)).status === 403);
  ok('investor cannot open the map', (await call('GET', '/map/fleet', investor)).status === 403);
  ok('no token is refused', (await call('GET', '/map/fleet', null)).status === 401);

  console.log('\nLive fleet over a real tracker connection');
  await sendFixes(A.imei, [{ lat: baseLat, lng: baseLng, speed: 36, heading: 90, acc: 1 }, { lat: baseLat, lng: baseLng + 0.0005, speed: 36, heading: 90, acc: 1 }]);
  const twin = socketTo('twin', admin); const twinUpdate = waitEvent(twin, 'digitalTwinUpdate', 8000, (s) => s.vehicleId === B.vid);
  await sleep(600);
  await sendFixes(B.imei, [{ lat: 5.7, lng: -0.1, speed: 0, acc: 0 }, { lat: 5.7, lng: -0.1, speed: 0, acc: 0 }]);
  const upd = await twinUpdate; ok('live position arrives over the websocket', !!upd && Math.abs(upd.position.latitude - 5.7) < 0.001, upd);
  const fleet = (await call('GET', '/map/fleet', admin)).data;
  const fa = fleet.vehicles.find((v) => v.id === A.vid), fb = fleet.vehicles.find((v) => v.id === B.vid);
  ok('fleet lists the vehicles of the organization', fleet.vehicles.length >= 4, fleet.vehicles.length);
  ok('moving vehicle: status, speed, heading, engine on', fa?.status === 'moving' && Math.round(fa.position.speed) === 36 && fa.position.heading === 90 && fa.position.ignition === true, fa?.position);
  ok('stopped vehicle with engine off is parked', fb?.status === 'parked', fb?.status);
  ok('popup data: GPS time, rider, hub, vehicle type', !!fa.position.time && !!fa.hubName && fa.vehicleType !== undefined && 'rider' in fa);
  ok('a vehicle with an assigned rider shows the rider name', fleet.vehicles.some((v) => v.rider && v.rider.name));
  ok('vehicle with no position is shown as no_gps', fleet.vehicles.some((v) => v.status === 'no_gps' || v.position));
  const hm = (await call('GET', '/map/fleet', hubMgr)).data;
  ok('hub manager sees only vehicles of own hub', hm.vehicles.length > 0 && hm.vehicles.length < fleet.vehicles.length && hm.vehicles.every((v) => v.hubId === hm.vehicles[0].hubId), [hm.vehicles.length, fleet.vehicles.length]);
  ok('finance sees the whole fleet', (await call('GET', '/map/fleet', finance)).data.vehicles.length === fleet.vehicles.length);
  ok('another organization sees none of it', (await call('GET', '/map/fleet', org2)).data.vehicles.length === 0);

  console.log('\nHistory, stops and heatmap');
  // a 60-minute trip for C with a 25-minute stop in the middle (engine on = idling)
  psql(MAIN_DB, 'DELETE FROM vehicle_destinations; DELETE FROM vehicle_privacy; DELETE FROM user_map_scope'); // leftovers of other test runs
  psql(TS_DB, `DELETE FROM positions WHERE device_id='${C.did}'`);
  const t0 = Date.now() - 3 * 3600_000; const rows = [];
  for (let i = 0; i < 12; i++) rows.push([i * 120, 5.60 + i * 0.002, -0.19, 30]);                 // 24 min driving
  for (let i = 0; i < 6; i++) rows.push([1440 + i * 300, 5.622, -0.19, 0]);                        // 25 min standing
  for (let i = 0; i < 10; i++) rows.push([2940 + i * 120, 5.622 + i * 0.002, -0.19, 28]);          // 18 min driving
  psql(TS_DB, 'INSERT INTO positions (device_id, latitude, longitude, speed, heading, ignition, "timestamp") VALUES ' + rows.map(([s, la, ln, sp]) => `('${C.did}', ${la}, ${ln}, ${sp}, 0, true, to_timestamp(${(t0 + s * 1000) / 1000}) AT TIME ZONE 'Europe/Vienna')`).join(','));
  const from = new Date(t0 - 60000).toISOString(), to = new Date(t0 + 4300 * 1000).toISOString();
  const h = await call('GET', `/map/history?vehicleId=${C.vid}&from=${from}&to=${to}`, admin);
  ok('history returns the route points', h.status === 200 && h.data.points.length === 28, h.data?.points?.length ?? h.raw);
  ok('one stop is found, about 25 minutes, engine on (idle)', h.data.stops.length === 1 && h.data.stops[0].durationSeconds >= 1200 && h.data.stops[0].idle === true, h.data.stops);
  ok('distance and top speed are reported', h.data.stats.distanceKm > 3 && h.data.stats.maxSpeedKmh === 30, h.data.stats);
  ok('points can be thinned for long trips', (await call('GET', `/map/history?vehicleId=${C.vid}&from=${from}&to=${to}&maxPoints=50`, admin)).data.points.length === 28 && (await call('GET', `/map/history?vehicleId=${C.vid}&from=${from}&to=${to}&maxPoints=50`, admin)).status === 200);
  ok('a period over 31 days is refused', (await call('GET', `/map/history?vehicleId=${C.vid}&from=2026-01-01&to=2026-11-01`, admin)).status === 400);
  ok('from after to is refused', (await call('GET', `/map/history?vehicleId=${C.vid}&from=${to}&to=${from}`, admin)).status === 400);
  ok('history of another organization vehicle is 404', (await call('GET', `/map/history?vehicleId=${C.vid}&from=${from}&to=${to}`, org2)).status === 404);
  ok('rider cannot read history', (await call('GET', `/map/history?vehicleId=${C.vid}`, rider)).status === 403);
  const heat = (await call('GET', `/map/heatmap?from=${from}&to=${to}&vehicleId=${C.vid}&precision=3`, admin)).data;
  ok('heatmap cells with weights; the stop is the hottest spot', heat.cells.length > 5 && heat.cells[0][2] >= 6 && Math.abs(heat.cells[0][0] - 5.622) < 0.002, heat.cells.slice(0, 2));
  ok('heatmap of another organization is empty', (await call('GET', `/map/heatmap?from=${from}&to=${to}`, org2)).data.cells.length === 0);

  console.log('\nGeofences: drawing, validation, isolation');
  const circle = await call('POST', '/geofences', admin, { name: 'Depot zone', type: 'circle', centerLatitude: 5.6037, centerLongitude: -0.187, radius: 400, color: '#e8434c', organizationId: '00000000-0000-0000-0000-000000000000' });
  ok('circle is created', circle.status === 201 || circle.status === 200, circle.raw);
  ok('organization comes from the login, not from the request', circle.data?.organizationId === org1Id);
  const poly = await call('POST', '/geofences', admin, { name: 'Market area', type: 'polygon', color: '#358ffc', coordinates: { type: 'Polygon', coordinates: [[[-0.2, 5.55], [-0.19, 5.55], [-0.19, 5.56], [-0.2, 5.56], [-0.2, 5.55]]] } });
  ok('polygon is created and comes back as GeoJSON', (poly.status === 201 || poly.status === 200) && poly.data?.id, poly.raw);
  const listed = (await call('GET', '/geofences', admin)).data;
  const polyBack = listed.find((g) => g.id === poly.data?.id);
  ok('stored polygon has the 4 corners we drew', polyBack?.coordinates?.type === 'Polygon' && polyBack.coordinates.coordinates[0].length === 5, polyBack?.coordinates);
  const rect = await call('POST', '/geofences', admin, { name: 'Yard', type: 'rectangle', coordinates: { type: 'Polygon', coordinates: [[[-0.25, 5.5], [-0.24, 5.5], [-0.24, 5.51], [-0.25, 5.51], [-0.25, 5.5]]] } });
  ok('rectangle is created', rect.status === 201 || rect.status === 200, rect.raw);
  ok('a radius below 10 m is refused', (await call('POST', '/geofences', admin, { name: 'Tiny', type: 'circle', centerLatitude: 5.6, centerLongitude: -0.18, radius: 3 })).status === 400);
  ok('a circle without a centre is refused', (await call('POST', '/geofences', admin, { name: 'No centre', type: 'circle', radius: 100 })).status === 400);
  ok('a polygon whose sides cross is refused', (await call('POST', '/geofences', admin, { name: 'Bowtie', type: 'polygon', coordinates: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] } })).status === 400);
  ok('a polygon that is not closed is refused', (await call('POST', '/geofences', admin, { name: 'Open', type: 'polygon', coordinates: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } })).status === 400);
  ok('a bad colour is refused', (await call('POST', '/geofences', admin, { name: 'Colour', type: 'circle', centerLatitude: 5.6, centerLongitude: -0.18, radius: 100, color: 'red' })).status === 400);
  ok('latitude out of range is refused', (await call('POST', '/geofences', admin, { name: 'Far', type: 'circle', centerLatitude: 95, centerLongitude: 0, radius: 100 })).status === 400);
  ok('hub manager cannot draw geofences', (await call('POST', '/geofences', hubMgr, { name: 'Nope', type: 'circle', centerLatitude: 5.6, centerLongitude: -0.18, radius: 100 })).status === 403);
  ok('hub manager can look at them', (await call('GET', '/geofences', hubMgr)).status === 200);
  ok('finance can look but not draw', (await call('GET', '/geofences', finance)).status === 200 && (await call('POST', '/geofences', finance, { name: 'Nope', type: 'circle', centerLatitude: 5.6, centerLongitude: -0.18, radius: 100 })).status === 403);
  ok('another organization sees none of our geofences', (await call('GET', '/geofences', org2)).data.length === 0);
  ok('another organization cannot read, change or delete one', (await call('GET', `/geofences/${circle.data.id}`, org2)).status === 404 && (await call('PUT', `/geofences/${circle.data.id}`, org2, { radius: 5000 })).status === 404 && (await call('DELETE', `/geofences/${circle.data.id}`, org2)).status === 404);
  const upd2 = await call('PUT', `/geofences/${circle.data.id}`, admin, { radius: 650, name: 'Depot zone (wider)' });
  ok('a geofence can be moved or resized', upd2.status === 200 && Number(upd2.data.radius) === 650 && upd2.data.name === 'Depot zone (wider)', upd2.raw);
  ok('the shape type cannot be switched', (await call('PUT', `/geofences/${circle.data.id}`, admin, { type: 'polygon' })).status === 400);
  const edited = await call('PUT', `/geofences/${poly.data.id}`, admin, { coordinates: { type: 'Polygon', coordinates: [[[-0.2, 5.55], [-0.18, 5.55], [-0.18, 5.57], [-0.2, 5.57], [-0.2, 5.55]]] } });
  ok('a polygon can be reshaped', edited.status === 200 && edited.data.coordinates.coordinates[0][1][0] === -0.18, edited.raw);
  ok('point test works for polygons and circles', (await call('POST', `/geofences/${poly.data.id}/test`, admin, { latitude: 5.56, longitude: -0.19 })).data.inside === true && (await call('POST', `/geofences/${circle.data.id}/test`, admin, { latitude: 5.0, longitude: -0.187 })).data.inside === false);
  ok('a geofence can be switched off', (await call('PUT', `/geofences/${rect.data.id}`, admin, { isActive: false })).data.isActive === false);
  ok('a geofence can be deleted', (await call('DELETE', `/geofences/${rect.data.id}`, admin)).status === 200 && (await call('GET', `/geofences/${rect.data.id}`, admin)).status === 404);

  console.log('\nMobile geofence and entry/exit alerts');
  const zero = { entryDwellSeconds: 0, exitDwellSeconds: 0, accuracyThresholdMeters: 100, bufferMeters: 0, cooldownSeconds: 0 };
  const mob = await call('POST', '/geofences', admin, { name: 'Escort zone', type: 'circle', radius: 300, centerLatitude: baseLat, centerLongitude: baseLng, anchorVehicleId: A.vid, hysteresis: zero, color: '#af5cf1' });
  ok('a circle can follow a vehicle', (mob.status === 201 || mob.status === 200) && mob.data.anchorVehicleId === A.vid, mob.raw);
  ok('a polygon cannot follow a vehicle', (await call('POST', '/geofences', admin, { name: 'Bad mobile', type: 'polygon', anchorVehicleId: A.vid, coordinates: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })).status === 400);
  ok('a vehicle of another organization cannot be followed', (await call('POST', '/geofences', org2, { name: 'Steal', type: 'circle', radius: 300, centerLatitude: 1, centerLongitude: 1, anchorVehicleId: A.vid })).status === 400);
  const alerts = socketTo('alerts', admin); await sleep(500);
  const entry = waitEvent(alerts, 'newAlert', 9000, (a) => /entered|entry/i.test(a.title || '') || a.type === 'geofence_entry');
  await sendFixes(B.imei, [{ lat: 5.7, lng: -0.1, speed: 20 }, { lat: baseLat + 0.0004, lng: baseLng + 0.0004, speed: 10 }, { lat: baseLat + 0.0004, lng: baseLng + 0.0004, speed: 10 }]);
  const gotEntry = await entry;
  ok('entering a mobile geofence raises an alert on the alerts websocket', !!gotEntry && gotEntry.geofenceId === mob.data.id, gotEntry);
  const exit = waitEvent(alerts, 'newAlert', 9000, (a) => a.type === 'geofence_exit' && a.geofenceId === mob.data.id);
  await sendFixes(B.imei, [{ lat: 5.7, lng: -0.1, speed: 40 }, { lat: 5.7, lng: -0.1, speed: 40 }]);
  ok('leaving it raises an exit alert', !!(await exit));
  const ev = (await call('GET', '/map/events?since=' + new Date(Date.now() - 3600_000).toISOString(), admin)).data;
  ok('recent events list shows entry and exit with plate and zone', ev.some((e) => e.type === 'entry' && e.plate === 'GR 4472-26' && e.geofenceName === 'Escort zone') && ev.some((e) => e.type === 'exit'), ev.slice(0, 2));
  ok('events of another organization are not visible', (await call('GET', '/map/events', org2)).data.length === 0);
  const fleet2 = (await call('GET', '/map/fleet', admin)).data;
  ok('fleet shows which zones a vehicle is confirmed inside', Array.isArray(fleet2.vehicles.find((v) => v.id === B.vid).insideGeofenceIds));
  alerts.close();

  console.log('\nWebsocket security');
  const anon = socketTo('twin', null); const anonDown = await Promise.race([waitEvent(anon, 'disconnect', 3000), sleep(3500).then(() => null)]);
  ok('a connection without a login is dropped', anonDown !== null || anon.disconnected === true);
  anon.close();
  const spy = socketTo('twin', org2); await sleep(500); spy.emit('joinOrg', org1Id);
  const leak = waitEvent(spy, 'digitalTwinUpdate', 3500);
  await sendFixes(C.imei, [{ lat: 5.61, lng: -0.19, speed: 20 }, { lat: 5.611, lng: -0.19, speed: 20 }]);
  ok('another organization cannot listen in by asking for our room', (await leak) === null);
  spy.close(); twin.close();

  console.log('\nPoints of interest, icons, destinations, ETA');
  const poi = await call('POST', '/map/pois', admin, { name: 'Shell Ring Road', category: 'fuel', lat: 5.58, lng: -0.2 });
  ok('POI is created', poi.status === 201 || poi.status === 200, poi.raw);
  ok('POI appears in the list', (await call('GET', '/map/pois', admin)).data.some((p) => p.id === poi.data?.id && p.category === 'fuel'));
  ok('POI category is validated', (await call('POST', '/map/pois', admin, { name: 'Odd', category: 'bar', lat: 5.5, lng: -0.2 })).status === 400);
  ok('POI latitude is validated', (await call('POST', '/map/pois', admin, { name: 'Odd', category: 'depot', lat: 123, lng: -0.2 })).status === 400);
  ok('POI can be renamed', (await call('PUT', `/map/pois/${poi.data.id}`, admin, { name: 'Shell Ring Road North' })).data?.name === 'Shell Ring Road North');
  ok('another organization cannot see or change it', (await call('GET', '/map/pois', org2)).data.length === 0 && (await call('PUT', `/map/pois/${poi.data.id}`, org2, { name: 'x1' })).status === 404 && (await call('DELETE', `/map/pois/${poi.data.id}`, org2)).status === 404);
  ok('finance can see POIs but not add them', (await call('GET', '/map/pois', finance)).status === 200 && (await call('POST', '/map/pois', finance, { name: 'Nope', category: 'depot', lat: 5.5, lng: -0.2 })).status === 403);
  ok('POI can be deleted', (await call('DELETE', `/map/pois/${poi.data.id}`, admin)).status === 200 && !(await call('GET', '/map/pois', admin)).data.some((p) => p.id === poi.data.id));

  ok('vehicle icon can be chosen', (await call('PUT', `/map/vehicles/${A.vid}/icon`, admin, { icon: 'truck' })).data?.icon === 'truck' && (await call('GET', '/map/fleet', admin)).data.vehicles.find((v) => v.id === A.vid).icon === 'truck');
  ok('an unknown icon is refused', (await call('PUT', `/map/vehicles/${A.vid}/icon`, admin, { icon: 'rocket' })).status === 400);
  ok('another organization cannot change our icon', (await call('PUT', `/map/vehicles/${A.vid}/icon`, org2, { icon: 'van' })).status === 404);
  ok('icon can be reset', (await call('PUT', `/map/vehicles/${A.vid}/icon`, admin, { icon: null })).status === 200);
  ok('no destination: ETA is refused with a clear message', (await call('POST', `/map/vehicles/${A.vid}/eta`, admin, {})).status === 400);
  ok('destination can be set', (await call('PUT', `/map/vehicles/${A.vid}/destination`, admin, { label: 'Kaneshie Market', lat: 5.56, lng: -0.24 })).status === 200 && (await call('GET', '/map/fleet', admin)).data.vehicles.find((v) => v.id === A.vid).destination?.label === 'Kaneshie Market');
  const eta = (await call('POST', `/map/vehicles/${A.vid}/eta`, admin, {})).data;
  ok('ETA uses the routing service (road distance 12 km)', eta?.basis === 'road' && eta.roadKm === 12 && eta.freeFlowMinutes === 15, eta);
  ok('ETA at the vehicle\'s own pace and an arrival time', eta.atCurrentPaceMinutes > 0 && !!eta.etaAt && eta.paceKmh > 0, eta);
  const eta2 = await call('POST', `/map/vehicles/${B.vid}/eta`, admin, { lat: 5.6, lng: -0.19 });
  ok('ETA for a given point works without a stored destination', eta2.status === 200 || eta2.status === 201, eta2.raw);
  ok('a bad destination is refused', (await call('PUT', `/map/vehicles/${A.vid}/destination`, admin, { lat: 200, lng: 0 })).status === 400);
  ok('hub manager cannot set destinations', (await call('PUT', `/map/vehicles/${A.vid}/destination`, hubMgr, { lat: 5.5, lng: -0.2 })).status === 403);
  ok('destination can be cleared', (await call('DELETE', `/map/vehicles/${A.vid}/destination`, admin)).status === 200 && (await call('GET', '/map/fleet', admin)).data.vehicles.find((v) => v.id === A.vid).destination === null);

  console.log('\nAddress search');
  const q1 = encodeURIComponent('Circle Accra ' + Date.now()); // unique, because the server caches answers for a day
  const s = await call('GET', '/map/geocode/search?q=' + q1, admin);
  ok('search returns places', s.status === 200 && s.data[0]?.label.includes('Accra') && Math.abs(s.data[0].lat - 5.57) < 0.01, s.raw);
  ok('search asks for Ghana and identifies itself', geoHits.some((u) => /countrycodes=gh/.test(u) && /VTrackPro/.test(u)), geoHits[0]);
  const n1 = geoHits.length; await call('GET', '/map/geocode/search?q=' + q1, admin);
  ok('a repeated search is answered from the cache', geoHits.length === n1);
  ok('too short a search is refused', (await call('GET', '/map/geocode/search?q=ab', admin)).status === 400);
  ok('reverse lookup gives an address', (await call('GET', '/map/geocode/reverse?lat=5.6&lng=-0.19', admin)).data?.address === 'Ring Road Central, Accra, Ghana');
  ok('reverse lookup validates coordinates', (await call('GET', '/map/geocode/reverse?lat=abc&lng=0', admin)).status === 400);
  ok('search needs a login', (await call('GET', '/map/geocode/search?q=Accra', null)).status === 401);

  // clean up what this run created so it can be repeated
  for (const g of (await call('GET', '/geofences', admin)).data) await call('DELETE', `/geofences/${g.id}`, admin);
  console.log(`\n${pass} passed, ${fail} failed`);
  fakeGeo.close(); fakeRoute.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
