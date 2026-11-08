/**
 * Live map, advanced layer: breakdown risk and high-risk areas, vehicle CAN/sensor readings, delivery dispatch (ETA, delay risk,
 * route options with reasoning, customer messages), zone checklists, vehicle groups and zone rules, bulk zone import, sensor assets,
 * charging availability, camera links, driver privacy hours and per-person hub access, moving-zone proximity.
 * Plugs into js/vtrack-map.js through window.VMap (its hook object H).
 */
(function () {
  'use strict';
  const M = window.VMap; if (!M) return;
  const { map, S, H, API, $, esc, toast, call, dialog, modal, val, store, fmtTime, fmtDur, fmtKm, ago } = M;
  const A = { jobs: new Map(), board: null, risk: [], tasks: [], taskFilter: 'pending', groups: [], assets: [], seenDp: new Set(), seenTk: new Set(), firstDp: true, tab: 'assets', advice: null };
  const routeLayer = L.layerGroup().addTo(map), assetLayer = L.layerGroup().addTo(map), adviceLayer = L.layerGroup().addTo(map), riskLayer = L.layerGroup();
  let riskHeat = null;
  const canEdit = () => !!S.cfg?.canEdit;
  const pill = (cls, text) => `<span class="vm-pill-s ${cls}">${text}</span>`;
  const RISK_LABEL = { low: 'Low', medium: 'Watch', high: 'High' };
  const JOB_LABEL = { arrived: 'Arrived', no_deadline: 'No deadline', on_time: 'On time', at_risk: 'At risk', late: 'Late', unknown: 'ETA unknown' };
  const EVENT_LABEL = { eta_changed: 'ETA changed', off_route: 'Left the planned route', rerouted: 'Route replanned', arrived: 'Arrived', delay_risk: 'May miss its deadline' };
  const eventIcon = { eta_changed: 'bi-clock-history', off_route: 'bi-sign-turn-slight-right', rerouted: 'bi-signpost-split', arrived: 'bi-flag-fill', delay_risk: 'bi-exclamation-triangle-fill' };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const badge = (id, n) => { const b = $(id); if (b) { b.textContent = n; b.classList.toggle('d-none', !n); } };
  const vehicleOptions = (sel) => [...S.fleet.values()].sort((a, b) => a.plate.localeCompare(b.plate)).map((v) => `<option value="${v.id}" ${sel === v.id ? 'selected' : ''}>${esc(v.plate)}</option>`).join('');
  const eventText = (e) => { const d = typeof e.detail === 'string' ? safeJson(e.detail) : e.detail || {}; if (e.kind === 'delay_risk') return `ETA ${d.etaMinutes} min, about ${d.lateByMinutes} min late`; if (e.kind === 'off_route') return `${d.deviationM} m away from the route`; if (e.kind === 'eta_changed') return d.to != null ? `${d.from != null ? d.from + ' → ' : ''}${d.to} min${d.congested ? ', congestion' : ''}` : esc(d.reason || ''); return esc(d.reason || d.label || ''); };
  const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };
  const downloadText = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

  // ================================================================ popup: readings, risk, delivery, video
  function telemetryHtml(v) {
    const t = v.telemetry; if (!t) return '';
    const cell = (label, value, cls) => `<div class="${cls || ''}"><b>${value}</b><small>${label}</small></div>`;
    const c = [];
    if (t.fuelLevel != null) c.push(cell('Fuel', `${Math.round(t.fuelLevel)}%`, t.fuelLevel <= 10 ? 'bad' : t.fuelLevel <= 20 ? 'warn' : ''));
    if (t.soc != null) c.push(cell('Charge', `${Math.round(t.soc)}%`, t.soc <= 15 ? 'bad' : t.soc <= 25 ? 'warn' : ''));
    if (t.rpm != null) c.push(cell('RPM', Math.round(t.rpm)));
    if (t.coolantTemp != null) c.push(cell('Coolant', `${Math.round(t.coolantTemp)}°C`, t.coolantTemp >= 105 ? 'bad' : t.coolantTemp >= 95 ? 'warn' : ''));
    if (t.motorTemp != null) c.push(cell('Motor', `${Math.round(t.motorTemp)}°C`, t.motorTemp >= 100 ? 'bad' : t.motorTemp >= 85 ? 'warn' : ''));
    if (t.batteryVoltage != null) c.push(cell('Battery', `${(+t.batteryVoltage).toFixed(1)} V`));
    if (t.temperatureC != null) c.push(cell('Cargo temp', `${(+t.temperatureC).toFixed(1)}°C`));
    if (t.doorOpen != null) c.push(cell('Door', t.doorOpen ? 'Open' : 'Closed', t.doorOpen ? 'warn' : ''));
    const dtc = Array.isArray(t.dtc) && t.dtc.length ? `<div class="box high"><b>Fault codes:</b> ${t.dtc.map(esc).join(', ')}</div>` : '';
    return (c.length ? `<div class="tel">${c.join('')}</div>` : '') + dtc;
  }
  function riskHtml(v) {
    const r = v.risk; if (!r || r.level === 'low') return '';
    return `<div class="box ${r.level === 'high' ? 'high' : ''}"><b>${r.level === 'high' ? 'High' : 'Elevated'} breakdown risk</b> (${r.score}/100)<ul class="why mb-0">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }
  function jobHtml(v) {
    const j = A.jobs.get(v.id), d = v.destination; if (!d) return '';
    const st = j ? `${pill(j.risk, JOB_LABEL[j.risk])} ` : '';
    const slack = j && j.slackMinutes != null ? (j.slackMinutes < 0 ? `late by ${-j.slackMinutes} min` : `${j.slackMinutes} min to spare`) : '';
    return `<div class="box ${j?.risk === 'late' ? 'high' : j?.risk === 'arrived' ? 'ok' : ''}">${st}${d.dueAt ? `Due ${esc(timeOf(d.dueAt))}` : ''} ${slack ? `&middot; ${slack}` : ''}${d.customerName ? `<div>Customer: ${esc(d.customerName)}${d.notifyCustomer ? ' <i class="bi bi-bell-fill" title="Customer is notified of changes"></i>' : ''}</div>` : ''}</div>`;
  }
  H.popup = (v) => {
    if (v.offDuty) return '<div class="box">Off duty: the position is hidden outside working hours (driver privacy).</div>';
    return telemetryHtml(v) + riskHtml(v) + jobHtml(v) + (v.position?.snapped ? '<div class="text-muted" style="font-size:.7rem"><i class="bi bi-sign-turn-right"></i> Shown on the road</div>' : '');
  };
  H.acts = (v) => `<button class="btn btn-outline-primary" data-act="video"><i class="bi bi-camera-video"></i> Video</button>
    ${v.position ? '<button class="btn btn-outline-primary" data-act="advice"><i class="bi bi-signpost-split"></i> Route options</button>' : ''}
    ${canEdit() && v.destination ? '<button class="btn btn-outline-primary" data-act="check"><i class="bi bi-arrow-repeat"></i> Check ETA</button>' : ''}`;
  H.act = (act, id) => {
    if (act === 'video') cameraDialog(id);
    if (act === 'advice') adviceFor(id);
    if (act === 'check') call(async () => { await API.post('/map/dispatch/check', { vehicleId: id }); toast('ETA and route checked'); await M.loadFleet(false); loadBoard(); });
  };

  // ================================================================ replay note and zone form
  H.replayNote = (h) => {
    const m = h.matching, pr = h.privacy;
    return (m ? `<div class="alert ${m.method === 'osrm' ? 'alert-info' : 'alert-warning'} py-1 small mt-2">${m.method === 'osrm' ? `Snapped to the road network (${Math.round(m.snappedShare * 100)}% of points moved onto a road; points that could not be matched, or that disagree with the heading or speed, stay where they were).` : esc(m.note || 'Road snapping is not available, so the raw GPS is shown.')}</div>` : '')
      + (pr && pr.hiddenPoints ? `<div class="alert alert-secondary py-1 small mt-2"><i class="bi bi-person-lock"></i> ${esc(pr.note || 'Positions outside working hours are hidden.')}</div>` : '');
  };
  const RULES = { notify: 'Just notify', restricted: 'Restricted: entering is a violation', allowed: 'Allowed area: leaving is a violation', lez: 'Low-emission zone: non-electric vehicles violate' };
  H.zoneTag = (g) => (g.rule && g.rule !== 'notify' ? `<span class="badge ${g.rule === 'allowed' ? 'bg-info text-dark' : 'bg-danger'}" title="${esc(RULES[g.rule])}">${g.rule === 'lez' ? 'LEZ' : g.rule}</span> ` : '');
  H.zoneForm = (g) => {
    const mine = new Set(S.zoneGroups.get(g.id) || []);
    return `<div class="mb-2"><label class="form-label">Rule</label><select id="zf-rule" class="form-select">${Object.entries(RULES).map(([k, t]) => `<option value="${k}" ${(g.rule || 'notify') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <div class="form-text">A violation raises a high-priority alert and marks the vehicle on the map.</div></div>
      ${A.groups.length ? `<div class="mb-2"><label class="form-label">Applies to</label><div id="zf-groups" class="d-flex flex-wrap gap-2">${A.groups.map((x) => `<label class="vm-chip ${mine.has(x.id) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" value="${x.id}" ${mine.has(x.id) ? 'checked' : ''} class="d-none" onchange="this.parentNode.classList.toggle('on',this.checked)"><span class="vm-dot" style="background:${esc(x.color)}"></span>${esc(x.name)}</label>`).join('')}</div><div class="form-text">None selected means every vehicle.</div></div>` : ''}`;
  };
  H.zoneBody = () => ({ rule: $('zf-rule')?.value || 'notify' });
  H.zoneAfter = async (id) => {
    const box = $('zf-groups'); if (!box || !id) return;
    const ids = [...box.querySelectorAll('input:checked')].map((i) => i.value);
    await API.put(`/map/geofences/${id}/groups`, { groupIds: ids });
    await loadGroups();
  };
  H.zonesDrawn = () => { /* styling is done by dash patterns in the core */ };

  // destination extras
  H.destForm = (d) => {
    const due = d?.dueAt ? new Date(new Date(d.dueAt).getTime() - new Date(d.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    return `<hr><div class="fw-semibold small mb-1">Delivery (optional)</div>
      <div class="row g-2 mb-2"><div class="col-6"><label class="form-label small mb-0">Customer name</label><input id="df-cname" class="form-control form-control-sm" maxlength="120" value="${esc(d?.customerName || '')}"></div>
        <div class="col-6"><label class="form-label small mb-0">Must arrive by</label><input id="df-due" type="datetime-local" class="form-control form-control-sm" value="${due}"></div>
        <div class="col-6"><label class="form-label small mb-0">Customer phone</label><input id="df-cphone" class="form-control form-control-sm" maxlength="30" placeholder="+233…" value="${esc(d?.customerPhone || '')}"></div>
        <div class="col-6"><label class="form-label small mb-0">Customer email</label><input id="df-cmail" class="form-control form-control-sm" maxlength="160" value="${esc(d?.customerEmail || '')}"></div></div>
      <label class="vm-sw"><input type="checkbox" id="df-notify" ${d?.notifyCustomer ? 'checked' : ''}><i></i><span>Message the customer when the ETA changes or the vehicle arrives</span></label>`;
  };
  H.destBody = () => {
    const due = val('df-due');
    return { customerName: val('df-cname').trim() || null, customerPhone: val('df-cphone').trim() || null, customerEmail: val('df-cmail').trim() || null, notifyCustomer: $('df-notify').checked, dueAt: due ? new Date(due).toISOString() : null };
  };

  // charging points: availability
  H.poi = (p) => {
    if (p.capacity == null) return p.category === 'charging' && canEdit() ? `<div class="mt-1"><button class="btn btn-sm btn-outline-success" data-poi-avail="${p.id}"><i class="bi bi-ev-station"></i> Set free bays</button></div>` : '';
    const stale = p.availabilityUpdatedAt && Date.now() - new Date(p.availabilityUpdatedAt) > 6 * 3600e3;
    return `<div class="box ${p.available === 0 ? 'high' : 'ok'}"><b>${p.available} of ${p.capacity}</b> bays free <span class="text-muted">(updated ${p.availabilityUpdatedAt ? esc(ago(Math.round((Date.now() - new Date(p.availabilityUpdatedAt)) / 1000))) : 'never'}${stale ? ', may be out of date' : ''})</span>${canEdit() ? ` <button class="btn btn-sm btn-link p-0 ms-1" data-poi-avail="${p.id}">change</button>` : ''}</div>`;
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-poi-avail]'); if (!b) return; const p = S.pois.get(b.dataset.poiAvail); if (!p) return; map.closePopup();
    dialog(`Free bays at ${p.name}`, `<div class="row g-2"><div class="col"><label class="form-label">Bays in total</label><input id="av-cap" type="number" min="1" max="500" class="form-control" value="${p.capacity ?? ''}"></div><div class="col"><label class="form-label">Free now</label><input id="av-free" type="number" min="0" max="500" class="form-control" value="${p.available ?? ''}"></div></div><div class="form-text mt-2">Update this by hand, or have the charger system call the API.</div>`,
      [{ text: 'Cancel', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Save', fn: async () => { const r = await call(() => API.put(`/map/pois/${p.id}/availability`, { capacity: Number(val('av-cap')), available: Number(val('av-free')) })); if (!r) return false; await M.loadPois(); toast('Availability saved'); } }]);
  });
  // ================================================================ health (breakdown risk)
  async function loadRisk() {
    const r = await call(() => API.get('/map/risk')); if (!r) return; A.risk = r.data.vehicles;
    const n = { high: 0, medium: 0, remote: 0 }; A.risk.forEach((x) => { if (x.level === 'high') n.high++; if (x.level === 'medium') n.medium++; if (x.remote && x.level !== 'low') n.remote++; });
    badge('vm-hl-badge', n.high);
    $('hl-sum').innerHTML = `<span class="vm-chip"><span class="vm-dot" style="background:#dc2626"></span>High ${n.high}</span><span class="vm-chip"><span class="vm-dot" style="background:#d97706"></span>Watch ${n.medium}</span><span class="vm-chip" title="Further than ${r.data.remoteKm} km from the nearest hub"><i class="bi bi-geo"></i> Far from a hub ${n.remote}</span>`;
    $('hl-list').innerHTML = A.risk.length ? A.risk.map((x) => `<div class="vm-row" data-hl="${x.vehicleId}" data-lat="${x.lat}" data-lng="${x.lng}"><div class="grow"><div class="t">${esc(x.plate)} <span class="vm-risk-pill ${x.level}">${RISK_LABEL[x.level]} · ${x.score}</span>${x.remote ? ' <span class="badge bg-dark" title="Far from a hub">remote</span>' : ''}</div>
      <div class="s" style="white-space:normal">${x.reasons.slice(0, 3).map(esc).join(' · ')}</div><div class="s" style="white-space:normal"><b>${esc(x.advice || '')}</b>${x.nearestHub ? ` Nearest hub: ${esc(x.nearestHub.name)}, ${x.nearestHub.km} km.` : ''}</div></div></div>`).join('')
      : '<div class="text-muted small p-3">No vehicle shows signs of trouble. Risk is calculated from engine and battery readings sent by the vehicles; vehicles that send no readings are not rated.</div>';
  }
  $('hl-list').addEventListener('click', (e) => { const r = e.target.closest('[data-hl]'); if (!r) return; M.select(r.dataset.hl, { pan: true }); });
  async function loadRiskAreas() {
    const r = await call(() => API.get('/map/risk/areas?days=7')); if (!r) return;
    if (riskHeat) { map.removeLayer(riskHeat); riskHeat = null; }
    const d = r.data; if (!d.cells.length) { toast('No fault readings in the last 7 days, so there are no high-risk areas.'); return; }
    riskHeat = L.heatLayer(d.cells.map(([la, ln, n]) => [la, ln, n / (d.max || 1)]), { radius: 30, blur: 22, minOpacity: 0.35, maxZoom: 16, gradient: { 0.3: '#fde68a', 0.6: '#f97316', 1: '#b91c1c' } }).addTo(map);
    toast(`High-risk areas: where vehicles reported faults in the last 7 days (${d.cells.length} cells).`);
  }
  $('ly-risk').addEventListener('change', (e) => { if (e.target.checked) loadRiskAreas(); else if (riskHeat) { map.removeLayer(riskHeat); riskHeat = null; } });

  // ================================================================ dispatch board
  async function loadBoard() {
    const r = await call(() => API.get('/map/dispatch')); if (!r) return; const b = r.data; A.board = b; A.jobs = new Map(b.jobs.map((j) => [j.vehicleId, j]));
    const c = {}; b.jobs.forEach((j) => { c[j.risk] = (c[j.risk] || 0) + 1; });
    badge('vm-dp-badge', (c.late || 0) + (c.at_risk || 0));
    $('dp-sum').innerHTML = b.jobs.length ? Object.keys(JOB_LABEL).filter((k) => c[k]).map((k) => `<span class="vm-chip">${pill(k, JOB_LABEL[k])} ${c[k]}</span>`).join('') : '';
    const fresh = b.events.filter((e) => !A.seenDp.has(e.id)); b.events.forEach((e) => A.seenDp.add(e.id));
    if (!A.firstDp) fresh.slice().reverse().forEach((e) => { if (['off_route', 'delay_risk', 'arrived'].includes(e.kind)) toast(`<b>${esc(e.plate)}</b>: ${esc(EVENT_LABEL[e.kind])}`, e.kind === 'arrived' ? '' : 'exit'); });
    A.firstDp = false;
    renderRoutes(); renderBoard();
    S.fleet.forEach((v) => { const m = S.markers.get(v.id); if (m?.isPopupOpen()) m.getPopup().setContent(M.popupHtml(v)); });
  }
  function renderRoutes() {
    routeLayer.clearLayers();
    (A.board?.jobs || []).forEach((j) => {
      if (j.status === 'arrived') return;
      const col = j.risk === 'late' ? '#dc2626' : j.risk === 'at_risk' ? '#d97706' : '#2563eb';
      if (j.route?.length > 1) L.polyline(j.route.map((p) => [p[1] ?? p.lat, p[0] ?? p.lng]), { color: col, weight: 4, opacity: 0.75, dashArray: '8 6' }).bindTooltip(`${esc(j.plate)} → ${esc(j.label || 'destination')}${j.etaMinutes != null ? ` · ${j.etaMinutes} min` : ''}`, { sticky: true }).addTo(routeLayer);
    });
  }
  function renderBoard() {
    const b = A.board; if (!b) return;
    const jobs = b.jobs.map((j) => {
      const slack = j.slackMinutes != null ? (j.slackMinutes < 0 ? `<b class="text-danger">${-j.slackMinutes} min late</b>` : `${j.slackMinutes} min spare`) : '';
      const alts = j.alternatives?.length ? `<div class="alt"><b>Other vehicles that could take it:</b>${j.alternatives.map((a) => `<div>${esc(a.plate)}: ${a.etaMinutes} min, ${a.distanceKm} km ${a.makesDeadline === true ? '<span class="text-success">makes the deadline</span>' : a.makesDeadline === false ? '<span class="text-danger">too late</span>' : ''}</div>`).join('')}<div class="text-muted">${esc(j.alternatives[0].basis)}</div></div>` : (j.risk === 'late' || j.risk === 'at_risk' ? '<div class="alt text-muted">No other free vehicle has reported recently.</div>' : '');
      const adv = j.routeAdvice?.reasoning?.length ? `<div class="alt"><b>Route suggestion:</b><ul class="mb-0 ps-3">${j.routeAdvice.reasoning.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
      return `<div class="vm-job" data-vid="${j.vehicleId}"><div class="hd" data-jact="go"><div class="grow"><b>${esc(j.plate)}</b> → ${esc(j.label || 'destination')}</div>${pill(j.risk, JOB_LABEL[j.risk])}</div>
        <div class="sub">${j.status === 'arrived' ? 'Arrived' : j.etaMinutes != null ? `ETA in <b>${j.etaMinutes} min</b>` : 'ETA not known yet'}${j.dueAt ? ` · due ${esc(timeOf(j.dueAt))}` : ''} ${slack ? '· ' + slack : ''}${j.offRoute ? ' · <span class="text-warning">left the route</span>' : ''}${j.customerName ? `<br>Customer: ${esc(j.customerName)}${j.notifyCustomer ? ' <i class="bi bi-bell-fill" title="Customer is notified"></i>' : ''}` : ''}</div>
        ${alts}${adv}
        <div class="d-flex gap-1 mt-1"><button class="btn btn-outline-primary btn-sm py-0" data-jact="advice">Route options</button>${canEdit() ? '<button class="btn btn-outline-secondary btn-sm py-0" data-jact="check">Check now</button>' : ''}</div></div>`;
    }).join('');
    const ev = b.events.length ? b.events.slice(0, 12).map((e) => `<div class="vm-row" data-vid="${e.vehicleId}" data-jact="go"><span class="vm-ico" style="background:#64748b;width:28px;height:28px;flex-basis:28px;font-size:.8rem"><i class="bi ${eventIcon[e.kind] || 'bi-dot'}"></i></span><div class="grow"><div class="t">${esc(e.plate)}: ${esc(EVENT_LABEL[e.kind] || e.kind)}</div><div class="s">${eventText(e)}</div></div><div class="s">${esc(timeOf(e.at))}</div></div>`).join('') : '<div class="text-muted small px-3 pb-2">Nothing yet.</div>';
    const nt = b.notifications.length ? b.notifications.slice(0, 8).map((n) => `<div class="vm-row"><span class="vm-ico" style="background:${n.status === 'sent' ? '#16a34a' : n.status === 'failed' ? '#dc2626' : '#94a3b8'};width:28px;height:28px;flex-basis:28px;font-size:.8rem"><i class="bi bi-chat-dots"></i></span><div class="grow"><div class="t" style="white-space:normal">${esc(n.message)}</div><div class="s">${esc(n.recipient || '')} · ${n.status === 'sent' ? 'sent' : n.status === 'failed' ? 'failed' : 'not sent (no message service connected)'} · ${esc(timeOf(n.at))}</div></div></div>`).join('') : '<div class="text-muted small px-3 pb-2">No customer messages yet.</div>';
    $('dp-list').innerHTML = `${jobs || '<div class="text-muted small p-3">No vehicle has a destination. Open a vehicle on the map and press Destination to start a delivery, with the customer and the time it must arrive.</div>'}
      <div class="vm-sec">Recent changes</div>${ev}<div class="vm-sec">Customer messages ${b.notifyConfigured ? '' : '<span class="text-warning text-capitalize">(no message service connected)</span>'}</div>${nt}`;
  }
  $('dp-list').addEventListener('click', (e) => {
    const t = e.target.closest('[data-jact]'); if (!t) return; const vid = t.closest('[data-vid]')?.dataset.vid; if (!vid) return;
    if (t.dataset.jact === 'go') M.select(vid, { pan: true });
    if (t.dataset.jact === 'advice') adviceFor(vid);
    if (t.dataset.jact === 'check') call(async () => { await API.post('/map/dispatch/check', { vehicleId: vid }); toast('Checked'); await M.loadFleet(false); loadBoard(); });
  });
  $('dp-refresh').addEventListener('click', loadBoard);
  $('ly-routes').addEventListener('change', (e) => { const f = e.target.checked ? 'addLayer' : 'removeLayer'; map[f](routeLayer); });

  // ================================================================ route options with reasoning
  const PRIORITY = { time: 'Fastest', balanced: 'Balanced', energy: 'Greenest' };
  async function adviceFor(vehicleId, priority) {
    const v = S.fleet.get(vehicleId); if (!v?.position) { toast('This vehicle has no position yet.', 'err'); return; }
    const go = async (dest) => {
      A.advice = { vehicleId, dest, priority: priority || A.advice?.priority || 'balanced' };
      await showAdvice();
    };
    if (v.destination) { map.closePopup(); await go({ lat: v.destination.lat, lng: v.destination.lng, label: v.destination.label, dueAt: v.destination.dueAt }); return; }
    map.closePopup(); M.startPick(`Click where ${v.plate} should go`, (ll) => go({ lat: ll.lat, lng: ll.lng, label: 'Chosen point' }));
  }
  async function showAdvice() {
    const a = A.advice; if (!a) return; const box = $('vm-advice'); box.classList.remove('d-none'); box.innerHTML = '<div class="text-muted">Working out the options…</div>';
    const q = `vehicleId=${a.vehicleId}&toLat=${a.dest.lat}&toLng=${a.dest.lng}&priority=${a.priority}${a.dest.dueAt ? `&dueAt=${encodeURIComponent(a.dest.dueAt)}` : ''}`;
    const r = await call(() => API.get(`/map/route-advice?${q}`)); if (!r) { box.classList.add('d-none'); return; }
    const d = r.data, v = S.fleet.get(a.vehicleId); adviceLayer.clearLayers();
    d.options.forEach((o, i) => { if (!o.geometry) return; const best = i === d.best.index; const ln = L.polyline(o.geometry.map((p) => [p[1], p[0]]), { color: best ? '#16a34a' : '#64748b', weight: best ? 6 : 4, opacity: best ? 0.9 : 0.7, dashArray: best ? null : '8 6' }).addTo(adviceLayer); ln.on('click', () => ln.bringToFront()); if (best) map.fitBounds(ln.getBounds().pad(0.2)); });
    L.marker([a.dest.lat, a.dest.lng]).addTo(adviceLayer).bindTooltip(esc(a.dest.label || 'Destination'));
    const unit = d.electric ? (o) => `${o.energyKwh} kWh` : (o) => `${o.fuelLitres} L`;
    box.innerHTML = `<div class="d-flex align-items-center mb-1"><h6 class="flex-grow-1 mb-0">Route options for ${esc(v?.plate || '')}</h6><button class="btn-close" id="adv-close"></button></div>
      <div class="btn-group btn-group-sm w-100 mb-2">${Object.entries(PRIORITY).map(([k, t]) => `<button class="btn btn-outline-primary ${a.priority === k ? 'active' : ''}" data-prio="${k}">${t}</button>`).join('')}</div>
      ${d.options.map((o, i) => `<div class="opt ${i === d.best.index ? 'best' : ''}" data-opt="${i}"><b>${esc(o.label || 'Route ' + (i + 1))}</b>${o.feasible === false ? ' <span class="text-danger">(too late)</span>' : ''}<br>${o.minutes} min · ${o.km} km · ${unit(o)} · ${o.co2Kg} kg CO₂</div>`).join('')}
      <div class="fw-semibold mt-2">Why</div><ul>${d.reasoning.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="text-muted" style="font-size:.7rem">${esc(d.note)}${d.congestionFactor > 1.15 ? ` Recent pace is about ${Math.round((d.congestionFactor - 1) * 100)}% slower than free flow.` : ''}</div>`;
    $('adv-close').onclick = closeAdvice;
    box.querySelectorAll('[data-prio]').forEach((b) => (b.onclick = () => { a.priority = b.dataset.prio; showAdvice(); }));
    box.querySelectorAll('[data-opt]').forEach((b) => (b.onclick = () => { const o = d.options[+b.dataset.opt]; if (o?.geometry) map.fitBounds(L.latLngBounds(o.geometry.map((p) => [p[1], p[0]])).pad(0.2)); }));
  }
  function closeAdvice() { A.advice = null; adviceLayer.clearLayers(); $('vm-advice').classList.add('d-none'); }

  // ================================================================ checklists (tasks)
  async function loadTasks() {
    const r = await call(() => API.get(`/map/tasks?status=${A.taskFilter}`)); if (!r) return; A.tasks = r.data;
    renderTasks();
    const p = await call(() => API.get('/map/tasks?status=pending')); if (p) badge('vm-tk-badge', p.data.length);
  }
  function renderTasks() {
    const el = $('tk-list');
    if (!A.tasks.length) { el.innerHTML = `<div class="text-muted small p-3">${A.taskFilter === 'pending' ? 'No checklist is waiting. When a vehicle enters a zone that has a checklist, it appears here and in the driver\'s app.' : A.taskFilter === 'completed' ? 'Nothing completed yet.' : 'Nothing missed.'}</div>`; return; }
    el.innerHTML = A.tasks.map((t) => {
      const when = t.status === 'completed' ? `done ${esc(timeOf(t.completedAt))}` : t.status === 'expired' ? 'not done in time' : `expires ${esc(timeOf(t.expiresAt))}`;
      const items = t.status === 'completed' ? t.items.map((i) => `<div class="s">${t.answers?.[i.id] ? '☑' : '☐'} ${esc(i.text)}</div>`).join('') + (t.note ? `<div class="s"><i>“${esc(t.note)}”</i></div>` : '') + (t.hasPhoto ? `<button class="btn btn-sm btn-outline-secondary py-0 mt-1" data-photo="${t.id}"><i class="bi bi-image"></i> Photo</button>` : '') : '';
      return `<div class="vm-row align-items-start" data-tk="${t.id}" data-vid="${t.vehicleId}"><span class="vm-ico" style="background:${t.status === 'completed' ? '#16a34a' : t.status === 'expired' ? '#94a3b8' : '#f59e0b'}"><i class="bi ${t.status === 'completed' ? 'bi-check2-square' : 'bi-ui-checks'}"></i></span><div class="grow"><div class="t" style="white-space:normal">${esc(t.title)}</div><div class="s">${esc(t.plate)} · ${esc(t.geofenceName)} · ${when}</div>${items}</div></div>`;
    }).join('');
  }
  $('tk-filter').addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (!b) return; A.taskFilter = b.dataset.st; $('tk-filter').querySelectorAll('.btn').forEach((x) => x.classList.toggle('active', x === b)); loadTasks(); });
  $('tk-list').addEventListener('click', async (e) => {
    const ph = e.target.closest('[data-photo]');
    if (ph) { const r = await call(() => API.get(`/map/tasks/${ph.dataset.photo}/photo`)); if (r?.data?.photo) dialog('Photo from the driver', `<img src="${esc(r.data.photo)}" class="img-fluid rounded" alt="Photo uploaded by the driver">`, [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }]); return; }
    const row = e.target.closest('[data-tk]'); if (row) M.select(row.dataset.vid, { pan: true });
  });
  H.task = (t) => {
    const v = S.fleet.get(t.vehicleId); if (!v) return; // not a vehicle this person may see
    if (t.kind === 'created') toast(`<b>${esc(v.plate)}</b> must complete: ${esc(t.title || 'a checklist')}`);
    if (t.kind === 'completed') toast(`<b>${esc(v.plate)}</b> completed: ${esc(t.title || 'a checklist')}`);
    loadTasks();
  };
  $('tk-defs').addEventListener('click', openDefinitions);

  async function openDefinitions() {
    const r = await call(() => API.get('/map/tasks/definitions')); if (!r) return;
    const rows = r.data;
    dialog('Zone checklists', `<div class="form-text mb-2">When a vehicle enters (or leaves) the zone, the driver gets this checklist in the driver app and you see the result here, live.</div>
      ${rows.length ? rows.map((d) => `<div class="vm-row px-0" data-def="${d.id}"><div class="grow"><div class="t">${esc(d.title)}</div><div class="s">${esc(d.geofenceName)} · on ${d.trigger} · ${d.items.length} item${d.items.length === 1 ? '' : 's'}${d.isActive === false ? ' · off' : ''}</div></div>${canEdit() ? `<div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" data-dact="edit"><i class="bi bi-pencil-square"></i></button><button class="btn btn-outline-danger" data-dact="del"><i class="bi bi-trash"></i></button></div>` : ''}</div>`).join('') : '<div class="text-muted small">No checklists yet.</div>'}`,
      [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }, ...(canEdit() ? [{ text: 'New checklist', fn: () => { setTimeout(() => defForm(null), 250); return true; } }] : [])]);
    $('vm-modal-body').onclick = async (e) => {
      const row = e.target.closest('[data-def]'), act = e.target.closest('[data-dact]')?.dataset.dact; if (!row || !act) return; const d = rows.find((x) => x.id === row.dataset.def);
      if (act === 'edit') { modal().hide(); setTimeout(() => defForm(d), 250); }
      if (act === 'del' && confirm(`Delete the checklist "${d.title}"? Past results are kept.`)) { const x = await call(() => API.del(`/map/tasks/definitions/${d.id}`)); if (x) { toast('Checklist deleted'); modal().hide(); setTimeout(openDefinitions, 250); } }
    };
  }
  function defForm(d) {
    const zones = [...S.zones.values()].sort((a, b) => a.g.name.localeCompare(b.g.name));
    if (!zones.length) { toast('Draw a geofence first, then attach a checklist to it.', 'err'); return; }
    const items = d?.items?.length ? d.items : [{ text: '', requirePhoto: false }];
    const itemRow = (it) => `<div class="d-flex gap-2 mb-1 align-items-center df-item"><input class="form-control form-control-sm" maxlength="200" placeholder="e.g. Unloading is complete" value="${esc(it.text)}"><label class="small text-nowrap" title="The driver must attach a photo"><input type="checkbox" ${it.requirePhoto ? 'checked' : ''}> photo</label><button class="btn btn-sm btn-outline-danger" data-rm><i class="bi bi-x"></i></button></div>`;
    dialog(d ? 'Edit checklist' : 'New checklist', `<div class="mb-2"><label class="form-label">Zone</label><select id="td-zone" class="form-select" ${d ? 'disabled' : ''}>${zones.map((z) => `<option value="${z.g.id}" ${d?.geofenceId === z.g.id ? 'selected' : ''}>${esc(z.g.name)}</option>`).join('')}</select></div>
      <div class="row g-2 mb-2"><div class="col-8"><label class="form-label">Title</label><input id="td-title" class="form-control" maxlength="120" value="${esc(d?.title || '')}" placeholder="e.g. Confirm unloading"></div><div class="col-4"><label class="form-label">Shown on</label><select id="td-trig" class="form-select"><option value="entry" ${d?.trigger !== 'exit' ? 'selected' : ''}>Entry</option><option value="exit" ${d?.trigger === 'exit' ? 'selected' : ''}>Exit</option></select></div></div>
      <label class="form-label">Items the driver must tick</label><div id="td-items">${items.map(itemRow).join('')}</div><button class="btn btn-sm btn-outline-primary mb-2" id="td-add"><i class="bi bi-plus"></i> Add item</button>
      <div class="row g-2"><div class="col-6"><label class="form-label">Valid for (minutes)</label><input id="td-exp" type="number" min="5" max="1440" class="form-control" value="${d?.expiresMinutes ?? 120}"></div><div class="col-6 d-flex align-items-end"><label class="vm-sw mb-1"><input type="checkbox" id="td-on" ${d?.isActive !== false ? 'checked' : ''}><i></i><span>Active</span></label></div></div>`,
      [{ text: 'Cancel', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Save', fn: async () => {
        const its = [...document.querySelectorAll('#td-items .df-item')].map((r) => ({ text: r.querySelector('input[type=text],input:not([type])').value.trim(), requirePhoto: r.querySelector('input[type=checkbox]').checked })).filter((x) => x.text);
        const body = { title: val('td-title').trim(), trigger: val('td-trig'), items: its, expiresMinutes: Number(val('td-exp')), isActive: $('td-on').checked, ...(d ? {} : { geofenceId: val('td-zone') }) };
        const r = await call(() => (d ? API.put(`/map/tasks/definitions/${d.id}`, body) : API.post('/map/tasks/definitions', body))); if (!r) return false; toast('Checklist saved');
      } }]);
    $('td-add').onclick = () => $('td-items').insertAdjacentHTML('beforeend', itemRow({ text: '' }));
    $('td-items').onclick = (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.df-item').remove(); };
  }

  // ================================================================ camera / video
  let hlsLoading = null;
  const loadHls = () => hlsLoading || (hlsLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/hls.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));
  async function playLive(el, url) {
    if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; return; }
    try { await loadHls(); if (window.Hls?.isSupported()) { const h = new window.Hls(); h.loadSource(url); h.attachMedia(el); el._hls = h; return; } } catch { /* fall through */ }
    el.replaceWith(Object.assign(document.createElement('div'), { className: 'alert alert-warning small', textContent: 'This browser cannot play the live stream here. Use "Open in a new tab".' }));
  }
  async function cameraDialog(id) {
    const v = S.fleet.get(id); map.closePopup();
    const r = await call(() => API.get(`/map/vehicles/${id}/camera`)); if (!r) return; const c = r.data;
    const show = (u, kind) => (kind === 'iframe' ? `<iframe class="vm-cam" src="${esc(u)}" sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>` : `<video class="vm-cam" controls autoplay muted playsinline ${kind === 'mp4' ? `src="${esc(u)}"` : ''}></video>`);
    const body = c.configured
      ? `<div class="mb-2 small text-muted">${esc(c.provider || 'Camera')} · ${esc(c.kind)}. ${esc(c.note || '')}</div><div id="cam-view">${c.liveUrl ? show(c.liveUrl, c.kind) : '<div class="text-muted">No live link set.</div>'}</div>
        <div class="d-flex gap-2 flex-wrap mt-2">${c.liveUrl ? `<button class="btn btn-sm btn-outline-primary" id="cam-live"><i class="bi bi-broadcast"></i> Live</button>` : ''}${c.clipUrl ? `<button class="btn btn-sm btn-outline-primary" id="cam-clip"><i class="bi bi-skip-backward-btn"></i> Last 10 seconds</button>` : ''}<a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener noreferrer" href="${esc(c.clipUrl || c.liveUrl || '#')}">Open in a new tab</a></div>`
      : `<div class="text-muted mb-2">No camera link is set for ${esc(v.plate)}. ${canEdit() ? 'Add the links from your dashcam provider below.' : ''}</div>`;
    const form = canEdit() ? `<hr><div class="fw-semibold small mb-1">Camera links</div><div class="row g-2">
      <div class="col-4"><select id="cm-kind" class="form-select form-select-sm"><option value="hls" ${c.kind === 'hls' ? 'selected' : ''}>Live stream (HLS)</option><option value="mp4" ${c.kind === 'mp4' ? 'selected' : ''}>Video file (MP4)</option><option value="iframe" ${c.kind === 'iframe' ? 'selected' : ''}>Provider page</option></select></div>
      <div class="col-8"><input id="cm-prov" class="form-control form-control-sm" maxlength="80" placeholder="Provider name" value="${esc(c.provider || '')}"></div>
      <div class="col-12"><input id="cm-live-url" class="form-control form-control-sm" placeholder="Live link (https://…)" value="${esc(c.liveUrl || '')}"></div>
      <div class="col-12"><input id="cm-clip-url" class="form-control form-control-sm" placeholder="Clip link, e.g. https://cam.example/clip?from={from}&to={to}"><div class="form-text">Use {from} and {to} (ISO time) or {from_unix} and {to_unix}; they are filled with the last 10 seconds. Links must start with https://.</div></div></div>` : '';
    dialog(`Video: ${v.plate}`, body + form, [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }, ...(canEdit() && c.configured ? [{ text: 'Remove links', cls: 'btn-outline-danger', fn: async () => { const x = await call(() => API.del(`/map/vehicles/${id}/camera`)); if (x) toast('Camera links removed'); else return false; } }] : []), ...(canEdit() ? [{ text: 'Save links', fn: async () => { const x = await call(() => API.put(`/map/vehicles/${id}/camera`, { kind: val('cm-kind'), provider: val('cm-prov').trim() || null, liveUrl: val('cm-live-url').trim() || null, clipTemplate: val('cm-clip-url').trim() || null })); if (!x) return false; toast('Camera links saved'); } }] : [])]);
    const view = $('cam-view'); if (view && c.configured && c.liveUrl && c.kind === 'hls') playLive(view.querySelector('video'), c.liveUrl);
    const swap = (u, kind) => { view.innerHTML = show(u, kind); const vid = view.querySelector('video'); if (vid && kind === 'hls' && !/\.mp4(\?|$)/i.test(u)) playLive(vid, u); };
    if ($('cam-live')) $('cam-live').onclick = () => swap(c.liveUrl, c.kind);
    if ($('cam-clip')) $('cam-clip').onclick = () => swap(c.clipUrl, /\.m3u8/i.test(c.clipUrl) ? 'hls' : /\.mp4(\?|$)/i.test(c.clipUrl) ? 'mp4' : c.kind === 'iframe' ? 'iframe' : 'mp4');
    $('vm-modal').addEventListener('hidden.bs.modal', () => { view?.querySelectorAll('video').forEach((x) => { x._hls?.destroy(); x.pause(); x.removeAttribute('src'); }); }, { once: true });
  }

  // ================================================================ sensor assets
  async function loadAssets() {
    const r = await call(() => API.get('/map/assets')); if (!r) return; A.assets = r.data; assetLayer.clearLayers();
    A.assets.forEach((a) => {
      if (a.lat == null || a.lng == null) return; const alarm = a.alarms?.length, st = a.status || {};
      const ic = { cooler: 'bi-thermometer-snow', trailer: 'bi-truck-flatbed', generator: 'bi-lightning-charge-fill', container: 'bi-box-seam' }[a.kind] || 'bi-box';
      const m = L.marker([a.lat, a.lng], { icon: L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 16], html: `<div class="vm-asset-mk ${alarm ? 'alarm' : a.stale ? 'stale' : ''}"><i class="bi ${ic}"></i></div>` }), zIndexOffset: alarm ? 800 : 200 }).addTo(assetLayer);
      m.bindPopup(`<div class="vm-pop"><h6>${esc(a.name)} <small class="text-muted fw-normal text-capitalize">${esc(a.kind)}</small></h6>
        ${alarm ? `<div class="box high"><b>Alarm</b><ul class="why mb-0">${a.alarms.map((x) => `<li>${esc(typeof x === 'string' ? x : x.message || x.text || JSON.stringify(x))}</li>`).join('')}</ul></div>` : a.stale ? '<div class="box">No report for over 6 hours.</div>' : '<div class="box ok">All readings are within limits.</div>'}
        <table>${st.temperatureC != null ? `<tr><td>Temperature</td><td><b>${(+st.temperatureC).toFixed(1)}°C</b></td></tr>` : ''}${st.doorOpen != null ? `<tr><td>Door</td><td>${st.doorOpen ? '<b class="text-danger">Open</b>' : 'Closed'}</td></tr>` : ''}${st.batteryPct != null ? `<tr><td>Battery</td><td>${Math.round(st.batteryPct)}%</td></tr>` : ''}${st.humidity != null ? `<tr><td>Humidity</td><td>${Math.round(st.humidity)}%</td></tr>` : ''}<tr><td>Last report</td><td>${a.lastReportAt ? esc(fmtTime(a.lastReportAt)) : 'never'}</td></tr></table></div>`);
    });
    const n = A.assets.filter((a) => a.alarms?.length).length; $('vm-setup-note').innerHTML = n ? `<span class="text-danger"><b>${n}</b> sensor asset${n === 1 ? ' has' : 's have'} an alarm.</span>` : '';
  }
  $('ly-assets').addEventListener('change', (e) => map[e.target.checked ? 'addLayer' : 'removeLayer'](assetLayer));
  $('ly-lez').addEventListener('change', (e) => { S.zones.forEach((z) => { if (z.layer && (z.g.rule === 'lez' || z.g.rule === 'restricted')) map[e.target.checked ? 'addLayer' : 'removeLayer'](z.layer); }); });
  function assetsDialog() {
    const body = () => `${A.assets.length ? A.assets.map((a) => `<div class="vm-row px-0" data-as="${a.id}"><span class="vm-ico" style="background:${a.alarms?.length ? '#dc2626' : '#0891b2'}"><i class="bi bi-box"></i></span><div class="grow"><div class="t">${esc(a.name)}</div><div class="s text-capitalize">${esc(a.kind)} · ${a.lastReportAt ? 'reported ' + esc(ago(Math.round((Date.now() - new Date(a.lastReportAt)) / 1000))) : 'no report yet'}${a.alarms?.length ? ' · ALARM' : ''}</div></div>${canEdit() ? '<div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" data-aact="edit"><i class="bi bi-pencil-square"></i></button><button class="btn btn-outline-danger" data-aact="del"><i class="bi bi-trash"></i></button></div>' : ''}</div>`).join('') : '<div class="text-muted small">No sensor assets yet.</div>'}
      <div class="form-text mt-2">A tracker on the asset reports its position and readings to <code>POST /api/map/ingest/assets/&lt;id&gt;</code> with the ingest key (see docs/map.md). Temperature, door and battery limits raise an alarm and turn the marker red.</div>`;
    dialog('Sensor assets', body(), [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }, ...(canEdit() ? [{ text: 'New asset', fn: () => { setTimeout(() => assetForm(null), 250); return true; } }] : [])]);
    $('vm-modal-body').onclick = async (e) => { const row = e.target.closest('[data-as]'), act = e.target.closest('[data-aact]')?.dataset.aact; if (!row || !act) return; const a = A.assets.find((x) => x.id === row.dataset.as); if (act === 'edit') { modal().hide(); setTimeout(() => assetForm(a), 250); } if (act === 'del' && confirm(`Remove ${a.name}?`)) { const x = await call(() => API.del(`/map/assets/${a.id}`)); if (x) { await loadAssets(); $('vm-modal-body').innerHTML = body(); toast('Asset removed'); } } };
  }
  function assetForm(a) {
    const l = a?.limits || {};
    dialog(a ? `Edit ${a.name}` : 'New sensor asset', `<div class="mb-2"><label class="form-label">Name</label><input id="as-name" class="form-control" maxlength="120" value="${esc(a?.name || '')}" placeholder="e.g. Cold trailer 1"></div>
      <div class="mb-2"><label class="form-label">Type</label><select id="as-kind" class="form-select">${['cooler', 'trailer', 'generator', 'container', 'other'].map((k) => `<option value="${k}" ${a?.kind === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></div>
      <div class="row g-2"><div class="col-4"><label class="form-label">Min temp °C</label><input id="as-tmin" type="number" class="form-control" value="${l.tempMin ?? ''}"></div><div class="col-4"><label class="form-label">Max temp °C</label><input id="as-tmax" type="number" class="form-control" value="${l.tempMax ?? ''}"></div><div class="col-4"><label class="form-label">Min battery %</label><input id="as-bmin" type="number" min="0" max="100" class="form-control" value="${l.batteryMin ?? ''}"></div></div>`,
      [{ text: 'Cancel', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Save', fn: async () => {
        const limits = {}; [['tempMin', 'as-tmin'], ['tempMax', 'as-tmax'], ['batteryMin', 'as-bmin']].forEach(([k, id]) => { if (val(id) !== '') limits[k] = Number(val(id)); });
        const body = { name: val('as-name').trim(), kind: val('as-kind'), limits }; const r = await call(() => (a ? API.put(`/map/assets/${a.id}`, body) : API.post('/map/assets', body))); if (!r) return false; await loadAssets(); toast('Asset saved');
        if (!a) toast(`Asset id for the tracker: <code>${esc(r.data.id)}</code>`);
      } }]);
  }

  // ================================================================ groups, zones import
  async function loadGroups() {
    const r = await API.get('/map/groups').catch(() => null); if (!r) return; A.groups = r.data;
    S.zoneGroups = new Map(); A.groups.forEach((g) => g.geofenceIds.forEach((z) => { if (!S.zoneGroups.has(z)) S.zoneGroups.set(z, new Set()); S.zoneGroups.get(z).add(g.id); }));
    M.redrawZones(); S.fleet.forEach(M.upsertMarker);
  }
  function groupsDialog() {
    const list = () => A.groups.length ? A.groups.map((g) => `<div class="vm-row px-0" data-gr="${g.id}"><span class="vm-ico" style="background:${esc(g.color)}"><i class="bi bi-collection"></i></span><div class="grow"><div class="t">${esc(g.name)}</div><div class="s">${g.vehicleIds.length} vehicle${g.vehicleIds.length === 1 ? '' : 's'} · ${g.geofenceIds.length} zone${g.geofenceIds.length === 1 ? '' : 's'}</div></div>${canEdit() ? '<button class="btn btn-sm btn-outline-secondary" data-gact="edit"><i class="bi bi-pencil-square"></i></button>' : ''}</div>`).join('') : '<div class="text-muted small">No groups yet. Make one, for example "Escort fleet", then limit a zone to it.</div>';
    dialog('Vehicle groups', list(), [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }, ...(canEdit() ? [{ text: 'New group', fn: () => { setTimeout(() => groupForm(null), 250); return true; } }] : [])]);
    $('vm-modal-body').onclick = (e) => { const row = e.target.closest('[data-gr]'); if (row && e.target.closest('[data-gact]')) { modal().hide(); setTimeout(() => groupForm(A.groups.find((g) => g.id === row.dataset.gr)), 250); } };
  }
  function groupForm(g) {
    const mem = new Set(g?.vehicleIds || []); const vs = [...S.fleet.values()].sort((a, b) => a.plate.localeCompare(b.plate));
    dialog(g ? `Edit ${g.name}` : 'New group', `<div class="row g-2 mb-2"><div class="col-9"><label class="form-label">Name</label><input id="gf-name" class="form-control" maxlength="80" value="${esc(g?.name || '')}"></div><div class="col-3"><label class="form-label">Colour</label><input id="gf-color" type="color" class="form-control form-control-color w-100" value="${g?.color || '#64748b'}"></div></div>
      <label class="form-label">Vehicles in the group</label><input id="gf-q" class="form-control form-control-sm mb-1" placeholder="Filter by plate"><div id="gf-v" style="max-height:240px;overflow:auto" class="border rounded p-2">${vs.map((v) => `<label class="vm-check" data-p="${esc(v.plate.toLowerCase())}"><input type="checkbox" value="${v.id}" ${mem.has(v.id) ? 'checked' : ''}> ${esc(v.plate)} <span class="text-muted">${esc(v.hubName || '')}</span></label>`).join('')}</div>`,
      [...(g ? [{ text: 'Delete', cls: 'btn-outline-danger', fn: async () => { if (!confirm(`Delete group "${g.name}"? Zones limited to it will apply to every vehicle again.`)) return false; const x = await call(() => API.del(`/map/groups/${g.id}`)); if (!x) return false; await loadGroups(); toast('Group deleted'); } }] : []), { text: 'Cancel', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Save', fn: async () => {
        const body = { name: val('gf-name').trim(), color: val('gf-color') }; const r = await call(() => (g ? API.put(`/map/groups/${g.id}`, body) : API.post('/map/groups', body))); if (!r) return false;
        const id = g?.id || r.data.id; const ids = [...document.querySelectorAll('#gf-v input:checked')].map((i) => i.value);
        const m = await call(() => API.put(`/map/groups/${id}/members`, { vehicleIds: ids })); if (!m) return false; await loadGroups(); await M.loadFleet(false); toast('Group saved');
      } }]);
    $('gf-q').oninput = (e) => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('#gf-v label').forEach((l) => (l.style.display = !q || l.dataset.p.includes(q) ? '' : 'none')); };
  }
  function importDialog() {
    dialog('Import geofences', `<div class="form-text mb-2">Load many customer sites at once. <b>CSV</b> needs the columns <code>name, lat, lng, radius</code> (metres), or <code>name, polygon</code> as <code>lat lng; lat lng; …</code>; optional: <code>color, speedLimit, description</code>. <b>GeoJSON</b> accepts Polygon features and Point features with a <code>radius</code> property. A shapefile must first be converted to GeoJSON (QGIS: Export, or <code>ogr2ogr -f GeoJSON out.geojson in.shp</code>).</div>
      <div class="mb-2"><input id="im-file" type="file" accept=".csv,.geojson,.json,text/csv,application/json" class="form-control form-control-sm"> <a href="#" id="im-tpl" class="small">Download a CSV template</a></div>
      <textarea id="im-text" class="form-control mb-2" rows="5" placeholder="…or paste the content here" style="font-family:monospace;font-size:.78rem"></textarea>
      <div class="row g-2 mb-2"><div class="col-6"><label class="form-label small mb-0">Format</label><select id="im-fmt" class="form-select form-select-sm"><option value="csv">CSV</option><option value="geojson">GeoJSON</option></select></div>
        <div class="col-6"><label class="form-label small mb-0">Rule</label><select id="im-rule" class="form-select form-select-sm">${Object.entries(RULES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div></div>
      ${A.groups.length ? `<div class="mb-2"><label class="form-label small mb-0">Apply to groups (none = all vehicles)</label><div id="im-groups" class="d-flex flex-wrap gap-2">${A.groups.map((x) => `<label class="vm-chip" style="cursor:pointer"><input type="checkbox" class="d-none" value="${x.id}" onchange="this.parentNode.classList.toggle('on',this.checked)"><span class="vm-dot" style="background:${esc(x.color)}"></span>${esc(x.name)}</label>`).join('')}</div></div>` : ''}
      <div id="im-out"></div>`,
      [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Check first', cls: 'btn-outline-primary', keep: true, fn: () => run(true) }, { text: 'Import', keep: true, fn: () => run(false) }]);
    $('im-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 3e6) { toast('That file is too large (limit 3 MB).', 'err'); return; } $('im-text').value = await f.text(); $('im-fmt').value = /json$/i.test(f.name) ? 'geojson' : 'csv'; };
    $('im-tpl').onclick = (e) => { e.preventDefault(); downloadText('geofences-template.csv', 'name,lat,lng,radius,color,speedLimit,description\nCustomer A,5.6037,-0.1870,150,#2563eb,30,Main entrance\nCustomer B,5.6100,-0.2000,100,,,\n"Market yard",,,,#16a34a,20,"polygon example: use the polygon column instead"\n', 'text/csv'); };
    async function run(dry) {
      const content = val('im-text').trim(); if (!content) { toast('Choose a file or paste the content first.', 'err'); return false; }
      const groupIds = [...document.querySelectorAll('#im-groups input:checked')].map((i) => i.value);
      const r = await call(() => API.post('/map/geofences/import', { format: val('im-fmt'), content, rule: val('im-rule'), groupIds, dryRun: dry })); if (!r) return false; const d = r.data;
      const bad = d.results.filter((x) => x.status === 'error' || x.status === 'skipped');
      $('im-out').innerHTML = `<div class="alert ${d.failed ? 'alert-warning' : 'alert-success'} py-2 small mb-1">${dry ? `Check: <b>${d.valid}</b> can be imported` : `<b>${d.created}</b> imported`}${d.skipped ? `, <b>${d.skipped}</b> skipped (name already exists)` : ''}${d.failed ? `, <b>${d.failed}</b> with problems` : ''}.</div>
        ${bad.length ? `<div style="max-height:150px;overflow:auto" class="small">${bad.slice(0, 100).map((x) => `<div>Row ${x.row}${x.name ? ` (${esc(x.name)})` : ''}: ${esc(x.message)}</div>`).join('')}</div>` : ''}`;
      if (!dry && d.created) { await M.loadZones(); await loadGroups(); toast(`${d.created} geofences imported`); }
      return false;
    }
  }

  // ================================================================ privacy hours and hub access (admins)
  async function privacyDialog() {
    const r = await call(() => API.get('/map/privacy')); if (!r) return; const rows = r.data;
    dialog('Driver privacy hours', `<div class="form-text mb-2">For vehicles that may be used privately. Outside the working hours the map shows only "Off duty": no position, route history, heatmap, alerts or readings.</div>
      ${rows.length ? rows.map((p) => `<div class="vm-row px-0" data-pv="${p.vehicleId}"><div class="grow"><div class="t">${esc(p.plate)}</div><div class="s">${esc(p.start)}–${esc(p.end)} · ${esc(p.timezone)} · ${(p.workDays || []).map((d) => 'MTWTFSS'[d - 1] || d).join(' ')}</div></div><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" data-pact="edit"><i class="bi bi-pencil-square"></i></button><button class="btn btn-outline-danger" data-pact="del"><i class="bi bi-trash"></i></button></div></div>`).join('') : '<div class="text-muted small">No vehicle has privacy hours.</div>'}`,
      [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Add a vehicle', fn: () => { setTimeout(() => privacyForm(null, rows), 250); return true; } }]);
    $('vm-modal-body').onclick = async (e) => { const row = e.target.closest('[data-pv]'), act = e.target.closest('[data-pact]')?.dataset.pact; if (!row || !act) return; const p = rows.find((x) => x.vehicleId === row.dataset.pv);
      if (act === 'edit') { modal().hide(); setTimeout(() => privacyForm(p, rows), 250); }
      if (act === 'del' && confirm(`Show ${p.plate} at all times again?`)) { const x = await call(() => API.del(`/map/vehicles/${p.vehicleId}/privacy`)); if (x) { toast('Privacy hours removed'); modal().hide(); await M.loadFleet(false); } } };
  }
  function privacyForm(p, rows) {
    const days = new Set(p?.workDays || [1, 2, 3, 4, 5]); const used = new Set(rows.map((x) => x.vehicleId));
    dialog(p ? `Hours for ${p.plate}` : 'Add privacy hours', `<div class="mb-2"><label class="form-label">Vehicle</label><select id="pv-veh" class="form-select" ${p ? 'disabled' : ''}>${[...S.fleet.values()].filter((v) => p ? v.id === p.vehicleId : !used.has(v.id)).sort((a, b) => a.plate.localeCompare(b.plate)).map((v) => `<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select></div>
      <div class="row g-2 mb-2"><div class="col-6"><label class="form-label">Working from</label><input id="pv-start" type="time" class="form-control" value="${p?.start || '07:00'}"></div><div class="col-6"><label class="form-label">until</label><input id="pv-end" type="time" class="form-control" value="${p?.end || '18:00'}"></div></div>
      <div class="mb-2"><label class="form-label">Working days</label><div class="d-flex gap-1 flex-wrap">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => `<label class="vm-chip ${days.has(i + 1) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" class="d-none" value="${i + 1}" ${days.has(i + 1) ? 'checked' : ''} onchange="this.parentNode.classList.toggle('on',this.checked)">${n}</label>`).join('')}</div></div>
      <div><label class="form-label">Time zone</label><input id="pv-tz" class="form-control" value="${esc(p?.timezone || 'Africa/Accra')}"><div class="form-text">A name like Africa/Accra. A shift that ends after midnight (for example 22:00 to 06:00) works too.</div></div>`,
      [{ text: 'Cancel', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Save', fn: async () => {
        const id = p?.vehicleId || val('pv-veh'); if (!id) { toast('Every vehicle already has privacy hours.', 'err'); return false; }
        const r = await call(() => API.put(`/map/vehicles/${id}/privacy`, { start: val('pv-start'), end: val('pv-end'), timezone: val('pv-tz').trim(), workDays: [...document.querySelectorAll('.modal-body input[type=checkbox]:checked')].map((i) => Number(i.value)) })); if (!r) return false; toast('Privacy hours saved'); await M.loadFleet(false);
      } }]);
  }
  async function accessDialog() {
    const [u, h] = await Promise.all([call(() => API.get('/team/users')), call(() => API.get('/hubs'))]); if (!u || !h) return;
    const users = (u.data.data || u.data).filter((x) => x.isActive !== false && !['rider', 'driver'].includes(x.role)); const hubs = h.data.data || h.data;
    dialog('Who sees which hubs', `<div class="form-text mb-2">By default people see every vehicle their role allows. Choose hubs to limit one person's map, live feed and alerts feed to those hubs (for example a dispatcher who handles only Kumasi). Administrators always see everything.</div>
      <div class="mb-2"><select id="ac-user" class="form-select"><option value="">Choose a person…</option>${users.map((x) => `<option value="${x.id}">${esc(x.firstName || '')} ${esc(x.lastName || '')} (${esc(x.role)})</option>`).join('')}</select></div><div id="ac-hubs" class="d-none">
        <div class="d-flex flex-wrap gap-2 mb-2">${hubs.map((x) => `<label class="vm-chip" style="cursor:pointer"><input type="checkbox" class="d-none" value="${x.id}" onchange="this.parentNode.classList.toggle('on',this.checked)">${esc(x.name)}</label>`).join('')}</div><div class="form-text">No hub selected: no limit.</div></div>`,
      [{ text: 'Close', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Save', keep: true, fn: async () => {
        const id = val('ac-user'); if (!id) return false; const ids = [...document.querySelectorAll('#ac-hubs input:checked')].map((i) => i.value);
        const r = await call(() => API.put(`/map/scope/users/${id}`, { hubIds: ids })); if (r) toast(ids.length ? `Limited to ${ids.length} hub${ids.length === 1 ? '' : 's'}` : 'No limit'); return false;
      } }]);
    $('ac-user').onchange = async (e) => { const id = e.target.value; $('ac-hubs').classList.toggle('d-none', !id); if (!id) return; const r = await call(() => API.get(`/map/scope/users/${id}`)); const set = new Set(r?.data?.hubIds || []); document.querySelectorAll('#ac-hubs input').forEach((i) => { i.checked = set.has(i.value); i.parentNode.classList.toggle('on', i.checked); }); };
  }
  document.querySelectorAll('[data-setup]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.setup; if (k === 'groups') groupsDialog(); if (k === 'import') importDialog(); if (k === 'assets') assetsDialog(); if (k === 'privacy') privacyDialog(); if (k === 'access') accessDialog();
  }));

  // ================================================================ moving zones: vehicles that come close are highlighted
  function updateNear() {
    const was = S.near, now = new Set();
    S.zones.forEach((z) => { const a = z.g.anchorVehicleId; if (!a) return; S.fleet.forEach((v) => { if (v.id !== a && v.inside?.has(z.g.id)) now.add(v.id); }); });
    let changed = false;
    now.forEach((id) => { if (!was.has(id)) { changed = true; const v = S.fleet.get(id); const z = [...S.zones.values()].find((q) => q.g.anchorVehicleId && v.inside?.has(q.g.id)); toast(`<b>${esc(v.plate)}</b> is inside the moving zone of <b>${esc(S.fleet.get(z?.g.anchorVehicleId)?.plate || 'a vehicle')}</b>`, 'exit'); } });
    was.forEach((id) => { if (!now.has(id)) changed = true; });
    S.near = now; if (changed) S.fleet.forEach((v) => { if (S.markers.has(v.id)) M.upsertMarker(v); });
  }

  // ================================================================ wiring
  H.fleet = () => { updateNear(); };
  H.tab = (t) => { A.tab = t; if (t === 'dispatch') loadBoard(); if (t === 'health') loadRisk(); if (t === 'tasks') loadTasks(); if (t === 'setup') loadAssets(); };
  H.ready = async () => {
    if (!canEdit()) $('vm-setup-tab').querySelector('button').title = 'Settings (view only)';
    await loadGroups(); loadAssets(); loadRisk(); loadBoard(); loadTasks();
    setInterval(updateNear, 2500);
    setInterval(() => { loadBoard(); loadRisk(); loadTasks(); loadAssets(); }, 60000);
  };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && A.advice) closeAdvice(); });
  window.__vmapAdv = A;
})();
