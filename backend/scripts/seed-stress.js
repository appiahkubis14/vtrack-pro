/**
 * Stress-test seed: fills a NEW organization with a large, realistic Ghana data set.
 *   - 20 of every record type (hubs, suppliers, models, consignments, owners, contracts, riders, staff, batteries, ...)
 *   - ~120 vehicles, a tracker on every contracted vehicle, and about two weeks of GPS tracks (positions, trips,
 *     geofence entries/exits, alerts) around 20 Ghanaian towns, so the map, history and replay have plenty to show.
 * Uses the real API for business records (so every rule is exercised) and direct SQL for GPS data and trackers.
 *
 *   cd backend && API=http://localhost:3000/api node scripts/seed-stress.js
 *   Env: DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE, TS_* for the positions database (defaults match .env),
 *        RUN=<tag>   re-use the same tag to top up the same organization (default: random),
 *        DAYS=14     days of GPS history, TRACKED=60 vehicles that get a tracker and tracks.
 * Failures are counted and logged; the script keeps going and prints a summary of what exists at the end.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// read .env (simple KEY=VALUE) without overriding variables already set
try {
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* no .env */ }

const API = process.env.API || 'http://localhost:3000/api';
const PUB = API.replace(/\/api\/?$/, '');
const RUN = process.env.RUN || Math.random().toString(36).slice(2, 7);
const DAYS = Number(process.env.DAYS || 14);
const TRACKED = Number(process.env.TRACKED || 60);
const PW = 'Demo!Passw0rd#2026';
const D = `stress${RUN}.vtrack.pro`;
const ADMIN = `admin@${D}`;

const mainDb = () => new Client({ host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 5432), user: process.env.DB_USERNAME || 'vtrack', password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE || 'vtrack_test' });
const tsDb = () => new Client({ host: process.env.TS_HOST || process.env.DB_HOST || 'localhost', port: +(process.env.TS_PORT || 5433), user: process.env.TS_USERNAME || process.env.DB_USERNAME || 'vtrack', password: process.env.TS_PASSWORD || process.env.DB_PASSWORD, database: process.env.TS_DATABASE || 'vtrack_ts' });

// ---------- tiny helpers ----------
let seed = [...RUN].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n, w) => String(n).padStart(w, '0');
const fails = {}; const made = {};
const note = (k) => { made[k] = (made[k] || 0) + 1; };
async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${json && (json.detail || json.message || json.title)}`);
  return json && json.data !== undefined ? json.data : json;
}
async function pub(p, body) {
  const res = await fetch(PUB + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${p} -> ${res.status}`);
}
/** Run a call, count it under `kind`, never throw. */
async function T(kind, fn) {
  try { const r = await fn(); note(kind); return r; } catch (e) {
    fails[kind] = (fails[kind] || 0) + 1; if (fails[kind] <= 3) console.log(`  ! ${kind}: ${e.message}`); return null;
  }
}
const login = async (email, password) => (await call('POST', '/auth/login', null, { email, password })).accessToken;
const ymd = (d) => d.toISOString().slice(0, 10);
const day = (n) => ymd(new Date(Date.now() - n * 86400000));
// the app stores timestamps as local time without a zone (pg's default), so write them the same way
const ts = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

