/**
 * Runs pending database migrations from the compiled build (no ts-node needed, so it works inside the production image).
 *   node scripts/migrate.js            main database
 *   node scripts/migrate.js timescale  tracking database too
 */
const targets = [['main', '../dist/src/config/typeorm.config']];
if (process.argv.includes('timescale')) targets.push(['tracking', '../dist/src/config/timescale-typeorm.config']);
(async () => {
  for (const [name, path] of targets) {
    const ds = require(path).default;
    await ds.initialize();
    const ran = await ds.runMigrations();
    console.log(`${name} database: ${ran.length ? ran.map((m) => m.name).join(', ') : 'already up to date'}`);
    await ds.destroy();
  }
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
