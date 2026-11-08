/**
 * End-to-end test of Phase 1 over HTTP against a running API, signing in as four different roles.
 *   DB_DATABASE=vtrack_test PORT=3000 node dist/src/main.js &
 *   API=http://localhost:3000/api node scripts/http-e2e.js
 * It creates its own organization with random names, so it can be run repeatedly. It needs psql (to link a tracker).
 */
const { execFileSync } = require('child_process');
const API = process.env.API || 'http://localhost:3000/api';
const TAG = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const PW = 'Str0ng!Passw0rd#1';
let passed = 0, failed = 0;
const failures = [];

async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json && json.data !== undefined ? json.data : json, raw: json };
}
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; failures.push(name); console.log('  FAIL ' + name + (extra ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
const expectStatus = (name, r, status) => check(`${name} (${status})`, r.status === status, { got: r.status, body: r.raw });
function sql(q) {
  const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'vtrack123' };
  return execFileSync('psql', ['-h', process.env.DB_HOST || 'localhost', '-U', process.env.DB_USERNAME || 'vtrack', '-d', process.env.DB_DATABASE || 'vtrack_test', '-At', '-c', q], { env }).toString().trim();
}
async function login(email, password) {
  const r = await call('POST', '/auth/login', null, { email, password });
  return { token: r.body && r.body.accessToken, user: r.body && r.body.user, status: r.status };
}

(async () => {
  console.log('== set-up as administrator');
  const email = `admin-${TAG}@example.com`;
  let r = await call('POST', '/auth/register', null, { email, password: PW, firstName: 'Ada', lastName: 'Admin', organizationName: `E2E ${TAG}` });
  expectStatus('register', r, 201);
  const admin = (await login(email, PW)).token;
  check('admin can sign in', !!admin);

  const hubA = (await call('POST', '/hubs', admin, { name: `Hub A ${TAG}`, region: 'Ashanti', gracePeriodHours: 1 })).body;
  const hubB = (await call('POST', '/hubs', admin, { name: `Hub B ${TAG}`, region: 'Volta' })).body;
  check('two hubs created', hubA && hubB);
  expectStatus('grace out of range refused', await call('POST', '/hubs', admin, { name: 'x' + TAG, region: 'R', gracePeriodHours: 500 }), 400);

  console.log('== suppliers, consignment, write-off (BR14)');
  r = await call('POST', '/suppliers', admin, { name: `Huodi ${TAG}`, country: 'China' }); expectStatus('create supplier', r, 201);
  const supplier = r.body;
  expectStatus('duplicate supplier refused', await call('POST', '/suppliers', admin, { name: `Huodi ${TAG}` }), 409);
  const model = (await call('POST', '/vehicle-models', admin, { brand: 'Huodi', name: 'HD-72V', vehicleType: 'ebike', listPricePesewas: 1500000 })).body;
  const REF = `CN-${TAG}`;
  r = await call('POST', '/consignments', admin, { reference: REF, supplierId: supplier.id, lines: [{ vehicleModelId: model.id, quantity: 5, unitCostPesewas: 100000 }], landedCostPesewas: 50000 });
  expectStatus('create consignment with supplier', r, 201);
  const cons = r.body; const lineId = cons.lines[0].id;
  check('supplier name copied onto consignment', cons.supplierName === `Huodi ${TAG}`);
  for (const s of ['shipped', 'at_port', 'cleared']) expectStatus('advance ' + s, await call('POST', `/consignments/${cons.id}/advance`, admin, { status: s }), 201);
  r = await call('POST', `/consignments/${cons.id}/receive`, admin, { counts: [{ lineId, count: 3 }] }); expectStatus('receive 3 of 5', r, 201);
  const vids = r.body.vehicleIds;
  expectStatus('write-off without reason refused', await call('POST', `/consignments/${cons.id}/write-offs`, admin, { lineId, units: 1 }), 400);
  expectStatus('write off more than outstanding refused', await call('POST', `/consignments/${cons.id}/write-offs`, admin, { lineId, units: 3, reason: 'lost at sea' }), 409);
  expectStatus('cannot close with units outstanding', await call('POST', `/consignments/${cons.id}/advance`, admin, { status: 'closed' }), 400);
  r = await call('POST', `/consignments/${cons.id}/write-offs`, admin, { lineId, units: 2, reason: 'Damaged in transit - container water ingress' }); expectStatus('write off 2 units with a reason', r, 201);
  check('consignment received once all units registered or written off', (await call('GET', `/consignments/${cons.id}`, admin)).body.status === 'received');
  expectStatus('close consignment', await call('POST', `/consignments/${cons.id}/advance`, admin, { status: 'closed' }), 201);
  check('write-off row stored with reason', sql(`SELECT COUNT(*) FROM write_offs WHERE consignment_line_id='${lineId}' AND reason LIKE 'Damaged%'`) === '1');

  console.log('== vehicle edit and retire');
  r = await call('PUT', `/business/vehicles/${vids[0]}`, admin, { plateNumber: `GR-${TAG}-A`, chassisNo: `CH${TAG}`, motorNo: `MO${TAG}` }); expectStatus('edit plate, chassis, motor', r, 200);
  expectStatus('duplicate plate refused', await call('PUT', `/business/vehicles/${vids[1]}`, admin, { plateNumber: `GR-${TAG}-A` }), 409);
  await call('PUT', `/business/vehicles/${vids[1]}`, admin, { plateNumber: `GR-${TAG}-B` });
  await call('PUT', `/business/vehicles/${vids[2]}`, admin, { plateNumber: `GR-${TAG}-C` });
  expectStatus('retire needs a reason', await call('POST', `/business/vehicles/${vids[2]}/retire`, admin, {}), 400);
  expectStatus('retire vehicle', await call('POST', `/business/vehicles/${vids[2]}/retire`, admin, { reason: 'Frame cracked, beyond repair' }), 201);
  expectStatus('retired vehicle cannot be edited', await call('PUT', `/business/vehicles/${vids[2]}`, admin, { color: 'red' }), 409);

  console.log('== owner, contract (grace override), payments with purpose and payer');
  const owner = (await call('POST', '/owners', admin, { name: `Ama ${TAG}`, phone: `024${TAG}1`, kycStatus: 'verified' })).body;
  const owner2 = (await call('POST', '/owners', admin, { name: `Kojo ${TAG}`, phone: `024${TAG}2`, kycStatus: 'verified' })).body;
  expectStatus('grace period out of range on contract refused', await call('POST', '/contracts', admin, { ownerId: owner.id, vehicleId: vids[0], mode: 'lease', pricePesewas: 900000, depositPesewas: 100000, termWeeks: 10, gracePeriodHours: 0 }), 400);
  const c1 = (await call('POST', '/contracts', admin, { ownerId: owner.id, vehicleId: vids[0], mode: 'lease', pricePesewas: 900000, depositPesewas: 100000, termWeeks: 10, gracePeriodHours: 2 })).body;
  const c2 = (await call('POST', '/contracts', admin, { ownerId: owner2.id, vehicleId: vids[1], mode: 'outright', pricePesewas: 800000, depositPesewas: 800000 })).body;
  expectStatus('activate lease', await call('POST', `/contracts/${c1.id}/activate`, admin), 201);
  expectStatus('activate outright', await call('POST', `/contracts/${c2.id}/activate`, admin), 201);
  expectStatus('installment payment by MoMo', await call('POST', `/contracts/${c1.id}/payments`, admin, { amountPesewas: 80000, reference: `MOMO-${TAG}-1`, method: 'momo', payerName: 'Ama (sister)' }), 201);
  const dupPay = await call('POST', `/contracts/${c1.id}/payments`, admin, { amountPesewas: 80000, reference: `MOMO-${TAG}-1`, method: 'momo' });
  check('same payment reference twice changes nothing', dupPay.body && dupPay.body.duplicate === true, dupPay.raw);
  const pays = (await call('GET', `/payments?partyId=${owner.id}`, admin)).body;
  check('payments list shows deposit and installment with purpose and payer', pays.some((p) => p.purpose === 'deposit') && pays.some((p) => p.purpose === 'installment' && p.method === 'momo' && p.partyName === 'Ama (sister)'), pays);

  console.log('== riders and logins for each role');
  const rider = (await call('POST', '/riders', admin, { fullName: `Kofi ${TAG}`, phone: `055${TAG}1`, hubId: hubA.id })).body;
  const rider2 = (await call('POST', '/riders', admin, { fullName: `Yaw ${TAG}`, phone: `055${TAG}2`, hubId: hubB.id })).body;
  r = await call('POST', '/team/users', admin, { email: `hub-${TAG}@example.com`, firstName: 'Hub', lastName: 'Manager', role: 'hub_manager', hubId: hubA.id }); expectStatus('create hub manager login', r, 201);
  const hmPw = r.body.temporaryPassword; check('temporary password is returned once and is strong', hmPw && hmPw.length >= 12);
  r = await call('POST', '/team/users', admin, { email: `inv-${TAG}@example.com`, firstName: 'Ama', role: 'investor', ownerId: owner.id }); expectStatus('create investor login', r, 201); const invPw = r.body.temporaryPassword;
  r = await call('POST', '/team/users', admin, { email: `rider-${TAG}@example.com`, firstName: 'Kofi', role: 'rider', riderId: rider.id }); expectStatus('create rider login', r, 201); const rdPw = r.body.temporaryPassword;
  expectStatus('investor without owner refused', await call('POST', '/team/users', admin, { email: `x-${TAG}@example.com`, firstName: 'X', role: 'investor' }), 400);
  expectStatus('second login for the same owner refused', await call('POST', '/team/users', admin, { email: `y-${TAG}@example.com`, firstName: 'Y', role: 'investor', ownerId: owner.id }), 409);
  expectStatus('duplicate email refused', await call('POST', '/team/users', admin, { email: `hub-${TAG}@example.com`, firstName: 'Z', role: 'finance' }), 409);
  expectStatus('cannot create a super_admin', await call('POST', '/team/users', admin, { email: `s-${TAG}@example.com`, firstName: 'S', role: 'super_admin' }), 400);
  const hmL = await login(`hub-${TAG}@example.com`, hmPw); check('hub manager signs in and is told to change the password', hmL.token && hmL.user.mustChangePassword === true, hmL);
  expectStatus('weak new password refused', await call('POST', '/account/change-password', hmL.token, { currentPassword: hmPw, newPassword: 'short' }), 400);
  expectStatus('wrong current password refused', await call('POST', '/account/change-password', hmL.token, { currentPassword: 'nope', newPassword: 'N3w!Passw0rd#2x' }), 401);
  expectStatus('change password', await call('POST', '/account/change-password', hmL.token, { currentPassword: hmPw, newPassword: 'N3w!Passw0rd#2x' }), 201);
  const hm = (await login(`hub-${TAG}@example.com`, 'N3w!Passw0rd#2x')).token; check('hub manager signs in with the new password', !!hm);
  const inv = (await login(`inv-${TAG}@example.com`, invPw)).token;
  const rd = (await login(`rider-${TAG}@example.com`, rdPw)).token;
  check('investor and rider can sign in', inv && rd);
  expectStatus('hub manager cannot list users', await call('GET', '/team/users', hm), 403);
  check('admin sees the users with their links', (await call('GET', '/team/users', admin)).body.some((u) => u.role === 'hub_manager' && u.hubName === hubA.name));

  console.log('== assignment, collections, settlement shortfall -> grace -> lock -> unlock');
  r = await call('POST', '/assignments', hm, { riderId: rider.id, vehicleId: vids[0], dailyTargetPesewas: 8000, dailyRemittancePesewas: 3000, serviceFeePesewas: 500, startDate: '2026-11-01' }); expectStatus('hub manager assigns rider to vehicle', r, 201);
  check('rider daily debit mirrors the remittance (GHS 30)', sql(`SELECT daily_target_amount FROM riders WHERE id='${rider.id}'`) === '30.00');
  const DATE = '2026-11-03';
  await call('POST', '/collections', hm, { riderId: rider.id, amountPesewas: 1000, date: DATE, reference: `RC-${TAG}-1` });
  r = await call('POST', '/settlements/calculate', hm, { date: DATE, hubId: hubA.id }); expectStatus('calculate settlement', r, 201);
  const sett = r.body.find((s) => s.riderId === rider.id);
  check('short collection gives a shortfall', sett && sett.status === 'shortfall', r.body);
  await new Promise((s) => setTimeout(s, 1500));
  let states = (await call('GET', '/enforcement/states', hm)).body;
  const st = states.find((s) => s.vehicleId === vids[0]);
  check('shortfall started a grace period of 2 hours (contract beats hub)', st && st.state === 'warning_sent' && st.graceHours === 2, states);
  check('hub manager sees only their hub in lock states', states.every((s) => s.hubId === hubA.id));

  r = await call('POST', '/enforcement/lock-requests', hm, { vehicleId: vids[0], reason: '' }); expectStatus('lock request needs a reason', r, 400);
  r = await call('POST', '/enforcement/lock-requests', hm, { vehicleId: vids[0], reason: 'Rider unreachable for 3 days' }); expectStatus('hub manager requests a lock', r, 201);
  const lockReq = r.body;
  expectStatus('duplicate pending request refused', await call('POST', '/enforcement/lock-requests', hm, { vehicleId: vids[0], reason: 'again please' }), 409);
  expectStatus('hub manager cannot approve', await call('POST', `/enforcement/lock-requests/${lockReq.id}/approve`, hm, {}), 403);
  // no tracker is linked yet: approval is accepted but the lock fails clearly instead of pretending
  r = await call('POST', `/enforcement/lock-requests/${lockReq.id}/approve`, admin, {}); expectStatus('admin approves', r, 201);
  check('without a tracker the lock reports failure', r.body.request.status === 'failed' && /tracker/.test(r.body.request.resultNote || ''), r.body);
  // link a tracker, ask again
  sql(`INSERT INTO devices (organization_id, vehicle_id, imei, protocol, status) SELECT organization_id, id, '86${TAG}0000001', 'gt06', 'online' FROM vehicles WHERE id='${vids[0]}'`);
  r = await call('POST', '/enforcement/lock-requests', hm, { vehicleId: vids[0], reason: 'Rider unreachable for 3 days' }); expectStatus('new lock request', r, 201);
  r = await call('POST', `/enforcement/lock-requests/${r.body.id}/approve`, admin, {}); expectStatus('admin approves with tracker linked', r, 201);
  check('vehicle is locked and a command was sent', r.body.result && r.body.result.locked === true && !!r.body.result.commandId, r.body);
  states = (await call('GET', '/enforcement/states', admin)).body;
  check('state is immobilized', states.find((s) => s.vehicleId === vids[0]).state === 'immobilized');
  const hubB_hm = await call('POST', '/enforcement/unlock', hm, { vehicleId: vids[0], reason: '' }); expectStatus('unlock needs a reason', hubB_hm, 400);
  r = await call('POST', '/enforcement/unlock', hm, { vehicleId: vids[0], reason: 'Rider paid GHS 20 in cash at the hub' }); expectStatus('hub manager unlocks with a reason', r, 201);
  states = (await call('GET', '/enforcement/states', admin)).body;
  const after = states.find((s) => s.vehicleId === vids[0]);
  check('state cleared with the reason stored', after.state === 'none' && after.unlockReason === 'Rider paid GHS 20 in cash at the hub', after);
  expectStatus('unlock of an unlocked vehicle refused', await call('POST', '/enforcement/unlock', hm, { vehicleId: vids[0], reason: 'again' }), 409);

  console.log('== shortfall cleared by a later payment releases the grace period');
  await call('POST', '/collections', hm, { riderId: rider.id, amountPesewas: 6000, date: '2026-11-04', reference: `RC-${TAG}-2` });
  // fresh shortfall on day 5 starts grace again, then topping it up and recalculating clears it
  await call('POST', '/collections', hm, { riderId: rider.id, amountPesewas: 500, date: '2026-11-05', reference: `RC-${TAG}-3` });
  await call('POST', '/settlements/calculate', hm, { date: '2026-11-05', hubId: hubA.id });
  await new Promise((s) => setTimeout(s, 1200));
  check('new shortfall opens grace again', (await call('GET', '/enforcement/states', hm)).body.find((s) => s.vehicleId === vids[0]).state === 'warning_sent');
  await call('POST', '/collections', hm, { riderId: rider.id, amountPesewas: 6000, date: '2026-11-05', reference: `RC-${TAG}-4` });
  await call('POST', '/settlements/calculate', hm, { date: '2026-11-05', riderId: rider.id });
  await new Promise((s) => setTimeout(s, 1200));
  check('paying the shortfall stops the grace period', (await call('GET', '/enforcement/states', hm)).body.find((s) => s.vehicleId === vids[0]).state === 'none');

  console.log('== rider exception (BR17, proposed)');
  await call('POST', '/collections', hm, { riderId: rider.id, amountPesewas: 100, date: '2026-11-06', reference: `RC-${TAG}-5` });
  expectStatus('exception needs a reason', await call('POST', '/enforcement/exceptions', hm, { riderId: rider.id, kind: 'sickness', startsOn: '2026-11-06', endsOn: '2026-11-30', reason: '' }), 400);
  expectStatus('exception end before start refused', await call('POST', '/enforcement/exceptions', hm, { riderId: rider.id, kind: 'sickness', startsOn: '2026-11-30', endsOn: '2026-11-06', reason: 'Malaria' }), 400);
  r = await call('POST', '/enforcement/exceptions', hm, { riderId: rider.id, kind: 'sickness', startsOn: '2026-11-01', endsOn: '2026-12-31', reason: 'Admitted to hospital' }); expectStatus('approve an exception', r, 201);
  await call('POST', '/settlements/calculate', hm, { date: '2026-11-06', hubId: hubA.id });
  await new Promise((s) => setTimeout(s, 1200));
  check('no grace period while an exception is active', (await call('GET', '/enforcement/states', hm)).body.find((s) => s.vehicleId === vids[0]).state === 'none');
  expectStatus('hub manager cannot create an exception for another hub rider', await call('POST', '/enforcement/exceptions', hm, { riderId: rider2.id, kind: 'leave', startsOn: '2026-11-06', endsOn: '2026-11-07', reason: 'Leave' }), 403);

  console.log('== charge payment, payouts, hub deposits (ledger flows)');
  const bat = (await call('POST', '/batteries', admin, { serialNo: `B-${TAG}`, hubId: hubA.id })).body;
  r = await call('POST', '/charge-events', hm, { batteryId: bat.id, riderId: rider.id }); expectStatus('start charge', r, 201);
  const ce = r.body;
  expectStatus('pay before finish refused', await call('POST', `/charge-events/${ce.id}/pay`, hm, { method: 'cash', reference: `CP-${TAG}` }), 409);
  expectStatus('finish charge', await call('POST', `/charge-events/${ce.id}/finish`, hm, { kwh: 3, feePesewas: 700 }), 201);
  r = await call('POST', `/charge-events/${ce.id}/pay`, hm, { method: 'cash', reference: `CP-${TAG}` }); expectStatus('pay the charge directly', r, 201);
  expectStatus('pay twice refused', await call('POST', `/charge-events/${ce.id}/pay`, hm, { method: 'cash', reference: `CP-${TAG}-2` }), 409);
  check('charge event is paid and linked to its payment', sql(`SELECT status || ':' || (payment_id IS NOT NULL) FROM charge_events WHERE id='${ce.id}'`) === 'paid:true');

  const bal = (await call('GET', '/payments/balances', admin)).body;
  const ownerBal = bal.find((b) => b.ownerId === owner.id && b.account === 'owner_account');
  const hubBal = bal.find((b) => b.ownerId === hubA.id && b.account === 'hub_collections');
  check('balances show what is owed and what hubs hold', hubBal && hubBal.balancePesewas > 0, bal);
  expectStatus('hub deposit above the held cash refused', await call('POST', `/hubs/${hubA.id}/cash-deposits`, hm, { amountPesewas: hubBal.balancePesewas + 1, method: 'cash', reference: `HD-${TAG}-big` }), 409);
  r = await call('POST', `/hubs/${hubA.id}/cash-deposits`, hm, { amountPesewas: 1000, method: 'bank', reference: `HD-${TAG}-1` }); expectStatus('hub deposits cash', r, 201);
  const dupHd = await call('POST', `/hubs/${hubA.id}/cash-deposits`, hm, { amountPesewas: 1000, method: 'bank', reference: `HD-${TAG}-1` });
  check('same deposit reference twice changes nothing', dupHd.body.duplicate === true);
  expectStatus('hub manager cannot deposit for another hub', await call('POST', `/hubs/${hubB.id}/cash-deposits`, hm, { amountPesewas: 10, method: 'cash', reference: `HD-${TAG}-x` }), 403);
  expectStatus('hub manager cannot pay out owners', await call('POST', `/payouts/owners/${owner.id}`, hm, { amountPesewas: 1, method: 'momo', reference: `PO-${TAG}-x` }), 403);
  const owed = ownerBal ? ownerBal.balancePesewas : 0;
  expectStatus('payout above what is owed refused', await call('POST', `/payouts/owners/${owner.id}`, admin, { amountPesewas: owed + 1, method: 'momo', reference: `PO-${TAG}-big` }), 409);
  if (owed > 0) expectStatus('owner payout', await call('POST', `/payouts/owners/${owner.id}`, admin, { amountPesewas: Math.min(owed, 1000), method: 'momo', reference: `PO-${TAG}-1` }), 201);
  const riderBal = bal.find((b) => b.ownerId === rider.id && b.account === 'rider_chop');
  if (riderBal && riderBal.balancePesewas > 0) {
    expectStatus('rider payout', await call('POST', `/payouts/riders/${rider.id}`, admin, { amountPesewas: Math.min(riderBal.balancePesewas, 500), method: 'cash', reference: `PR-${TAG}-1` }), 201);
    expectStatus('rider payout above owed refused', await call('POST', `/payouts/riders/${rider.id}`, admin, { amountPesewas: riderBal.balancePesewas * 10, method: 'cash', reference: `PR-${TAG}-2` }), 409);
  } else check('rider has chop money to pay out', false, bal);
  const tb = (await call('GET', '/ledger/trial-balance', admin)).body;
  check('the ledger still balances after every flow', tb.balanced === true, tb);

  console.log('== investor portal and role limits');
  r = await call('GET', '/portal/investor', inv); expectStatus('investor portal', r, 200);
  check('investor sees only their own vehicle and contract', r.body.vehicles.length === 1 && r.body.contracts.length === 1 && r.body.vehicles[0].plateNumber === `GR-${TAG}-A`, r.body);
  check('investor statement includes payback progress', r.body.statements[0].vehicles[0].payback && 'progressPct' in r.body.statements[0].vehicles[0].payback, r.body.statements);
  expectStatus('investor cannot open the rider portal', await call('GET', '/portal/rider', inv), 403);
  expectStatus('investor cannot read another owner statement', await call('GET', `/business-reports/owner-statement?ownerId=${owner2.id}&from=2026-11-01&to=2026-11-30`, inv), 403);
  expectStatus('investor cannot see the ledger', await call('GET', '/ledger/trial-balance', inv), 403);
  expectStatus('investor cannot record a payment', await call('POST', `/contracts/${c1.id}/payments`, inv, { amountPesewas: 1, reference: 'x' }), 403);
  expectStatus('investor cannot see lock states', await call('GET', '/enforcement/states', inv), 403);
  expectStatus('investor cannot read the audit trail', await call('GET', '/audit/logs', inv), 403);

  console.log('== rider portal');
  r = await call('GET', '/portal/rider', rd); expectStatus('rider portal', r, 200);
  check('rider sees own assignment, settlements and balance', r.body.rider.fullName === `Kofi ${TAG}` && r.body.assignment.dailyRemittancePesewas === 3000 && r.body.settlements.length >= 1 && typeof r.body.chopBalancePesewas === 'number', r.body);
  expectStatus('rider cannot open the investor portal', await call('GET', '/portal/investor', rd), 403);
  expectStatus('rider cannot list riders', await call('GET', '/riders', rd), 403);
  expectStatus('rider cannot list contracts', await call('GET', '/contracts', rd), 403);

  console.log('== hub manager limits');
  const hubs = (await call('GET', '/hubs', hm)).body;
  check('hub manager sees only their own hub', Array.isArray(hubs) && hubs.length === 1 && hubs[0].id === hubA.id, hubs);
  expectStatus("hub manager cannot read the other hub's close", await call('GET', `/business-reports/hub-daily-close?hubId=${hubB.id}&date=${DATE}`, hm), 403);
  expectStatus("hub manager cannot read another hub's rider statement", await call('GET', `/business-reports/rider-statement?riderId=${rider2.id}&from=2026-11-01&to=2026-11-30`, hm), 403);
  expectStatus('hub manager cannot write off units', await call('POST', `/consignments/${cons.id}/write-offs`, hm, { lineId, reason: 'x' }), 403);
  expectStatus('hub manager cannot create users', await call('POST', '/team/users', hm, { email: `q-${TAG}@example.com`, firstName: 'Q', role: 'viewer' }), 403);

  console.log('== reports');
  r = await call('GET', `/business-reports/rider-statement?riderId=${rider.id}&from=2026-11-01&to=2026-11-30`, hm); expectStatus('rider statement', r, 200);
  check('rider statement carries a routes section', Array.isArray(r.body.routes) && r.body.routeTotals !== undefined, r.body);
  sql(`INSERT INTO trips (device_id, vehicle_id, start_time, end_time, distance, duration) SELECT d.id, d.vehicle_id, '2026-11-03 07:00', '2026-11-03 08:10', 12.5, 4200 FROM devices d WHERE d.vehicle_id='${vids[0]}'`);
  r = await call('GET', `/business-reports/rider-statement?riderId=${rider.id}&from=2026-11-01&to=2026-11-30`, hm);
  check('trips on the assigned vehicle appear as daily routes', r.body.routes.length === 1 && r.body.routes[0].trips === 1 && r.body.routes[0].distance === 12.5, r.body.routes);
  r = await call('GET', '/business-reports/fleet-health', admin); expectStatus('fleet health', r, 200);
  check('fleet health lists vehicle states and battery stats', r.body.vehiclesByStatus.length > 0 && r.body.batteryStats.total >= 1, r.body);
  for (const dim of ['vehicle', 'region', 'vehicle_type']) {
    r = await call('GET', `/business-reports/summary-by?dimension=${dim}&from=2026-11-01&to=2026-11-30`, admin);
    check(`summary by ${dim}`, r.status === 200 && r.body.rows.length >= 1, r.raw);
  }
  expectStatus('bad dimension refused', await call('GET', '/business-reports/summary-by?dimension=colour&from=2026-11-01&to=2026-11-30', admin), 400);
  r = await call('GET', '/business-reports/summary-by?dimension=region&from=2026-11-01&to=2026-11-30', hm);
  check('hub manager summary is limited to their region', r.status === 200 && r.body.rows.every((x) => x.label === 'Ashanti'), r.raw);

  console.log('== audit trail');
  await new Promise((s) => setTimeout(s, 800));
  r = await call('GET', '/audit/logs?limit=500', admin); expectStatus('admin reads audit trail', r, 200);
  const logs = r.body;
  const actions = JSON.stringify(logs);
  check('business actions are logged', logs.length > 20 && /payouts|cash-deposits|lock-requests|team\/users/.test(actions), logs.slice(0, 2));
  check('enforcement actions are logged', logs.some((l) => String(l.action).startsWith('enforcement.')));
  check('reads of personal data are logged', logs.some((l) => /^get/i.test(String(l.action)) && /portal|owners|statement|ledger/.test(JSON.stringify(l))), logs.slice(0, 3));
  check('secrets never reach the audit trail', !/Str0ng|N3w!Passw0rd|temporaryPassword/.test(actions));
  check('audit trail only shows this organization', logs.every((l) => !l.organizationId || l.organizationId === logs[0].organizationId));
  check('audit rows cannot be changed in the database', (() => { try { sql(`UPDATE audit_logs SET action='x' WHERE id=(SELECT id FROM audit_logs LIMIT 1)`); return false; } catch { return true; } })());
  check('audit rows cannot be deleted in the database', (() => { try { sql(`DELETE FROM audit_logs WHERE id=(SELECT id FROM audit_logs LIMIT 1)`); return false; } catch { return true; } })());
  const am = await login(`inv-${TAG}@example.com`, invPw);
  expectStatus('deactivated user cannot sign in', await (async () => { const u = (await call('GET', '/team/users', admin)).body.find((x) => x.email === `inv-${TAG}@example.com`); await call('POST', `/team/users/${u.id}/deactivate`, admin); return call('POST', '/auth/login', null, { email: `inv-${TAG}@example.com`, password: invPw }); })(), 401);
  void am;

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
