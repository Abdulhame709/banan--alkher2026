import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'banan.sqlite');

export const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`);

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

/* Keep voucher sequences ahead of any pre-existing rows (seeds, imports, backups). */
db.exec(`
  UPDATE sequences
     SET value = MAX(value, COALESCE((SELECT MAX(receipt_no) FROM fund_receipts), 0))
   WHERE name = 'receipt';
  UPDATE sequences
     SET value = MAX(value, COALESCE((SELECT MAX(request_no) FROM fund_expense_requests), 0))
   WHERE name = 'expense_request';
  UPDATE sequences
     SET value = MAX(value, COALESCE((
       SELECT MAX(CAST(SUBSTR(payment_voucher_no, 4) AS INTEGER))
         FROM fund_expense_requests
        WHERE payment_voucher_no LIKE 'PV-%'
     ), 0))
   WHERE name = 'payment_voucher';
`);

/** Execute a function inside an immediate write transaction. */
export function withTx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw error;
  }
}

/** Atomically reserve the next value of a voucher sequence (call inside a TX). */
export function nextSequence(name) {
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(name);
  if (!row) throw new Error(`Unknown sequence: ${name}`);
  const next = Number(row.value) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, name);
  return next;
}

export function audit({ action, entityType, entityId = null, actor = null, details = '' }) {
  db.prepare(
    `INSERT INTO fund_audit_logs
      (id, action, entity_type, entity_id, actor_id, actor_name, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    action,
    entityType,
    entityId,
    actor?.id ?? null,
    actor?.full_name ?? null,
    details
  );
}

export function getSettings() {
  return db.prepare('SELECT * FROM fund_settings WHERE id = ?').get('fund');
}
