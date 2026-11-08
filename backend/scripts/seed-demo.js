/**
 * Fills a database with a realistic demo organization so every screen has something to inspect, then prints the logins.
 * Uses only the public API (plus psql to link trackers and add sample trips), so it exercises the real rules.
 *   API=http://localhost:3000/api DB_DATABASE=vtrack_test node scripts/seed-demo.js
 * Safe to run once per database: if the demo administrator already exists it stops and prints the logins.
 */
const { execFileSync } = require('child_process');
const API = process.env.API || 'http://localhost:3000/api';
const PW = 'Demo!Passw0rd#2026';
const D = 'demo.vtrack.pro';
const LOGINS = { admin: `admin@${D}`, finance: `finance@${D}`, hubManager: `manager.kumasi@${D}`, investor: `investor@${D}`, rider: `rider@${D}` };

async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json && (json.detail || json.message)}`);
  return json && json.data !== undefined ? json.data : json;
}
const sql = (q) => execFileSync('psql', ['-h', process.env.DB_HOST || 'localhost', '-U', process.env.DB_USERNAME || 'vtrack', '-d', process.env.DB_DATABASE || 'vtrack_test', '-At', '-c', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'vtrack123' } }).toString().trim();
const day = (n) => { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); };
const login = async (email, password) => (await call('POST', '/auth/login', null, { email, password })).accessToken;
const lastDigits = (s) => s.replace(/\D/g, '');

(async () => {
  try {
    await call('POST', '/auth/register', null, { email: LOGINS.admin, password: PW, firstName: 'Kwasi', lastName: 'Mpiani-Brobbe', organizationName: 'V-Track Demo (Ghana)' });
  } catch (e) {
    if (/409|already/i.test(e.message)) { console.log('The demo organization already exists. Logins:'); printLogins(); return; }
    throw e;
  }
  const A = await login(LOGINS.admin, PW);
  console.log('Creating hubs, suppliers, stock...');
  const kumasi = await call('POST', '/hubs', A, { name: 'Kumasi Central Hub', region: 'Ashanti', town: 'Kumasi', assembly: 'Kumasi Metropolitan', status: 'active', gracePeriodHours: 6, latitude: 6.6885, longitude: -1.6244 });
  const tamale = await call('POST', '/hubs', A, { name: 'Tamale Pilot Hub', region: 'Northern', town: 'Tamale', status: 'pilot', latitude: 9.4075, longitude: -0.8534 });
  await call('POST', `/hubs/${kumasi.id}/charge-points`, A, { name: 'Bay 1', powerSource: 'grid' });
  await call('POST', `/hubs/${kumasi.id}/charge-points`, A, { name: 'Solar bay', powerSource: 'solar' });
  const supplier = await call('POST', '/suppliers', A, { name: 'Huodi Electric Vehicles Ltd', country: 'China', contactName: 'Mr Chen', phone: '+86 21 5555 0101', email: 'sales@huodi.example' });
  await call('POST', '/suppliers', A, { name: 'Zonda Motors', country: 'China' });
  const ebike = await call('POST', '/vehicle-models', A, { brand: 'Huodi', name: 'HD-72V Cargo E-bike', vehicleType: 'ebike', batterySpec: '72V 100Ah lithium', listPricePesewas: 1_800_000 });
  await call('POST', '/vehicle-models', A, { brand: 'Zonda', name: 'Aboboyaa Goods Trike', vehicleType: 'trike_goods', batterySpec: '72V 150Ah lithium', listPricePesewas: 3_500_000 });
  const cons = await call('POST', '/consignments', A, { reference: 'HD-2026-01', supplierId: supplier.id, containerNo: 'MSKU7712345', blNumber: 'BL-7788', lines: [{ vehicleModelId: ebike.id, quantity: 8, unitCostPesewas: 1_100_000 }], landedCostPesewas: 480_000 });
  for (const s of ['shipped', 'at_port', 'cleared']) await call('POST', `/consignments/${cons.id}/advance`, A, { status: s });
  const rec = await call('POST', `/consignments/${cons.id}/receive`, A, { counts: [{ lineId: cons.lines[0].id, count: 6 }] });
  await call('POST', `/consignments/${cons.id}/write-offs`, A, { lineId: cons.lines[0].id, units: 1, reason: 'Water damage to the motor controller; supplier credit note pending' });
  const vids = rec.vehicleIds;
  const plates = ['GR 4471-26', 'GR 4472-26', 'AS 2210-26', 'AS 2211-26', 'AS 2212-26', 'NR 1005-26'];
  for (let i = 0; i < 6; i++) await call('PUT', `/business/vehicles/${vids[i]}`, A, { plateNumber: plates[i], chassisNo: `LSH${900100 + i}`, motorNo: `MT-${55100 + i}` });
  await call('POST', `/business/vehicles/${vids[5]}/retire`, A, { reason: 'Frame cracked on arrival, not worth repairing' });

  console.log('Owners, contracts, payments...');
  const mk = (name, phone, extra = {}) => call('POST', '/owners', A, { name, phone, kycStatus: 'verified', ...extra });
  const ama = await mk('Ama Serwaa', '0244100101', { momoNumber: '0244100101', idDocument: 'GHA-723456789-1' });
  const kojo = await mk('Kojo Antwi', '0208100102', { momoNumber: '0208100102' });
  const sme = await mk('Asante Logistics SME', '0322100103', { ownerType: 'sme' });
  const c1 = await call('POST', '/contracts', A, { ownerId: ama.id, vehicleId: vids[0], mode: 'lease', pricePesewas: 1_800_000, depositPesewas: 300_000, termWeeks: 26, startDate: day(30), gracePeriodHours: 24 });
  const c2 = await call('POST', '/contracts', A, { ownerId: ama.id, vehicleId: vids[1], mode: 'outright', pricePesewas: 1_750_000, depositPesewas: 1_750_000, startDate: day(30) });
  const c3 = await call('POST', '/contracts', A, { ownerId: kojo.id, vehicleId: vids[2], mode: 'lease', pricePesewas: 1_800_000, depositPesewas: 200_000, termWeeks: 20, startDate: day(21) });
  const c4 = await call('POST', '/contracts', A, { ownerId: sme.id, vehicleId: vids[3], mode: 'lease', pricePesewas: 1_850_000, depositPesewas: 250_000, termWeeks: 16, startDate: day(14) });
  for (const c of [c1, c2, c3, c4]) await call('POST', `/contracts/${c.id}/activate`, A);
  await call('POST', `/contracts/${c1.id}/payments`, A, { amountPesewas: 180_000, reference: 'MOMO-8812001', method: 'momo', payerName: 'Ama Serwaa' });
  await call('POST', `/contracts/${c3.id}/payments`, A, { amountPesewas: 160_000, reference: 'RCPT-0042', method: 'cash', payerName: 'Kojo Antwi' });
  await call('POST', `/contracts/${c4.id}/payments`, A, { amountPesewas: 50_000, reference: 'MOMO-8812077', method: 'momo' });

  console.log('Logins, riders, assignments...');
  const mkUser = async (body) => { const u = await call('POST', '/team/users', A, body); const t = await login(body.email, u.temporaryPassword); await call('POST', '/account/change-password', t, { currentPassword: u.temporaryPassword, newPassword: PW }); };
  const riders = [];
  for (const [n, p, h] of [['Kofi Boateng', '0551200101', kumasi], ['Yaw Owusu', '0551200102', kumasi], ['Abena Mensah', '0551200103', kumasi], ['Ibrahim Alhassan', '0551200104', tamale]]) {
    riders.push(await call('POST', '/riders', A, { fullName: n, phone: p, hubId: h.id, guarantorName: 'Family member', guarantorPhone: '0244000000' }));
  }
  await mkUser({ email: LOGINS.finance, firstName: 'Efua', lastName: 'Finance', role: 'finance' });
  await mkUser({ email: LOGINS.hubManager, firstName: 'Nana', lastName: 'Kumasi Manager', role: 'hub_manager', hubId: kumasi.id });
  await mkUser({ email: LOGINS.investor, firstName: 'Ama', lastName: 'Serwaa', role: 'investor', ownerId: ama.id });
  await mkUser({ email: LOGINS.rider, firstName: 'Kofi', lastName: 'Boateng', role: 'rider', riderId: riders[0].id });
  const H = await login(LOGINS.hubManager, PW);
  const T = await login(LOGINS.admin, PW);
  const assign = [[0, 0], [1, 1], [2, 2], [3, 3]]; // kofi: ama's lease, yaw: ama's outright, abena: kojo's lease, ibrahim: sme's lease (Tamale)
  for (const [r, v] of assign) await call('POST', '/assignments', r === 3 ? T : H, { riderId: riders[r].id, vehicleId: vids[v], dailyTargetPesewas: 9000, dailyRemittancePesewas: 3000, serviceFeePesewas: 500, startDate: day(8) });

  console.log('Batteries, charging, swaps...');
  const bats = [];
  for (let i = 1; i <= 5; i++) bats.push(await call('POST', '/batteries', A, { serialNo: `BAT-KSI-00${i}`, hubId: kumasi.id }));
  await call('POST', `/batteries/${bats[0].id}/fit`, H, { vehicleId: vids[0] });
  await call('POST', `/batteries/${bats[1].id}/fit`, H, { vehicleId: vids[1] });
  await call('POST', '/battery-swaps', H, { vehicleId: vids[0], batteryInId: bats[2].id, riderId: riders[0].id });
  sql(`UPDATE batteries SET health_pct=91.5, cycle_count=120 WHERE serial_no='BAT-KSI-001'; UPDATE batteries SET health_pct=64.0, cycle_count=410 WHERE serial_no='BAT-KSI-002'; UPDATE batteries SET status='faulty', health_pct=40 WHERE serial_no='BAT-KSI-005'`);

  console.log('Collections and settlements for the last 7 days...');
  for (let n = 7; n >= 1; n--) {
    const date = day(n);
    for (let r = 0; r < 3; r++) {
      let amount = [9200, 8800, 9500][r];
      if (n === 1 && r === 1) amount = 1500;            // Yaw is short yesterday -> shortfall + grace period
      if (n <= 3 && r === 2) amount = 800;               // Abena short for 3 days -> will be locked
      await call('POST', '/collections', H, { riderId: riders[r].id, amountPesewas: amount, date, reference: `KSI-${date}-${r}`, source: r === 1 ? 'momo' : 'cash' });
    }
    await call('POST', '/collections', T, { riderId: riders[3].id, amountPesewas: 7800, date, reference: `TML-${date}`, source: 'cash' });
    await call('POST', '/settlements/calculate', A, { date });
    if (n > 2) for (const h of [kumasi, tamale]) { const l = await call('GET', `/settlements?date=${date}&hubId=${h.id}`, A).catch(() => []); for (const s of l) if (s.status !== 'shortfall') await call('POST', `/settlements/${s.id}/close`, A).catch(() => null); }
  }
  const ce = await call('POST', '/charge-events', H, { batteryId: bats[3].id, riderId: riders[0].id });
  await call('POST', `/charge-events/${ce.id}/finish`, H, { kwh: 4.2, feePesewas: 600 });
  const ce2 = await call('POST', '/charge-events', H, { batteryId: bats[4].id, riderId: riders[1].id }).catch(() => null);
  if (ce2) { await call('POST', `/charge-events/${ce2.id}/finish`, H, { kwh: 3.1, feePesewas: 450 }); await call('POST', `/charge-events/${ce2.id}/pay`, H, { method: 'cash', reference: 'CHG-RCPT-001' }); }

  console.log('Trackers, trips, lock flow, exception, payouts...');
  sql(`INSERT INTO devices (organization_id, vehicle_id, imei, protocol, status) SELECT organization_id, id, '8600000000' || right(id::text,5), 'gt06', 'online' FROM vehicles WHERE id = ANY(ARRAY['${vids[0]}','${vids[1]}','${vids[2]}','${vids[3]}']::uuid[])`);
  for (let n = 6; n >= 1; n--) sql(`INSERT INTO trips (device_id, vehicle_id, start_time, end_time, distance, duration) SELECT d.id, d.vehicle_id, '${day(n)} 06:30', '${day(n)} 08:15', ${18 + n}, 6300 FROM devices d WHERE d.vehicle_id='${vids[0]}'`);
  for (let n = 6; n >= 1; n--) sql(`INSERT INTO trips (device_id, vehicle_id, start_time, end_time, distance, duration) SELECT d.id, d.vehicle_id, '${day(n)} 13:00', '${day(n)} 15:40', ${25 + n}, 9600 FROM devices d WHERE d.vehicle_id='${vids[0]}'`);
  const lock = await call('POST', '/enforcement/lock-requests', H, { vehicleId: vids[2], reason: 'Rider has been short three days running and is not answering calls' });
  await call('POST', `/enforcement/lock-requests/${lock.id}/approve`, A, { note: 'Approved after speaking to the guarantor' });
  await call('POST', '/enforcement/lock-requests', H, { vehicleId: vids[1], reason: 'Suspected misuse of the vehicle at night' });
  await call('POST', '/enforcement/exceptions', H, { riderId: riders[1].id, kind: 'sickness', startsOn: day(0), endsOn: day(-5), reason: 'Rider has malaria, medical note seen' });
  await call('POST', `/hubs/${kumasi.id}/cash-deposits`, H, { amountPesewas: 20_000, method: 'bank', reference: 'GCB-SLIP-44102', note: 'Weekly banking' });
  const bal = await call('GET', '/payments/balances', A);
  const ownerBal = bal.find((b) => b.ownerId === ama.id && b.account === 'owner_account');
  if (ownerBal && ownerBal.balancePesewas > 5000) await call('POST', `/payouts/owners/${ama.id}`, A, { amountPesewas: Math.floor(ownerBal.balancePesewas / 2), method: 'momo', reference: 'MOMO-PAYOUT-0001', note: 'Weekly payout' });
  const rb = bal.find((b) => b.ownerId === riders[0].id && b.account === 'rider_chop');
  if (rb && rb.balancePesewas > 2000) await call('POST', `/payouts/riders/${riders[0].id}`, A, { amountPesewas: 2000, method: 'cash', reference: 'RIDER-PAY-0001' });
  console.log('Done.\n');
  printLogins();
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });

function printLogins() {
  console.log(`Password for every demo login: ${PW}`);
  for (const [k, v] of Object.entries(LOGINS)) console.log(`  ${k.padEnd(12)} ${v}`);
}
