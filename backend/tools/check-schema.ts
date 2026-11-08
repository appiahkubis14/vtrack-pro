// Verifies that every TypeORM entity column exists in the real database schema.
// Usage: npx ts-node tools/check-schema.ts   (needs a migrated database)
import dataSource from '../src/config/typeorm.config';

(async () => {
  await dataSource.initialize();
  let bad = 0;
  for (const meta of dataSource.entityMetadatas) {
    if (meta.tableType === 'view' || meta.tableType === 'entity-child') continue;
    const rows: { column_name: string }[] = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [meta.tableName],
    );
    if (rows.length === 0) {
      // positions lives in the TimescaleDB database, not here.
      console.log(`SKIP  ${meta.name} (table "${meta.tableName}" not in main DB)`);
      continue;
    }
    const have = new Set(rows.map((r) => r.column_name));
    for (const col of meta.columns) {
      if (!have.has(col.databaseName)) {
        bad++;
        console.log(`MISSING  ${meta.name}.${col.propertyName} -> column "${col.databaseName}" not in table "${meta.tableName}"`);
      }
    }
  }
  console.log(bad === 0 ? 'OK: all entity columns exist in the database.' : `FAILED: ${bad} missing column(s).`);
  await dataSource.destroy();
  process.exit(bad === 0 ? 0 : 1);
})();
