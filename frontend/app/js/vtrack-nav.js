/**
 * Renders the application shell into <div id="vtrack-header"></div> on every page: a sidebar with the menu
 * (collapsible to icons, slides over the page on phones) and a top bar with the page title, theme switch,
 * connection status and the profile menu. Styles are in css/vtrack-shell.css; the theme is in vtrack-theme.js.
 * The profile menu and sidebar use plain code (no Bootstrap dropdown), so they work even if a script is slow to load.
 */
(function () {
  // Who sees what. Hiding a link is only a convenience: the server enforces every permission.
  const ADMIN = ['super_admin', 'org_admin'];
  const OPS = [...ADMIN, 'fleet_manager', 'hub_manager'];
  const MONEY = [...ADMIN, 'finance'];
  const SEE_BUSINESS = [...OPS, 'finance', 'auditor', 'dispatcher'];
  const STAFF = [...SEE_BUSINESS, 'driver', 'viewer'];

  const NAV_LINKS = [
    { href: 'dashboard.html', label: 'Dashboard', icon: 'bi-speedometer2', roles: STAFF },
    { href: 'vehicles.html', label: 'Vehicles', icon: 'bi-truck', roles: STAFF },
    { href: 'devices.html', label: 'Devices', icon: 'bi-broadcast', roles: STAFF },
    { href: 'alerts.html', label: 'Alerts', icon: 'bi-bell', roles: STAFF },
    { href: 'live-map.html', label: 'Live Map', icon: 'bi-geo-alt', roles: [...SEE_BUSINESS, 'viewer'] },
    { href: 'investor.html', label: 'My Portfolio', icon: 'bi-graph-up-arrow', roles: ['investor'] },
    { href: 'rider-portal.html', label: 'My Account', icon: 'bi-person-badge', roles: ['rider'] },
  ];

  const NAV_GROUPS = [
    {
      label: 'Business',
      icon: 'bi-bank',
      roles: SEE_BUSINESS,
      items: [
        { href: 'hubs.html', label: 'Hubs', icon: 'bi-building' },
        { href: 'consignments.html', label: 'Consignments & Suppliers', icon: 'bi-box-seam', roles: [...ADMIN, 'fleet_manager', 'finance', 'auditor'] },
        { href: 'stock.html', label: 'Vehicle Stock', icon: 'bi-ev-front', roles: [...ADMIN, 'fleet_manager', 'finance', 'auditor'] },
        { href: 'owners.html', label: 'Owners', icon: 'bi-people', roles: [...ADMIN, 'fleet_manager', 'finance', 'auditor'] },
        { href: 'contracts.html', label: 'Contracts', icon: 'bi-file-earmark-check', roles: [...ADMIN, 'fleet_manager', 'finance', 'auditor'] },
        { href: 'riders.html', label: 'Riders & Assignments', icon: 'bi-person-vcard' },
        { href: 'batteries.html', label: 'Batteries & Charging', icon: 'bi-battery-charging' },
        { href: 'settlements.html', label: 'Daily Settlements', icon: 'bi-cash-coin' },
        { href: 'payments.html', label: 'Payments & Payouts', icon: 'bi-wallet2' },
        { href: 'enforcement.html', label: 'Lock Control', icon: 'bi-lock' },
        { href: 'reports.html', label: 'Business Reports', icon: 'bi-bar-chart-line' },
      ],
    },
    {
      label: 'Administration',
      icon: 'bi-shield-lock',
      roles: [...ADMIN, 'auditor'],
      items: [
        { href: 'team.html', label: 'Team & Logins', icon: 'bi-person-gear', roles: ADMIN },
        { href: 'audit.html', label: 'Audit Trail', icon: 'bi-journal-text' },
      ],
    },
    {
      label: 'Commercial',
      icon: 'bi-briefcase',
      roles: [...ADMIN, 'fleet_manager', 'dispatcher'],
      items: [
        { href: 'leads.html', label: 'Leads', icon: 'bi-person-lines-fill' },
        { href: 'quotes.html', label: 'Quotes', icon: 'bi-file-earmark-text' },
        { href: 'catalog.html', label: 'Product Catalog', icon: 'bi-box-seam' },
      ],
    },
    {
      label: 'Specialized',
      icon: 'bi-shield-shaded',
      roles: [...ADMIN, 'fleet_manager'],
      items: [
        { href: 'portable-assets.html', label: 'Portable Assets', icon: 'bi-geo' },
        { href: 'roaming.html', label: 'Roaming & Borders', icon: 'bi-globe-americas' },
        { href: 'audio.html', label: 'Audio Monitoring', icon: 'bi-mic' },
        { href: 'theft-recovery.html', label: 'Theft Recovery', icon: 'bi-shield-exclamation' },
      ],
    },
  ];

  const allowed = (entry, role) => !entry.roles || entry.roles.includes(role);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const page = () => window.location.pathname.split('/').pop() || 'dashboard.html';
  const MOBILE = () => window.matchMedia('(max-width: 991.98px)').matches;

  const linkHtml = (l, cur) => `<a class="vt-link ${l.href === cur ? 'active' : ''}" href="${l.href}" title="${esc(l.label)}"><i class="bi ${l.icon}"></i><span class="vt-label">${esc(l.label)}</span></a>`;

  function groupHtml(g, cur) {
    const active = g.items.some((i) => i.href === cur);
    return `<div class="vt-group ${active ? 'open has-active' : ''}">
      <button type="button" class="vt-group-btn" title="${esc(g.label)}" aria-expanded="${active}"><i class="bi ${g.icon}"></i><span class="vt-label">${esc(g.label)}</span><i class="bi bi-chevron-down vt-caret"></i></button>
      <div class="vt-sub">${g.items.map((i) => linkHtml(i, cur)).join('')}</div>
    </div>`;
  }

  function pageTitle() {
    const t = (document.title || '').split('|')[0].trim();
    return t || 'V-Track Pro';
  }

  function renderNav() {
    const host = document.getElementById('vtrack-header');
    if (!host) return;
    const user = window.VTrackAPI.getUser();
    const role = user?.role;
    const cur = page();
    const links = NAV_LINKS.filter((l) => allowed(l, role));
    const groups = NAV_GROUPS.filter((g) => allowed(g, role)).map((g) => ({ ...g, items: g.items.filter((i) => allowed(i, role)) })).filter((g) => g.items.length);
    const home = links[0]?.href ?? 'dashboard.html';
    const email = user?.email ?? '';
    const initials = email ? email.slice(0, 2).toUpperCase() : '??';
    const roleText = String(user?.role ?? '').replace(/_/g, ' ');
    const theme = window.VTrackTheme ? window.VTrackTheme.get() : 'light';

    document.body.classList.add('vt-shell');
    if (!MOBILE() && store.get('vtrack-sidebar') === 'mini') document.body.classList.add('vt-mini');

    host.innerHTML = `
      <aside class="vt-sidebar" id="vt-sidebar" aria-label="Main menu">
        <a class="vt-brand" href="${home}"><span class="vt-brand-mark"><i class="bi bi-signpost-split"></i></span><span class="vt-brand-name">V-Track Pro<small>Fleet &amp; business</small></span></a>
        <nav class="vt-scroll">
          ${links.length ? `<div class="vt-section">${links.length > 1 || role === 'investor' || role === 'rider' ? 'Overview' : ''}</div>${links.map((l) => linkHtml(l, cur)).join('')}` : ''}
          ${groups.length ? '<div class="vt-section">Menu</div>' : ''}
          ${groups.map((g) => groupHtml(g, cur)).join('')}
          ${ADMIN.includes(role) ? `<div class="vt-section">Account</div>${linkHtml({ href: 'settings.html', label: 'Settings', icon: 'bi-gear' }, cur)}` : ''}
        </nav>
        <div class="vt-side-foot"><span class="vt-foot-text">V-Track Pro</span><button type="button" class="vt-collapse-btn" id="vt-collapse" title="Collapse menu" aria-label="Collapse menu"><i class="bi bi-chevron-double-left"></i></button></div>
      </aside>
      <div class="vt-backdrop" id="vt-backdrop"></div>
      <header class="vt-topbar">
        <button type="button" class="vt-icon-btn vt-menu-btn" id="vt-menu-btn" aria-label="Open menu"><i class="bi bi-list fs-4"></i></button>
        <h1 class="vt-page-title">${esc(pageTitle())}</h1>
        <div class="vt-spacer"></div>
        <span class="vt-status badge bg-secondary-subtle text-secondary" id="vtrack-connection-badge"><i class="bi bi-circle-fill fs-11 me-1"></i>connecting...</span>
        <button type="button" class="vt-icon-btn" id="vt-theme-btn" title="Switch light / dark" aria-label="Switch light or dark theme"><i class="bi ${theme === 'dark' ? 'bi-sun' : 'bi-moon-stars'}"></i></button>
        <div class="vt-profile" id="vt-profile">
          <button type="button" class="vt-profile-btn" id="vt-profile-btn" aria-haspopup="true" aria-expanded="false">
            <span class="vt-avatar">${esc(initials)}</span>
            <span class="vt-who"><b>${esc(email)}</b><small>${esc(roleText)}</small></span>
            <i class="bi bi-chevron-down small text-secondary"></i>
          </button>
          <div class="vt-menu" id="vt-menu" role="menu">
            <div class="vt-menu-head"><b>${esc(email)}</b><small>${esc(roleText)}</small></div>
            <a href="change-password.html" role="menuitem"><i class="bi bi-key"></i>Change password</a>
            <div class="vt-theme-row" role="group" aria-label="Theme">
              <button type="button" data-theme="light"><i class="bi bi-sun"></i>Light</button>
              <button type="button" data-theme="dark"><i class="bi bi-moon-stars"></i>Dark</button>
              <button type="button" data-theme="system"><i class="bi bi-circle-half"></i>Auto</button>
            </div>
            <hr class="my-2">
            <button type="button" class="vt-mi vt-danger" id="vtrack-logout-btn" role="menuitem"><i class="bi bi-box-arrow-right"></i>Log out</button>
          </div>
        </div>
      </header>`;

    wire();
    checkApiHealth();
    if (!window.__vtrackHealthTimer) window.__vtrackHealthTimer = setInterval(() => { if (!document.hidden) checkApiHealth(); }, 30000);
  }

  function wire() {
    const $ = (id) => document.getElementById(id);
    const body = document.body;
    const profile = $('vt-profile');

    // ---- profile menu: plain click handling, closes on outside click / Esc / navigation ----
    const setProfile = (open) => { profile.classList.toggle('open', open); $('vt-profile-btn').setAttribute('aria-expanded', String(open)); };
    $('vt-profile-btn').addEventListener('click', (e) => { e.stopPropagation(); setProfile(!profile.classList.contains('open')); });
    document.addEventListener('click', (e) => { if (!profile.contains(e.target)) setProfile(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setProfile(false); body.classList.remove('vt-open'); } });
    $('vtrack-logout-btn').addEventListener('click', () => window.VTrackAPI.logout());

    // ---- theme ----
    const paintTheme = () => {
      const t = window.VTrackTheme ? window.VTrackTheme.get() : 'light';
      let saved = null; try { saved = localStorage.getItem('vtrack-theme'); } catch { /* ignore */ }
      const mode = saved === 'light' || saved === 'dark' ? saved : 'system';
      $('vt-theme-btn').innerHTML = `<i class="bi ${t === 'dark' ? 'bi-sun' : 'bi-moon-stars'}"></i>`;
      profile.querySelectorAll('.vt-theme-row button').forEach((b) => b.classList.toggle('on', b.dataset.theme === mode));
    };
    $('vt-theme-btn').addEventListener('click', () => { window.VTrackTheme && window.VTrackTheme.toggle(); paintTheme(); });
    profile.querySelectorAll('.vt-theme-row button').forEach((b) => b.addEventListener('click', () => {
      if (!window.VTrackTheme) return;
      if (b.dataset.theme === 'system') window.VTrackTheme.clear(); else window.VTrackTheme.set(b.dataset.theme);
      paintTheme();
    }));
    document.addEventListener('vtrack-theme', paintTheme);
    paintTheme();

    // ---- sidebar: groups, collapse to icons, slide-over on phones ----
    document.querySelectorAll('.vt-group-btn').forEach((btn) => btn.addEventListener('click', () => {
      if (body.classList.contains('vt-mini') && !MOBILE()) { body.classList.remove('vt-mini'); store.set('vtrack-sidebar', 'full'); }
      const g = btn.parentElement; const open = !g.classList.contains('open');
      g.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
    }));
    $('vt-collapse').addEventListener('click', () => { const mini = body.classList.toggle('vt-mini'); store.set('vtrack-sidebar', mini ? 'mini' : 'full'); });
    $('vt-menu-btn').addEventListener('click', () => body.classList.add('vt-open'));
    $('vt-backdrop').addEventListener('click', () => body.classList.remove('vt-open'));
    document.querySelectorAll('.vt-link').forEach((a) => a.addEventListener('click', () => body.classList.remove('vt-open')));
    const active = document.querySelector('.vt-link.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  async function checkApiHealth() {
    const badge = document.getElementById('vtrack-connection-badge');
    if (!badge) return;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetch(`${window.VTrackAPI.wsBaseUrl}/health`, { signal: ctl.signal });
      const body = await res.json();
      const ok = res.ok && body?.data?.status === 'ok';
      badge.className = `vt-status badge ${ok ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}`;
      badge.innerHTML = `<i class="bi bi-circle-fill fs-11 me-1"></i>${ok ? 'API online' : 'API issue'}`;
    } catch {
      badge.className = 'vt-status badge bg-danger-subtle text-danger';
      badge.innerHTML = '<i class="bi bi-circle-fill fs-11 me-1"></i>API unreachable';
    } finally { clearTimeout(timer); }
  }

  window.VTrackNav = { render: renderNav };
})();
