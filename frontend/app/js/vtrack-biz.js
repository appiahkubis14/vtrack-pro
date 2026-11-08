/**
 * Shared helpers for the business-layer pages (hubs, consignments, owners, contracts, riders, batteries,
 * settlements, reports). Everything that comes from the server is escaped before it is put into HTML.
 * Money is held in pesewas (1 GHS = 100 pesewas) everywhere except in the text boxes people type into.
 */
(function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  const ghs = (p) =>
    'GHS ' + (Number(p || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** "12.50" -> 1250. Rejects anything that is not a plain amount with at most two decimals. */
  function toPesewas(text) {
    const t = String(text ?? '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error(`"${text}" is not a valid amount (use digits with up to two decimals, e.g. 12.50)`);
    const [c, f = ''] = t.split('.');
    return Number(c) * 100 + Number(f.padEnd(2, '0'));
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const label = (s) => esc(String(s ?? '').replace(/_/g, ' '));

  const STATUS_COLOURS = {
    active: 'success', settled: 'success', completed: 'success', verified: 'success', available: 'success', received: 'success', closed: 'secondary',
    draft: 'secondary', pending: 'secondary', ordered: 'secondary', calculated: 'info', charging: 'info', fitted: 'info', shipped: 'info', at_port: 'info', cleared: 'info',
    assigned: 'info', sold: 'primary', in_stock: 'primary', pilot: 'warning', shortfall: 'danger', defaulted: 'danger', repossessed: 'danger',
    faulty: 'danger', missing: 'danger', rejected: 'danger', suspended: 'warning', ended: 'secondary', exited: 'secondary', cancelled: 'secondary', open: 'warning', billed: 'secondary',
  };
  const badge = (s) => `<span class="badge bg-${STATUS_COLOURS[s] || 'secondary'}-subtle text-${STATUS_COLOURS[s] || 'secondary'}">${label(s)}</span>`;

  /**
   * A table with search, filter lists (for columns like Status or Type), click-to-sort headers and paging. The rows stay in the
   * page (they are only hidden or moved), so buttons inside a row keep working. Pass { search: false } to turn the toolbar off,
   * and c.sortValue(row) / c.filter:false on a column to adjust it.
   */
  let tableSeq = 0;
  const PAGE = 25;
  const FILTER_COLS = /^(status|state|type|role|hub|category|priority|severity|kind|purpose|method|direction|region|mode|channel|source|stage)$/i;
  const plain = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  function table(cols, rows, empty = 'Nothing here yet.', opts = {}) {
    if (!rows || !rows.length) return `<div class="text-center text-muted py-5">${esc(empty)}</div>`;
    const cells = rows.map((r) => cols.map((c) => c.render(r)));
    const texts = cells.map((row) => row.map(plain));
    const id = 'vt' + ++tableSeq;
    const tools = opts.search !== false && rows.length >= 3;
    const filters = !tools ? [] : cols.map((c, i) => {
      if (c.filter === false || (!c.filter && !FILTER_COLS.test(c.label))) return null;
      const vals = [...new Set(texts.map((t) => t[i]).filter(Boolean))];
      return vals.length >= 2 && vals.length <= 15 ? { i, label: c.label, vals: vals.sort((a, b) => a.localeCompare(b)) } : null;
    }).filter(Boolean);
    const head = cols.map((c, i) => `<th class="${c.cls || ''}" ${tools && c.sort !== false && c.label ? `data-tsort="${i}" style="cursor:pointer;white-space:nowrap" title="Sort"` : ''}>${esc(c.label)}${tools && c.label ? ' <i class="bi bi-chevron-expand text-muted small"></i>' : ''}</th>`).join('');
    const body = cells.map((row, ri) => `<tr data-s="${esc(texts[ri].join(' ').toLowerCase())}" data-i="${ri}">${row.map((h, i) => `<td class="${cols[i].cls || ''}" ${cols[i].sortValue ? `data-v="${esc(cols[i].sortValue(rows[ri]))}"` : ''}>${h}</td>`).join('')}</tr>`).join('');
    const bar = tools ? `<div class="d-flex flex-wrap gap-2 align-items-center px-3 py-2 border-bottom vt-tbar">
        <div class="input-group input-group-sm" style="max-width:280px"><span class="input-group-text"><i class="bi bi-search"></i></span><input type="search" class="form-control" placeholder="Search this list" aria-label="Search this list" data-tsearch></div>
        ${filters.map((f) => `<select class="form-select form-select-sm" style="width:auto;max-width:200px" aria-label="Filter by ${esc(f.label)}" data-tfilter="${f.i}"><option value="">${esc(f.label)}: all</option>${f.vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`).join('')}
        <button class="btn btn-sm btn-outline-secondary d-none" data-treset><i class="bi bi-x-lg"></i> Clear</button>
        <span class="ms-auto text-muted fs-13" data-tcount></span></div>` : '';
    const pager = rows.length > PAGE ? `<div class="d-flex align-items-center justify-content-end gap-2 px-3 py-2 border-top"><button class="btn btn-sm btn-outline-secondary" data-tpage="-1"><i class="bi bi-chevron-left"></i></button><span class="fs-13" data-tpageinfo></span><button class="btn btn-sm btn-outline-secondary" data-tpage="1"><i class="bi bi-chevron-right"></i></button></div>` : '';
    return `<div class="vt-tbl" id="${id}" data-n="${rows.length}">${bar}<div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><div class="text-center text-muted py-4 d-none" data-tnone>No matching entries.</div>${pager}</div>`;
  }
  const numOf = (t) => { const m = String(t).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return /^(ghs\s*)?-?[\d,.]+\s*(%|km|kg|l|min|h|d)?$/i.test(String(t).trim()) && m ? Number(m[0]) : null; };
  function refreshTable(root, resetPage) {
    const q = root.querySelector('[data-tsearch]')?.value.trim().toLowerCase() || '';
    const fl = [...root.querySelectorAll('[data-tfilter]')].map((s) => [Number(s.dataset.tfilter), s.value]).filter((f) => f[1]);
    const tbody = root.querySelector('tbody'), all = [...tbody.rows];
    if (resetPage) root.dataset.page = '0';
    const hit = all.filter((tr) => { tr.dataset.m = ''; const ok = (!q || q.split(/\s+/).every((w) => tr.dataset.s.includes(w))) && fl.every(([i, v]) => plain(tr.cells[i]?.innerHTML) === v); if (ok) tr.dataset.m = '1'; return ok; });
    const pages = Math.max(1, Math.ceil(hit.length / PAGE)); let page = Math.min(Number(root.dataset.page || 0), pages - 1); root.dataset.page = page;
    all.forEach((tr) => { tr.hidden = true; });
    hit.slice(page * PAGE, page * PAGE + PAGE).forEach((tr) => { tr.hidden = false; });
    const c = root.querySelector('[data-tcount]'); if (c) c.textContent = hit.length === all.length ? `${all.length} entr${all.length === 1 ? 'y' : 'ies'}` : `${hit.length} of ${all.length}`;
    root.querySelector('[data-tnone]')?.classList.toggle('d-none', hit.length > 0);
    root.querySelector('[data-treset]')?.classList.toggle('d-none', !q && !fl.length);
    const info = root.querySelector('[data-tpageinfo]'); if (info) { info.textContent = `${hit.length ? page * PAGE + 1 : 0}-${Math.min(hit.length, page * PAGE + PAGE)} of ${hit.length}`; root.querySelectorAll('[data-tpage]').forEach((b) => { b.disabled = (Number(b.dataset.tpage) < 0 && page === 0) || (Number(b.dataset.tpage) > 0 && page >= pages - 1); }); }
  }
  document.addEventListener('input', (e) => { const r = e.target.closest?.('.vt-tbl'); if (r && e.target.matches('[data-tsearch]')) refreshTable(r, true); });
  document.addEventListener('change', (e) => { const r = e.target.closest?.('.vt-tbl'); if (r && e.target.matches('[data-tfilter]')) refreshTable(r, true); });
  document.addEventListener('click', (e) => {
    const r = e.target.closest?.('.vt-tbl'); if (!r) return;
    const th = e.target.closest('[data-tsort]'), pg = e.target.closest('[data-tpage]'), rs = e.target.closest('[data-treset]');
    if (th) {
      const i = Number(th.dataset.tsort), dir = th.dataset.dir === 'asc' ? 'desc' : 'asc'; r.querySelectorAll('[data-tsort]').forEach((x) => { delete x.dataset.dir; const ic = x.querySelector('i'); if (ic) ic.className = 'bi bi-chevron-expand text-muted small'; }); th.dataset.dir = dir; th.querySelector('i').className = `bi bi-chevron-${dir === 'asc' ? 'up' : 'down'} small`;
      const tb = r.querySelector('tbody'), rows = [...tb.rows], val = (tr) => { const c = tr.cells[i]; return (c.dataset.v ?? plain(c.innerHTML)); };
      rows.sort((a, b) => { const x = val(a), y = val(b), nx = numOf(x), ny = numOf(y); let d; if (nx !== null && ny !== null) d = nx - ny; else { const dx = Date.parse(x), dy = Date.parse(y); d = !isNaN(dx) && !isNaN(dy) && /\d{4}|\d{1,2}[/-]/.test(x) ? dx - dy : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }); } return (dir === 'asc' ? 1 : -1) * (d || Number(a.dataset.i) - Number(b.dataset.i)); });
      rows.forEach((tr) => tb.appendChild(tr)); refreshTable(r, true);
    }
    if (pg) { r.dataset.page = String(Number(r.dataset.page || 0) + Number(pg.dataset.tpage)); refreshTable(r); }
    if (rs) { const s = r.querySelector('[data-tsearch]'); if (s) s.value = ''; r.querySelectorAll('[data-tfilter]').forEach((x) => (x.value = '')); refreshTable(r, true); }
  });
  // tables are drawn as text; run the first paging pass as soon as they appear
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) (n.matches?.('.vt-tbl') ? [n] : [...(n.querySelectorAll?.('.vt-tbl') || [])]).forEach((t) => refreshTable(t, true)); }))).observe(document.documentElement, { childList: true, subtree: true });

  function toast(message, kind = 'success') {
    let host = document.getElementById('biz-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'biz-toasts';
      host.style.cssText = 'position:fixed;top:72px;right:16px;z-index:2000;max-width:420px';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `alert alert-${kind} shadow-sm py-2 px-3 mb-2`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), kind === 'danger' ? 8000 : 3500);
  }

  /** Runs an action and shows its failure instead of leaving a silent unhandled rejection. */
  async function run(fn, okMessage) {
    try {
      const r = await fn();
      if (okMessage) toast(okMessage);
      return r;
    } catch (e) {
      toast(e.message || String(e), 'danger');
      return undefined;
    }
  }

  /**
   * Opens a modal form.
   * fields: [{ name, label, type: text|number|money|date|select|textarea|checkbox, options:[{value,label}], required, value, hint, col }]
   * onSubmit receives the values; money fields arrive as integer pesewas. Throw to show an error in the form.
   * clearable: emptying a box that had a value sends null (so the saved value is cleared) instead of leaving it out.
   */
  function form({ title, fields, submitLabel = 'Save', onSubmit, intro, clearable }) {
    const id = 'bizModal' + Math.random().toString(36).slice(2, 8);
    const input = (f) => {
      const req = f.required ? 'required' : '';
      const v = f.value ?? (f.type === 'date' ? today() : '');
      if (f.type === 'select') {
        const opts = (f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
        return `<select class="form-select" name="${f.name}" ${req}><option value="">${f.required ? 'Choose...' : 'None'}</option>${opts}</select>`;
      }
      if (f.type === 'textarea') return `<textarea class="form-control" name="${f.name}" rows="2" ${req}>${esc(v)}</textarea>`;
      if (f.type === 'checkbox') return `<div class="form-check"><input class="form-check-input" type="checkbox" name="${f.name}" ${v ? 'checked' : ''}></div>`;
      if (f.type === 'money') return `<div class="input-group"><span class="input-group-text">GHS</span><input class="form-control" name="${f.name}" inputmode="decimal" placeholder="0.00" value="${esc(v)}" ${req}></div>`;
      return `<input class="form-control" type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${f.type === 'number' ? 'step="any"' : ''} ${req}>`;
    };
    const body = fields
      .map((f) => `<div class="col-${f.col || 12}"><label class="form-label">${esc(f.label)}${f.required ? ' *' : ''}</label>${input(f)}${f.hint ? `<div class="form-text">${esc(f.hint)}</div>` : ''}</div>`)
      .join('');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal fade" id="${id}" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><form novalidate>
        <div class="modal-header"><h5 class="modal-title">${esc(title)}</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body"><div class="alert alert-danger d-none" data-err></div>${intro ? `<p class="text-muted">${esc(intro)}</p>` : ''}<div class="row g-3">${body}</div></div>
        <div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button><button type="submit" class="btn btn-primary">${esc(submitLabel)}</button></div>
      </form></div></div></div>`;
    document.body.appendChild(wrap);
    const el = wrap.querySelector('.modal');
    const modal = new bootstrap.Modal(el);
    el.addEventListener('hidden.bs.modal', () => wrap.remove());
    el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errBox = el.querySelector('[data-err]');
      errBox.classList.add('d-none');
      const btn = el.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const values = {};
        for (const f of fields) {
          const node = ev.target.elements[f.name];
          let v = f.type === 'checkbox' ? node.checked : node.value.trim();
          if (f.type === 'money') v = v === '' ? undefined : toPesewas(v);
          else if (f.type === 'number') v = v === '' ? undefined : Number(v);
          else if (v === '') v = clearable && f.value !== undefined && f.value !== null && String(f.value) !== '' ? null : undefined; // an emptied box clears the saved value when the form is clearable
          if (f.required && (v === undefined || v === '')) throw new Error(`${f.label} is required`);
          values[f.name] = v;
        }
        await onSubmit(values);
        modal.hide();
      } catch (e) {
        errBox.textContent = e.message || String(e);
        errBox.classList.remove('d-none');
      } finally {
        btn.disabled = false;
      }
    });
    modal.show();
  }

  /** Confirmation that names what will happen. Returns a promise of true/false. */
  const confirmAction = (message) => Promise.resolve(window.confirm(message));

  const can = (...roles) => roles.includes((window.VTrackAPI.getUser() || {}).role);
  const ADMIN = ['super_admin', 'org_admin'];

  const opts = (rows, value, text) => (rows || []).map((r) => ({ value: value(r), label: text(r) }));

  /** One call: wait for the page, then guard, render nav. */
  function start(main) {
    window.VTrackAPI.requireAuth();
    window.VTrackNav.render();
    main();
  }

  function stat(labelText, value, sub) {
    return `<div class="col-6 col-lg-3"><div class="card h-100"><div class="card-body py-3"><div class="text-muted fs-13">${esc(labelText)}</div><div class="fs-4 fw-semibold">${value}</div>${sub ? `<div class="text-muted fs-13">${sub}</div>` : ''}</div></div></div>`;
  }

  window.Biz = { esc, ghs, toPesewas, today, label, badge, table, toast, run, form, confirmAction, can, ADMIN, opts, start, stat };
})();
