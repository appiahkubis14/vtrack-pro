/** Edit endpoints + dashboard attention, against the seeded demo org.  API=http://localhost:3000/api node scripts/edit-e2e.js */
const API = process.env.API || 'http://localhost:3000/api';
const PW = 'Demo!Passw0rd#2026'; let ok = 0, bad = 0;
const call = async (m, p, t, b) => { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, d: j && j.data !== undefined ? j.data : j }; };
const chk = (n, c, x) => { c ? (ok++, console.log('  ok   ' + n)) : (bad++, console.log('  FAIL ' + n, x ? JSON.stringify(x) : '')); };
const login = async (u) => (await call('POST', '/auth/login', null, { email: u + '@demo.vtrack.pro', password: PW })).d.accessToken;
(async () => {
  const [admin, fin, rider, inv] = await Promise.all(['admin', 'finance', 'rider', 'investor'].map(login));
  // dashboard attention
  let r = await call('GET', '/dashboard/attention', admin); chk('attention loads for admin', r.s === 200 && r.d.summary && Array.isArray(r.d.items), r);
  chk('admin sees money block', !!r.d.money); r = await call('GET', '/dashboard/attention', rider); chk('rider refused attention', r.s === 403, r);
  r = await call('GET', '/dashboard/attention', inv); chk('investor refused attention', r.s === 403, r);
  // vehicles
  r = await call('GET', '/vehicles?limit=10&search=zzzzqq', admin); chk('vehicle search finds nothing for junk', r.s === 200 && (r.d[0] || r.d.items || r.d).length === 0, r);
  r = await call('GET', '/vehicles?limit=10', rider); chk('rider cannot list vehicles', r.s === 403, r.s);
  const list = (await call('GET', '/vehicles?limit=10', admin)).d; const arr = Array.isArray(list[0]) ? list[0] : (list.items || list); const v = arr.find((x) => x.lifecycleStatus !== 'retired');
  r = await call('PUT', '/vehicles/' + v.id, inv, { color: 'Red' }); chk('investor cannot edit a vehicle', r.s === 403, r.s);
  r = await call('PUT', '/vehicles/' + v.id, admin, { color: 'Blue', organizationId: '00000000-0000-0000-0000-000000000000' }); chk('vehicle edit ok, org field ignored or refused', r.s === 200 || r.s === 400, r.s);
  if (r.s === 200) chk('org unchanged after edit', r.d.organizationId === v.organizationId, r.d);
  r = await call('PUT', '/vehicles/' + v.id, admin, { hubId: '11111111-1111-4111-8111-111111111111' }); chk('foreign hub refused', r.s >= 400 && r.s < 500, r.s);
  r = await call('PUT', '/vehicles/00000000-0000-4000-8000-000000000000', admin, { color: 'x' }); chk('unknown vehicle is 404', r.s === 404, r.s);
  // devices
  const devs = (await call('GET', '/devices?limit=5', admin)).d[0]; const dv = devs[0];
  r = await call('PUT', '/devices/' + dv.id, inv, { name: 'x' }); chk('investor cannot edit a device', r.s === 403, r.s);
  r = await call('PUT', '/devices/' + dv.id, admin, { name: dv.name || 'Tracker', imei: '999999999999999', organizationId: '00000000-0000-0000-0000-000000000000' });
  chk('device edit ok / unknown fields refused', r.s === 200 || r.s === 400, r.s); if (r.s === 200) chk('imei not changed', r.d.imei === dv.imei, r.d);
  r = await call('GET', '/devices/00000000-0000-4000-8000-000000000000', admin); chk('unknown device 404', r.s === 404, r.s);
  // contracts
  const cs = (await call('GET', '/contracts', fin)).d; const active = cs.find((c) => c.status === 'active'); const draft = cs.find((c) => c.status === 'draft');
  if (active) { r = await call('PUT', '/contracts/' + active.id, fin, { pricePesewas: 100 }); chk('running contract price cannot change', r.s >= 400 && r.s < 500, r.s);
    r = await call('PUT', '/contracts/' + active.id, fin, { notes: 'e2e note', gracePeriodHours: 48 }); chk('running contract notes+grace editable', r.s === 200, r); }
  if (draft) { r = await call('PUT', '/contracts/' + draft.id, fin, { depositPesewas: 1000 }); chk('draft contract editable', r.s === 200, r); }
  r = await call('PUT', '/contracts/' + (active || cs[0]).id, rider, { notes: 'x' }); chk('rider cannot edit contract', r.s === 403, r.s);
  // assignments / riders
  r = await call('PUT', '/assignments/00000000-0000-4000-8000-000000000000', admin, { remittancePesewas: 100 }); chk('unknown assignment 404', r.s === 404, r.s);
  r = await call('PUT', '/assignments/00000000-0000-4000-8000-000000000000', rider, {}); chk('rider cannot edit assignments', r.s === 403, r.s);
  // catalog + commercial
  r = await call('POST', '/products', rider, { name: 'x', slug: 'x' + Date.now() }); chk('rider cannot create product', r.s === 403, r.s);
  r = await call('POST', '/products', admin, { name: 'E2E item', slug: 'e2e-' + Date.now(), hardwareType: 'gt06' }); chk('admin creates product', r.s === 201, r.s);
  if (r.s === 201) { const id = r.d.id; r = await call('PUT', `/products/${id}`, admin, { name: 'E2E item 2', id: '00000000-0000-4000-8000-000000000000' }); chk('product edit keeps id', r.s === 200 && r.d.id === id && r.d.name === 'E2E item 2', r.d);
    r = await call('PUT', `/products/${id}`, inv, { name: 'z' }); chk('investor cannot edit product', r.s === 403, r.s); await call('DELETE', `/products/${id}`, admin); }
  r = await call('GET', '/quotes', rider); chk('rider refused quotes', r.s === 403, r.s); r = await call('GET', '/leads', fin); chk('finance refused leads', r.s === 403, r.s);
  // vehicle history
  const hv = arr.find((x) => x.lifecycleStatus === 'assigned') || v;
  r = await call('GET', `/vehicles/${hv.id}/history?days=30`, admin); chk('history loads', r.s === 200 && r.d.totals && Array.isArray(r.d.daily) && r.d.insights.length > 0, r.s);
  chk('history daily covers today', r.s === 200 && r.d.daily[r.d.daily.length - 1].date === new Date().toISOString().slice(0, 10));
  r = await call('GET', `/vehicles/${hv.id}/history/events?days=90&limit=5`, admin); chk('history events page', r.s === 200 && r.d.events.length <= 5 && r.d.events.every((e, i, a) => !i || a[i - 1].at >= e.at), r.s);
  r = await call('GET', `/vehicles/${hv.id}/history/events?types=alert`, admin); chk('history type filter', r.s === 200 && r.d.events.every((e) => e.kind === 'alert'), r.s);
  r = await call('GET', `/vehicles/${hv.id}/history/route?days=30`, admin); chk('history route', r.s === 200 && Array.isArray(r.d.segments), r.s);
  r = await call('GET', `/vehicles/${hv.id}/history?from=bad`, admin); chk('bad date refused', r.s === 400, r.s);
  r = await call('GET', `/vehicles/${hv.id}/history?days=999`, admin); chk('range over 400 days refused', r.s === 400, r.s);
  r = await call('GET', `/vehicles/not-a-uuid/history`, admin); chk('bad id 404', r.s === 404, r.s);
  r = await call('GET', `/vehicles/${hv.id}/history`, rider); chk('rider refused history', r.s === 403, r.s);
  r = await call('GET', `/vehicles/${hv.id}/history`, fin); chk('finance may read history', r.s === 200, r.s);
  r = await call('GET', `/vehicles/00000000-0000-4000-8000-000000000000/history`, admin); chk('unknown vehicle history 404', r.s === 404, r.s);
  // hub scope + driver privacy on history
  const mgr = await login('manager.kumasi'); r = await call('GET', `/vehicles/${hv.id}/history`, mgr); const other = arr.find((x) => x.hubId && x.hubId !== hv.hubId);
  if (other) { r = await call('GET', `/vehicles/${other.id}/history`, mgr); chk('hub manager cannot open another hub vehicle history', r.s === 404, r.s); }
  const now = new Date(); const hh = (h) => String((h + 24) % 24).padStart(2, '0') + ':00'; const offStart = hh(now.getUTCHours() + 2), offEnd = hh(now.getUTCHours() + 4);
  r = await call('PUT', `/map/vehicles/${hv.id}/privacy`, admin, { enabled: true, timezone: 'UTC', workDays: [1, 2, 3, 4, 5, 6, 7], start: offStart, end: offEnd });
  if (r.s === 200 || r.s === 201) {
    const h = await call('GET', `/vehicles/${hv.id}/history?days=30`, admin); chk('privacy: history flags it', h.s === 200 && h.d.privacy === true, h.s);
    chk('privacy: no off-duty distance shown', h.d.totals.distanceKm === 0, h.d.totals.distanceKm);
    const rt = await call('GET', `/vehicles/${hv.id}/history/route?days=30`, admin); chk('privacy: no off-duty route shown', rt.d.segments.length === 0, rt.d.segments.length);
    await call('DELETE', `/map/vehicles/${hv.id}/privacy`, admin);
  } else chk('privacy set for test', false, r.s);
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
