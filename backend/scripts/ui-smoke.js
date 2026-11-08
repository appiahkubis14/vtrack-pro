/**
 * Browser smoke test for the business pages: drives hubs -> consignments -> owners -> contracts -> riders ->
 * batteries -> settlements -> reports in a real browser against a running API and a static server for frontend/.
 *
 *   1. scripts/setup-test-db.sh                                   (clean vtrack_test database)
 *   2. DB_DATABASE=vtrack_test node dist/src/main.js              (API on :3000)
 *   3. (cd ../frontend && python3 -m http.server 8080)            (pages on :8080)
 *   4. register the QA user once:
 *        curl -X POST localhost:3000/api/auth/register -H 'content-type: application/json' \
 *          -d '{"email":"qa-admin@example.com","password":"Str0ng!Passw0rd#1","firstName":"QA","lastName":"Admin","organizationName":"QA Org"}'
 *   5. npx playwright install chromium && node scripts/ui-smoke.js
 *
 * Run it on a fresh database: it creates records and expects the first hub in the list to be its own.
 */
const { chromium } = require('playwright');
const API = 'http://localhost:3000/api';
const WEB = 'http://localhost:8080/app/';
const errors = [];
const log = (...a) => console.log(...a);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const _goto = page.goto.bind(page); page.goto = (u, o) => _goto(u, { waitUntil: 'domcontentloaded', ...(o || {}) });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push(`pageerror @${page.url().split('/').pop()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|ERR_TUNNEL|net::ERR_BLOCKED|status of 409/.test(m.text())) errors.push(`console @${page.url().split('/').pop()}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());

  // log in through the real API and store the session the way login.html does
  const login = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'qa-admin@example.com', password: 'Str0ng!Passw0rd#1' }) })).json();
  log('login ok:', !!login.data?.accessToken, JSON.stringify(login).slice(0,120));
  await page.goto(WEB + 'login.html');
  await page.evaluate((s) => { localStorage.setItem('vtrack_token', s.accessToken); localStorage.setItem('vtrack_refresh_token', s.refreshToken || ''); localStorage.setItem('vtrack_user', JSON.stringify(s.user)); }, login.data);

  const toastText = async () => (await page.locator('#biz-toasts .alert').allInnerTexts()).join(' | ');
  const fill = async (name, v) => { const el = page.locator(`.modal.show [name="${name}"]`); await el.waitFor(); const tag = await el.evaluate((n) => n.tagName); if (tag === 'SELECT') await el.selectOption(v); else await el.fill(String(v)); };
  const submit = async () => { await page.locator('.modal.show button[type=submit]').click(); await page.waitForTimeout(700); };
  const modalError = async () => { const e = page.locator('.modal.show [data-err]:not(.d-none)'); return (await e.count()) ? await e.innerText() : null; };
  const step = async (name, fn) => { try { await fn(); log('PASS', name); } catch (e) { log('FAIL', name, '-', e.message.split('\n')[0], '| url:', page.url());  errors.push(`step ${name}: ${e.message.split('\n')[0]}`); } };
  const clickBtn = async (text, scope = 'body') => { await page.locator(`${scope} button:has-text("${text}"), ${scope} a:has-text("${text}")`).first().click(); await page.waitForTimeout(600); };

  const TAG = String(Date.now()).slice(-6);

  await step('hubs: add hub', async () => {
    await page.goto(WEB + 'hubs.html'); await page.waitForTimeout(800);
    await clickBtn('Add hub');
    await fill('name', 'Madina Pilot Hub'); await fill('region', 'Greater Accra'); await fill('town', 'Madina'); await submit();
    if (await modalError()) throw new Error(await modalError());
    if (!(await page.locator('#hubs-list').innerText()).includes('Madina Pilot Hub')) throw new Error('hub not in list');
  });
  await step('hubs: add charge point', async () => {
    await clickBtn('Charge points', '#hubs-list');
    await clickBtn('Add charge point');
    await fill('name', 'Bay 1'); await submit();
    if (await modalError()) throw new Error(await modalError());
    if (!(await page.locator('#cp-list').innerText()).includes('Bay 1')) throw new Error('charge point missing');
  });

  await step('consignments: model + consignment + advance + receive', async () => {
    await page.goto(WEB + 'consignments.html'); await page.waitForTimeout(800);
    await clickBtn('Add vehicle model');
    await fill('brand', 'Huodi'); await fill('name', 'HD72 Cargo'); await fill('vehicleType', 'ebike'); await fill('listPricePesewas', '15000'); await submit();
    if (await modalError()) throw new Error(await modalError());
    await clickBtn('New consignment');
    await fill('reference', 'CN-' + TAG); await fill('vehicleModelId', await page.locator('.modal.show select[name=vehicleModelId] option:nth-child(2)').getAttribute('value')); await fill('quantity', 3); await fill('unitCostPesewas', '10000'); await fill('landedCostPesewas', '3000'); await submit();
    if (await modalError()) throw new Error(await modalError());
    for (const label of ['Mark shipped', 'Arrived at port', 'Cleared customs']) { await clickBtn(label, '#cons-list'); }
    await clickBtn('Receive units', '#cons-list');
    await page.waitForTimeout(500);
    const row = await page.locator('#cons-list tbody tr').first().innerText();
    if (!/3 \/ 3/.test(row) || !/received/i.test(row)) throw new Error('row was: ' + row.replace(/\s+/g, ' '));
    await clickBtn('Close', '#cons-list'); await page.waitForTimeout(400);
    if (!/closed/i.test(await page.locator('#cons-list tbody tr').first().innerText())) throw new Error('did not close');
    await page.locator('#cons-list a[data-act=view]').first().click(); await page.waitForTimeout(800);
    if (!(await page.locator('#detail-body').innerText()).includes('Profitability')) throw new Error('no profitability');
  });

  await step('owners: add owner (masked output)', async () => {
    await page.goto(WEB + 'owners.html'); await page.waitForTimeout(800);
    await clickBtn('Add owner');
    await fill('name', 'Ama Mensah'); await fill('phone', '0244' + TAG); await fill('momoNumber', '0244' + TAG); await fill('idDocument', 'GHA-' + TAG + '-7'); await submit();
    if (await modalError()) throw new Error(await modalError());
    const t = await page.locator('#owners-list').innerText();
    if (!t.includes('Ama Mensah') || t.includes('0244' + TAG + '\n') && t.split('0244' + TAG).length > 2) throw new Error('unexpected: ' + t.replace(/\s+/g, ' '));
    if (t.includes('GHA-' + TAG)) throw new Error('ID number leaked into page');
  });

  await step('contracts: create + activate + pay', async () => {
    await page.goto(WEB + 'contracts.html'); await page.waitForTimeout(800);
    await clickBtn('New contract');
    await fill('ownerId', await page.locator('.modal.show select[name=ownerId] option:nth-child(2)').getAttribute('value'));
    await fill('vehicleId', await page.locator('.modal.show select[name=vehicleId] option:nth-child(2)').getAttribute('value'));
    await fill('mode', 'lease'); await fill('pricePesewas', '15000'); await fill('depositPesewas', '3000'); await fill('termWeeks', 12); await submit();
    if (await modalError()) throw new Error(await modalError());
    await page.locator('#contracts-list a[data-act=view]').first().click(); await page.waitForTimeout(800);
    await clickBtn('Approve & activate', '#detail-body'); await page.waitForTimeout(900);
    let d = await page.locator('#detail-body').innerText();
    if (!/active/i.test(d) || !d.includes('GHS 12,000.00')) throw new Error('not active: ' + d.replace(/\s+/g, ' ').slice(0, 200));
    await clickBtn('Record payment', '#detail-body');
    await fill('amountPesewas', '1500'); await fill('reference', 'MOMO-' + TAG); await submit();
    if (await modalError()) throw new Error(await modalError());
    await page.waitForTimeout(800);
    d = await page.locator('#detail-body').innerText();
    if (!d.includes('GHS 1,500.00')) throw new Error('payment not shown: ' + d.replace(/\s+/g, ' ').slice(0, 250));
    await clickBtn('Record payment', '#detail-body');
    await fill('amountPesewas', '999999'); await fill('reference', 'BIG-' + TAG); await submit();
    if (!/exceeds/i.test((await modalError()) || '')) throw new Error('overpayment not refused');
    await page.keyboard.press('Escape');
  });

  await step('riders: add rider + assign', async () => {
    await page.goto(WEB + 'riders.html'); await page.waitForTimeout(800);
    await clickBtn('Add rider');
    await fill('fullName', 'Kofi Boateng'); await fill('phone', '0551' + TAG); await fill('hubId', await page.locator('.modal.show select[name=hubId] option:nth-child(2)').getAttribute('value')); await submit();
    if (await modalError()) throw new Error(await modalError());
    await clickBtn('Assign vehicle');
    await fill('riderId', await page.locator('.modal.show select[name=riderId] option:nth-child(2)').getAttribute('value'));
    await fill('vehicleId', await page.locator('.modal.show select[name=vehicleId] option:nth-child(2)').getAttribute('value'));
    await fill('dailyTargetPesewas', '80'); await fill('dailyRemittancePesewas', '30'); await fill('serviceFeePesewas', '5'); await submit();
    if (await modalError()) throw new Error(await modalError());
    if (!(await page.locator('#assign-list').innerText()).includes('Kofi Boateng')) throw new Error('assignment not listed');
  });

  await step('batteries: add, fit, charge, finish', async () => {
    await page.goto(WEB + 'batteries.html'); await page.waitForTimeout(800);
    await clickBtn('Add battery'); await fill('serialNo', 'BAT-' + TAG); await fill('hubId', await page.locator('.modal.show select[name=hubId] option:nth-child(2)').getAttribute('value')); await submit();
    if (await modalError()) throw new Error(await modalError());
    await clickBtn('Start charge', '#battery-list');
    await fill('riderId', await page.locator('.modal.show select[name=riderId] option:nth-child(2)').getAttribute('value'));
    await submit();
    if (await modalError()) throw new Error(await modalError());
    await page.waitForTimeout(500);
    await clickBtn('Finish', '#charge-list');
    await fill('kwh', 7.5); await fill('feePesewas', '10'); await submit();
    if (await modalError()) throw new Error(await modalError());
    await page.waitForTimeout(500);
    if (!/completed/i.test(await page.locator('#charge-list').innerText())) throw new Error('charge not completed');
  });

  await step('settlements: record takings, calculate, close', async () => {
    await page.goto(WEB + 'settlements.html'); await page.waitForTimeout(800);
    await page.locator('#hub-select').selectOption({ index: 1 }); await page.waitForTimeout(800);
    await clickBtn('Record takings');
    await fill('riderId', await page.locator('.modal.show select[name=riderId] option:nth-child(2)').getAttribute('value')); await fill('amountPesewas', '80'); await fill('reference', 'R-' + TAG); await submit();
    if (await modalError()) throw new Error(await modalError());
    await clickBtn('Calculate day'); await page.waitForTimeout(900);
    const t = await page.locator('#settle-list').innerText();
    if (!t.includes('Kofi Boateng') || !/settled/i.test(t)) throw new Error('settlement: ' + t.replace(/\s+/g, ' '));
    if (!t.includes('GHS 35.00')) throw new Error('chop should be 80 - 30 - 5 - 10 = 35: ' + t.replace(/\s+/g, ' '));
    await clickBtn('Close day', '#settle-list'); await page.waitForTimeout(700);
    if (!/closed/i.test(await page.locator('#settle-list').innerText())) throw new Error('not closed');
  });

  await step('reports: hub close / period / rider / owner / arrears', async () => {
    await page.goto(WEB + 'reports.html'); await page.waitForTimeout(900);
    await page.locator('#hub').selectOption({ index: 0 }); await clickBtn('Show');
    let o = await page.locator('#output').innerText(); if (!o.includes('Kofi Boateng') || !o.includes('GHS 80.00')) throw new Error('hub close: ' + o.replace(/\s+/g, ' ').slice(0, 200));
    await page.locator('[data-tab=period]').click(); await clickBtn('Show'); o = await page.locator('#output').innerText(); if (!o.includes('GHS 80.00')) throw new Error('period: ' + o.replace(/\s+/g, ' ').slice(0, 200));
    await page.locator('[data-tab=rider]').click(); await page.locator('#rider').selectOption({ index: 0 }); await clickBtn('Show'); o = await page.locator('#output').innerText(); if (!o.includes('GHS 35.00')) throw new Error('rider: ' + o.replace(/\s+/g, ' ').slice(0, 200));
    await page.locator('[data-tab=owner]').click(); await page.locator('#owner').selectOption({ index: 0 }); await clickBtn('Show'); o = await page.locator('#output').innerText(); if (!o.includes('Contracts')) throw new Error('owner: ' + o.replace(/\s+/g, ' ').slice(0, 200));
    await page.locator('[data-tab=arrears]').click(); await page.waitForTimeout(800); o = await page.locator('#output').innerText(); if (!/behind|Contract/.test(o)) throw new Error('arrears: ' + o);
  });

  await step('nav: Business menu present on every page', async () => {
    await page.goto(WEB + 'hubs.html'); await page.waitForTimeout(500);
    const t = await page.locator('#vtrack-header').innerText(); if (!t.includes('Business')) throw new Error('no Business menu');
  });

  await page.screenshot({ path: 'last.png' });
  await browser.close();
  log('\nJS/console errors:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  process.exit(errors.length ? 1 : 0);
})();
