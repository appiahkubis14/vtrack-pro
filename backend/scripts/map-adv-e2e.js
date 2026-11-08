/**
 * End-to-end checks of the advanced map: road snapping, sensor/CAN data and risk, vehicle groups and zone rules, bulk import, zone
 * checklists, driver privacy, per-user map scope, dispatch (ETA, off-route, arrival, customer notification, delay risk), route advice,
 * camera links, charging points and sensor assets. Needs demo data and an API started with:
 *
 *   GEOCODER_URL=http://127.0.0.1:9911 ROUTING_URL=http://127.0.0.1:9912 CUSTOMER_NOTIFY_WEBHOOK_URL=http://127.0.0.1:9913/notify \
 *   TELEMETRY_INGEST_KEY=test-ingest-key-0123456789 DB_DATABASE=vtrack_test PORT=3000 node dist/src/main.js
 *   node scripts/map-adv-e2e.js
 */
const http = require('http');
const { execFileSync } = require('child_process');
const io = require('../../frontend/app/js/vendor/socket.io.min.js');

const API = process.env.API || 'http://localhost:3000/api';
const ROOT = API.replace(/\/api$/, '');
const PW = 'Demo!Passw0rd#2026', KEY = process.env.TELEMETRY_INGEST_KEY || 'test-ingest-key-0123456789';
const MAIN_DB = process.env.MAIN_DB || 'vtrack_test', TS_DB = process.env.TS_DB || 'vtrack_ts';
const psql = (db, q) => execFileSync('psql', ['-h', process.env.PGHOST || 'localhost', '-p', process.env.PGPORT || '5432', '-U', 'vtrack', '-d', db, '-At', '-c', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'vtrack123' } }).toString().trim();
const ZERO = { entryDwellSeconds: 0, exitDwellSeconds: 0, accuracyThresholdMeters: 100, bufferMeters: 0, cooldownSeconds: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : '')); } };
const section = (s) => console.log('\n' + s);

async function call(method, path, token, body, headers = {}) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, data: json && json.data !== undefined ? json.data : json, raw: json };
}
const signIn = async (email, password = PW) => (await call('POST', '/auth/login', null, { email, password })).data?.accessToken;
const ingest = (imei, o) => call('POST', '/map/ingest/telemetry', null, { imei, timestamp: new Date().toISOString(), ...o }, { 'x-ingest-key': KEY });
const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); };

// ---- fake routing service (route with alternatives, match, nearest) and fake customer-notification webhook ----
const hooks = [];
const fakeRoute = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  const u = new URL(req.url, 'http://x'); const parts = u.pathname.split('/');
  if (parts[1] === 'route') {
    const [a, b] = parts[4].split(';').map((p) => p.split(',').map(Number)); const d = hav(a[1], a[0], b[1], b[0]);
    const mk = (f, sp, bend) => ({ distance: d * f, duration: (d * f) / sp, geometry: { type: 'LineString', coordinates: [a, [(a[0] + b[0]) / 2 + bend, (a[1] + b[1]) / 2], b] } });
    return res.end(JSON.stringify({ code: 'Ok', routes: u.searchParams.get('alternatives') === 'true' ? [mk(1.2, 8, 0), mk(1.0, 6.5, 0.004)] : [mk(1.2, 8, 0)] }));
  }
  if (parts[1] === 'match') {
    const pts = parts[4].split(';').map((p) => p.split(',').map(Number));
    return res.end(JSON.stringify({ code: 'Ok', matchings: [], tracepoints: pts.map((p, i) => (i === 3 ? null : { location: [p[0], p[1] + 0.00003], matchings_index: 0, waypoint_index: i })) }));
  }
  if (parts[1] === 'nearest') { const [lng, lat] = parts[4].split(',').map(Number); return res.end(JSON.stringify({ code: 'Ok', waypoints: [{ location: [lng, lat + 0.00002], distance: 2.2 }] })); }
  res.statusCode = 404; res.end('{}');
});
const fakeHook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { hooks.push(JSON.parse(b)); } catch { /* ignore */ } res.end('{}'); }); });

