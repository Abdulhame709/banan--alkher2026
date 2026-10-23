import { runMigrations, syncSequences, closePool } from './db.js';

try {
  await runMigrations();
  await syncSequences();
  console.log('[db] migrations up to date');
} catch (error) {
  console.error('[db] migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
