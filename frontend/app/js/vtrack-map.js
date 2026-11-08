/**
 * Live map: tracking with clustering, geofences (draw/edit, inside/outside, alerts), places, base maps, traffic and
 * weather overlays, measuring, route replay, stops, heatmap, address search, destinations with ETA and vehicle icons.
 * All data comes from /api/map/*, /api/geofences and the /twin and /alerts sockets.
 */
(function () {
  'use strict';
  const API = window.VTrackAPI;
  API.requireAuth();
  window.VTrackNav.render();

  // ---------------------------------------------------------------- constants and helpers
  const STATUS = {
    moving: { label: 'Moving', color: '#16a34a' },
    idle: { label: 'Idle', color: '#f59e0b' },
    parked: { label: 'Stopped', color: '#dc2626' },
    offline: { label: 'Offline', color: '#6b7280' },
    no_gps: { label: 'No GPS yet', color: '#94a3b8' },
    off_duty: { label: 'Off duty', color: '#8b5cf6' },
  };
  const ICONS = { ebike: 'bi-lightning-charge-fill', trike: 'bi-truck-flatbed', truck: 'bi-truck', van: 'bi-truck-front-fill', car: 'bi-car-front-fill', bus: 'bi-bus-front-fill', motorbike: 'bi-bicycle', excavator: 'bi-minecart-loaded', arrow: 'bi-arrow-up-circle-fill' };
  const POI_STYLE = { depot: ['#2563eb', 'bi-building'], hub: ['#7c3aed', 'bi-house-door'], customer: ['#0d9488', 'bi-shop'], fuel: ['#ea580c', 'bi-fuel-pump-fill'], charging: ['#16a34a', 'bi-ev-station-fill'], parking: ['#475569', 'bi-p-circle'], service: ['#b45309', 'bi-tools'], other: ['#64748b', 'bi-geo-alt-fill'] };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vtmap.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('vtmap.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const fmtTime = (iso) => new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDur = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`; };
  const ago = (sec) => (sec == null ? 'never' : sec < 90 ? `${sec} s ago` : sec < 5400 ? `${Math.round(sec / 60)} min ago` : sec < 172800 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} d ago`);
  const toast = (msg, kind) => { const t = document.createElement('div'); t.className = 'vm-toast ' + (kind || ''); t.innerHTML = msg; $('vm-toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 5000); };
  const call = async (fn) => { try { return await fn(); } catch (e) { toast(esc(e.message || 'Something went wrong'), 'err'); return null; } };
  const distM = (a, b) => L.latLng(a).distanceTo(L.latLng(b));
  const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);

  // ---------------------------------------------------------------- state
  const S = {
    cfg: null, fleet: new Map(), markers: new Map(), zones: new Map(), pois: new Map(), poiMarkers: new Map(),
    selected: null, follow: false, filter: { text: '', status: new Set() }, refresh: 30, timer: null,
    events: [], seen: new Set(), unread: 0, muted: store.get('muted', false), audio: null,
    trails: new Map(), addrCache: new Map(), edit: null, pick: null,
    zoneGroups: new Map(), near: new Set(),
  };
  /** Extension points; js/vtrack-map-adv.js fills these in (risk, dispatch, checklists, groups, cameras, privacy...). */
  const H = { popup: () => '', acts: () => '', act: () => {}, fleet: () => {}, task: () => {}, ready: () => {}, tab: () => {}, zoneForm: () => '', zoneBody: () => ({}), zoneAfter: async () => {}, zoneTag: () => '', destForm: () => '', destBody: () => ({}), poi: () => '', replayNote: () => '', zonesDrawn: () => {} };
  /** A zone limited to certain vehicle groups only applies to vehicles in one of them. */
  const zoneApplies = (z, v) => { const gs = S.zoneGroups.get(z.g.id); return !gs || !gs.size || (v.groupIds || []).some((x) => gs.has(x)); };
  const violating = (v) => [...(v.inside || [])].some((id) => { const g = S.zones.get(id)?.g; return g && (g.rule === 'restricted' || (g.rule === 'lez' && v.fuelType && !/electric|ev/i.test(v.fuelType))); });

  // ---------------------------------------------------------------- map and layers
  const map = L.map('map', { zoomControl: false, preferCanvas: false, worldCopyJump: true }).setView([5.6037, -0.187], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  const bases = {
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'vm-street', attribution: '&copy; OpenStreetMap contributors' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
    terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)' }),
  };
  let baseName = store.get('base', 'street');
  if (!bases[baseName]) baseName = 'street';
  bases[baseName].addTo(map);

  const clusterOn = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 55, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => L.divIcon({ className: '', html: `<div class="vm-cluster"><b>${c.getChildCount()}</b></div>`, iconSize: [44, 44] }),
  });
  const plain = L.layerGroup();
  let fleetLayer = clusterOn;
  const zoneLayer = L.layerGroup().addTo(map);
  const poiLayer = L.layerGroup().addTo(map);
  const trailLayer = L.layerGroup();
  const replayLayer = L.layerGroup().addTo(map);
  const measureLayer = L.layerGroup().addTo(map);
  fleetLayer.addTo(map);
  let trafficLayer = null, weatherLayer = null, heatLayer = null, weatherTimer = null;

  // ---------------------------------------------------------------- vehicle markers
  const vehColor = (v) => (STATUS[v.status] || STATUS.no_gps).color;
  function markerIcon(v) {
    const p = v.position;
    const icon = ICONS[v.icon] || ICONS[v.vehicleType === 'tricycle' ? 'trike' : 'ebike'] || ICONS.ebike;
    const inside = v.inside && v.inside.size ? ' inside' : '';
    const stale = v.status === 'offline' ? ' stale' : '';
    const showDir = v.status === 'moving' || (p && p.speed > 1);
    const rk = v.risk && v.risk.level !== 'low' ? ` risk-${v.risk.level}` : '';
    const flags = `${rk}${violating(v) ? ' viol' : ''}${S.near.has(v.id) ? ' near' : ''}`;
    return L.divIcon({
      className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18],
      html: `<div class="vm-mk${inside}${stale}${flags}" style="--c:${vehColor(v)}"><div class="dir" style="transform:rotate(${p ? p.heading : 0}deg);${showDir ? '' : 'opacity:.0'}"></div><div class="body"><i class="bi ${icon}"></i></div>${rk ? '<span class="rk"><i class="bi bi-wrench-adjustable"></i></span>' : ''}${violating(v) ? '<span class="vi"><i class="bi bi-exclamation-lg"></i></span>' : ''}<div class="lab">${esc(v.plate)}</div></div>`,
    });
  }
  function popupHtml(v) {
    const p = v.position, st = STATUS[v.status] || STATUS.no_gps;
    const zones = [...(v.inside || [])].map((id) => S.zones.get(id)?.g.name).filter(Boolean);
    const addr = S.addrCache.get(key(p));
    const edit = S.cfg.canEdit;
    const dest = v.destination;
    return `<div class="vm-pop" data-vid="${v.id}">
      <h6>${esc(v.plate)}${v.modelName ? ` <small class="text-muted fw-normal">${esc(v.modelName)}</small>` : ''}</h6>
      <span class="st"><span class="vm-dot" style="background:${st.color}"></span>${st.label}</span>
      ${zones.length ? `<span class="st ms-1" title="Inside geofence"><i class="bi bi-hexagon"></i> ${esc(zones.join(', '))}</span>` : ''}
      <table>
        <tr><td>Speed</td><td><b>${p ? Math.round(p.speed) : 0} km/h</b>${p ? ` &middot; heading ${Math.round(p.heading)}°` : ''}</td></tr>
        <tr><td>GPS time</td><td>${p ? `${esc(fmtTime(p.time))} <span class="text-muted">(${ago(Math.max(0, Math.round((Date.now() - new Date(p.time)) / 1000)))})</span>` : '–'}</td></tr>
        <tr><td>Address</td><td class="vm-addr">${p ? esc(addr || 'Looking up…') : '–'}</td></tr>
        <tr><td>Driver</td><td>${v.rider ? esc(v.rider.name) + (v.rider.phone ? ` <span class="text-muted">${esc(v.rider.phone)}</span>` : '') : '<span class="text-muted">Not assigned</span>'}</td></tr>
        <tr><td>Hub</td><td>${esc(v.hubName || '–')}</td></tr>
        ${p ? `<tr><td>Engine</td><td>${p.ignition ? 'On' : 'Off'}${v.device?.battery ? ` &middot; battery ${Math.round(v.device.battery)}%` : ''}</td></tr>` : ''}
        ${dest ? `<tr><td>Going to</td><td>${esc(dest.label || 'Destination')} <span class="vm-eta text-muted">…</span></td></tr>` : ''}
      </table>${H.popup(v)}
      <div class="acts">
        <button class="btn btn-outline-primary" data-act="follow"><i class="bi bi-crosshair"></i> Follow</button>
        <button class="btn btn-outline-primary" data-act="replay"><i class="bi bi-clock-history"></i> Replay</button>
        <a class="btn btn-outline-secondary" href="vehicle-history.html?id=${v.id}"><i class="bi bi-journal-text"></i> History</a>
        ${edit ? `<button class="btn btn-outline-primary" data-act="dest"><i class="bi bi-flag-fill"></i> Destination</button>
        <button class="btn btn-outline-primary" data-act="zone"><i class="bi bi-circle"></i> Zone around it</button>
        <button class="btn btn-outline-secondary" data-act="icon"><i class="bi bi-palette"></i> Icon</button>` : ''}${H.acts(v)}
      </div></div>`;
  }
  const key = (p) => (p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : '');

  const ll = (p) => (p.snapped ? [p.snapped.lat, p.snapped.lng] : [p.lat, p.lng]);
  function upsertMarker(v) {
    const p = v.position;
    let m = S.markers.get(v.id);
    if (!p) { if (m) { fleetLayer.removeLayer(m); S.markers.delete(v.id); } return; }
    if (!m) {
      m = L.marker(ll(p), { icon: markerIcon(v), title: v.plate, riseOnHover: true });
      m.bindPopup(() => popupHtml(S.fleet.get(v.id)), { maxWidth: 330, autoPan: true });
      m.on('click', () => select(v.id, { pan: false }));
      m.on('popupopen', () => onPopupOpen(v.id));
      S.markers.set(v.id, m);
      if (matches(v)) fleetLayer.addLayer(m);
    } else {
      m.setLatLng(ll(p));
      m.setIcon(markerIcon(v));
      if (m.isPopupOpen()) m.getPopup().setContent(popupHtml(v));
    }
  }
  function matches(v) {
    const f = S.filter, t = f.text;
    if (f.status.size && !f.status.has(v.status)) return false;
    if (!t) return true;
    return [v.plate, v.rider?.name, v.hubName, v.modelName].some((x) => (x || '').toLowerCase().includes(t));
  }
  function applyFilter() {
    S.fleet.forEach((v) => {
      const m = S.markers.get(v.id);
      if (!m) return;
      const shown = fleetLayer.hasLayer(m);
      if (matches(v) && !shown) fleetLayer.addLayer(m);
      else if (!matches(v) && shown) fleetLayer.removeLayer(m);
    });
    renderList();
  }

  async function onPopupOpen(id) {
    const v = S.fleet.get(id); const el = () => document.querySelector(`.vm-pop[data-vid="${id}"]`);
    if (v.position && !S.addrCache.has(key(v.position))) {
      const r = await call(() => API.get(`/map/geocode/reverse?lat=${v.position.lat}&lng=${v.position.lng}`));
      S.addrCache.set(key(v.position), r?.data?.address || 'Address not available');
      const a = el()?.querySelector('.vm-addr'); if (a) a.textContent = S.addrCache.get(key(v.position));
    }
    if (v.destination) {
      const r = await call(() => API.post(`/map/vehicles/${id}/eta`, {}));
      const e = r?.data, x = el()?.querySelector('.vm-eta');
      if (e && x) x.innerHTML = `&middot; <b>${e.minutes} min</b> (${e.roadKm} km, arrives ${new Date(e.etaAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})${e.atCurrentPaceMinutes != null ? '' : ' <span title="No recent driving speed, so free-flow time is shown">*</span>'}`;
      else if (x) x.textContent = '';
    }
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('.vm-pop [data-act]'); if (!b) return;
    const id = b.closest('.vm-pop').dataset.vid, act = b.dataset.act;
    if (act === 'follow') { S.follow = true; $('vm-follow').classList.add('on'); select(id, { pan: true }); }
    if (act === 'replay') openReplayFor(id);
    if (act === 'dest') destinationDialog(id);
    if (act === 'zone') zoneAroundVehicle(id);
    if (act === 'icon') iconDialog(id);
    H.act(act, id);
  });

  // ---------------------------------------------------------------- geofence geometry
  function inZone(z, ll) {
    if (z.kind === 'circle') return distM(z.center, ll) <= z.radius;
    const [x, y] = [ll[1], ll[0]]; let c = false;
    for (let i = 0, j = z.ring.length - 1; i < z.ring.length; j = i++) {
      const xi = z.ring[i][1], yi = z.ring[i][0], xj = z.ring[j][1], yj = z.ring[j][0];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function parseZone(g) {
    const color = g.color || '#2563eb';
    if (g.type === 'circle') {
      const z = { g, kind: 'circle', color, radius: Number(g.radius), center: [Number(g.centerLatitude), Number(g.centerLongitude)] };
      if (g.anchorVehicleId) { const a = S.fleet.get(g.anchorVehicleId); if (a?.position) z.center = [a.position.lat, a.position.lng]; else z.noCenter = true; }
      return z;
    }
    const ring = g.coordinates?.coordinates?.[0] || [];
    return { g, kind: 'polygon', color, ring: ring.map((p) => [p[1], p[0]]) };
  }
  function drawZone(z) {
    const g = z.g; if (z.layer) zoneLayer.removeLayer(z.layer);
    const style = { color: z.color, weight: g.isActive === false ? 1 : 2, fillColor: z.color, fillOpacity: g.isActive === false ? 0.04 : 0.2, dashArray: g.anchorVehicleId ? '6 5' : g.rule === 'restricted' ? '2 6' : g.rule === 'lez' ? '10 4' : null };
    if (z.kind === 'circle') { if (z.noCenter || !isFinite(z.center[0])) { z.layer = null; return; } z.layer = L.circle(z.center, { ...style, radius: z.radius }); }
    else z.layer = L.polygon(z.ring, style);
    const inCount = [...S.fleet.values()].filter((v) => v.inside?.has(g.id)).length;
    z.layer.bindTooltip(`${esc(g.name)}${g.anchorVehicleId ? ' (follows a vehicle)' : ''} &middot; ${inCount} inside`, { sticky: true, className: 'vm-tip' });
    z.layer.on('click', () => { if (!S.edit && !S.pick) z.layer.bindPopup(zonePopup(z)).openPopup(); });
    z.layer.addTo(zoneLayer);
  }
  function zonePopup(z) {
    const g = z.g, who = [...S.fleet.values()].filter((v) => v.inside?.has(g.id)).map((v) => v.plate);
    return `<div class="vm-pop"><h6>${esc(g.name)}</h6><div class="text-muted">${z.kind === 'circle' ? `Circle, ${fmtKm(z.radius)} radius` : 'Polygon'}${g.speedLimit ? ` &middot; limit ${g.speedLimit} km/h` : ''}</div>${H.zoneTag(g) ? `<div class="mt-1">${H.zoneTag(g)}</div>` : ''}<div class="mt-1">Inside now: ${who.length ? esc(who.join(', ')) : 'nobody'}</div></div>`;
  }
  function recomputeInside() {
    S.fleet.forEach((v) => {
      const before = v.inside ? [...v.inside].sort().join() : '';
      v.inside = new Set();
      if (v.position) S.zones.forEach((z, id) => { if (z.g.isActive !== false && zoneApplies(z, v) && !(z.g.anchorVehicleId === v.id) && !(z.kind === 'circle' && z.noCenter) && inZone(z, [v.position.lat, v.position.lng])) v.inside.add(id); });
      if (before !== [...v.inside].sort().join()) upsertMarker(v);
    });
  }
  async function loadZones() {
    const r = await call(() => API.get('/geofences'));
    const rows = r?.data?.data ?? r?.data ?? [];
    S.zones.clear(); zoneLayer.clearLayers();
    rows.forEach((g) => S.zones.set(g.id, parseZone(g)));
    redrawZones();
  }
  function redrawZones() {
    S.zones.forEach((z) => { if (z.g.anchorVehicleId) { const a = S.fleet.get(z.g.anchorVehicleId); if (a?.position) { z.center = [a.position.lat, a.position.lng]; z.noCenter = false; } } });
    recomputeInside();
    S.zones.forEach(drawZone);
    renderZoneList(); H.zonesDrawn();
  }

  // ---------------------------------------------------------------- fleet data
  async function loadFleet(first) {
    const r = await call(() => API.get('/map/fleet'));
    if (!r) { setLive('bad', 'Offline'); return; }
    const list = r.data.vehicles, ids = new Set(list.map((v) => v.id));
    list.forEach((nv) => {
      const old = S.fleet.get(nv.id);
      nv.inside = old?.inside || new Set();
      S.fleet.set(nv.id, nv);
    });
    [...S.fleet.keys()].forEach((id) => { if (!ids.has(id)) { const m = S.markers.get(id); if (m) fleetLayer.removeLayer(m); S.markers.delete(id); S.fleet.delete(id); } });
    redrawZones();
    S.fleet.forEach(upsertMarker);
    renderList(); renderChips(); updateCount(); fillReplayVehicles();
    if (first) fitAll(true);
    if (S.follow && S.selected) followSelected();
    if (S.trailsOn) S.fleet.forEach(addTrailPoint);
    H.fleet(list);
  }
  function updateCount() {
    const n = [...S.fleet.values()];
    $('vm-count').textContent = `${n.filter((v) => v.status === 'moving').length} moving · ${n.length} vehicles`;
  }
  function fitAll(quiet) {
    const pts = [...S.fleet.values()].filter((v) => v.position && matches(v)).map((v) => [v.position.lat, v.position.lng]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16, animate: !quiet });
    else if (!quiet) toast('No vehicle has reported a position yet.');
  }
  function setLive(cls, text) { const e = $('vm-live'); e.className = 'vm-pill ' + cls; e.innerHTML = `<i class="bi bi-circle-fill"></i> ${text}`; }

  // realtime
  function connectSockets() {
    const auth = { token: API.getToken() };
    const tw = io(`${API.wsBaseUrl}/twin`, { transports: ['websocket'], auth });
    tw.on('connect', () => setLive('ok', 'Live'));
    tw.on('disconnect', () => setLive('wait', 'Reconnecting'));
    tw.on('connect_error', () => setLive('bad', 'Offline (polling)'));
    tw.on('digitalTwinUpdate', (s) => {
      const v = [...S.fleet.values()].find((x) => x.id === s.vehicleId); if (!v || !s.position) return;
      const lat = Number(s.position.latitude), lng = Number(s.position.longitude); if (!isFinite(lat) || !isFinite(lng)) return;
      const speed = Number(s.position.speed ?? 0);
      v.position = { ...(v.position || {}), lat, lng, speed, heading: Number(s.position.heading ?? v.position?.heading ?? 0), time: s.lastUpdatedAt || new Date().toISOString(), ageSeconds: 0, ignition: v.position?.ignition ?? speed > 0 };
      v.status = speed > 3 ? 'moving' : v.position.ignition ? 'idle' : 'parked';
      if (v.position.speed > 0) v.position.ignition = true;
      S.markers.has(v.id) || upsertMarker(v);
      redrawZonesFor(v); upsertMarker(v); updateRow(v); updateCount();
      if (S.trailsOn) addTrailPoint(v);
      if (S.follow && S.selected === v.id) followSelected();
    });
    const al = io(`${API.wsBaseUrl}/alerts`, { transports: ['websocket'], auth });
    al.on('newAlert', (a) => { if (/geofence/i.test(a.type || '')) pollEvents(); });
    al.on('taskUpdate', (t) => H.task(t));
  }
  function redrawZonesFor(v) {
    S.zones.forEach((z) => { if (z.g.anchorVehicleId === v.id && v.position) { z.center = [v.position.lat, v.position.lng]; z.noCenter = false; drawZone(z); } });
    const before = v.inside ? [...v.inside].sort().join() : '';
    v.inside = new Set();
    S.zones.forEach((z, id) => { if (z.g.isActive !== false && zoneApplies(z, v) && z.g.anchorVehicleId !== v.id && !(z.kind === 'circle' && z.noCenter) && inZone(z, [v.position.lat, v.position.lng])) v.inside.add(id); });
    if (before !== [...v.inside].sort().join()) renderZoneList();
  }
  function schedule() { clearInterval(S.timer); S.timer = setInterval(() => { loadFleet(false); pollEvents(); }, S.refresh * 1000); }

  // ---------------------------------------------------------------- asset list
  function renderChips() {
    const counts = {}; S.fleet.forEach((v) => { counts[v.status] = (counts[v.status] || 0) + 1; });
    $('vm-status-chips').innerHTML = Object.keys(STATUS).filter((k) => counts[k]).map((k) => `<button class="vm-chip ${S.filter.status.has(k) ? 'on' : ''}" data-st="${k}"><span class="vm-dot" style="background:${STATUS[k].color}"></span>${STATUS[k].label} ${counts[k]}</button>`).join('');
  }
  function rowHtml(v) {
    const st = STATUS[v.status] || STATUS.no_gps, p = v.position;
    const icon = ICONS[v.icon] || ICONS.ebike;
    return `<div class="vm-row ${S.selected === v.id ? 'sel' : ''}" data-id="${v.id}"><span class="vm-ico" style="background:${st.color}"><i class="bi ${icon}"></i></span>
      <div class="grow"><div class="t">${esc(v.plate)}${v.inside?.size ? ' <i class="bi bi-hexagon text-primary" title="Inside a geofence"></i>' : ''}</div>
      <div class="s">${st.label}${p ? ` · ${Math.round(p.speed)} km/h` : ''} · ${esc(v.rider?.name || 'no driver')}</div></div>
      <div class="s text-end">${p ? ago(Math.max(0, Math.round((Date.now() - new Date(p.time)) / 1000))) : '–'}</div></div>`;
  }
  function renderList() {
    const vs = [...S.fleet.values()].filter(matches).sort((a, b) => a.plate.localeCompare(b.plate));
    $('vm-asset-list').innerHTML = vs.length ? vs.map(rowHtml).join('') : '<div class="text-muted small p-3">No vehicles match.</div>';
  }
  function updateRow(v) { const row = document.querySelector(`.vm-row[data-id="${v.id}"]`); if (row) row.outerHTML = rowHtml(v); }
  function select(id, opt = {}) {
    S.selected = id; renderList();
    const v = S.fleet.get(id), m = S.markers.get(id); if (!v) return;
    if (opt.pan !== false && v.position) {
      if (m && fleetLayer.zoomToShowLayer && !map.hasLayer(m)) fleetLayer.zoomToShowLayer(m, () => m.openPopup());
      map.setView([v.position.lat, v.position.lng], Math.max(map.getZoom(), 16), { animate: true });
      if (m) setTimeout(() => (fleetLayer.zoomToShowLayer ? fleetLayer.zoomToShowLayer(m, () => m.openPopup()) : m.openPopup()), 350);
    }
  }
  function followSelected() { const v = S.fleet.get(S.selected); if (v?.position) map.panTo([v.position.lat, v.position.lng], { animate: true }); }
  $('vm-asset-list').addEventListener('click', (e) => { const r = e.target.closest('.vm-row'); if (r) { select(r.dataset.id, { pan: true }); if (innerWidth < 992) $('vm-panel').classList.add('collapsed'); } });
  $('vm-asset-search').addEventListener('input', (e) => { S.filter.text = e.target.value.trim().toLowerCase(); applyFilter(); });
  $('vm-status-chips').addEventListener('click', (e) => { const b = e.target.closest('.vm-chip'); if (!b) return; const k = b.dataset.st; S.filter.status.has(k) ? S.filter.status.delete(k) : S.filter.status.add(k); renderChips(); applyFilter(); });

  // tabs and panel
  document.querySelectorAll('.vm-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.vm-tabs .nav-link').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.vm-pane').forEach((p) => p.classList.toggle('d-none', p.dataset.pane !== b.dataset.tab));
    if (b.dataset.tab === 'alerts') { S.unread = 0; badge(); }
    H.tab(b.dataset.tab);
  }));
  const openTab = (t) => document.querySelector(`.vm-tabs [data-tab="${t}"]`).click();
  $('vm-panel-toggle').addEventListener('click', () => { $('vm-panel').classList.toggle('collapsed'); setTimeout(() => map.invalidateSize(), 250); });
  if (innerWidth < 992) $('vm-panel').classList.add('collapsed');

  // ---------------------------------------------------------------- tool buttons
  $('vm-fit').addEventListener('click', () => fitAll(false));
  $('vm-follow').addEventListener('click', () => {
    if (!S.selected) { toast('Pick a vehicle in the list or on the map first.'); return; }
    S.follow = !S.follow; $('vm-follow').classList.toggle('on', S.follow); if (S.follow) followSelected();
  });
  map.on('dragstart', () => { if (S.follow) { S.follow = false; $('vm-follow').classList.remove('on'); } });
  $('vm-full').addEventListener('click', () => {
    const on = !document.body.classList.contains('vm-full');
    document.body.classList.toggle('vm-full', on);
    $('vm-full').querySelector('i').className = 'bi ' + (on ? 'bi-fullscreen-exit' : 'bi-fullscreen');
    if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(() => map.invalidateSize(), 200);
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('vm-full')) { document.body.classList.remove('vm-full'); $('vm-full').querySelector('i').className = 'bi bi-fullscreen'; setTimeout(() => map.invalidateSize(), 200); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (S.pick) cancelPick(); if (measuring) toggleMeasure(false); if (document.body.classList.contains('vm-full') && !document.fullscreenElement) { document.body.classList.remove('vm-full'); setTimeout(() => map.invalidateSize(), 200); } } });
  if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));
  map.on('mousemove', (e) => { $('vm-coords').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`; });
  map.on('click', (e) => { if (!measuring && !S.pick && !drawing) $('vm-coords').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}  (selected)`; });

  // layers panel
  $('vm-layers-btn').addEventListener('click', () => $('vm-layers').classList.toggle('d-none'));
  function setBase(name) {
    Object.values(bases).forEach((l) => map.removeLayer(l)); bases[name].addTo(map).bringToBack(); baseName = name; store.set('base', name);
    document.querySelectorAll('#vm-base [data-base]').forEach((b) => b.classList.toggle('active', b.dataset.base === name));
  }
  $('vm-base').addEventListener('click', (e) => { const b = e.target.closest('[data-base]'); if (b) setBase(b.dataset.base); });
  setBase(baseName);
  const toggleLayer = (id, layer) => $(id).addEventListener('change', (e) => (e.target.checked ? map.addLayer(layer) : map.removeLayer(layer)));
  toggleLayer('ly-zones', zoneLayer); toggleLayer('ly-pois', poiLayer);
  $('ly-cluster').addEventListener('change', (e) => {
    const next = e.target.checked ? clusterOn : plain; if (next === fleetLayer) return;
    map.removeLayer(fleetLayer); fleetLayer.clearLayers(); fleetLayer = next; fleetLayer.addTo(map);
    S.markers.forEach((m, id) => { if (matches(S.fleet.get(id))) fleetLayer.addLayer(m); });
  });
  $('ly-labels').addEventListener('change', (e) => document.getElementById('map').classList.toggle('show-labels', e.target.checked));
  S.trailsOn = false;
  $('ly-trails').addEventListener('change', (e) => { S.trailsOn = e.target.checked; if (S.trailsOn) { trailLayer.addTo(map); } else { map.removeLayer(trailLayer); trailLayer.clearLayers(); S.trails.clear(); } });
  function addTrailPoint(v) {
    if (!v.position) return;
    let t = S.trails.get(v.id); const ll = [v.position.lat, v.position.lng];
    if (!t) { t = { pts: [], line: L.polyline([], { color: vehColor(v), weight: 3, opacity: 0.7 }).addTo(trailLayer) }; S.trails.set(v.id, t); }
    const last = t.pts[t.pts.length - 1]; if (last && distM(last, ll) < 5) return;
    t.pts.push(ll); if (t.pts.length > 60) t.pts.shift(); t.line.setLatLngs(t.pts).setStyle({ color: vehColor(v) });
  }
  $('vm-refresh').value = String(S.refresh);
  $('vm-refresh').addEventListener('change', (e) => { S.refresh = Number(e.target.value); store.set('refresh', S.refresh); schedule(); toast(`Refreshing every ${S.refresh} s`); });

  // traffic and weather
  function setupOverlays() {
    const t = S.cfg.traffic;
    if (t.enabled) {
      trafficLayer = L.tileLayer(t.tileUrl, { maxZoom: 19, opacity: 0.85, attribution: t.attribution });
      $('ly-traffic').addEventListener('change', (e) => (e.target.checked ? trafficLayer.addTo(map) : map.removeLayer(trafficLayer)));
    } else {
      $('ly-traffic').disabled = true; $('ly-traffic-note').textContent = t.reason;
    }
    $('ly-weather').addEventListener('change', async (e) => {
      if (!e.target.checked) { if (weatherLayer) map.removeLayer(weatherLayer); clearInterval(weatherTimer); return; }
      await buildWeather(); if (weatherLayer) weatherLayer.addTo(map); weatherTimer = setInterval(async () => { const was = weatherLayer; await buildWeather(); if (was) map.removeLayer(was); weatherLayer?.addTo(map); }, 600000);
    });
    $('ly-weather-note').textContent = S.cfg.weather.note || '';
  }
  async function buildWeather() {
    const w = S.cfg.weather;
    if (w.provider === 'custom') { weatherLayer = L.tileLayer(w.tileUrl, { opacity: 0.6, attribution: w.attribution, maxZoom: 19 }); return; }
    try {
      const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
      const frame = j.radar?.past?.[j.radar.past.length - 1]; if (!frame) throw new Error('no frames');
      weatherLayer = L.tileLayer(`${j.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.65, maxNativeZoom: 7, maxZoom: 19, attribution: w.attribution, zIndex: 400 });
    } catch { weatherLayer = null; $('ly-weather').checked = false; toast('Weather radar is not reachable right now.', 'err'); }
  }

  // ---------------------------------------------------------------- measure
  let measuring = false, mpts = [], mline = null;
  function toggleMeasure(on) {
    measuring = on === undefined ? !measuring : on; $('vm-measure').classList.toggle('on', measuring);
    map.getContainer().style.cursor = measuring ? 'crosshair' : '';
    if (measuring) { mpts = []; measureLayer.clearLayers(); mline = L.polyline([], { color: '#ef4444', weight: 3, dashArray: '6 6' }).addTo(measureLayer); $('vm-measure-box').classList.remove('d-none'); showMeasure(); }
    else { $('vm-measure-box').classList.add('d-none'); measureLayer.clearLayers(); }
  }
  function showMeasure() {
    let total = 0; for (let i = 1; i < mpts.length; i++) total += distM(mpts[i - 1], mpts[i]);
    $('vm-measure-box').innerHTML = `<i class="bi bi-rulers"></i> ${mpts.length < 2 ? 'Click points on the map' : `<b>${fmtKm(total)}</b> over ${mpts.length - 1} leg${mpts.length > 2 ? 's' : ''}`} <button class="btn btn-sm btn-link p-0 ms-2" id="ms-undo">Undo</button> <button class="btn btn-sm btn-link p-0 ms-1" id="ms-done">Done</button>`;
    $('ms-undo').onclick = () => { mpts.pop(); redrawMeasure(); }; $('ms-done').onclick = () => toggleMeasure(false);
  }
  function redrawMeasure() { measureLayer.clearLayers(); mline = L.polyline(mpts, { color: '#ef4444', weight: 3, dashArray: '6 6' }).addTo(measureLayer); mpts.forEach((p) => L.circleMarker(p, { radius: 4, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }).addTo(measureLayer)); showMeasure(); }
  map.on('click', (e) => { if (!measuring) return; mpts.push(e.latlng); redrawMeasure(); });
  $('vm-measure').addEventListener('click', () => toggleMeasure());

  // ---------------------------------------------------------------- address search
  let searchTimer;
  $('vm-search-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const q = $('vm-search').value.trim(); const box = $('vm-search-results');
    if (q.length < 3) { toast('Type at least 3 characters.'); return; }
    // coordinates typed directly
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) { goTo(+m[1], +m[2], q); return; }
    box.classList.remove('d-none'); box.innerHTML = '<div class="p-2 small text-muted">Searching…</div>';
    const c = map.getCenter(); const r = await call(() => API.get(`/map/geocode/search?q=${encodeURIComponent(q)}&lat=${c.lat}&lng=${c.lng}`));
    const rows = r?.data || [];
    if (!r) { box.classList.add('d-none'); return; }
    box.innerHTML = rows.length ? rows.map((x, i) => `<button type="button" data-i="${i}">${esc(x.label)}</button>`).join('') : '<div class="p-2 small text-muted">Nothing found. Try a nearby landmark or a town name.</div>';
    box.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; const x = rows[+b.dataset.i]; box.classList.add('d-none'); x.bbox ? map.fitBounds([[x.bbox[0], x.bbox[2]], [x.bbox[1], x.bbox[3]]], { maxZoom: 17 }) : map.setView([x.lat, x.lng], 16); dropPin(x.lat, x.lng, x.label); };
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.vm-search')) $('vm-search-results').classList.add('d-none'); });
  let pin = null;
  function dropPin(lat, lng, label) { if (pin) map.removeLayer(pin); pin = L.marker([lat, lng]).addTo(map).bindPopup(`<b>${esc(label)}</b><br><small>${lat.toFixed(6)}, ${lng.toFixed(6)}</small>`).openPopup(); }
  function goTo(lat, lng, label) { map.setView([lat, lng], 16); dropPin(lat, lng, label); $('vm-search-results').classList.add('d-none'); }

  // ---------------------------------------------------------------- places (POIs)
  async function loadPois() {
    const r = await call(() => API.get('/map/pois')); poiLayer.clearLayers(); S.pois.clear();
    (r?.data || []).forEach((p) => {
      S.pois.set(p.id, p); const [c, ic] = POI_STYLE[p.category] || POI_STYLE.other;
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="vm-poi${p.capacity != null && p.available === 0 ? ' full' : ''}" style="background:${c}"><i class="bi ${ic}"></i>${p.capacity != null ? `<span class="avl">${p.available}</span>` : ''}</div>` }), zIndexOffset: -500 });
      m.bindPopup(`<div class="vm-pop"><h6>${esc(p.name)}</h6><div class="text-muted text-capitalize">${esc(p.category)}</div>${p.address ? `<div>${esc(p.address)}</div>` : ''}${p.notes ? `<div class="mt-1">${esc(p.notes)}</div>` : ''}${H.poi(p)}${S.cfg.canEdit ? `<div class="acts mt-2"><button class="btn btn-outline-primary" data-poi-edit="${p.id}">Edit</button><button class="btn btn-outline-danger" data-poi-del="${p.id}">Delete</button></div>` : ''}</div>`);
      m.addTo(poiLayer);
    });
  }
  document.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-poi-edit]'), del = e.target.closest('[data-poi-del]');
    if (ed) poiDialog(S.pois.get(ed.dataset.poiEdit));
    if (del) call(async () => { if (!confirm('Delete this place?')) return; await API.del(`/map/pois/${del.dataset.poiDel}`); map.closePopup(); await loadPois(); toast('Place deleted'); });
  });
  map.on('contextmenu', (e) => { if (!S.cfg.canEdit || measuring || S.pick) return; L.popup().setLatLng(e.latlng).setContent(`<div class="vm-pop"><div class="mb-1"><small>${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}</small></div><button class="btn btn-sm btn-outline-primary" id="ctx-poi"><i class="bi bi-geo-alt-fill"></i> Add a place here</button></div>`).openOn(map); setTimeout(() => { const b = $('ctx-poi'); if (b) b.onclick = () => { map.closePopup(); poiDialog({ lat: e.latlng.lat, lng: e.latlng.lng }); }; }, 0); });

  // ---------------------------------------------------------------- dialogs
  const modal = () => bootstrap.Modal.getOrCreateInstance($('vm-modal'));
  function dialog(title, body, buttons) {
    $('vm-modal-title').textContent = title; $('vm-modal-body').innerHTML = body; const f = $('vm-modal-foot'); f.innerHTML = '';
    buttons.forEach((b) => { const x = document.createElement('button'); x.className = 'btn ' + (b.cls || 'btn-primary'); x.textContent = b.text; x.onclick = async () => { const ok = await b.fn(); if (ok !== false && !b.keep) modal().hide(); }; f.appendChild(x); });
    modal().show();
  }
  const val = (id) => $(id).value;
  function poiDialog(p) {
    const cats = S.cfg.poiCategories, edit = !!p.id;
    dialog(edit ? 'Edit place' : 'New place', `<div class="mb-2"><label class="form-label">Name</label><input id="pf-name" class="form-control" maxlength="120" value="${esc(p.name || '')}"></div>
      <div class="mb-2"><label class="form-label">Type</label><select id="pf-cat" class="form-select">${cats.map((c) => `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></div>
      <div class="row g-2 mb-2"><div class="col"><label class="form-label">Latitude</label><input id="pf-lat" class="form-control" value="${p.lat}"></div><div class="col"><label class="form-label">Longitude</label><input id="pf-lng" class="form-control" value="${p.lng}"></div></div>
      <div class="mb-2"><label class="form-label">Address</label><input id="pf-addr" class="form-control" maxlength="255" value="${esc(p.address || '')}"></div>
      <div><label class="form-label">Notes</label><textarea id="pf-notes" class="form-control" rows="2">${esc(p.notes || '')}</textarea></div>`,
      [{ text: 'Cancel', cls: 'btn-outline-secondary', fn: () => true }, { text: 'Save', fn: async () => {
        const body = { name: val('pf-name').trim(), category: val('pf-cat'), lat: Number(val('pf-lat')), lng: Number(val('pf-lng')), address: val('pf-addr').trim() || null, notes: val('pf-notes').trim() || null };
        const r = await call(() => (edit ? API.put(`/map/pois/${p.id}`, body) : API.post('/map/pois', body))); if (!r) return false; await loadPois(); toast('Place saved');
      } }]);
  }
  function iconDialog(id) {
    const v = S.fleet.get(id);
    dialog(`Icon for ${v.plate}`, `<div class="d-flex flex-wrap gap-2">${S.cfg.icons.map((k) => `<button class="btn btn-outline-secondary ${v.icon === k ? 'active' : ''}" data-ic="${k}" style="width:84px"><i class="bi ${ICONS[k]} fs-4 d-block"></i><small>${k}</small></button>`).join('')}</div><div class="form-text mt-2">Colour always shows status: green moving, amber idle, red stopped, grey offline.</div>`,
      [{ text: 'Use default', cls: 'btn-outline-secondary', fn: () => setIcon(id, null) }, { text: 'Close', cls: 'btn-outline-secondary', fn: () => true }]);
    $('vm-modal-body').onclick = (e) => { const b = e.target.closest('[data-ic]'); if (b) { setIcon(id, b.dataset.ic); modal().hide(); } };
  }
  async function setIcon(id, icon) { const r = await call(() => API.put(`/map/vehicles/${id}/icon`, { icon })); if (!r) return false; const v = S.fleet.get(id); v.icon = icon; upsertMarker(v); updateRow(v); toast('Icon updated'); }

  // destination and ETA
  function destinationDialog(id) {
    const v = S.fleet.get(id), d = v.destination;
    dialog(`Destination for ${v.plate}`, `<div class="mb-2"><label class="form-label">Label</label><input id="df-label" class="form-control" maxlength="160" value="${esc(d?.label || '')}" placeholder="e.g. Kumasi depot"></div>
      <div class="row g-2 mb-2"><div class="col"><label class="form-label">Latitude</label><input id="df-lat" class="form-control" value="${d?.lat ?? ''}"></div><div class="col"><label class="form-label">Longitude</label><input id="df-lng" class="form-control" value="${d?.lng ?? ''}"></div></div>
      <button id="df-pick" class="btn btn-outline-primary btn-sm"><i class="bi bi-cursor"></i> Pick on the map</button> <button id="df-search" class="btn btn-outline-primary btn-sm"><i class="bi bi-search"></i> Use the search result</button>${H.destForm(d)}`,
      [...(d ? [{ text: 'Clear', cls: 'btn-outline-danger', fn: async () => { const r = await call(() => API.del(`/map/vehicles/${id}/destination`)); if (!r) return false; v.destination = null; destLayerRefresh(); upsertMarker(v); toast('Destination cleared'); } }] : []),
        { text: 'Save', fn: async () => { const lat = Number(val('df-lat')), lng = Number(val('df-lng')); const r = await call(() => API.put(`/map/vehicles/${id}/destination`, { lat, lng, label: val('df-label').trim() || null, ...H.destBody() })); if (!r) return false; v.destination = { lat, lng, label: val('df-label').trim() || null }; destLayerRefresh(); toast('Destination set'); const m = S.markers.get(id); m?.getPopup()?.setContent(popupHtml(v)); loadFleet(false); } }]);
    $('df-pick').onclick = () => { modal().hide(); startPick('Click the destination on the map', (ll) => { v.destination = null; dialogReopen(id, ll); }); };
    $('df-search').onclick = () => { if (!pin) { toast('Search an address first, then use it here.'); return; } const ll = pin.getLatLng(); $('df-lat').value = ll.lat.toFixed(6); $('df-lng').value = ll.lng.toFixed(6); };
  }
  function dialogReopen(id, ll) { const v = S.fleet.get(id); const old = v.destination; v.destination = { lat: ll.lat, lng: ll.lng, label: old?.label || '' }; destinationDialog(id); v.destination = old; $('df-lat').value = ll.lat.toFixed(6); $('df-lng').value = ll.lng.toFixed(6); }
  const destLayer = L.layerGroup().addTo(map);
  function destLayerRefresh() {
    destLayer.clearLayers();
    S.fleet.forEach((v) => { if (v.destination) L.marker([v.destination.lat, v.destination.lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [5, 26], html: '<div style="color:#dc2626;font-size:28px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><i class="bi bi-flag-fill"></i></div>' }) }).bindTooltip(`${esc(v.plate)} → ${esc(v.destination.label || 'destination')}`).addTo(destLayer); });
  }
  function startPick(msg, cb) { S.pick = cb; map.getContainer().style.cursor = 'crosshair'; toast(msg + ' (Esc to cancel)'); }
  function cancelPick() { S.pick = null; map.getContainer().style.cursor = ''; }
  map.on('click', (e) => { if (S.pick) { const cb = S.pick; cancelPick(); cb(e.latlng); } });

  // ---------------------------------------------------------------- geofence drawing and editing
  let drawing = false;
  map.pm.setGlobalOptions({ snappable: true, allowSelfIntersection: false, templineStyle: { color: '#2563eb' }, hintlineStyle: { color: '#2563eb', dashArray: [5, 5] }, pathOptions: { color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.2 } });
  $('vm-draw-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-draw]'); if (!b) return;
    if (!S.cfg.canEdit) { toast('Your role can view geofences but not change them.', 'err'); return; }
    if (drawing) map.pm.disableDraw(); drawing = true; map.pm.enableDraw(b.dataset.draw);
    $('vm-draw-help').textContent = b.dataset.draw === 'Polygon' ? 'Click each corner, then click the first point to finish.' : b.dataset.draw === 'Circle' ? 'Click the centre, move out, click again to set the radius.' : 'Click one corner, then the opposite corner.';
  });
  map.on('pm:create', (e) => {
    drawing = false; $('vm-draw-help').textContent = 'Pick a shape, then draw it on the map.';
    const layer = e.layer; let geom;
    if (e.shape === 'Circle') { const c = layer.getLatLng(); geom = { type: 'circle', centerLatitude: +c.lat.toFixed(7), centerLongitude: +c.lng.toFixed(7), radius: Math.round(layer.getRadius()) }; }
    else { const ring = layer.getLatLngs()[0].map((p) => [+p.lng.toFixed(7), +p.lat.toFixed(7)]); ring.push(ring[0]); geom = { type: e.shape === 'Rectangle' ? 'rectangle' : 'polygon', coordinates: { type: 'Polygon', coordinates: [ring] } }; }
    map.removeLayer(layer);
    const tmp = e.shape === 'Circle' ? L.circle([geom.centerLatitude, geom.centerLongitude], { radius: geom.radius, color: '#2563eb', dashArray: '4 4' }).addTo(map) : L.polygon(geom.coordinates.coordinates[0].map((p) => [p[1], p[0]]), { color: '#2563eb', dashArray: '4 4' }).addTo(map);
    zoneDialog(null, geom, () => map.removeLayer(tmp));
  });
  map.on('pm:drawstart', () => map.getContainer().classList.add('vm-drawing'));
  map.on('pm:drawend', () => { drawing = false; map.getContainer().classList.remove('vm-drawing'); });

  function zoneDialog(existing, geom, done, anchorId) {
    const g = existing || {}, a = g.alerts || { onEntry: true, onExit: true };
    const isCircle = (geom?.type || g.type) === 'circle';
    const vehOpts = [...S.fleet.values()].sort((x, y) => x.plate.localeCompare(y.plate)).map((v) => `<option value="${v.id}" ${(anchorId || g.anchorVehicleId) === v.id ? 'selected' : ''}>${esc(v.plate)}</option>`).join('');
    dialog(existing ? `Edit ${g.name}` : 'New geofence', `<div class="mb-2"><label class="form-label">Name</label><input id="zf-name" class="form-control" maxlength="120" value="${esc(g.name || '')}" placeholder="e.g. Accra depot"></div>
      <div class="row g-2 mb-2"><div class="col-4"><label class="form-label">Colour</label><input id="zf-color" type="color" class="form-control form-control-color w-100" value="${g.color || '#2563eb'}"></div>
        <div class="col-8"><label class="form-label">Speed limit inside (km/h)</label><input id="zf-speed" type="number" min="1" max="300" class="form-control" value="${g.speedLimit ?? ''}" placeholder="none"></div></div>
      <label class="vm-sw"><input id="zf-in" type="checkbox" ${a.onEntry !== false ? 'checked' : ''}><i></i><span>Alert when a vehicle enters</span></label>
      <label class="vm-sw"><input id="zf-out" type="checkbox" ${a.onExit !== false ? 'checked' : ''}><i></i><span>Alert when a vehicle leaves</span></label>
      <label class="vm-sw mb-2"><input id="zf-on" type="checkbox" ${g.isActive !== false ? 'checked' : ''}><i></i><span>Active</span></label>
      ${H.zoneForm(g)}
      ${isCircle ? `<div class="mb-2"><label class="form-label">Moves with a vehicle (optional)</label><select id="zf-anchor" class="form-select"><option value="">No, fixed place</option>${vehOpts}</select><div class="form-text">The circle then follows that vehicle, e.g. an escort zone.</div></div>` : ''}`,
      [{ text: 'Cancel', cls: 'btn-outline-secondary', fn: () => { done && done(); return true; } }, { text: 'Save', fn: async () => {
        const body = { name: val('zf-name').trim(), color: val('zf-color'), speedLimit: val('zf-speed') ? Number(val('zf-speed')) : null, isActive: $('zf-on').checked, alerts: { onEntry: $('zf-in').checked, onExit: $('zf-out').checked } };
        if (isCircle) body.anchorVehicleId = val('zf-anchor') || null;
        Object.assign(body, H.zoneBody());
        if (!existing) Object.assign(body, geom);
        const r = await call(() => (existing ? API.put(`/geofences/${g.id}`, body) : API.post('/geofences', body))); if (!r) return false;
        await H.zoneAfter(r.data?.id || g.id); done && done(); await loadZones(); toast(`Geofence "${esc(body.name)}" saved`); return true;
      } }]);
    $('vm-modal').addEventListener('hidden.bs.modal', function once() { $('vm-modal').removeEventListener('hidden.bs.modal', once); done && done(); }, { once: true });
  }
  function zoneAroundVehicle(id) {
    const v = S.fleet.get(id); if (!v?.position) return;
    map.closePopup();
    zoneDialog(null, { type: 'circle', centerLatitude: v.position.lat, centerLongitude: v.position.lng, radius: 300 }, null, id);
    // radius is fixed at 300 m for a quick zone; it can be changed afterwards with "Edit shape"
  }

  function renderZoneList() {
    const rows = [...S.zones.values()].sort((a, b) => a.g.name.localeCompare(b.g.name));
    $('vm-zone-list').innerHTML = rows.length ? rows.map((z) => {
      const inside = [...S.fleet.values()].filter((v) => v.inside?.has(z.g.id)).length;
      return `<div class="vm-row" data-zone="${z.g.id}"><span class="vm-ico" style="background:${z.color};opacity:${z.g.isActive === false ? 0.45 : 1}"><i class="bi ${z.kind === 'circle' ? 'bi-circle' : 'bi-pentagon'}"></i></span>
        <div class="grow"><div class="t">${esc(z.g.name)}</div><div class="s">${H.zoneTag(z.g)}${z.kind === 'circle' ? fmtKm(z.radius) + ' radius' : 'Polygon'}${z.g.anchorVehicleId ? ' · follows ' + esc(S.fleet.get(z.g.anchorVehicleId)?.plate || 'vehicle') : ''} · ${inside} inside${z.g.isActive === false ? ' · off' : ''}</div></div>
        ${S.cfg.canEdit ? `<div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" data-zact="edit" title="Details"><i class="bi bi-pencil-square"></i></button><button class="btn btn-outline-secondary" data-zact="shape" title="Edit shape"><i class="bi bi-vector-pen"></i></button><button class="btn btn-outline-danger" data-zact="del" title="Delete"><i class="bi bi-trash"></i></button></div>` : ''}</div>`;
    }).join('') : '<div class="text-muted small p-3">No geofences yet. Draw one with the buttons above.</div>';
  }
  $('vm-zone-list').addEventListener('click', async (e) => {
    const row = e.target.closest('[data-zone]'); if (!row) return; const z = S.zones.get(row.dataset.zone); const act = e.target.closest('[data-zact]')?.dataset.zact;
    if (!act) { if (z.layer) map.fitBounds(z.layer.getBounds(), { maxZoom: 17, padding: [30, 30] }); return; }
    if (act === 'edit') zoneDialog(z.g, null);
    if (act === 'del') { if (!confirm(`Delete geofence "${z.g.name}"? Its alert history is kept.`)) return; const r = await call(() => API.del(`/geofences/${z.g.id}`)); if (r) { toast('Geofence deleted'); loadZones(); } }
    if (act === 'shape') editShape(z);
  });
  function editShape(z) {
    if (S.edit) finishEdit(false);
    if (z.g.anchorVehicleId) { toast('This circle follows a vehicle. Change its radius with a new circle, or use Details.', 'err'); return; }
    if (!z.layer) return;
    z.layer.pm.enable({ allowSelfIntersection: false }); S.edit = z; map.fitBounds(z.layer.getBounds(), { maxZoom: 17, padding: [60, 60] });
    $('vm-draw-help').innerHTML = `Editing <b>${esc(z.g.name)}</b>: drag the handles. <button class="btn btn-sm btn-primary ms-1" id="ed-save">Save shape</button> <button class="btn btn-sm btn-outline-secondary" id="ed-cancel">Cancel</button>`;
    $('ed-save').onclick = () => finishEdit(true); $('ed-cancel').onclick = () => finishEdit(false);
  }
  async function finishEdit(save) {
    const z = S.edit; if (!z) return; S.edit = null; z.layer.pm.disable();
    $('vm-draw-help').textContent = 'Pick a shape, then draw it on the map.';
    if (save) {
      const body = z.kind === 'circle' ? { centerLatitude: +z.layer.getLatLng().lat.toFixed(7), centerLongitude: +z.layer.getLatLng().lng.toFixed(7), radius: Math.round(z.layer.getRadius()) }
        : { coordinates: { type: 'Polygon', coordinates: [(() => { const r = z.layer.getLatLngs()[0].map((p) => [+p.lng.toFixed(7), +p.lat.toFixed(7)]); r.push(r[0]); return r; })()] } };
      const r = await call(() => API.put(`/geofences/${z.g.id}`, body)); if (r) toast('Shape saved');
    }
    loadZones();
  }

  // ---------------------------------------------------------------- alerts feed and sound
  function beep(kind) {
    if (S.muted) return;
    try {
      S.audio = S.audio || new (window.AudioContext || window.webkitAudioContext)(); const c = S.audio, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = kind === 'ENTRY' ? 880 : 520; g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.45);
      o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.5);
    } catch { /* sound is optional */ }
  }
  const badge = () => { const b = $('vm-alert-badge'); b.textContent = S.unread; b.classList.toggle('d-none', !S.unread); };
  const muteIcon = () => { $('vm-mute').innerHTML = `<i class="bi ${S.muted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill'}"></i>`; };
  $('vm-mute').addEventListener('click', () => { S.muted = !S.muted; store.set('muted', S.muted); muteIcon(); if (!S.muted) beep('ENTRY'); });
  muteIcon();
  let firstEvents = true;
  async function pollEvents() {
    const r = await call(() => API.get('/map/events?limit=50')); if (!r) return;
    const evs = r.data; S.events = evs;
    const fresh = evs.filter((e) => !S.seen.has(e.id)); evs.forEach((e) => S.seen.add(e.id));
    if (!firstEvents) fresh.slice().reverse().forEach((e) => {
      const entry = /entry|enter/i.test(e.type); const word = entry ? 'entered' : 'left';
      toast(`<b>${esc(e.plate || 'A vehicle')}</b> ${word} <b>${esc(e.geofenceName)}</b>`, entry ? '' : 'exit'); beep(entry ? 'ENTRY' : 'EXIT');
      const m = S.markers.get(e.vehicleId); if (m?._icon) { const mk = m._icon.querySelector('.vm-mk'); mk?.classList.add('pulse'); setTimeout(() => mk?.classList.remove('pulse'), 2200); }
      S.unread++;
    });
    firstEvents = false; badge();
    $('vm-alert-list').innerHTML = evs.length ? evs.map((e) => { const entry = /entry|enter/i.test(e.type); return `<div class="vm-row" data-ev="${e.id}" data-lat="${e.latitude}" data-lng="${e.longitude}"><span class="vm-ico" style="background:${entry ? '#16a34a' : '#f59e0b'}"><i class="bi ${entry ? 'bi-box-arrow-in-right' : 'bi-box-arrow-right'}"></i></span><div class="grow"><div class="t">${esc(e.plate || 'Vehicle')} ${entry ? 'entered' : 'left'}</div><div class="s">${esc(e.geofenceName)}</div></div><div class="s text-end">${esc(fmtTime(e.time))}</div></div>`; }).join('') : '<div class="text-muted small p-3">No zone entries or exits in the last 24 hours.</div>';
  }
  $('vm-alert-list').addEventListener('click', (e) => { const r = e.target.closest('[data-ev]'); if (r && +r.dataset.lat) map.setView([+r.dataset.lat, +r.dataset.lng], 16); });

  // ---------------------------------------------------------------- replay, stops, heatmap
  const pad2 = (n) => String(n).padStart(2, '0');
  const toLocalInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  function setRange(h) { const to = new Date(), from = new Date(Date.now() - h * 3600e3); $('rp-from').value = toLocalInput(from); $('rp-to').value = toLocalInput(to); }
  setRange(8);
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => setRange(Number(b.dataset.range))));
  function fillReplayVehicles() {
    const sel = $('rp-vehicle'), cur = sel.value; const vs = [...S.fleet.values()].sort((a, b) => a.plate.localeCompare(b.plate));
    if (sel.options.length === vs.length) return;
    sel.innerHTML = vs.map((v) => `<option value="${v.id}">${esc(v.plate)}</option>`).join(''); if (cur) sel.value = cur;
  }
  function openReplayFor(id) { openTab('replay'); $('vm-panel').classList.remove('collapsed'); $('rp-vehicle').value = id; loadRoute(); }

  const R = { pts: [], idx: 0, t: 0, playing: false, raf: 0, marker: null, last: 0 };
  function speedColor(s) { return s > 60 ? '#dc2626' : s > 30 ? '#f59e0b' : s > 3 ? '#16a34a' : '#64748b'; }
  async function loadRoute() {
    const id = $('rp-vehicle').value; if (!id) { toast('Choose a vehicle first.'); return; }
    const from = new Date($('rp-from').value), to = new Date($('rp-to').value);
    if (isNaN(+from) || isNaN(+to) || to <= from) { toast('Choose a valid period (From must be before To).', 'err'); return; }
    stopReplay(); replayLayer.clearLayers(); clearHeat();
    $('rp-body').innerHTML = '<div class="text-muted small py-3">Loading…</div>';
    const r = await call(() => API.get(`/map/history?vehicleId=${id}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&maxPoints=3000&minStopMinutes=${val('rp-minstop')}${$('rp-snap')?.checked ? '&match=true' : ''}`));
    if (!r) { $('rp-body').innerHTML = ''; return; }
    const h = r.data, st = h.stats; R.pts = h.points.map((p) => ({ ...p, ms: +new Date(p.t) }));
    if (R.pts.length < 2) { $('rp-body').innerHTML = `<div class="text-muted small py-3">${esc(h.note || 'No movement was recorded for this vehicle in that period.')}</div>`; return; }
    for (let i = 1; i < R.pts.length; i++) L.polyline([[R.pts[i - 1].lat, R.pts[i - 1].lng], [R.pts[i].lat, R.pts[i].lng]], { color: speedColor(R.pts[i].speed), weight: 5, opacity: 0.9 }).addTo(replayLayer);
    const a = R.pts[0], b = R.pts[R.pts.length - 1];
    L.circleMarker([a.lat, a.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).bindTooltip('Start').addTo(replayLayer);
    L.circleMarker([b.lat, b.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).bindTooltip('End').addTo(replayLayer);
    h.stops.forEach((s, i) => {
      const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="vm-stop" style="background:${s.idle ? '#f59e0b' : '#dc2626'}">${i + 1}</div>` }) }).addTo(replayLayer);
      m.bindPopup(`<div class="vm-pop"><h6>Stop ${i + 1}: ${fmtDur(s.durationSeconds)}</h6><div>${s.idle ? 'Engine on (idling)' : 'Engine off (parked)'}</div><div>${esc(fmtTime(s.start))} to ${esc(fmtTime(s.end))}</div><div class="mt-1 stop-addr" data-lat="${s.lat}" data-lng="${s.lng}">Looking up address…</div></div>`);
      m.on('popupopen', () => stopAddress(s, m));
      s._m = m;
    });
    map.fitBounds(L.polyline(R.pts.map((p) => [p.lat, p.lng])).getBounds().pad(0.15));
    R.marker = L.marker([a.lat, a.lng], { zIndexOffset: 1000, icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: '<div class="vm-mk" style="--c:#2563eb"><div class="dir" id="rp-dir"></div><div class="body"><i class="bi bi-arrow-up-circle-fill"></i></div></div>' }) }).addTo(replayLayer);
    R.t = 0; setScrub(0);
    $('vm-replay').classList.remove('d-none');
    $('rp-body').innerHTML = `<div class="row g-2 my-2 small">
      <div class="col-6"><div class="text-muted">Distance</div><b>${st.distanceKm} km</b></div><div class="col-6"><div class="text-muted">Driving time</div><b>${fmtDur(st.movingSeconds)}</b></div>
      <div class="col-6"><div class="text-muted">Stopped</div><b>${fmtDur(st.stoppedSeconds)}</b></div><div class="col-6"><div class="text-muted">Idling</div><b>${fmtDur(st.idleSeconds)}</b></div>
      <div class="col-6"><div class="text-muted">Top speed</div><b>${Math.round(st.maxSpeedKmh)} km/h</b></div><div class="col-6"><div class="text-muted">Average (moving)</div><b>${Math.round(st.avgMovingSpeedKmh)} km/h</b></div></div>
      ${H.replayNote(h)}
      ${h.truncated ? '<div class="alert alert-warning py-1 small">This period has more than 60,000 points; only the first part is shown. Choose a shorter period.</div>' : ''}
      <div class="fw-semibold small mb-1 mt-2">Stops (${h.stops.length})</div>
      ${h.stops.length ? h.stops.map((s, i) => `<div class="vm-row px-0" data-stop="${i}"><span class="vm-ico" style="background:${s.idle ? '#f59e0b' : '#dc2626'};width:28px;height:28px;flex-basis:28px;font-size:.75rem">${i + 1}</span><div class="grow"><div class="t">${fmtDur(s.durationSeconds)} ${s.idle ? '<span class="badge bg-warning text-dark">idling</span>' : ''}</div><div class="s">${esc(fmtTime(s.start))}</div></div></div>`).join('') : '<div class="text-muted small">No stops longer than the chosen minimum.</div>'}`;
    $('rp-body').onclick = (e) => { const r2 = e.target.closest('[data-stop]'); if (!r2) return; const s = h.stops[+r2.dataset.stop]; map.setView([s.lat, s.lng], 17); s._m.openPopup(); };
  }
  async function stopAddress(s, m) {
    const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`; let a = S.addrCache.get(k);
    if (!a) { const r = await call(() => API.get(`/map/geocode/reverse?lat=${s.lat}&lng=${s.lng}`)); a = r?.data?.address || 'Address not available'; S.addrCache.set(k, a); }
    const el = m.getPopup().getElement()?.querySelector('.stop-addr'); if (el) el.textContent = a;
  }
  function setScrub(t) {
    R.t = t; const p = R.pts; if (!p.length) return;
    const t0 = p[0].ms, t1 = p[p.length - 1].ms, now = t0 + (t1 - t0) * t;
    let i = R.idx; if (p[i].ms > now) i = 0; while (i < p.length - 2 && p[i + 1].ms <= now) i++; R.idx = i;
    const a = p[i], b = p[i + 1], f = Math.max(0, Math.min(1, (now - a.ms) / Math.max(1, b.ms - a.ms)));
    const lat = a.lat + (b.lat - a.lat) * f, lng = a.lng + (b.lng - a.lng) * f;
    R.marker.setLatLng([lat, lng]);
    const dir = document.getElementById('rp-dir'); if (dir) dir.style.transform = `rotate(${distM([a.lat, a.lng], [b.lat, b.lng]) > 2 ? bearing(a, b) : a.heading}deg)`;
    $('rp-scrub').value = Math.round(t * 1000);
    $('rp-time').textContent = `${new Date(now).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${Math.round(a.speed)} km/h`;
    if (!map.getBounds().contains([lat, lng])) map.panTo([lat, lng], { animate: false });
  }
  function bearing(a, b) { const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  function tick(ts) {
    if (!R.playing) return; const dt = (ts - R.last) / 1000; R.last = ts;
    const span = (R.pts[R.pts.length - 1].ms - R.pts[0].ms) / 1000; R.t += (dt * Number(val('rp-speed'))) / span;
    if (R.t >= 1) { setScrub(1); stopReplay(); return; } setScrub(R.t); R.raf = requestAnimationFrame(tick);
  }
  function playReplay() { if (R.pts.length < 2) return; if (R.t >= 1) R.t = 0; R.playing = true; R.last = performance.now(); $('rp-play').innerHTML = '<i class="bi bi-pause-fill"></i>'; R.raf = requestAnimationFrame(tick); }
  function stopReplay() { R.playing = false; cancelAnimationFrame(R.raf); $('rp-play').innerHTML = '<i class="bi bi-play-fill"></i>'; }
  $('rp-play').addEventListener('click', () => (R.playing ? stopReplay() : playReplay()));
  $('rp-scrub').addEventListener('input', (e) => { stopReplay(); setScrub(Number(e.target.value) / 1000); });
  $('rp-close').addEventListener('click', () => { stopReplay(); replayLayer.clearLayers(); R.pts = []; $('vm-replay').classList.add('d-none'); });
  $('rp-load').addEventListener('click', loadRoute);
  $('rp-clear').addEventListener('click', () => { stopReplay(); replayLayer.clearLayers(); clearHeat(); R.pts = []; $('vm-replay').classList.add('d-none'); $('rp-body').innerHTML = ''; });
  function clearHeat() { if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; } }
  $('rp-heat').addEventListener('click', async () => {
    const from = new Date($('rp-from').value), to = new Date($('rp-to').value); if (isNaN(+from) || isNaN(+to) || to <= from) { toast('Choose a valid period first.', 'err'); return; }
    const r = await call(() => API.get(`/map/heatmap?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)); if (!r) return;
    clearHeat(); const d = r.data; if (!d.cells.length) { toast('No movement recorded in that period.'); return; }
    heatLayer = L.heatLayer(d.cells.map(([la, ln, n]) => [la, ln, n / d.max]), { radius: 22, blur: 18, minOpacity: 0.3, maxZoom: 17 }).addTo(map);
    map.fitBounds(L.latLngBounds(d.cells.map((c) => [c[0], c[1]])).pad(0.2), { maxZoom: 15 });
    $('rp-body').innerHTML = `<div class="small text-muted py-3">Heatmap of the whole fleet, ${esc(fmtTime(d.from))} to ${esc(fmtTime(d.to))}. Brighter areas are where vehicles spent the most reports (about ${d.cellMeters} m cells). Use the × button to remove it.</div>`;
  });

  // ---------------------------------------------------------------- shared with js/vtrack-map-adv.js
  window.VMap = { map, S, H, API, $, esc, toast, call, dialog, modal, val, store, fmtTime, fmtDur, fmtKm, ago, distM, select, loadFleet, loadZones, loadPois, redrawZones, upsertMarker, openTab, startPick, popupHtml, zoneDialog, get fleetLayer() { return fleetLayer; }, STATUS, ICONS };

  // ---------------------------------------------------------------- start
  (async function init() {
    const c = await API.get('/map/config').catch((e) => { toast(esc(e.message === 'Forbidden' || /403/.test(e.message) ? 'Your role cannot open the map.' : e.message), 'err'); return null; });
    if (!c) return;
    S.cfg = c.data; S.refresh = store.get('refresh', S.cfg.refreshSeconds || 30); $('vm-refresh').value = String(S.refresh);
    if (![...$('vm-refresh').options].some((o) => +o.value === S.refresh)) { const o = new Option(`${S.refresh} seconds`, S.refresh); $('vm-refresh').add(o); $('vm-refresh').value = String(S.refresh); }
    map.setView([S.cfg.center.lat, S.cfg.center.lng], 12);
    if (!S.cfg.canEdit) $('vm-draw-buttons').querySelectorAll('button').forEach((b) => (b.disabled = true));
    setupOverlays();
    await loadZones(); await loadFleet(true); destLayerRefresh();
    loadPois(); pollEvents(); connectSockets(); schedule();
    window.__vmap = { map, S };
    H.ready();
  })();
})();
