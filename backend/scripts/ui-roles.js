/**
 * Opens every screen in a real browser as each role (admin, finance, hub manager, investor, rider), checks that the
 * page renders without script errors, that nothing shows a permission error, and saves a screenshot of each.
 * Needs the demo data:  node scripts/seed-demo.js
 *   node scripts/ui-roles.js [outputDir]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const API = process.env.API || 'http://localhost:3000/api';
const WEB = process.env.WEB || 'http://localhost:8080/app/';
const OUT = process.argv[2] || '/tmp/ui-roles';
const PW = 'Demo!Passw0rd#2026';
fs.mkdirSync(OUT, { recursive: true });

const ROLES = {
  admin: { email: 'admin@demo.vtrack.pro', pages: ['hubs', 'consignments', 'stock', 'owners', 'contracts', 'riders', 'batteries', 'settlements', 'payments', 'enforcement', 'reports', 'team', 'audit'] },
  finance: { email: 'finance@demo.vtrack.pro', pages: ['payments', 'contracts', 'settlements', 'reports'], forbidden: ['team', 'audit'] },
  hubManager: { email: 'manager.kumasi@demo.vtrack.pro', pages: ['hubs', 'riders', 'batteries', 'settlements', 'payments', 'enforcement', 'reports'] },
  investor: { email: 'investor@demo.vtrack.pro', pages: ['investor'], forbidden: ['hubs', 'team', 'payments'] },
  rider: { email: 'rider@demo.vtrack.pro', pages: ['rider-portal'], forbidden: ['hubs', 'riders', 'investor'] },
};

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  for (const [role, cfg] of Object.entries(ROLES)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr|unpkg\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const _goto = page.goto.bind(page); page.goto = (u, o) => _goto(u, { waitUntil: 'domcontentloaded', ...(o || {}) });
    const errs = [];
    page.on('pageerror', (e) => errs.push('script error: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
    page.on('dialog', (d) => d.accept());

    // sign in through the real login form
    await page.goto(WEB + 'login.html');
    await page.fill('#email', cfg.email); await page.fill('#password', PW); await page.click('#login-btn');
    await page.waitForURL(/\.html/, { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(1200);
    const landing = page.url().split('/').pop().split('?')[0];
    const wantLanding = role === 'investor' ? 'investor.html' : role === 'rider' ? 'rider-portal.html' : 'dashboard.html';
    console.log(`\n[${role}] landed on ${landing} ${landing === wantLanding ? 'OK' : 'FAIL (expected ' + wantLanding + ')'}`);
    if (landing !== wantLanding) failures++;

    for (const p of cfg.pages) {
      errs.length = 0;
      await page.goto(`${WEB}${p}.html`); await page.waitForTimeout(1800);
      const toasts = await page.locator('#biz-toasts .alert-danger').allInnerTexts().catch(() => []);
      const bodyText = await page.locator('main').innerText().catch(() => '');
      const navText = await page.locator('#vtrack-header').innerText().catch(() => '');
      await page.screenshot({ path: `${OUT}/${role}-${p}.png`, fullPage: true });
      const empty = bodyText.trim().length < 40;
      const problems = [...errs, ...toasts.map((t) => 'toast: ' + t), ...(empty ? ['page is empty'] : [])];
      console.log(`  ${problems.length ? 'FAIL' : 'PASS'} ${p}${problems.length ? ' - ' + problems.join(' | ') : ''}`);
      if (problems.length) failures++;
      if (p === 'riders' || p === 'hubs') { /* nav check below */ }
      void navText;
    }
    // nav shows only what the role can use
    const nav = await page.locator('#vtrack-header').innerText();
    if (role === 'investor' && /Hubs|Team|Payments/.test(nav)) { console.log('  FAIL investor nav shows staff links'); failures++; }
    if (role === 'rider' && /Hubs|Team|Payments|Riders/.test(nav)) { console.log('  FAIL rider nav shows staff links'); failures++; }
    if (role === 'hubManager' && /Team|Audit|Consignments/.test(nav)) { console.log('  FAIL hub manager nav shows admin links'); failures++; }
    // pages the role must not be able to use: the data call is refused and the page says so instead of showing data
    for (const p of cfg.forbidden || []) {
      await page.goto(`${WEB}${p}.html`); await page.waitForTimeout(1500);
      const toasts = await page.locator('#biz-toasts .alert-danger').allInnerTexts().catch(() => []);
      const text = await page.locator('main').innerText().catch(() => '');
      const refused = toasts.length > 0 || /Forbidden|not allowed|permission|access/i.test(text);
      console.log(`  ${refused ? 'PASS' : 'FAIL'} ${p} refused for ${role}${refused ? '' : ' - page showed data'}`);
      if (!refused) failures++;
    }
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} problem(s)` : '\nAll screens render for every role.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