// ---------- reference data ----------
// 20 towns: name, region, plate code, lat, lng
const TOWNS = [
  ['Accra Central', 'Greater Accra', 'GR', 5.5600, -0.2057], ['Tema', 'Greater Accra', 'GT', 5.6698, -0.0166],
  ['Kumasi Central', 'Ashanti', 'AS', 6.6885, -1.6244], ['Obuasi', 'Ashanti', 'AS', 6.2025, -1.6603],
  ['Tamale', 'Northern', 'NR', 9.4075, -0.8534], ['Takoradi', 'Western', 'WR', 4.8962, -1.7554],
  ['Cape Coast', 'Central', 'CR', 5.1053, -1.2466], ['Sunyani', 'Bono', 'BA', 7.3349, -2.3123],
  ['Ho', 'Volta', 'VR', 6.6000, 0.4667], ['Koforidua', 'Eastern', 'ER', 6.0941, -0.2590],
  ['Bolgatanga', 'Upper East', 'UE', 10.7856, -0.8514], ['Wa', 'Upper West', 'UW', 10.0601, -2.5099],
  ['Techiman', 'Bono East', 'BE', 7.5833, -1.9333], ['Nkawkaw', 'Eastern', 'ER', 6.5500, -0.7667],
  ['Winneba', 'Central', 'CR', 5.3511, -0.6231], ['Kasoa', 'Central', 'CR', 5.5340, -0.4170],
  ['Madina', 'Greater Accra', 'GR', 5.6683, -0.1667], ['Ejisu', 'Ashanti', 'AS', 6.7200, -1.4700],
  ['Yendi', 'Northern', 'NR', 9.4427, -0.0099], ['Hohoe', 'Volta', 'VR', 7.1519, 0.4733],
];
const MALE = ['Kwame', 'Kofi', 'Yaw', 'Kwesi', 'Kojo', 'Kwabena', 'Nana', 'Ebenezer', 'Isaac', 'Emmanuel', 'Daniel', 'Samuel', 'Prince', 'Michael', 'Joseph', 'Fuseini', 'Abdul', 'Ibrahim', 'Issah', 'Seidu', 'Mohammed', 'Alhassan', 'Francis', 'Richard'];
const FEMALE = ['Ama', 'Abena', 'Akosua', 'Adwoa', 'Afia', 'Efua', 'Esi', 'Yaa', 'Serwaa', 'Gifty', 'Comfort', 'Grace', 'Mavis', 'Patience', 'Mariama', 'Fatima', 'Hawa', 'Rukaya', 'Priscilla', 'Josephine'];
const SUR = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Osei', 'Agyeman', 'Amoah', 'Darko', 'Frimpong', 'Adjei', 'Ofori', 'Acheampong', 'Addo', 'Quaye', 'Tetteh', 'Annan', 'Sarpong', 'Gyasi', 'Yeboah', 'Alhassan', 'Abdulai', 'Iddrisu', 'Mahama', 'Akoto', 'Nyarko', 'Ansah', 'Kyei', 'Baah', 'Antwi'];
const SUPPLIERS = [['Huodi Electric Vehicles Ltd', 'China'], ['Zonda Motors', 'China'], ['Shineray Mobility', 'China'], ['Kengo Electric Co', 'China'], ['Jinpeng Trike Works', 'China'], ['Foton Lovol Africa', 'China'], ['Bajaj Auto Export', 'India'], ['TVS Motor Exports', 'India'], ['Piaggio Africa', 'Italy'], ['Gogoro Partners', 'Taiwan'], ['Yadea Group', 'China'], ['Niu Technologies', 'China'], ['Sunra Electric', 'China'], ['Aima Technology', 'China'], ['Tailg Mobility', 'China'], ['Lvyuan Power', 'China'], ['Ampere Vehicles', 'India'], ['Hero Electric', 'India'], ['Roam Motors', 'Kenya'], ['Spiro Africa', 'Benin']];
const MODEL_BRANDS = ['Huodi', 'Zonda', 'Shineray', 'Kengo', 'Jinpeng', 'Foton', 'Bajaj', 'TVS', 'Piaggio', 'Gogoro'];
const MODEL_KINDS = [['HD-72V Cargo E-bike', 'ebike', 1800000], ['Aboboyaa Goods Trike', 'trike_goods', 3500000], ['City Passenger Trike', 'trike_passenger', 3200000], ['Delivery E-bike Lite', 'ebike', 1500000]];
const SHOPS = ['Makola Market', 'Kejetia Market', 'Central Market', 'Tamale Market', 'Kaneshie Market', 'Techiman Market', 'Madina Market', 'Takoradi Market Circle', 'Cape Coast Kotokuraba', 'Ho Main Market'];
const POI_NAMES = { fuel: ['Goil', 'Total', 'Shell', 'Star Oil'], charging: ['Solar charge bay', 'Grid charge bay'], parking: ['Trike rank', 'Okada rank'], service: ['Mechanic yard', 'Spare parts shop'], customer: ['Wholesale depot', 'Cold store', 'Provision shop'], depot: ['Customer depot'] };

const person = (female) => `${pick(female ? FEMALE : MALE)} ${pick(SUR)}`;
const phone = () => `0${pick(['24', '54', '55', '20', '50', '26', '27'])}${pad(ri(1000000, 9999999), 7)}`;

