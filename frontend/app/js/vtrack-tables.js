/* Search + click-to-sort for pages that draw their own <table><tbody id="..."> (pages not using Biz.table).
   Add: <script src="js/vtrack-tables.js"></script>. Re-applies itself whenever the page redraws the rows. */
(function () {
  const norm = (s) => String(s || '').toLowerCase();
  const num = (t) => { const n = parseFloat(String(t).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && /\d/.test(t) ? n : null; };
  function enhance(table) {
    if (table.dataset.vtEnh || table.closest('.vt-tbl')) return;
    const tbody = table.tBodies[0]; if (!tbody || !tbody.id) return;
    table.dataset.vtEnh = '1';
    const wrap = table.closest('.table-responsive') || table;
    const bar = document.createElement('div'); bar.className = 'd-flex gap-2 align-items-center px-3 py-2 border-bottom'; bar.classList.add('d-none');
    bar.innerHTML = '<input type="search" class="form-control form-control-sm" style="max-width:280px" placeholder="Search this list" aria-label="Search this list"><span class="text-muted fs-13" data-count></span><button type="button" class="btn btn-sm btn-link d-none" data-clear>Clear</button>';
    wrap.parentNode.insertBefore(bar, wrap);
    const input = bar.querySelector('input'), count = bar.querySelector('[data-count]'), clear = bar.querySelector('[data-clear]');
    const none = document.createElement('tr'); none.dataset.vtNone = '1'; none.hidden = true;
    let sortCol = -1, dir = 1, busy = false, mo = null;
    const dataRows = () => [...tbody.rows].filter((r) => !r.dataset.vtNone && r.cells.length > 1 && !r.querySelector('td[colspan]'));
    function apply() {
      if (busy) return; busy = true;
      const rows = dataRows(); bar.classList.toggle('d-none', rows.length < 3 && !input.value);
      if (sortCol >= 0) rows.sort((a, b) => { const x = a.cells[sortCol]?.innerText.trim() || '', y = b.cells[sortCol]?.innerText.trim() || ''; const nx = num(x), ny = num(y); return (nx !== null && ny !== null ? nx - ny : x.localeCompare(y, undefined, { numeric: true })) * dir; }).forEach((r) => tbody.appendChild(r));
      const q = norm(input.value).split(/\s+/).filter(Boolean); let shown = 0;
      rows.forEach((r) => { const t = norm(r.innerText); const hit = q.every((w) => t.includes(w)); r.hidden = !hit; if (hit) shown++; });
      none.innerHTML = `<td colspan="${table.tHead ? table.tHead.rows[0].cells.length : 6}" class="text-center text-muted py-4">No matching entries</td>`;
      none.hidden = !(rows.length && !shown); tbody.appendChild(none);
      count.textContent = input.value ? `${shown} of ${rows.length}` : (rows.length ? `${rows.length} entries` : '');
      clear.classList.toggle('d-none', !input.value && sortCol < 0);
      busy = false; if (mo) mo.takeRecords();
    }
    input.addEventListener('input', apply);
    clear.addEventListener('click', () => { input.value = ''; sortCol = -1; table.querySelectorAll('th').forEach((h) => h.removeAttribute('aria-sort')); apply(); });
    if (table.tHead) [...table.tHead.rows[0].cells].forEach((th, i) => { if (!th.textContent.trim()) return; th.style.cursor = 'pointer'; th.title = 'Click to sort'; th.addEventListener('click', () => { dir = sortCol === i ? -dir : 1; sortCol = i; table.querySelectorAll('th').forEach((h) => h.removeAttribute('aria-sort')); th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending'); apply(); }); });
    mo = new MutationObserver(() => { if (!busy) apply(); }); mo.observe(tbody, { childList: true });
    apply();
  }
  const scan = () => document.querySelectorAll('table').forEach(enhance);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scan);
})();
