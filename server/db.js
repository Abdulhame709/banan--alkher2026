import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* --------------------------------------------------------------------------
 * pg type parsers: keep the API contract identical to the previous SQLite
 * implementation (dates/timestamps as ISO strings, decimals as numbers).
 * ------------------------------------------------------------------------ */
pg.types.setTypeParser(1082, (value) => value); // date
pg.types.setTypeParser(1114, (value) => new Date(`${value}Z`).toISOString()); // timestamp
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString()); // timestamptz
pg.types.setTypeParser(1700, (value) => Number(value)); // numeric
pg.types.setTypeParser(20, (value) => Number(value)); // int8 / bigint

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL غير مضبوط. انسخ .env.example إلى .env وضع رابط PostgreSQL.'
  );
}

const needsSsl =
  process.env.PGSSL === 'true' ||
  /sslmode=(require|verify-ca|verify-full)/i.test(connectionString);

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (error) => {
  console.error('[postgres] idle client error', error);
});

/* --------------------------------------------------------------------------
 * Transactions. AsyncLocalStorage lets every helper (audit, nextSequence,
 * queries) automatically use the transaction client without threading it
 * through every function call.
 * ------------------------------------------------------------------------ */
const txStorage = new AsyncLocalStorage();

export function currentDb() {
  return txStorage.getStore() ?? pool;
}

export function inTransaction() {
  return Boolean(txStorage.getStore());
}

/**
 * Run a function inside a transaction. Nested calls join the outer
 * transaction instead of opening a second one.
 */
export async function withTx(fn) {
  const active = txStorage.getStore();
  if (active) return fn(active);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStorage.run(client, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection may already be gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

export function query(text, params = []) {
  return currentDb().query(text, params);
}

export async function many(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

export async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] ?? null;
}

export async function execute(text, params = []) {
  const result = await query(text, params);
  // pg returns an array for multi-statement strings; callers that need rows
  // should use one()/many() with a single statement instead.
  if (Array.isArray(result)) {
    return { changes: 0, row: null };
  }
  return { changes: result.rowCount ?? 0, row: result.rows?.[0] ?? null };
}

/** Atomically reserve the next value of a voucher sequence. */
export async function nextSequence(name) {
  const row = await one(
    'update sequences set value = value + 1 where name = $1 returning value',
    [name]
  );
  if (!row) throw new Error(`Unknown sequence: ${name}`);
  return Number(row.value);
}

/**
 * Keep voucher sequences ahead of any pre-existing rows (seeds, imports,
 * restores). Safe to call on every boot.
 */
export async function syncSequences() {
  await execute(`
    update sequences
       set value = greatest(value, coalesce((select max(receipt_no) from fund_receipts), 0))
     where name = 'receipt'
  `);
  await execute(`
    update sequences
       set value = greatest(value, coalesce((select max(request_no) from fund_expense_requests), 0))
     where name = 'expense_request'
  `);
  await execute(`
    update sequences
       set value = greatest(value, coalesce((
         select max((substring(payment_voucher_no from 4))::integer)
           from fund_expense_requests
          where payment_voucher_no like 'PV-%'
       ), 0))
     where name = 'payment_voucher'
  `);
}

/** Append an immutable audit row. Uses the active transaction when present. */
export async function audit({
  action,
  entityType,
  entityId = null,
  actor = null,
  details = '',
}) {
  await execute(
    `insert into fund_audit_logs
       (action, entity_type, entity_id, actor_id, actor_name, details)
     values ($1, $2, $3, $4, $5, $6)`,
    [action, entityType, entityId, actor?.id ?? null, actor?.full_name ?? null, details]
  );
}

export async function getSettings() {
  return one('select * from fund_settings where id = $1', ['fund']);
}

/* --------------------------------------------------------------------------
 * Migrations: numbered SQL files applied once, in order.
 * ------------------------------------------------------------------------ */
const MIGRATION_LOCK_KEY = 918_273_645;

export async function runMigrations() {
  if (process.env.RUN_MIGRATIONS === 'false') return;

  const lockClient = await pool.connect();
  try {
    await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await lockClient.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await lockClient.query(
        'select 1 from schema_migrations where version = $1',
        [file]
      );
      if (applied.rowCount) continue;

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await lockClient.query('begin');
      try {
        await lockClient.query(sql);
        await lockClient.query('insert into schema_migrations (version) values ($1)', [file]);
        await lockClient.query('commit');
        console.log(`[db] applied migration ${file}`);
      } catch (error) {
        await lockClient.query('rollback').catch(() => {});
        throw new Error(`فشل تطبيق الترحيل ${file}: ${error.message}`);
      }
    }
  } finally {
    try {
      await lockClient.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } catch {
      /* ignore */
    }
    lockClient.release();
  }
}

export async function closePool() {
  await pool.end();
}