(async () => {
  await new Promise((r) => fakeRoute.listen(9912, '127.0.0.1', r)); await new Promise((r) => fakeHook.listen(9913, '127.0.0.1', r));
  const admin = await signIn('admin@demo.vtrack.pro'), finance = await signIn('finance@demo.vtrack.pro'), rider = await signIn('rider@demo.vtrack.pro'), hubMgr = await signIn('manager.kumasi@demo.vtrack.pro');
  if (!admin) { console.error('Demo logins missing: run node scripts/seed-demo.js first'); process.exit(2); }
  const iso = { email: 'adv-iso@example.com', password: 'Iso!Passw0rd#2026' };
  await call('POST', '/auth/register', null, { ...iso, firstName: 'Iso', lastName: 'Lated', organizationName: 'Isolated Org Two' });
  const org2 = await signIn(iso.email, iso.password);
  const dev = (plate) => { const [imei, vid, did, hub] = psql(MAIN_DB, `select d.imei, v.id, d.id, coalesce(v.hub_id::text,'') from devices d join vehicles v on v.id=d.vehicle_id where v.plate_number='${plate}'`).split('|'); return { imei, vid, did, hub }; };
  const A = dev('GR 4471-26'), B = dev('GR 4472-26'), C = dev('AS 2210-26'), D = dev('AS 2211-26');
  for (const q of ["delete from task_runs", "delete from geofence_tasks", "delete from geofence_groups", "delete from vehicle_group_members", "delete from vehicle_groups", "delete from alerts where geofence_id in (select id from geofences where name in ('No-go quarry','City LEZ','Customer site K','Shop One','Shop Two','Yard East','Depot Pin'))", "delete from geofence_events where geofence_id in (select id from geofences where name in ('No-go quarry','City LEZ','Customer site K','Shop One','Shop Two','Yard East','Depot Pin'))", "delete from geofence_device_states where geofence_id in (select id from geofences where name in ('No-go quarry','City LEZ','Customer site K','Shop One','Shop Two','Yard East','Depot Pin'))", "delete from geofences where name in ('No-go quarry','City LEZ','Customer site K','Shop One','Shop Two','Yard East','Depot Pin')", "delete from map_assets", "delete from vehicle_cameras", "delete from pois where name='Test charging bay'"]) psql(MAIN_DB, q);
  psql(MAIN_DB, `delete from vehicle_destinations; delete from vehicle_privacy; delete from user_map_scope; update vehicles set fuel_type=NULL where plate_number in ('GR 4471-26','GR 4472-26','AS 2210-26','AS 2211-26')`);
  const fresh = async (imei, lat, lng, o = {}) => { for (let i = 0; i < 3; i++) { await ingest(imei, { latitude: lat, longitude: lng, speed: 0, heading: 0, ignition: true, ...o }); await sleep(450); } };

  section('Access and roles');
  ok('groups need a login', (await call('GET', '/map/groups', null)).status === 401);
  ok('rider cannot list groups', (await call('GET', '/map/groups', rider)).status === 403);
  ok('finance can read groups but not create one', (await call('GET', '/map/groups', finance)).status === 200 && (await call('POST', '/map/groups', finance, { name: 'Nope' })).status === 403);
  ok('risk, dispatch and assets need a login', (await call('GET', '/map/risk', null)).status === 401 && (await call('GET', '/map/dispatch', null)).status === 401 && (await call('GET', '/map/assets', null)).status === 401);

  section('Telemetry ingestion (CAN / OBD / sensors)');
  const bad = (b, h = { 'x-ingest-key': KEY }) => call('POST', '/map/ingest/telemetry', null, b, h);
  ok('no key is refused', (await bad({ imei: A.imei }, {})).status === 401);
  ok('wrong key is refused', (await bad({ imei: A.imei }, { 'x-ingest-key': 'x'.repeat(30) })).status === 401);
  ok('missing imei is refused', (await bad({ latitude: 5, longitude: 0 })).status === 400);
  ok('latitude out of range is refused', (await bad({ imei: A.imei, latitude: 95, longitude: 0 })).status === 400);
  ok('future timestamp is refused', (await bad({ imei: A.imei, latitude: 5, longitude: 0, timestamp: new Date(Date.now() + 3600e3).toISOString() })).status === 400);
  ok('odd key in obd is refused', (await bad({ imei: A.imei, latitude: 5, longitude: 0, obd: { 'a;b': 1 } })).status === 400);
  ok('nested value in obd is refused', (await bad({ imei: A.imei, latitude: 5, longitude: 0, obd: { a: { b: 1 } } })).status === 400);
  ok('unknown device is refused', (await bad({ imei: '999999999999999', latitude: 5, longitude: 0 })).status === 400);
  const good = await ingest(A.imei, { latitude: 5.9, longitude: -0.4, speed: 22, heading: 40, ignition: true, obd: { coolant_temp: 112, dtc: ['P0217', 'P0300'], SOC: 8, junk: 'x' }, sensors: { temperature: 41 } });
  ok('valid telemetry is accepted', good.status === 201 || good.status === 200, good.raw);
  await sleep(500);
  const fleet = (await call('GET', '/map/fleet', admin)).data;
  const fa = fleet.vehicles.find((v) => v.id === A.vid);
  ok('fleet shows tidy telemetry (coolant, charge, fault codes)', fa?.telemetry?.coolantTemp === 112 && fa.telemetry.soc === 8 && fa.telemetry.dtc.length === 2 && fa.telemetry.junk === undefined, fa?.telemetry);
  ok('fleet marks the vehicle high risk with reasons', fa?.risk?.level === 'high' && fa.risk.reasons.length >= 3, fa?.risk);
  const risk = (await call('GET', '/map/risk', admin)).data;
  const ra = risk.vehicles.find((v) => v.vehicleId === A.vid);
  ok('risk list has the vehicle with advice', !!ra && ra.level === 'high' && /service|dispatch/i.test(ra.advice), ra);
  const ar = (await call('GET', '/map/risk/areas?days=1', admin)).data;
  ok('risk areas show where the faults were recorded', ar.cells.some((c) => Math.abs(c[0] - 5.9) < 0.01 && Math.abs(c[1] + 0.4) < 0.01), ar);
  ok('another organization sees no risk', (await call('GET', '/map/risk', org2)).data.vehicles.length === 0);

  section('Road snapping (map matching)');
  psql(TS_DB, `DELETE FROM positions WHERE device_id='${C.did}'`);
  const t0 = Date.now() - 2 * 3600_000; const rows = [];
  for (let i = 0; i < 12; i++) rows.push([i * 120, 5.60 + i * 0.002, -0.19, 30, 0]);
  for (let i = 0; i < 6; i++) rows.push([1440 + i * 300, 5.622, -0.19, 0, 0]);
  psql(TS_DB, 'INSERT INTO positions (device_id, latitude, longitude, speed, heading, ignition, "timestamp") VALUES ' + rows.map(([s, la, ln, sp, h]) => `('${C.did}', ${la}, ${ln}, ${sp}, ${h}, true, to_timestamp(${(t0 + s * 1000) / 1000}) AT TIME ZONE 'Europe/Vienna')`).join(','));
  const q = `vehicleId=${C.vid}&from=${new Date(t0 - 60000).toISOString()}&to=${new Date(t0 + 3600e3).toISOString()}`;
  const raw = (await call('GET', `/map/history?${q}`, admin)).data;
  const mt = (await call('GET', `/map/history?${q}&match=true`, admin)).data;
  ok('raw history has no matching block', raw.matching === null);
  ok('matched history reports the method and share', mt.matching?.method === 'osrm' && mt.matching.snappedShare > 0.5, mt.matching);
  const p0 = mt.points[0];
  ok('points are moved onto the road and the raw position is kept', p0.snapped === true && p0.rawLat !== undefined && p0.lat !== p0.rawLat && hav(p0.lat, p0.lng, p0.rawLat, p0.rawLng) < 10, p0);
  ok('a point the matcher could not place stays where it was', mt.points.some((p) => p.snapped === false && p.lat === p.rawLat));
  ok('distance and stops are still reported', mt.stats.distanceKm > 1 && Array.isArray(mt.stops) && mt.stops.length >= 1, mt.stats);

  section('Vehicle groups and zone rules');
  const g1 = (await call('POST', '/map/groups', admin, { name: 'Escort fleet', color: '#ff8800' })).data;
  ok('admin creates a group', !!g1?.id);
  ok('duplicate group name is refused', (await call('POST', '/map/groups', admin, { name: 'Escort fleet' })).status === 400);
  ok('members are set', (await call('PUT', `/map/groups/${g1.id}/members`, admin, { vehicleIds: [B.vid] })).status === 200);
  ok('another organization\'s vehicle cannot be added', (await call('PUT', `/map/groups/${g1.id}/members`, org2, { vehicleIds: [B.vid] })).status >= 400);
  const grp = (await call('GET', '/map/groups', admin)).data.find((g) => g.id === g1.id);
  ok('group lists its members', grp.vehicleIds.length === 1 && grp.vehicleIds[0] === B.vid);
  const zl = { lat: 5.70, lng: -0.10 };
  const zone = (await call('POST', '/geofences', admin, { name: 'No-go quarry', type: 'circle', centerLatitude: zl.lat, centerLongitude: zl.lng, radius: 400, rule: 'restricted', hysteresis: ZERO })).data;
  ok('restricted zone is created', zone?.rule === 'restricted', zone);
  ok('bad rule is refused', (await call('POST', '/geofences', admin, { name: 'Bad rule', type: 'circle', centerLatitude: 5, centerLongitude: 0, radius: 100, rule: 'wild' })).status === 400);
  ok('zone is limited to the group', (await call('PUT', `/map/geofences/${zone.id}/groups`, admin, { groupIds: [g1.id] })).status === 200);
  await fresh(A.imei, zl.lat, zl.lng);        // A is not in the group
  await fresh(B.imei, 5.50, -0.30); await fresh(B.imei, zl.lat, zl.lng); // B is
  await sleep(800);
  const ev = (vid) => Number(psql(MAIN_DB, `select count(*) from geofence_events where geofence_id='${zone.id}' and vehicle_id='${vid}'`));
  ok('a vehicle outside the group is ignored by the zone', ev(A.vid) === 0, ev(A.vid));
  ok('a vehicle in the group entering is recorded', ev(B.vid) >= 1, ev(B.vid));
  const al = psql(MAIN_DB, `select severity || '|' || title from alerts where geofence_id='${zone.id}' order by created_at desc limit 1`);
  ok('entering a restricted zone raises a high VIOLATION alert', /^high\|VIOLATION/.test(al), al);

  section('Bulk geofence import');
  const csv = 'name,lat,lng,radius,color\nShop One,5.61,-0.21,120,#00aa00\nShop Two,5.62,-0.22,90,\nBroken,abc,1,50,\nShop One,5.63,-0.23,50,\n';
  const dry = (await call('POST', '/map/geofences/import', admin, { format: 'csv', content: csv, dryRun: true })).data;
  ok('dry run reports without creating', dry.dryRun === true && dry.valid === 2 && dry.failed === 1 && dry.skipped === 1 && Number(psql(MAIN_DB, "select count(*) from geofences where name='Shop Two'")) === 0, dry);
  const imp = (await call('POST', '/map/geofences/import', admin, { format: 'csv', content: csv, rule: 'notify', groupIds: [g1.id] })).data;
  ok('import creates the valid rows and reports the others', imp.created === 2 && imp.failed === 1 && imp.skipped === 1, imp);
  ok('imported zones are limited to the chosen group', Number(psql(MAIN_DB, `select count(*) from geofence_groups gg join geofences g on g.id=gg.geofence_id where g.name in ('Shop One','Shop Two') and gg.group_id='${g1.id}'`)) === 2);
  const gj = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Yard East' }, geometry: { type: 'Polygon', coordinates: [[[-0.30, 5.50], [-0.29, 5.50], [-0.29, 5.51], [-0.30, 5.51], [-0.30, 5.50]]] } }, { type: 'Feature', properties: { name: 'Depot Pin', radius: 75 }, geometry: { type: 'Point', coordinates: [-0.31, 5.52] } }, { type: 'Feature', properties: { name: 'Line' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] };
  const imp2 = (await call('POST', '/map/geofences/import', admin, { format: 'geojson', content: JSON.stringify(gj) })).data;
  ok('GeoJSON polygons and points import, lines are reported', imp2.created === 2 && imp2.failed === 1, imp2);
  ok('shapefile is not accepted, with a hint', (await call('POST', '/map/geofences/import', admin, { format: 'shp', content: 'x' })).status === 400);
  ok('finance cannot import', (await call('POST', '/map/geofences/import', finance, { format: 'csv', content: csv })).status === 403);
  ok('zones can be listed with their rule', (await call('GET', '/geofences', admin)).data.some((g) => g.name === 'No-go quarry' && g.rule === 'restricted'));

  section('Low-emission zone');
  psql(MAIN_DB, `update vehicles set fuel_type='petrol' where id='${D.vid}'`);
  const lez = (await call('POST', '/geofences', admin, { name: 'City LEZ', type: 'circle', centerLatitude: 5.80, centerLongitude: -0.20, radius: 500, rule: 'lez', hysteresis: ZERO })).data;
  await fresh(D.imei, 5.7, -0.4); await fresh(D.imei, 5.80, -0.20); await sleep(600);
  const lezAl = psql(MAIN_DB, `select severity from alerts where geofence_id='${lez.id}' order by created_at desc limit 1`);
  ok('a petrol vehicle entering the LEZ is a violation', lezAl === 'high', lezAl);
  await fresh(C.imei, 5.7, -0.4); await fresh(C.imei, 5.80, -0.20); await sleep(600);
  ok('an electric vehicle entering it is not', psql(MAIN_DB, `select count(*) from alerts where geofence_id='${lez.id}' and severity='high'`) === '1');

  section('Zone checklists');
  // the demo rider's own vehicle
  const riderVeh = psql(MAIN_DB, `select v.plate_number from rider_assignments a join riders r on r.id=a.rider_id join users u on u.id=r.user_id join vehicles v on v.id=a.vehicle_id where u.email='rider@demo.vtrack.pro' and a.status='active' limit 1`);
  ok('demo rider has an assigned vehicle', !!riderVeh, riderVeh);
  const R = dev(riderVeh);
  const chkZone = (await call('POST', '/geofences', admin, { name: 'Customer site K', type: 'circle', centerLatitude: 5.45, centerLongitude: -0.25, radius: 200, hysteresis: ZERO })).data;
  ok('rider cannot create checklists', (await call('POST', '/map/tasks/definitions', rider, { geofenceId: chkZone.id, title: 'x', items: ['a'] })).status === 403);
  ok('checklist needs items', (await call('POST', '/map/tasks/definitions', admin, { geofenceId: chkZone.id, title: 'Unload', items: [] })).status === 400);
  const def = (await call('POST', '/map/tasks/definitions', admin, { geofenceId: chkZone.id, title: 'Confirm unloading', trigger: 'entry', expiresMinutes: 60, items: [{ text: 'Unloading is complete' }, { text: 'Photograph the delivery', requirePhoto: true }] })).data;
  ok('checklist is created', !!def?.id);
  await fresh(R.imei, 5.40, -0.30); await fresh(R.imei, 5.45, -0.25); await sleep(800);
  const pending = (await call('GET', '/map/tasks?status=pending', admin)).data;
  const run = pending.find((t) => t.vehicleId === R.vid && t.title === 'Confirm unloading');
  ok('entering the zone creates a checklist for that vehicle', !!run && run.items.length === 2, pending);
  const mine = (await call('GET', '/map/my-tasks', rider)).data;
  ok('the rider sees it in the portal feed', Array.isArray(mine) && mine.some((t) => t.id === run.id), mine);
  ok('staff cannot use the rider feed', (await call('GET', '/map/my-tasks', admin)).status === 403);
  const ids = run.items.map((i) => i.id);
  ok('unticked items are refused', (await call('POST', `/map/task-runs/${run.id}/complete`, rider, { answers: { [ids[0]]: true } })).status === 400);
  ok('required photo is enforced', (await call('POST', `/map/task-runs/${run.id}/complete`, rider, { answers: { [ids[0]]: true, [ids[1]]: true } })).status === 400);
  ok('a bad photo is refused', (await call('POST', `/map/task-runs/${run.id}/complete`, rider, { answers: { [ids[0]]: true, [ids[1]]: true }, photo: 'data:text/html;base64,PGI+' })).status === 400);
  ok('another organization cannot complete it', (await call('POST', `/map/task-runs/${run.id}/complete`, org2, { answers: {} })).status >= 400);
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const sock = io(`${ROOT}/alerts`, { transports: ['websocket'], auth: { token: admin }, reconnection: false, forceNew: true });
  const pushed = new Promise((resolve) => { const t = setTimeout(() => resolve(null), 5000); sock.on('taskUpdate', (p) => { if (p.kind === 'completed') { clearTimeout(t); resolve(p); } }); });
  await sleep(500);
  const done = await call('POST', `/map/task-runs/${run.id}/complete`, rider, { answers: { [ids[0]]: true, [ids[1]]: true }, photo: px, note: 'Left with the guard' });
  ok('the rider completes it', done.status === 201 || done.status === 200, done.raw);
  ok('the map is told immediately over the socket', !!(await pushed));
  sock.close();
  ok('completing twice is refused', (await call('POST', `/map/task-runs/${run.id}/complete`, rider, { answers: { [ids[0]]: true, [ids[1]]: true }, photo: px })).status === 400);
  const comp = (await call('GET', '/map/tasks?status=completed', admin)).data.find((t) => t.id === run.id);
  ok('staff see the result with the note and photo flag', comp?.note === 'Left with the guard' && comp.hasPhoto === true, comp);
  ok('the photo can be opened by staff', !!(await call('GET', `/map/tasks/${run.id}/photo`, admin)).data?.photo);

  section('Driver privacy');
  await fresh(B.imei, 5.55, -0.25, { speed: 15 });
  ok('visible before privacy is switched on', (await call('GET', '/map/fleet', admin)).data.vehicles.find((v) => v.id === B.vid).position !== null);
  ok('finance cannot set privacy hours', (await call('PUT', `/map/vehicles/${B.vid}/privacy`, finance, { start: '00:00', end: '00:01' })).status === 403);
  ok('bad time zone is refused', (await call('PUT', `/map/vehicles/${B.vid}/privacy`, admin, { timezone: 'Mars/Base' })).status === 400);
  ok('privacy is set with hours that exclude now', (await call('PUT', `/map/vehicles/${B.vid}/privacy`, admin, { timezone: 'Africa/Accra', workDays: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '00:01' })).status === 200);
  const fb = (await call('GET', '/map/fleet', admin)).data.vehicles.find((v) => v.id === B.vid);
  ok('off duty: no position, status off_duty, no telemetry', fb.position === null && fb.status === 'off_duty' && fb.offDuty === true && fb.telemetry === null, fb);
  const hp = (await call('GET', `/map/history?vehicleId=${B.vid}&from=${new Date(Date.now() - 3600e3).toISOString()}&to=${new Date().toISOString()}`, admin)).data;
  ok('history shows nothing outside working hours', hp.points.length === 0 && hp.privacy?.hiddenPoints >= 1, hp.privacy);
  const hm = (await call('GET', `/map/heatmap?vehicleId=${B.vid}&from=${new Date(Date.now() - 3600e3).toISOString()}&to=${new Date().toISOString()}`, admin)).data;
  ok('heatmap shows nothing for it', hm.cells.length === 0, hm);
  const tw = (await call('GET', `/twin/fleet?vehicleIds=${B.vid}`, admin)).data;
  ok('the live-state endpoint hides it too', tw[B.vid] === null || tw[B.vid] === undefined, tw);
  const sA = io(`${ROOT}/twin`, { transports: ['websocket'], auth: { token: admin }, reconnection: false, forceNew: true });
  let got = null; sA.on('digitalTwinUpdate', (s) => { if (s.vehicleId === B.vid) got = s; });
  await sleep(700); await ingest(B.imei, { latitude: 5.56, longitude: -0.25, speed: 12, heading: 0, ignition: true }); await sleep(1500);
  ok('no live updates leave the server while off duty', got === null, got);
  const sB2 = []; sA.on('digitalTwinUpdate', (s) => sB2.push(s.vehicleId)); await ingest(C.imei, { latitude: 5.57, longitude: -0.25, speed: 12, heading: 0, ignition: true }); await sleep(1500);
  ok('other vehicles still update', sB2.includes(C.vid), sB2);
  sA.close();
  await call('DELETE', `/map/vehicles/${B.vid}/privacy`, admin);
  ok('removing privacy shows it again', (await call('GET', '/map/fleet', admin)).data.vehicles.find((v) => v.id === B.vid).position !== null);

  section('Who sees which hubs');
  const financeId = (await call('GET', '/account/me', finance)).data.id;
  const hubOf = (v) => v.hub;
  const allVeh = (await call('GET', '/map/fleet', finance)).data.vehicles;
  const hubs = [...new Set(allVeh.map((v) => v.hubId).filter(Boolean))];
  ok('demo data has vehicles in at least two hubs', hubs.length >= 2, hubs);
  ok('only admins set scope', (await call('PUT', `/map/scope/users/${financeId}`, finance, { hubIds: [hubs[0]] })).status === 403);
  ok('scope rejects unknown hubs', (await call('PUT', `/map/scope/users/${financeId}`, admin, { hubIds: ['00000000-0000-0000-0000-000000000000'] })).status === 400);
  ok('scope is set', (await call('PUT', `/map/scope/users/${financeId}`, admin, { hubIds: [hubs[0]] })).status === 200);
  const fv = (await call('GET', '/map/fleet', finance)).data.vehicles;
  ok('the user now sees only that hub', fv.length > 0 && fv.every((v) => v.hubId === hubs[0]) && fv.length < allVeh.length, [fv.length, allVeh.length]);
  const inHub = allVeh.find((v) => v.hubId === hubs[0] && v.position), outHub = allVeh.find((v) => v.hubId !== hubs[0] && v.position);
  const imeiOf = (vid) => psql(MAIN_DB, `select imei from devices where vehicle_id='${vid}' limit 1`);
  const sF = io(`${ROOT}/twin`, { transports: ['websocket'], auth: { token: finance }, reconnection: false, forceNew: true });
  const seen = []; sF.on('digitalTwinUpdate', (s) => seen.push(s.vehicleId)); await sleep(800);
  await ingest(imeiOf(outHub.id), { latitude: 5.58, longitude: -0.26, speed: 10, heading: 0, ignition: true }); await ingest(imeiOf(inHub.id), { latitude: 5.58, longitude: -0.27, speed: 10, heading: 0, ignition: true }); await sleep(1500);
  ok('live updates reach the user only for their hub', seen.includes(inHub.id) && !seen.includes(outHub.id), seen);
  ok('the live-state endpoint is scoped too', ((await call('GET', `/twin/fleet?vehicleIds=${outHub.id}`, finance)).data || {})[outHub.id] == null);
  ok('history of an outside vehicle is refused', (await call('GET', `/map/history?vehicleId=${outHub.id}`, finance)).status === 404);
  sF.close();
  await call('PUT', `/map/scope/users/${financeId}`, admin, { hubIds: [] });
  ok('clearing the scope restores the full view', (await call('GET', '/map/fleet', finance)).data.vehicles.length === allVeh.length);
  ok('hub manager still sees only own hub', (await call('GET', '/map/fleet', hubMgr)).data.vehicles.length < allVeh.length);

  section('Dispatch: ETA, off-route, arrival, customer notification, delay risk');
  await fresh(A.imei, 5.600, -0.200, { speed: 25 }); await fresh(C.imei, 5.605, -0.205, { speed: 0 });
  const dest = { lat: 5.640, lng: -0.200 };
  ok('bad phone is refused', (await call('PUT', `/map/vehicles/${A.vid}/destination`, admin, { ...dest, customerPhone: 'abc' })).status === 400);
  ok('notifying needs a contact', (await call('PUT', `/map/vehicles/${A.vid}/destination`, admin, { ...dest, notifyCustomer: true })).status === 400);
  const due = new Date(Date.now() + 2 * 60_000).toISOString();
  const setd = await call('PUT', `/map/vehicles/${A.vid}/destination`, admin, { ...dest, label: 'Kofi Store', customerName: 'Kofi', customerPhone: '+233201234567', notifyCustomer: true, dueAt: due });
  ok('destination with customer and deadline is saved', setd.status === 200, setd.raw);
  await sleep(1200);
  ok('the customer is told it is on its way', hooks.some((h) => /on its way/.test(h.message) && h.to === '+233201234567'), hooks);
  let board = (await call('GET', '/map/dispatch', admin)).data;
  let job = board.jobs.find((j) => j.vehicleId === A.vid);
  ok('the board shows ETA and a planned route', job?.etaMinutes > 0 && Array.isArray(job.route) && job.route.length >= 2, job);
  ok('a deadline that cannot be met is marked late', job?.risk === 'late' && job.slackMinutes < 0, job);
  ok('late jobs list other vehicles that could take them', job.alternatives?.length >= 1 && job.alternatives.every((a) => a.vehicleId !== A.vid), job.alternatives);
  ok('late jobs carry a route suggestion with reasoning', job.routeAdvice?.reasoning?.length >= 1, job.routeAdvice);
  ok('a delay-risk event is recorded', board.events.some((e) => e.kind === 'delay_risk' && e.plate === 'GR 4471-26'), board.events.map((e) => e.kind));
  const nHooks = hooks.length;
  await fresh(A.imei, 5.615, -0.178, { speed: 25 }); await call('POST', '/map/dispatch/check', admin, { vehicleId: A.vid });
  await fresh(A.imei, 5.620, -0.176, { speed: 25 }); await call('POST', '/map/dispatch/check', admin, { vehicleId: A.vid });
  board = (await call('GET', '/map/dispatch', admin)).data;
  ok('leaving the planned route is detected and the route is replanned', board.events.some((e) => e.kind === 'off_route'), board.events.map((e) => e.kind));
  ok('the customer hears about the changed ETA', hooks.length > nHooks && hooks.slice(nHooks).some((h) => /Update/.test(h.message)), hooks.slice(nHooks));
  ok('notifications are logged', board.notifications.length >= 2 && board.notifyConfigured === true, board.notifications.length);
  await fresh(A.imei, dest.lat, dest.lng, { speed: 0 }); await call('POST', '/map/dispatch/check', admin, { vehicleId: A.vid });
  board = (await call('GET', '/map/dispatch', admin)).data; job = board.jobs.find((j) => j.vehicleId === A.vid);
  ok('arrival is detected', job?.status === 'arrived' && board.events.some((e) => e.kind === 'arrived'), job);
  ok('the customer is told it arrived', hooks.some((h) => /has arrived/.test(h.message)));
  ok('another organization sees no jobs', (await call('GET', '/map/dispatch', org2)).data.jobs.length === 0);
  ok('finance cannot trigger a check', (await call('POST', '/map/dispatch/check', finance, { vehicleId: A.vid })).status === 403);

  section('Route advice');
  await fresh(C.imei, 5.60, -0.20, { speed: 20 });
  const adv = (await call('GET', `/map/route-advice?vehicleId=${C.vid}&toLat=5.66&toLng=-0.20&priority=energy`, admin)).data;
  ok('two options with energy, CO2 and a recommendation', adv.options.length === 2 && adv.options.every((o) => o.co2Kg > 0 && o.energyKwh > 0) && adv.best.label === 'Recommended', adv);
  ok('the reasoning is spelled out', adv.reasoning.length >= 2 && /faster|slower|shorter|longer/.test(adv.reasoning.join(' ')), adv.reasoning);
  const advDue = (await call('GET', `/map/route-advice?vehicleId=${C.vid}&toLat=5.66&toLng=-0.20&dueAt=${new Date(Date.now() + 60_000).toISOString()}`, admin)).data;
  ok('a deadline nobody can meet is said plainly', advDue.reasoning.some((r) => /No route reaches/.test(r)), advDue.reasoning);
  ok('bad coordinates are refused', (await call('GET', `/map/route-advice?vehicleId=${C.vid}&toLat=999&toLng=0`, admin)).status === 400);
  ok('another organization cannot ask about the vehicle', (await call('GET', `/map/route-advice?vehicleId=${C.vid}&toLat=5.66&toLng=-0.20`, org2)).status === 400);

  section('Camera links');
  ok('http links are refused', (await call('PUT', `/map/vehicles/${C.vid}/camera`, admin, { kind: 'hls', liveUrl: 'http://cam.example/live.m3u8' })).status === 400);
  ok('javascript links are refused', (await call('PUT', `/map/vehicles/${C.vid}/camera`, admin, { kind: 'iframe', liveUrl: 'javascript:alert(1)' })).status === 400);
  ok('an https link is saved', (await call('PUT', `/map/vehicles/${C.vid}/camera`, admin, { kind: 'hls', provider: 'Acme Cam', liveUrl: 'https://cam.example/live.m3u8', clipTemplate: 'https://cam.example/clip?from={from}&to={to}' })).status === 200);
  const cam = (await call('GET', `/map/vehicles/${C.vid}/camera`, admin)).data;
  ok('the last-10-seconds clip link is filled in', cam.configured && /from=20\d\d-.*&to=20\d\d-/.test(cam.clipUrl) && !/\{from\}/.test(cam.clipUrl), cam);
  ok('a vehicle without a camera says so', (await call('GET', `/map/vehicles/${B.vid}/camera`, admin)).data.configured === false);
  ok('a rider cannot read camera links', (await call('GET', `/map/vehicles/${C.vid}/camera`, rider)).status === 403);

  section('Charging points and sensor assets');
  const poi = (await call('POST', '/map/pois', admin, { name: 'Test charging bay', category: 'charging', lat: 5.61, lng: -0.19 })).data;
  ok('availability needs sensible numbers', (await call('PUT', `/map/pois/${poi.id}/availability`, admin, { capacity: 4, available: 9 })).status === 400);
  ok('availability is saved', (await call('PUT', `/map/pois/${poi.id}/availability`, admin, { capacity: 4, available: 2 })).status === 200);
  const pl = (await call('GET', '/map/pois', admin)).data.find((p) => p.id === poi.id);
  ok('the place shows capacity, free bays and the update time', pl.capacity === 4 && pl.available === 2 && !!pl.availabilityUpdatedAt, pl);
  const asset = (await call('POST', '/map/assets', admin, { name: 'Cold trailer 1', kind: 'cooler', limits: { tempMax: 5, batteryMin: 20 } })).data;
  ok('an asset is created', !!asset?.id);
  ok('reports without the key are refused', (await call('POST', `/map/ingest/assets/${asset.id}`, null, { temperatureC: 3 }, {})).status === 401);
  ok('bad readings are refused', (await call('POST', `/map/ingest/assets/${asset.id}`, null, { temperatureC: 'hot' }, { 'x-ingest-key': KEY })).status === 400);
  ok('a report is accepted', (await call('POST', `/map/ingest/assets/${asset.id}`, null, { latitude: 5.6, longitude: -0.2, temperatureC: 9, doorOpen: true, batteryPct: 15 }, { 'x-ingest-key': KEY })).status < 300);
  const as = (await call('GET', '/map/assets', admin)).data.find((a) => a.id === asset.id);
  ok('door, temperature and battery alarms are raised', as.alarms.length === 3 && as.lat === 5.6, as);
  ok('another organization does not see the asset', !(await call('GET', '/map/assets', org2)).data.some((a) => a.id === asset.id));

  console.log(`\n${pass} passed, ${fail} failed`);
  fakeRoute.close(); fakeHook.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
