/**
 * Restores a Banan fund JSON backup into Supabase Postgres.
 *
 * DANGER: this replaces the current financial data with the backup contents.
 * Always take a fresh backup before restoring, and test with --dry-run first.
 *
 * Uses the Supabase Management API (no database password needed). The token is
 * read from SUPABASE_KEYS.txt or SUPABASE_ACCESS_TOKEN.
 *
 * Usage:
 *   node scripts/restore-backup.mjs --file "C:\path\banan-backup-....json" --dry-run --yes
 *   node scripts/restore-backup.mjs --file "C:\path\banan-backup-....json" --yes
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const fileArg =
  args.find((arg) => arg.startsWith('--file='))?.slice('--file='.length) ??
  (args.includes('--file') ? args[args.indexOf('--file') + 1] : undefined);
const dryRun = args.includes('--dry-run');
const confirmed = args.includes('--yes');

if (!fileArg || !confirmed) {
  console.error('Usage: node scripts/restore-backup.mjs --file <backup.json> [--dry-run] --yes');
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(path.resolve(fileArg), 'utf8'));
if (backup.format !== 'banan-fund-backup' || !backup.data) {
  console.error('This is not a Banan fund backup file.');
  process.exit(1);
}

const readFileIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const keysRaw = readFileIfExists('SUPABASE_KEYS.txt');
const envRaw = readFileIfExists('.env');

const token = process.env.SUPABASE_ACCESS_TOKEN ?? keysRaw.match(/sbp_[a-f0-9]+/)?.[0];
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN or an sbp_ token in SUPABASE_KEYS.txt is required.');
  process.exit(1);
}

const projectUrl =
  keysRaw.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0] ??
  envRaw.match(/^SUPABASE_URL=(.*)$/m)?.[1]?.trim() ??
  envRaw.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim();
if (!projectUrl) {
  console.error('Supabase project URL not found in SUPABASE_KEYS.txt or .env.');
  process.exit(1);
}
const projectRef = new URL(projectUrl).hostname.split('.')[0];

async function runQuery(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status}: ${text.slice(0, 2000)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;
const quoteLiteral = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

function insertStatement(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  if (!columns.length) return null;
  const tuples = rows.map(
    (row) => `(${columns.map((column) => quoteLiteral(row[column])).join(', ')})`
  );
  return `insert into public.${quoteIdent(table)} (${columns
    .map(quoteIdent)
    .join(', ')}) values\n${tuples.join(',\n')};`;
}

const data = backup.data;
const counts = Object.fromEntries(
  Object.entries(data).map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : 0])
);
console.log('Backup:', backup.generated_at, JSON.stringify(counts));
console.log(dryRun ? 'Mode: DRY RUN (will roll back)' : 'Mode: REAL RESTORE (will commit)');

try {
  const authRows = await runQuery('select id from auth.users');
  const authIds = new Set((Array.isArray(authRows) ? authRows : []).map((row) => row.id));

  const profiles = (data.fund_user_profiles ?? []).filter((row) => authIds.has(row.user_id));
  const skippedProfiles = (data.fund_user_profiles ?? []).length - profiles.length;

  const receipts = (data.fund_receipts ?? []).map((row) => ({
    ...row,
    created_by: row.created_by && authIds.has(row.created_by) ? row.created_by : null,
  }));
  const expenses = (data.fund_expense_requests ?? []).map((row) => ({
    ...row,
    created_by: row.created_by && authIds.has(row.created_by) ? row.created_by : null,
    disbursed_by:
      row.disbursed_by && authIds.has(row.disbursed_by) ? row.disbursed_by : null,
  }));

  const statements = ['begin;'];
  statements.push(`
    truncate table
      public.fund_expense_approvals,
      public.fund_expense_requests,
      public.fund_receipts,
      public.fund_subscriptions,
      public.fund_members,
      public.fund_settings,
      public.fund_audit_logs,
      public.sequences,
      public.fund_user_profiles
    restart identity;
  `);

  for (const [table, rows] of [
    ['fund_settings', data.fund_settings],
    ['fund_members', data.fund_members],
    ['fund_user_profiles', profiles],
    ['fund_subscriptions', data.fund_subscriptions],
    ['fund_receipts', receipts],
    ['fund_expense_requests', expenses],
    ['fund_expense_approvals', data.fund_expense_approvals],
    ['sequences', data.sequences],
    ['fund_audit_logs', data.fund_audit_logs],
  ]) {
    const statement = insertStatement(table, rows);
    if (statement) statements.push(statement);
  }

  statements.push(dryRun ? 'rollback;' : 'commit;');
  const response = await runQuery(statements.join('\n'));

  console.log(dryRun ? 'Dry run complete — all changes rolled back.' : 'Restore committed successfully.');
  if (skippedProfiles) {
    console.log(`Skipped ${skippedProfiles} profile(s) whose Auth user no longer exists.`);
  }
  console.log('Server response:', JSON.stringify(response).slice(0, 500) || '(empty)');
} catch (error) {
  console.error('Restore failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