// ---------- GPS track generation ----------
function bearing(a, b) { const y = Math.sin((b[1] - a[1]) * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180); const x = Math.cos(a[0] * Math.PI / 180) * Math.sin(b[0] * Math.PI / 180) - Math.sin(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.cos((b[1] - a[1]) * Math.PI / 180); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
function km(a, b) { const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
/** A believable delivery round: out from the hub through a few stops and back. One point per 30 seconds. */
function makeTrip(center, start, opts = {}) {
  const radiusKm = opts.radiusKm || (1.5 + rnd() * 5);
  const wp = [center];
  const n = ri(2, 4);
  for (let i = 0; i < n; i++) { const ang = rnd() * 2 * Math.PI, r = radiusKm * (0.4 + rnd() * 0.6); wp.push([center[0] + (r * Math.sin(ang)) / 111, center[1] + (r * Math.cos(ang)) / (111 * Math.cos(center[0] * Math.PI / 180))]); }
  wp.push(center);
  const pts = []; let t = start.getTime(); let cur = [...wp[0]]; let odo = 0;
  for (let w = 1; w < wp.length; w++) {
    const target = wp[w]; const base = 14 + rnd() * 22; // km/h cruise
    let guard = 0;
    while (km(cur, target) > 0.06 && guard++ < 400) {
      const sp = Math.max(4, base + (rnd() - 0.5) * 10); const step = (sp / 3600) * 30; // km per 30 s
      const d = km(cur, target); const f = Math.min(1, step / d);
      const next = [cur[0] + (target[0] - cur[0]) * f + (rnd() - 0.5) * 0.00008, cur[1] + (target[1] - cur[1]) * f + (rnd() - 0.5) * 0.00008];
      pts.push({ lat: next[0], lng: next[1], speed: sp, heading: Math.round(bearing(cur, next)), t, ign: true }); odo += km(cur, next); cur = next; t += 30000;
    }
    if (w < wp.length - 1) for (let s = 0, m = ri(3, 8); s < m; s++) { pts.push({ lat: cur[0], lng: cur[1], speed: 0, heading: pts.length ? pts[pts.length - 1].heading : 0, t, ign: s % 2 === 0 }); t += 30000; } // a stop to drop goods
  }
  return { pts, km: odo, max: Math.max(...pts.map((p) => p.speed)) };
}

// ---------- main ----------
(async () => {
  const t0 = Date.now();
  console.log(`Stress seed, run tag "${RUN}"  (admin: ${ADMIN} / ${PW})`);
  try { await call('POST', '/auth/register', null, { email: ADMIN, password: PW, firstName: 'Stress', lastName: 'Admin', organizationName: `V-Track Stress Test ${RUN}` }); console.log('Created organization.'); } catch (e) { if (!/409|already|exist/i.test(e.message)) throw e; console.log('Organization exists, topping up.'); }
  const A = await login(ADMIN, PW);
  const db = mainDb(); await db.connect();
  const org = (await db.query('SELECT organization_id FROM users WHERE email=$1', [ADMIN])).rows[0].organization_id;
  const ts_ = tsDb(); await ts_.connect();

  // ----- hubs + charge points -----
  console.log('Hubs, charge points, suppliers, models...');
  const hubs = [];
  for (let i = 0; i < 20; i++) {
    const [town, region, , lat, lng] = TOWNS[i];
    const h = await T('hubs', () => call('POST', '/hubs', A, { name: `${town} Hub ${RUN}`, region, town, assembly: `${town} Municipal`, status: i % 7 === 6 ? 'pilot' : 'active', gracePeriodHours: pick([6, 12, 24]), latitude: lat, longitude: lng }));
    if (h) { hubs.push({ ...h, i, lat, lng, code: TOWNS[i][2] }); for (const [nm, src] of [['Bay 1', 'grid'], ['Bay 2', i % 3 === 0 ? 'solar' : 'grid']]) await T('chargePoints', () => call('POST', `/hubs/${h.id}/charge-points`, A, { name: nm, powerSource: src })); }
  }
  const suppliers = [];
  for (const [n, c] of SUPPLIERS) { const s = await T('suppliers', () => call('POST', '/suppliers', A, { name: `${n} (${RUN})`, country: c, contactName: person(false), phone: `+86 21 5555 ${pad(ri(0, 9999), 4)}`, email: `sales${ri(1, 999)}@${n.split(' ')[0].toLowerCase()}.example` })); if (s) suppliers.push(s); }
  const models = [];
  for (let i = 0; i < 20; i++) { const k = MODEL_KINDS[i % 4]; const m = await T('models', () => call('POST', '/vehicle-models', A, { brand: MODEL_BRANDS[i % 10], name: `${k[0]} ${['Mk1', 'Mk2', 'Pro', 'S', 'X'][i % 5]}`, vehicleType: k[1], batterySpec: `${pick([60, 72])}V ${pick([60, 100, 150])}Ah lithium`, listPricePesewas: k[2] + ri(0, 4) * 50000 })); if (m) models.push(m); }

  // ----- consignments -> vehicles -----
  console.log('Consignments and vehicles...');
  const vehicles = []; // {id, hub, plate}
  let plateSeq = ri(1000, 4000);
  for (let i = 0; i < 20 && suppliers.length && models.length; i++) {
    const qty = ri(5, 7); const model = models[i % models.length];
    const cons = await T('consignments', () => call('POST', '/consignments', A, { reference: `${RUN.toUpperCase()}-${pad(i + 1, 3)}`, supplierId: suppliers[i % suppliers.length].id, containerNo: `MSKU${pad(ri(0, 9999999), 7)}`, blNumber: `BL-${ri(1000, 9999)}`, lines: [{ vehicleModelId: model.id, quantity: qty, unitCostPesewas: Math.round(model.listPricePesewas * 0.6) }], landedCostPesewas: ri(300, 700) * 1000 }));
    if (!cons) continue;
    const upto = i % 5 === 0 ? ['shipped'] : i % 5 === 1 ? ['shipped', 'at_port'] : ['shipped', 'at_port', 'cleared']; // some are still in transit
    let okAdv = true; for (const s of upto) { if (!(await T('advances', () => call('POST', `/consignments/${cons.id}/advance`, A, { status: s })))) okAdv = false; }
    if (upto.length < 3 || !okAdv) continue;
    const rec = await T('receipts', () => call('POST', `/consignments/${cons.id}/receive`, A, { counts: [{ lineId: cons.lines[0].id, count: qty }] }));
    if (!rec) continue;
    const hub = hubs[i % hubs.length]; if (!hub) continue;
    for (const vid of rec.vehicleIds) {
      const plate = `${hub.code} ${plateSeq++}-26`;
      await T('vehicleEdits', () => call('PUT', `/business/vehicles/${vid}`, A, { plateNumber: plate, chassisNo: `LSH${RUN.toUpperCase()}${pad(plateSeq, 6)}`, motorNo: `MT-${ri(10000, 99999)}`, color: pick(['Black', 'Red', 'Blue', 'White', 'Green', 'Yellow']) }));
      vehicles.push({ id: vid, hub, plate, model: model.vehicleType, list: model.listPricePesewas });
    }
    await db.query('UPDATE vehicles SET hub_id=$1 WHERE id = ANY($2::uuid[])', [hub.id, rec.vehicleIds]);
  }
  console.log(`  ${vehicles.length} vehicles created`);

  // ----- owners, contracts, payments -----
  console.log('Owners, contracts, payments...');
  const owners = [];
  for (let i = 0; i < 20; i++) { const sme = i % 5 === 4; const o = await T('owners', () => call('POST', '/owners', A, { name: sme ? `${pick(SUR)} ${pick(['Logistics', 'Transport', 'Enterprise', 'Trading', 'Agro'])} Ltd` : person(i % 2 === 0), phone: phone(), kycStatus: pick(['verified', 'verified', 'verified', 'pending']), ownerType: sme ? 'sme' : 'individual', momoNumber: phone(), idDocument: `GHA-${ri(100000000, 999999999)}-${ri(0, 9)}` })); if (o) owners.push(o); }
  const contracted = [];
  const nContracts = Math.min(vehicles.length, Math.max(30, TRACKED));
  for (let i = 0; i < nContracts && owners.length; i++) {
    const v = vehicles[i]; const lease = i % 4 !== 0; const price = Math.round(v.list * (1.15 + rnd() * 0.25) / 1000) * 1000; // priced above the landed unit cost
    const c = await T('contracts', () => call('POST', '/contracts', A, lease ? { ownerId: owners[i % owners.length].id, vehicleId: v.id, mode: 'lease', pricePesewas: price, depositPesewas: ri(10, 25) * 10000, termWeeks: pick([16, 20, 26, 30]), startDate: day(ri(20, 90)), gracePeriodHours: pick([12, 24, 48]) } : { ownerId: owners[i % owners.length].id, vehicleId: v.id, mode: 'outright', pricePesewas: price, depositPesewas: price, startDate: day(ri(20, 90)) }));
    if (!c) continue;
    if (await T('activations', () => call('POST', `/contracts/${c.id}/activate`, A))) {
      contracted.push({ ...v, contractId: c.id });
      const pays = (i % 4 === 0) ? 0 : ri(1, 4); // outright contracts are paid in full on activation
      for (let p = 0; p < pays; p++) await T('payments', () => call('POST', `/contracts/${c.id}/payments`, A, { amountPesewas: ri(10, 30) * 10000, reference: `${pick(['MOMO', 'RCPT', 'BANK'])}-${ri(1000000, 9999999)}`, method: pick(['momo', 'cash', 'bank']), payerName: person(rnd() > 0.5) }));
    }
  }

  // ----- riders, team, assignments -----
  console.log('Riders, team members, assignments...');
  const riders = [];
  for (let i = 0; i < 40 && hubs.length; i++) {
    const hub = i < contracted.length ? contracted[i].hub : hubs[i % hubs.length];
    const r = await T('riders', () => call('POST', '/riders', A, { fullName: person(i % 6 === 5), phone: phone(), hubId: hub.id, guarantorName: person(rnd() > 0.5), guarantorPhone: phone() }));
    if (r) riders.push({ ...r, hub });
  }
  const staff = [['finance', 3], ['hub_manager', 12], ['dispatcher', 3], ['auditor', 1], ['fleet_manager', 1]];
  let staffN = 0;
  for (const [role, n] of staff) for (let k = 0; k < n; k++) {
    const hub = hubs[staffN % hubs.length]; staffN++;
    const email = `${role.replace('_', '.')}.${k + 1}@${D}`;
    const body = { email, firstName: pick(MALE.concat(FEMALE)), lastName: pick(SUR), role, ...(role === 'hub_manager' ? { hubId: hub.id } : {}) };
    const u = await T('teamUsers', () => call('POST', '/team/users', A, body));
    if (u && u.temporaryPassword) await T('passwordChanges', async () => { const tk = await login(email, u.temporaryPassword); await call('POST', '/account/change-password', tk, { currentPassword: u.temporaryPassword, newPassword: PW }); });
  }
  for (let k = 0; k < 4 && owners[k]; k++) {
    const email = `investor.${k + 1}@${D}`;
    const u = await T('teamUsers', () => call('POST', '/team/users', A, { email, firstName: 'Investor', lastName: String(k + 1), role: 'investor', ownerId: owners[k].id }));
    if (u && u.temporaryPassword) await T('passwordChanges', async () => { const tk = await login(email, u.temporaryPassword); await call('POST', '/account/change-password', tk, { currentPassword: u.temporaryPassword, newPassword: PW }); });
  }
  const assignments = [];
  for (let i = 0; i < Math.min(riders.length, contracted.length); i++) {
    const a = await T('assignments', () => call('POST', '/assignments', A, { riderId: riders[i].id, vehicleId: contracted[i].id, dailyTargetPesewas: pick([8000, 9000, 10000]), dailyRemittancePesewas: pick([2500, 3000, 3500]), serviceFeePesewas: 500, startDate: day(ri(10, 30)) }));
    if (a) assignments.push({ rider: riders[i], vehicle: contracted[i] });
  }

  // ----- batteries, swaps, charging -----
  console.log('Batteries, swaps, charge events...');
  const bats = [];
  for (let i = 0; i < 60 && hubs.length; i++) { const hub = hubs[i % hubs.length]; const b = await T('batteries', () => call('POST', '/batteries', A, { serialNo: `BAT-${RUN.toUpperCase()}-${pad(i + 1, 3)}`, hubId: hub.id })); if (b) bats.push({ ...b, hub }); }
  for (let i = 0; i < 20 && i < bats.length && i < contracted.length; i++) await T('batteryFits', () => call('POST', `/batteries/${bats[i].id}/fit`, A, { vehicleId: contracted[i].id }));
  const spare = bats.slice(20, 40);
  for (let i = 0; i < assignments.length && spare.length && made.swaps !== 20; i++) { const bi = spare.findIndex((b) => b.hub.id === assignments[i].vehicle.hub.id); if (bi < 0) continue; const [b] = spare.splice(bi, 1); await T('swaps', () => call('POST', '/battery-swaps', A, { vehicleId: assignments[i].vehicle.id, batteryInId: b.id, riderId: assignments[i].rider.id })); }
  for (let i = 40; i < 60 && i < bats.length; i++) {
    const rider = assignments[i - 40] ? assignments[i - 40].rider : riders[0];
    const ce = await T('chargeEvents', () => call('POST', '/charge-events', A, { batteryId: bats[i].id, riderId: rider && rider.id }));
    if (ce && i % 4 !== 0) { await T('chargeFinish', () => call('POST', `/charge-events/${ce.id}/finish`, A, { kwh: +(2 + rnd() * 4).toFixed(1), feePesewas: ri(3, 9) * 100 })); if (i % 3 === 0) await T('chargePay', () => call('POST', `/charge-events/${ce.id}/pay`, A, { method: pick(['cash', 'momo']), reference: `CHG-${ri(10000, 99999)}` })); }
  }
  for (const b of bats) { await db.query('UPDATE batteries SET health_pct=$1, cycle_count=$2' + (rnd() < 0.08 ? ", status='faulty'" : '') + ' WHERE id=$3', [+(40 + rnd() * 58).toFixed(1), ri(20, 520), b.id]).catch(() => {}); }

  // ----- collections and settlements -----
  console.log(`Collections and settlements for ${Math.min(DAYS, 10)} days...`);
  for (let n = Math.min(DAYS, 10); n >= 1; n--) {
    const date = day(n);
    for (const a of assignments) {
      const roll = rnd();
      const amount = roll < 0.75 ? 9000 + ri(-300, 600) : roll < 0.9 ? ri(1500, 6000) : 0; // some riders short, a few skip
      if (amount > 0) await T('collections', () => call('POST', '/collections', A, { riderId: a.rider.id, amountPesewas: amount, date, reference: `${a.rider.hub.code}-${date}-${a.rider.id.slice(0, 4)}`, source: pick(['cash', 'momo']) }));
    }
    await T('settlementRuns', () => call('POST', '/settlements/calculate', A, { date }));
    if (n > 2) for (const h of hubs) { const l = await call('GET', `/settlements?date=${date}&hubId=${h.id}`, A).catch(() => []); for (const s of (Array.isArray(l) ? l : [])) if (s.status !== 'shortfall') await T('settlementCloses', () => call('POST', `/settlements/${s.id}/close`, A)); }
  }
  for (const h of hubs.filter((x) => assignments.some((a) => a.rider.hub.id === x.id))) await T('cashDeposits', () => call('POST', `/hubs/${h.id}/cash-deposits`, A, { amountPesewas: ri(5, 30) * 100, method: 'bank', reference: `GCB-${ri(10000, 99999)}`, note: 'Weekly banking' }));
  const bal = await call('GET', '/payments/balances', A).catch(() => []);
  for (const b of (Array.isArray(bal) ? bal : [])) if (b.account === 'owner_account' && b.balancePesewas > 5000) await T('payouts', () => call('POST', `/payouts/owners/${b.ownerId}`, A, { amountPesewas: Math.floor(b.balancePesewas / 2), method: 'momo', reference: `PAYOUT-${ri(10000, 99999)}` }));

  // ----- enforcement -----
  console.log('Enforcement, catalog, leads...');
  for (let i = 0; i < 20 && i < assignments.length; i++) {
    const lr = await T('lockRequests', () => call('POST', '/enforcement/lock-requests', A, { vehicleId: assignments[i].vehicle.id, reason: pick(['Rider short three days running and not answering calls', 'Suspected misuse of the vehicle at night', 'Vehicle seen outside the agreed area', 'Rider unreachable, guarantor informed']) }));
    if (lr && i % 3 === 0) await T('lockApprovals', () => call('POST', `/enforcement/lock-requests/${lr.id}/approve`, A, { note: 'Approved after contacting the guarantor' }));
  }
  for (let i = 0; i < 20 && i < riders.length; i++) await T('exceptions', () => call('POST', '/enforcement/exceptions', A, { riderId: riders[i].id, kind: pick(['sickness', 'breakdown', 'leave', 'other']), startsOn: day(ri(-2, 2)), endsOn: day(ri(-8, -3)), reason: pick(['Rider has malaria, medical note seen', 'Bike in workshop awaiting spare part', 'Funeral in the family', 'Public holiday']) }));

  // catalog products + leads
  const cat = (await T('productCategories', () => call('POST', '/products/categories', A, { name: `Vehicles ${RUN}`, slug: `vehicles-${RUN}` }))) || {};
  const prodNames = ['E-bike Cargo 72V', 'Goods Trike Aboboyaa', 'Passenger Trike City', 'GPS Tracker GT06', 'Smart Lock Module', 'Battery 72V 100Ah', 'Battery 72V 150Ah', 'Charging Bay Kit', 'Solar Charge Panel', 'Helmet Set', 'Cargo Box Large', 'Rain Cover', 'Spare Motor Controller', 'Hub Motor 3000W', 'Tyre Set', 'Phone Mount', 'Dash Camera', 'Fuel Sensor', 'Immobiliser Relay', 'Fleet Dashboard Subscription'];
  for (const [i, n] of prodNames.entries()) await T('products', () => call('POST', '/products', A, { categoryId: cat.id, name: n, slug: `${n.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${RUN}`, shortDescription: `${n} for fleets in Ghana`, hardwareType: i < 3 ? 'vehicle' : 'accessory', baseCurrency: 'GHS', isActive: true, isFeatured: i < 4, displayOrder: i }));
  // leads: the public form is rate-limited (by design), so the seed writes them straight to the table
  for (let i = 0; i < 25; i++) { const t = TOWNS[i % 20]; await T('leads', () => db.query(`INSERT INTO leads (contact_name, company_name, phone, email, country, city, fleet_size, message, source_channel, preferred_language, consent_to_contact, status, created_at) VALUES ($1,$2,$3,$4,'GH',$5,$6,$7,$8,'en',true,$9,$10)`, [person(i % 3 === 0), i % 2 ? `${pick(SUR)} ${pick(['Logistics', 'Foods', 'Trading', 'Farms'])}` : null, phone(), `lead${i}.${RUN}@example.com`, t[0], ri(1, 40), pick(['We deliver goods daily and need e-bikes', 'Interested in a lease-to-own offer', 'Please call me about trikes', 'How does the tracker work?']), pick(['website', 'whatsapp', 'referral', 'facebook']), pick(['new', 'new', 'contacted', 'qualified']), new Date(Date.now() - ri(0, 20) * 86400000)]));
  }

  // ----- trackers + GPS tracks -----
  console.log(`Trackers and ${DAYS} days of GPS tracks for ${Math.min(TRACKED, contracted.length)} vehicles...`);
  const tracked = contracted.slice(0, TRACKED);
  const now = Date.now(); let posCount = 0, tripCount = 0, evCount = 0, alertCount = 0;
  const hubFence = {};
  for (const h of hubs) { // 20 circular hub geofences
    const g = await T('geofences', () => call('POST', '/geofences', A, { name: `${h.town} depot ${RUN}`, type: 'circle', centerLatitude: h.lat, centerLongitude: h.lng, radius: 350, color: '#2f9e44', isActive: true, alerts: { onEnter: true, onExit: true } }));
    if (g) hubFence[h.id] = g.id;
  }
  const zones = ['Market zone', 'Restricted: airport', 'Customer area', 'Night parking', 'School zone'];
  for (let i = 0; i < 6; i++) { const h = hubs[(i * 3) % hubs.length]; const c = [h.lng + 0.02, h.lat + 0.015]; const d = 0.006; await T('geofences', () => call('POST', '/geofences', A, { name: `${pick(zones)} ${h.town}`, type: 'polygon', coordinates: { type: 'Polygon', coordinates: [[[c[0] - d, c[1] - d], [c[0] + d, c[1] - d], [c[0] + d, c[1] + d], [c[0] - d, c[1] + d], [c[0] - d, c[1] - d]]] }, color: '#e8590c', isActive: true })); }
  for (const [vi, v] of tracked.entries()) {
    const imei = `8601${pad(parseInt(RUN, 36) % 1000, 3)}${pad(vi, 6)}${pad(ri(0, 99), 2)}`;
    const dev = (await db.query(`INSERT INTO devices (organization_id, vehicle_id, imei, name, protocol, model, status, battery_level, signal_strength, sim_number, sim_provider, is_active) VALUES ($1,$2,$3,$4,'gt06',$5,'online',$6,$7,$8,$9,true) ON CONFLICT (imei) DO UPDATE SET vehicle_id=EXCLUDED.vehicle_id RETURNING id`, [org, v.id, imei, `Tracker ${v.plate}`, pick(['GT06N', 'JM-VL03', 'ST-901']), ri(30, 100), ri(40, 100), `0${ri(240000000, 559999999)}`, pick(['MTN', 'Vodafone', 'AirtelTigo'])])).rows[0];
    note('devices');
    await db.query(`INSERT INTO vehicle_devices (vehicle_id, device_id, role, trust_level, is_active) VALUES ($1,$2,'primary',100,true)`, [v.id, dev.id]).catch(() => {});
    const center = [v.hub.lat, v.hub.lng];
    const P = { dev: [], lat: [], lng: [], sp: [], hd: [], ig: [], ts: [] };
    const tripRows = []; const evRows = [];
    const live = vi % 11 !== 7; // a few trackers are offline (no data for the last day)
    const quiet = vi % 17 === 5; // a bike that barely moves (idle analysis)
    const nightRider = vi % 13 === 4; // moves at night (privacy / theft story)
    const push = (tr) => { for (const p of tr.pts) { P.dev.push(dev.id); P.lat.push(p.lat); P.lng.push(p.lng); P.sp.push(+p.speed.toFixed(1)); P.hd.push(p.heading); P.ig.push(p.ign); P.ts.push(ts(new Date(p.t))); } };
    for (let d = DAYS; d >= 0; d--) {
      const base = new Date(); base.setHours(0, 0, 0, 0); base.setTime(base.getTime() - d * 86400000);
      const trips = quiet ? (rnd() < 0.3 ? 1 : 0) : ri(2, 4);
      let hour = 6 + rnd() * 1.5;
      for (let k = 0; k < trips; k++) {
        const start = new Date(base.getTime() + hour * 3600000);
        if (d === 0 && start.getTime() > now - 1800000) break;
        const tr = makeTrip(center, start, { radiusKm: 1 + rnd() * (v.model === 'ebike' ? 5 : 4) });
        const lastT = tr.pts[tr.pts.length - 1].t;
        if (d === 0 && lastT > now) { const shift = lastT - (now - 60000); for (const p of tr.pts) p.t -= shift; } // today's last trip ends right now (live)
        push(tr);
        const first = tr.pts[0], last = tr.pts[tr.pts.length - 1];
        tripRows.push([dev.id, v.id, ts(new Date(first.t)), ts(new Date(last.t)), JSON.stringify({ lat: first.lat, lng: first.lng }), JSON.stringify({ lat: last.lat, lng: last.lng }), +tr.km.toFixed(2), Math.round((last.t - first.t) / 1000), +(tr.km / ((last.t - first.t) / 3600000)).toFixed(1), +tr.max.toFixed(1), tr.pts.filter((p) => p.speed === 0).length ? 1 : 0, ri(60, 98)]);
        if (hubFence[v.hub.id]) evRows.push([hubFence[v.hub.id], dev.id, v.id, 'exit', first.lat, first.lng, ts(new Date(first.t + 60000))], [hubFence[v.hub.id], dev.id, v.id, 'entry', last.lat, last.lng, ts(new Date(last.t))]);
        hour += (last.t - first.t) / 3600000 + 1.2 + rnd() * 2;
        if (hour > 18) break;
      }
      if (nightRider && d % 4 === 1) { const tr = makeTrip(center, new Date(base.getTime() + (22 + rnd() * 1.5) * 3600000), { radiusKm: 6 }); push(tr); const f = tr.pts[0], l = tr.pts[tr.pts.length - 1]; tripRows.push([dev.id, v.id, ts(new Date(f.t)), ts(new Date(l.t)), JSON.stringify({ lat: f.lat, lng: f.lng }), JSON.stringify({ lat: l.lat, lng: l.lng }), +tr.km.toFixed(2), Math.round((l.t - f.t) / 1000), 20, +tr.max.toFixed(1), 1, 55]); }
    }
    if (live) { // a round that is happening right now: started 5-40 min ago, last point seconds ago, so the map shows it live
      const mins = ri(5, 40); const tr = makeTrip(center, new Date(now - mins * 60000), { radiusKm: 2 + rnd() * 3 });
      const keep = tr.pts.filter((p) => p.t <= now - ri(5, 60) * 1000); const moving = vi % 3 !== 0;
      if (keep.length > 2) { if (!moving) keep[keep.length - 1].speed = 0; push({ pts: keep }); const f = keep[0], l = keep[keep.length - 1]; tripRows.push([dev.id, v.id, ts(new Date(f.t)), ts(new Date(l.t)), JSON.stringify({ lat: f.lat, lng: f.lng }), JSON.stringify({ lat: l.lat, lng: l.lng }), +(tr.km * keep.length / tr.pts.length).toFixed(2), Math.round((l.t - f.t) / 1000), 22, +Math.max(...keep.map((p) => p.speed)).toFixed(1), 0, ri(60, 98)]); }
    }
    for (let o = 0; o < P.dev.length; o += 4000) {
      const s = (a) => a.slice(o, o + 4000);
      await ts_.query(`INSERT INTO positions (device_id, latitude, longitude, speed, heading, ignition, "timestamp", satellites, hdop, event_type) SELECT d,la,lo,sp,hd,ig,t::timestamp,sat,0.9,'position' FROM unnest($1::uuid[],$2::numeric[],$3::numeric[],$4::numeric[],$5::int[],$6::boolean[],$7::text[],$8::int[]) AS x(d,la,lo,sp,hd,ig,t,sat)`, [s(P.dev), s(P.lat), s(P.lng), s(P.sp), s(P.hd), s(P.ig), s(P.ts), s(P.dev).map(() => ri(7, 14))]);
    }
    posCount += P.dev.length;
    for (const r of tripRows) { await db.query(`INSERT INTO trips (device_id, vehicle_id, start_time, end_time, start_location, end_location, distance, duration, average_speed, max_speed, stop_count, score) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12)`, r).then(() => tripCount++).catch((e) => { fails.trips = (fails.trips || 0) + 1; if (fails.trips < 3) console.log('  ! trips:', e.message); }); }
    for (const r of evRows) { await db.query(`INSERT INTO geofence_events (geofence_id, device_id, vehicle_id, event_type, latitude, longitude, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7)`, r).then(() => evCount++).catch((e) => { fails.geofenceEvents = (fails.geofenceEvents || 0) + 1; if (fails.geofenceEvents < 3) console.log('  ! geofence_events:', e.message); }); }
    if (P.dev.length) {
      const lp = await ts_.query(`SELECT id FROM positions WHERE device_id=$1 ORDER BY "timestamp" DESC LIMIT 1`, [dev.id]);
      await db.query(`UPDATE devices SET last_position_id=$1, last_communication_at=$2, status=$3 WHERE id=$4`, [lp.rows[0] && lp.rows[0].id, live ? new Date(now - ri(0, 5) * 60000) : new Date(now - ri(3, 40) * 3600000), live ? 'online' : 'offline', dev.id]);
    }
    const kinds = [['overspeed', 'high', 'Overspeed', 'Travelling above the allowed speed'], ['geofence_exit', 'medium', 'Left the hub area', 'Vehicle left its assigned zone'], ['geofence_entry', 'low', 'Entered the hub area', 'Vehicle returned to the hub'], ['harsh_braking', 'medium', 'Harsh braking', 'Sudden braking detected'], ['gps_jamming', 'critical', 'GPS signal lost', 'Possible jamming near the last position']];
    for (let a = 0, na = ri(0, 2) + (vi % 3 === 0 ? 1 : 0); a < na; a++) {
      const [type, sev, title, desc] = pick(kinds); const when = new Date(now - ri(1, DAYS * 24) * 3600000); const resolved = rnd() < 0.5;
      await db.query(`INSERT INTO alerts (organization_id, device_id, vehicle_id, type, severity, title, description, position, is_acknowledged, is_resolved, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9,$10)`, [org, dev.id, v.id, type, sev, `${title}: ${v.plate}`, desc, JSON.stringify({ lat: center[0] + (rnd() - 0.5) * 0.04, lng: center[1] + (rnd() - 0.5) * 0.04 }), resolved, when]).then(() => alertCount++).catch((e) => { fails.alerts = (fails.alerts || 0) + 1; if (fails.alerts < 3) console.log('  ! alerts:', e.message); });
    }
    if ((vi + 1) % 10 === 0) console.log(`  ... ${vi + 1}/${tracked.length} vehicles tracked, ${posCount} positions`);
  }
  made.positions = posCount; made.trips = tripCount; made.geofenceEvents = evCount; made.alerts = alertCount;

  // ----- more map locations: POIs -----
  console.log('Points of interest...');
  for (let i = 0; i < 80 && hubs.length; i++) {
    const h = hubs[i % hubs.length]; const c = pick(Object.keys(POI_NAMES)); const nm = pick(POI_NAMES[c]);
    await T('pois', () => call('POST', '/map/pois', A, { name: `${nm} ${h.town} ${i + 1}`, category: c, lat: h.lat + (rnd() - 0.5) * 0.07, lng: h.lng + (rnd() - 0.5) * 0.07, address: `${pick(SHOPS)}, ${h.town}`, notes: c === 'charging' ? 'Open 6am to 9pm' : undefined }));
  }

  // ----- maintenance -----
  console.log('Maintenance records...');
  for (let i = 0; i < 40 && vehicles.length; i++) {
    const v = vehicles[i % vehicles.length]; const done = rnd() < 0.6; const sched = new Date(now + ri(-30, 20) * 86400000);
    await db.query(`INSERT INTO maintenance (organization_id, vehicle_id, service_type, description, priority, status, scheduled_date, completed_date, cost, parts_cost, labor_cost, vendor_name, vendor_phone, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [org, v.id, pick(['tyre change', 'brake service', 'controller repair', 'motor service', 'general check', 'battery check', 'chain and sprocket']), pick(['Routine service', 'Rider reported noise', 'Brake pads worn', 'Controller overheating']), pick(['low', 'medium', 'high']), done ? 'completed' : pick(['scheduled', 'in_progress']), ymd(sched), done ? ymd(sched) : null, ri(50, 600), ri(20, 400), ri(30, 200), `${pick(SUR)} Auto Works`, phone(), 'Seeded by stress test']).then(() => note('maintenance')).catch((e) => { fails.maintenance = (fails.maintenance || 0) + 1; if (fails.maintenance < 3) console.log('  ! maintenance:', e.message); });
  }

  // ----- summary -----
  const count = async (tbl) => (await db.query(`SELECT count(*)::int n FROM ${tbl} WHERE organization_id=$1`, [org]).catch(() => ({ rows: [{ n: '?' }] }))).rows[0].n;
  const sum = {};
  for (const t of ['hubs', 'suppliers', 'vehicle_models', 'consignments', 'vehicles', 'owners', 'riders', 'users', 'batteries', 'geofences', 'pois', 'devices', 'alerts', 'maintenance']) sum[t] = await count(t);
  sum.contracts = (await db.query('SELECT count(*)::int n FROM sale_contracts c WHERE c.organization_id=$1', [org]).catch(() => ({ rows: [{ n: '?' }] }))).rows[0].n;
  sum.assignments = (await db.query('SELECT count(*)::int n FROM rider_assignments a WHERE a.organization_id=$1', [org]).catch(() => ({ rows: [{ n: '?' }] }))).rows[0].n;
  sum.leads = (await db.query("SELECT count(*)::int n FROM leads WHERE email LIKE $1", ['%.'+RUN+'@example.com']).catch(() => ({ rows: [{ n: '?' }] }))).rows[0].n;
  sum.trips = (await db.query('SELECT count(*)::int n FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE v.organization_id=$1', [org])).rows[0].n;
  sum.positions = (await ts_.query('SELECT count(*)::int n FROM positions WHERE device_id = ANY($1::uuid[])', [(await db.query('SELECT id FROM devices WHERE organization_id=$1', [org])).rows.map((r) => r.id)])).rows[0].n;
  console.log('\nRows now in this organization:'); console.table(sum);
  console.log('Created this run:', JSON.stringify(made));
  if (Object.keys(fails).length) console.log('Failures (first 3 of each printed above):', JSON.stringify(fails));
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s.\nLogin: ${ADMIN} / ${PW}`);
  console.log(`Other logins (same password): finance.1@${D}, hub.manager.1@${D}, dispatcher.1@${D}, investor.1@${D}`);
  await db.end(); await ts_.end();
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
