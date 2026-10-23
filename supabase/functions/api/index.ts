// @ts-nocheck
/**
 * Banan Charity Fund — Supabase Edge Function API
 *
 * Preserves the REST contract used by the React app while replacing the
 * Express/cookie backend with Supabase Auth (Bearer JWT) and Postgres.
 *
 * Deploy:
 *   supabase functions deploy api --no-verify-jwt
 */
import { Hono } from 'npm:hono@4.6.14';
import { cors } from 'npm:hono/cors';
import postgres from 'npm:postgres@3.4.5';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ??
  JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default;
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const DB_URL = Deno.env.get('SUPABASE_DB_URL')!;
const BUCKET = Deno.env.get('SUPABASE_STORAGE_BUCKET') ?? 'fund-files';
const BACKUP_BUCKET = Deno.env.get('SUPABASE_BACKUP_BUCKET') ?? 'fund-backups';
const BACKUP_RETENTION = 30;
const BACKUP_TABLES = [
  'fund_settings',
  'fund_user_profiles',
  'fund_members',
  'fund_subscriptions',
  'fund_receipts',
  'fund_expense_requests',
  'fund_expense_approvals',
  'fund_audit_logs',
  'sequences',
];

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !DB_URL) {
  throw new Error('Supabase environment is incomplete');
}

// Supabase injects the direct database URL. Edge Functions run in short-lived
// isolates, so a direct connection pays a TCP/TLS handshake for almost every
// request. Route through Supavisor's transaction pooler instead.
const databaseUrl = new URL(DB_URL);
if (databaseUrl.hostname.startsWith('db.') && databaseUrl.hostname.endsWith('.supabase.co')) {
  const projectRef = databaseUrl.hostname.split('.')[1];
  databaseUrl.hostname = 'aws-0-ap-southeast-2.pooler.supabase.com';
  databaseUrl.port = '6543';
  databaseUrl.username = `postgres.${projectRef}`;
  databaseUrl.searchParams.set('sslmode', 'require');
}

const sql = postgres(databaseUrl.toString(), {
  prepare: false,
  ssl: 'require',
  max: 2,
  idle_timeout: 20,
  connect_timeout: 10,
  types: {
    numeric: { to: 1700, from: [1700], parse: (value: string) => Number(value) },
    int8: { to: 20, from: [20], parse: (value: string) => Number(value) },
    date: { to: 1082, from: [1082], parse: (value: string) => value },
    timestamptz: { to: 1184, from: [1184], parse: (value: string) => value },
    timestamp: { to: 1114, from: [1114], parse: (value: string) => value },
  },
});

/* -------------------------------------------------------------------------- */
/* Errors and validation                                                       */
/* -------------------------------------------------------------------------- */

class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ROLES = ['admin', 'accountant', 'treasurer', 'board_member', 'member'];
const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام',
  accountant: 'محاسب',
  treasurer: 'أمين الصندوق',
  board_member: 'عضو مجلس الإدارة',
  member: 'عضو',
};
const RECEIPT_TYPE_LABELS: Record<string, string> = {
  subscription: 'اشتراك شهري',
  donation: 'تبرع',
  other: 'إيراد آخر',
};
const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  social_aid: 'مساعدات اجتماعية',
  charitable_aid: 'مساعدات خيرية',
  medical_aid: 'مساعدات طبية',
  emergency_aid: 'مساعدات طارئة',
  operational: 'مصروفات تشغيلية',
};

function capabilities(role: string) {
  const admin = role === 'admin';
  const accountant = role === 'accountant';
  const treasurer = role === 'treasurer';
  const board = role === 'board_member';
  const internal = admin || accountant || treasurer || board;
  return {
    manageMembers: admin || accountant,
    manageReceipts: admin || accountant || treasurer,
    createExpenses: admin || accountant || treasurer || board,
    approveExpenses: admin || treasurer || board,
    payExpenses: admin || treasurer,
    viewReports: internal,
    viewAudit: admin || board,
    admin,
  };
}

function str(value: unknown, { name = 'الحقل', required = false, max = 500, min = 0 } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new HttpError(400, `${name} مطلوب`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new HttpError(400, `${name} مطلوب`);
    return null;
  }
  if (text.length < min) throw new HttpError(400, `${name} يجب أن يكون ${min} أحرف على الأقل`);
  if (text.length > max) throw new HttpError(400, `${name} أطول من الحد المسموح (${max} حرف)`);
  return text;
}

function amount(value: unknown, { name = 'المبلغ', min = 0.01, max = 1_000_000_000_000, required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `${name} مطلوب`);
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new HttpError(400, `${name} غير صالح`);
  if (number < min) throw new HttpError(400, `${name} يجب أن يكون أكبر من أو يساوي ${min}`);
  if (number > max) throw new HttpError(400, `${name} أكبر من الحد المسموح`);
  return round2(number);
}

function oneOf(value: unknown, allowed: string[], { name = 'القيمة' } = {}) {
  if (!allowed.includes(String(value))) throw new HttpError(400, `${name} غير صالح`);
  return String(value);
}

function bool(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  return false;
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Aden' });
}

function isoDate(value: unknown, { name = 'التاريخ', required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (!required) return null;
    return todayISO();
  }
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new HttpError(400, `${name} غير صالح (الصيغة المطلوبة YYYY-MM-DD)`);
  }
  return text;
}

function normalizeMonth(value: unknown, { required = true } = {}) {
  if (!value) {
    if (!required) return null;
    return `${todayISO().slice(0, 7)}-01`;
  }
  const text = String(value).slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new HttpError(400, 'الشهر غير صالح');
  }
  return `${text}-01`;
}

function monthLabel(month: string) {
  if (!month) return '';
  const [year, m] = month.split('-');
  const names = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  return `${names[Number(m) - 1] ?? ''} ${year}`;
}

function round2(value: unknown) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function pageParams(query: Record<string, string>) {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(5, Number.parseInt(query.pageSize ?? '25', 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function defaultRange(query: Record<string, string>) {
  const today = todayISO();
  const from = query.from ? String(query.from).slice(0, 10) : `${today.slice(0, 4)}-01-01`;
  const to = query.to ? String(query.to).slice(0, 10) : today;
  return { from, to };
}

function validFileName(value: unknown) {
  const name = str(value, { name: 'المرفق', max: 80 });
  if (!name) return null;
  if (!/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|pdf)$/i.test(name)) {
    throw new HttpError(400, 'اسم الملف غير صالح');
  }
  return name;
}

function csvResponse(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const escape = (value: unknown) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))];
  const body = `\uFEFF${lines.join('\r\n')}`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="banan-report.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

// Auth verification is a network round trip to the Auth server. Cache the
// verified auth identity for a short window; the profile/role row is still read
// fresh on every request, so disabling a user takes effect immediately.
const authUserCache = new Map<string, { user: any; expiresAt: number }>();

async function verifyAuthUser(token: string) {
  const cached = authUserCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new HttpError(401, 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى');
  }
  const user = await response.json();
  if (authUserCache.size > 500) authUserCache.clear();
  authUserCache.set(token, { user, expiresAt: Date.now() + 30_000 });
  return user;
}

async function requireUser(c: any) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : c.req.query('token');
  if (!token) throw new HttpError(401, 'يجب تسجيل الدخول أولاً');

  const authUser = await verifyAuthUser(token);
  const rows = await sql`select * from fund_user_profiles where user_id = ${authUser.id} limit 1`;
  if (!rows.length) throw new HttpError(403, 'الحساب غير مهيأ. تواصل مع مدير النظام');
  const profile = rows[0];
  if (!profile.active) throw new HttpError(403, 'هذا الحساب موقوف. تواصل مع مدير النظام');

  return {
    id: profile.user_id,
    full_name: profile.full_name,
    email: authUser.email ?? profile.email,
    phone: profile.phone,
    role: profile.role,
    role_label: ROLE_LABELS[profile.role],
    active: true,
    linked_member_id: profile.linked_member_id,
    created_at: profile.created_at,
  };
}

function requireCap(user: any, capability: string) {
  if (!capabilities(user.role)[capability]) {
    throw new HttpError(403, 'لا تملك صلاحية تنفيذ هذا الإجراء');
  }
}

function requireRole(user: any, ...roles: string[]) {
  if (!roles.includes(user.role)) {
    throw new HttpError(403, 'لا تملك صلاحية الوصول إلى هذا القسم');
  }
}

function authPayload(user: any, settings: any) {
  return { user, capabilities: capabilities(user.role), settings };
}

/* -------------------------------------------------------------------------- */
/* Database helpers                                                            */
/* -------------------------------------------------------------------------- */

async function getSettings(db: any = sql) {
  const rows = await db`select * from fund_settings where id = 'fund' limit 1`;
  if (rows.length) return rows[0];
  const inserted = await db`insert into fund_settings (id) values ('fund') on conflict (id) do nothing returning *`;
  if (inserted.length) return inserted[0];
  return (await db`select * from fund_settings where id = 'fund' limit 1`)[0];
}

async function publicSettings() {
  const settings = await getSettings();
  return {
    fund_name: settings.fund_name,
    logo_url: settings.logo_url
      ? `${SUPABASE_URL}/functions/v1/api/logo?forceFunctionRegion=ap-southeast-2&v=${encodeURIComponent(settings.updated_at)}`
      : null,
    currency: settings.currency,
    default_monthly_fee: Number(settings.default_monthly_fee),
    allow_signups: Boolean(settings.allow_signups),
    allow_self_approval_demo: Boolean(settings.allow_self_approval_demo),
  };
}

async function audit(
  db: any,
  user: any,
  action: string,
  entityType: string,
  entityId: string | null,
  details: string
) {
  await db`insert into fund_audit_logs (action, entity_type, entity_id, actor_id, actor_name, details)
           values (${action}, ${entityType}, ${entityId}, ${user?.id ?? null}, ${user?.full_name ?? null}, ${details})`;
}

async function nextSequence(db: any, name: string) {
  const rows = await db`update sequences set value = value + 1 where name = ${name} returning value`;
  if (!rows.length) throw new HttpError(500, 'تسلسل المستندات غير مهيأ');
  return Number(rows[0].value);
}

async function cashPosition(db: any = sql) {
  const settings = await getSettings(db);
  const receipts = await db`select coalesce(sum(amount), 0) as total from fund_receipts`;
  const paidExpenses = await db`select coalesce(sum(amount), 0) as total from fund_expense_requests where status = 'paid'`;
  const committed = await db`select coalesce(sum(amount), 0) as total from fund_expense_requests where status = 'approved'`;
  const cash = round2(Number(settings.opening_balance) + Number(receipts[0].total) - Number(paidExpenses[0].total));
  return {
    opening_balance: round2(settings.opening_balance),
    total_receipts: round2(receipts[0].total),
    total_paid_expenses: round2(paidExpenses[0].total),
    cash_balance: cash,
    committed_pending: round2(committed[0].total),
    net_available: round2(cash - Number(committed[0].total)),
  };
}

async function arrearsPosition(db: any = sql) {
  const rows = await db`select
      coalesce(sum(amount - paid_amount), 0) as arrears,
      coalesce(sum(case when status <> 'paid' then 1 else 0 end), 0) as open_months,
      coalesce(sum(amount), 0) as accrued,
      coalesce(sum(paid_amount), 0) as collected
    from fund_subscriptions`;
  const row = rows[0];
  return {
    total_arrears: round2(row.arrears),
    open_months: Number(row.open_months),
    total_accrued: round2(row.accrued),
    total_collected: round2(row.collected),
  };
}

async function periodTotals(db: any, from: string, to: string) {
  const receipts = await db`select coalesce(sum(amount), 0) as total from fund_receipts where receipt_date between ${from} and ${to}`;
  const paidExpenses = await db`select coalesce(sum(amount), 0) as total from fund_expense_requests
    where status = 'paid' and (disbursed_at at time zone 'Asia/Aden')::date between ${from} and ${to}`;
  return {
    receipts: round2(receipts[0].total),
    paid_expenses: round2(paidExpenses[0].total),
    net: round2(Number(receipts[0].total) - Number(paidExpenses[0].total)),
  };
}

async function getReceipt(id: string) {
  const rows = await sql`
    select r.*, m.full_name as member_name, m.member_no,
           p.full_name as created_by_name
      from fund_receipts r
      left join fund_members m on m.id = r.member_id
      left join fund_user_profiles p on p.user_id = r.created_by
     where r.id = ${id}`;
  return rows[0] ?? null;
}

async function getExpense(id: string) {
  const rows = await sql`
    select e.*, p.full_name as created_by_name, d.full_name as disbursed_by_name
      from fund_expense_requests e
      left join fund_user_profiles p on p.user_id = e.created_by
      left join fund_user_profiles d on d.user_id = e.disbursed_by
     where e.id = ${id}`;
  if (!rows.length) return null;
  const expense = rows[0];
  expense.approvals = await sql`
    select * from fund_expense_approvals where request_id = ${id} order by created_at asc`;
  return expense;
}

async function memberStatement(memberId: string) {
  const memberRows = await sql`select * from v_member_financials where id = ${memberId}`;
  if (!memberRows.length) return null;
  const member = memberRows[0];
  const subscriptions = await sql`
    select s.*,
           coalesce((select sum(r.amount) from fund_receipts r where r.subscription_id = s.id), 0) as receipted
      from fund_subscriptions s
     where s.member_id = ${memberId}
     order by s.due_month asc`;
  const receipts = await sql`
    select * from fund_receipts
     where member_id = ${memberId}
     order by receipt_date desc, receipt_no desc`;
  const byMonth = new Map<string, any[]>();
  for (const receipt of receipts) {
    if (!receipt.subscription_id) continue;
    if (!byMonth.has(receipt.subscription_id)) byMonth.set(receipt.subscription_id, []);
    byMonth.get(receipt.subscription_id)!.push(receipt);
  }
  for (const subscription of subscriptions) {
    subscription.receipts = byMonth.get(subscription.id) ?? [];
  }
  return { member, subscriptions, receipts };
}

async function cashLedger(from: string, to: string) {
  const settings = await getSettings();
  const priorReceipts = await sql`select coalesce(sum(amount), 0) as total from fund_receipts where receipt_date < ${from}`;
  const priorExpenses = await sql`select coalesce(sum(amount), 0) as total from fund_expense_requests
    where status = 'paid' and (disbursed_at at time zone 'Asia/Aden')::date < ${from}`;
  const opening = round2(Number(settings.opening_balance) + Number(priorReceipts[0].total) - Number(priorExpenses[0].total));

  const receipts = await sql`
    select r.id, r.receipt_no, r.receipt_type, r.receipt_date as date,
           coalesce(m.full_name, r.donor_name, 'متبرع') as party,
           coalesce(r.restricted_purpose, case r.receipt_type
             when 'subscription' then 'سداد اشتراك شهري'
             when 'donation' then 'تبرع عام'
             else 'إيراد آخر' end) as description,
           r.amount, r.payment_method, r.created_at
      from fund_receipts r
      left join fund_members m on m.id = r.member_id
     where r.receipt_date between ${from} and ${to}`;

  const expenses = await sql`
    select e.id, e.request_no, e.category,
           (e.disbursed_at at time zone 'Asia/Aden')::date as date,
           e.beneficiary_name as party, e.description,
           e.amount, e.payment_voucher_no, e.disbursed_at as created_at
      from fund_expense_requests e
     where e.status = 'paid'
       and (e.disbursed_at at time zone 'Asia/Aden')::date between ${from} and ${to}`;

  const movements = [
    ...receipts.map((row: any) => ({
      id: row.id,
      kind: 'receipt',
      date: row.date,
      reference: `REC-${String(row.receipt_no).padStart(4, '0')}`,
      description: row.description,
      party: row.party,
      receipt_type: row.receipt_type,
      payment_method: row.payment_method,
      debit: 0,
      credit: round2(row.amount),
      created_at: row.created_at,
    })),
    ...expenses.map((row: any) => ({
      id: row.id,
      kind: 'expense',
      date: row.date,
      reference: row.payment_voucher_no || `EXP-${String(row.request_no).padStart(4, '0')}`,
      description: row.description,
      party: row.party,
      category: row.category,
      payment_method: 'cash',
      debit: round2(row.amount),
      credit: 0,
      created_at: row.created_at,
    })),
  ].sort((a, b) =>
    String(a.date) === String(b.date)
      ? String(a.created_at).localeCompare(String(b.created_at))
      : String(a.date).localeCompare(String(b.date))
  );

  let balance = opening;
  for (const movement of movements) {
    balance = round2(balance + movement.credit - movement.debit);
    movement.balance = balance;
  }

  return {
    from,
    to,
    opening_balance: opening,
    closing_balance: round2(balance),
    total_in: round2(movements.reduce((sum, row) => sum + row.credit, 0)),
    total_out: round2(movements.reduce((sum, row) => sum + row.debit, 0)),
    movements,
  };
}

async function notifyUsers(
  db: any,
  userIds: string[],
  { type, title, body, link, entityType, entityId }: any,
  excludeId?: string
) {
  const unique = [...new Set(userIds)].filter((id) => id && id !== excludeId);
  for (const userId of unique) {
    await db`insert into fund_notifications (user_id, type, title, body, link, entity_type, entity_id)
             values (${userId}, ${type}, ${title}, ${body ?? null}, ${link ?? null}, ${entityType ?? null}, ${entityId ?? null})`;
  }
}

async function notifyRoles(db: any, roles: string[], payload: any, excludeId?: string) {
  const rows = await db`select user_id from fund_user_profiles where active = true and role = any(${roles})`;
  await notifyUsers(db, rows.map((row: any) => row.user_id), payload, excludeId);
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const ALL_MIMES = [...IMAGE_MIMES, 'application/pdf'];

async function serveStorageObject(name: string, cache = 'private, max-age=3600') {
  if (!/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|pdf)$/i.test(name)) {
    throw new HttpError(400, 'اسم الملف غير صالح');
  }
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
  });
  if (!response.ok) throw new HttpError(404, 'الملف غير موجود');
  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('content-type') ?? 'application/octet-stream');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', cache);
  headers.set('Content-Disposition', `inline; filename="${name}"`);
  return new Response(response.body, { status: 200, headers });
}

async function uploadToStorage(file: File, kind: 'document' | 'logo') {
  const maxSize = 8 * 1024 * 1024;
  if (file.size > maxSize) throw new HttpError(400, 'حجم الملف أكبر من الحد المسموح (8 ميجابايت)');
  const allowed = kind === 'logo' ? IMAGE_MIMES : ALL_MIMES;
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase().replace('.jpeg', '.jpg');
  if (!allowed.includes(file.type) || !CONTENT_TYPES[ext]) {
    throw new HttpError(400, 'نوع الملف غير مدعوم. المسموح: صور PNG/JPG/WebP أو PDF');
  }
  if (file.type === 'application/pdf' && ext !== '.pdf') throw new HttpError(400, 'امتداد ملف PDF غير صالح');
  if (file.type.startsWith('image/') && ext === '.pdf') throw new HttpError(400, 'امتداد الصورة غير صالح');

  const filename = `${crypto.randomUUID()}${ext}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': file.type,
      'x-upsert': 'true',
    },
    body: new Uint8Array(await file.arrayBuffer()),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('storage upload failed', response.status, text);
    throw new HttpError(500, 'تعذر رفع الملف. يرجى المحاولة مرة أخرى');
  }
  return { file: filename, name: file.name, size: file.size, mime: file.type };
}

/* -------------------------------------------------------------------------- */
/* App                                                                         */
/* -------------------------------------------------------------------------- */

const app = new Hono().basePath('/api');
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type', 'apikey', 'x-client-info', 'x-region'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Disposition'],
    maxAge: 86400,
  })
);

app.get('/health', (c) =>
  c.json({ ok: true, service: 'صندوق بنان الخير للبنيان', time: new Date().toISOString() })
);


app.get('/public/settings', async (c) => c.json({ settings: await publicSettings() }));

app.get('/logo', async (c) => {
  const settings = await getSettings();
  if (!settings.logo_url) throw new HttpError(404, 'لا يوجد شعار');
  return serveStorageObject(settings.logo_url, 'no-cache');
});

app.get('/files/:name', async (c) => {
  await requireUser(c);
  return serveStorageObject(c.req.param('name'));
});

app.get('/auth/me', async (c) => {
  const user = await requireUser(c);
  return c.json(authPayload(user, await publicSettings()));
});

app.patch('/auth/me', async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json();
  const fullName = str(body?.full_name, { name: 'الاسم الكامل', required: true, min: 3, max: 120 });
  const phone = str(body?.phone, { name: 'رقم الهاتف', max: 30 });
  const currentPassword = body?.current_password ? String(body.current_password) : null;
  const newPassword = body?.new_password ? String(body.new_password) : null;

  if (newPassword) {
    if (newPassword.length < 8) throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل');
    const verify = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: currentPassword }),
    });
    if (!verify.ok) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
    const update = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
    });
    if (!update.ok) throw new HttpError(500, 'تعذر تحديث كلمة المرور');
  }

  await sql`update fund_user_profiles set full_name = ${fullName}, phone = ${phone} where user_id = ${user.id}`;
  await audit(sql, { ...user, full_name: fullName }, 'تحديث الملف الشخصي', 'user', user.id,
    newPassword ? 'تحديث البيانات وكلمة المرور' : 'تحديث البيانات الشخصية');
  return c.json({ ok: true, full_name: fullName, phone });
});

/* ------------------------------- Dashboard -------------------------------- */

function lastMonths(count: number, anchor = todayISO()) {
  const [year, month] = anchor.split('-').map(Number);
  const months: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}

app.get('/dashboard', async (c) => {
  const user = await requireUser(c);

  if (user.role === 'member') {
    if (!user.linked_member_id) {
      return c.json({
        restricted: true,
        member: null,
        message: 'لم يتم ربط حسابك بعضوية في الصندوق بعد. يرجى التواصل مع إدارة الصندوق.',
      });
    }
    const statement = await memberStatement(user.linked_member_id);
    if (!statement) {
      return c.json({ restricted: true, member: null, message: 'تعذر العثور على بيانات العضوية المرتبطة بحسابك.' });
    }
    return c.json({
      restricted: true,
      member: statement.member,
      subscriptions: statement.subscriptions.slice(-12).reverse(),
      receipts: statement.receipts.slice(0, 8),
    });
  }

  const position = await cashPosition();
  const arrears = await arrearsPosition();
  const revenue = await sql`select receipt_type, is_restricted, coalesce(sum(amount), 0) as total
    from fund_receipts group by receipt_type, is_restricted`;
  const revenueBreakdown = { subscriptions: 0, general_donations: 0, restricted_donations: 0, other: 0 };
  for (const row of revenue) {
    if (row.receipt_type === 'subscription') revenueBreakdown.subscriptions += Number(row.total);
    else if (row.receipt_type === 'donation' && row.is_restricted) revenueBreakdown.restricted_donations += Number(row.total);
    else if (row.receipt_type === 'donation') revenueBreakdown.general_donations += Number(row.total);
    else revenueBreakdown.other += Number(row.total);
  }

  const expensesByCategory = (await sql`select category, coalesce(sum(amount), 0) as total, count(*) as count
    from fund_expense_requests where status = 'paid' group by category order by total desc`)
    .map((row: any) => ({
      ...row,
      label: EXPENSE_CATEGORY_LABELS[row.category] ?? row.category,
      total: round2(row.total),
    }));

  const pending = await sql`select e.*, p.full_name as created_by_name
    from fund_expense_requests e
    left join fund_user_profiles p on p.user_id = e.created_by
    where e.status = 'pending' order by e.created_at desc limit 6`;

  const pendingSummary = (await sql`select count(*) as count, coalesce(sum(amount), 0) as total
    from fund_expense_requests where status = 'pending'`)[0];

  const recentReceipts = await sql`select r.id, r.receipt_no, r.receipt_type, r.amount, r.receipt_date,
      coalesce(m.full_name, r.donor_name, 'متبرع') as party, r.is_restricted
    from fund_receipts r left join fund_members m on m.id = r.member_id
    order by r.receipt_date desc, r.receipt_no desc limit 6`;

  const approved = await sql`select e.id, e.request_no, e.beneficiary_name, e.amount, e.category, e.approval_count
    from fund_expense_requests e where e.status = 'approved' order by e.created_at asc limit 5`;

  const memberStats = (await sql`select count(*) as total,
      coalesce(sum(case when active then 1 else 0 end), 0) as active,
      coalesce(sum(case when to_char(joined_on, 'YYYY-MM') = ${todayISO().slice(0, 7)} then 1 else 0 end), 0) as new_this_month
    from fund_members`)[0];

  const months = lastMonths(6);
  const receiptTrend = await sql`select to_char(receipt_date, 'YYYY-MM') as month, coalesce(sum(amount), 0) as total
    from fund_receipts group by month`;
  const expenseTrend = await sql`select to_char(disbursed_at at time zone 'Asia/Aden', 'YYYY-MM') as month,
      coalesce(sum(amount), 0) as total
    from fund_expense_requests where status = 'paid' group by month`;
  const receiptMap = new Map(receiptTrend.map((row: any) => [row.month, round2(row.total)]));
  const expenseMap = new Map(expenseTrend.map((row: any) => [row.month, round2(row.total)]));

  return c.json({
    restricted: false,
    position,
    arrears: {
      ...arrears,
      members_in_arrears: Number((await sql`select count(*) as count from (
        select member_id from fund_subscriptions where status <> 'paid' group by member_id
      ) x`)[0].count),
    },
    revenue_breakdown: {
      subscriptions: round2(revenueBreakdown.subscriptions),
      general_donations: round2(revenueBreakdown.general_donations),
      restricted_donations: round2(revenueBreakdown.restricted_donations),
      other: round2(revenueBreakdown.other),
    },
    expenses_by_category: expensesByCategory,
    pending_requests: pending,
    pending_summary: { count: Number(pendingSummary.count), total: round2(pendingSummary.total) },
    approved_requests: approved,
    recent_receipts: recentReceipts,
    members: {
      total: Number(memberStats.total ?? 0),
      active: Number(memberStats.active ?? 0),
      new_this_month: Number(memberStats.new_this_month ?? 0),
    },
    trend: months.map((month) => ({
      month,
      receipts: receiptMap.get(month) ?? 0,
      expenses: expenseMap.get(month) ?? 0,
    })),
  });
});

/* --------------------------------- Members -------------------------------- */

async function nextMemberNo(db: any = sql) {
  const rows = await db`select coalesce(max(cast(substr(member_no, 3) as integer)), 0) as max
    from fund_members where member_no like 'M-%'`;
  return `M-${String(Number(rows[0].max) + 1).padStart(3, '0')}`;
}

async function memberRow(id: string) {
  return (await sql`select * from v_member_financials where id = ${id}`)[0] ?? null;
}

app.get('/members', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');

  const search = String(c.req.query('search') ?? '').trim();
  const status = String(c.req.query('status') ?? 'all');
  const conditions: string[] = [];
  const params: any[] = [];
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(full_name ilike $${n} or member_no ilike $${n} or phone ilike $${n})`);
  }
  if (status === 'active') conditions.push('active = true');
  if (status === 'inactive') conditions.push('active = false');
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const rows = await sql.unsafe(`select * from v_member_financials ${where} order by member_no asc`, params);
  return c.json({
    members: rows.map((row: any) => ({
      ...row,
      active: Boolean(row.active),
      total_accrued: Number(row.total_accrued),
      total_paid: Number(row.total_paid),
      arrears: Number(row.arrears),
    })),
  });
});

app.get('/members/:id/statement', async (c) => {
  const user = await requireUser(c);
  const id = c.req.param('id');
  if (user.role === 'member' && user.linked_member_id !== id) {
    throw new HttpError(403, 'لا تملك صلاحية الاطلاع على كشف حساب هذا العضو');
  }
  const statement = await memberStatement(id);
  if (!statement) throw new HttpError(404, 'العضو غير موجود');
  return c.json(statement);
});

app.post('/members', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'manageMembers');
  const body = await c.req.json();
  const settings = await getSettings();
  const fullName = str(body?.full_name, { name: 'اسم العضو', required: true, min: 3, max: 120 });
  const phone = str(body?.phone, { name: 'رقم الهاتف', max: 30 });
  const address = str(body?.address, { name: 'العنوان', max: 250 }) || 'الغدير - مقبنة - تعز';
  const monthlyFee = body?.monthly_fee === undefined || body?.monthly_fee === ''
    ? Number(settings.default_monthly_fee)
    : amount(body.monthly_fee, { name: 'رسوم الاشتراك الشهري', min: 0 });
  const joinedOn = isoDate(body?.joined_on, { name: 'تاريخ الانضمام' });
  const notes = str(body?.notes, { name: 'ملاحظات', max: 1000 });
  const active = bool(body?.active, true);
  let memberNo = str(body?.member_no, { name: 'رقم العضوية', max: 30 });
  if (memberNo && !/^M-\d{1,6}$/.test(memberNo)) {
    throw new HttpError(400, 'رقم العضوية يجب أن يكون بالصيغة M-001');
  }
  if (memberNo && (await sql`select 1 from fund_members where member_no = ${memberNo}`).length) {
    throw new HttpError(409, 'رقم العضوية مستخدم مسبقاً');
  }

  const result = await sql.begin(async (tx) => {
    memberNo ||= await nextMemberNo(tx);
    const id = crypto.randomUUID();
    await tx`insert into fund_members (id, member_no, full_name, phone, address, monthly_fee, joined_on, active, notes)
      values (${id}, ${memberNo}, ${fullName}, ${phone}, ${address}, ${monthlyFee}, ${joinedOn}, ${active}, ${notes})`;
    await audit(tx, user, 'إضافة عضو جديد', 'member', id, `إضافة العضو ${fullName} برقم عضوية ${memberNo}`);
    return id;
  });
  return c.json({ member: await memberRow(result) }, 201);
});

app.patch('/members/:id', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'manageMembers');
  const id = c.req.param('id');
  const existingRows = await sql`select * from fund_members where id = ${id}`;
  if (!existingRows.length) throw new HttpError(404, 'العضو غير موجود');
  const existing = existingRows[0];
  const body = await c.req.json();

  const fullName = str(body?.full_name ?? existing.full_name, { name: 'اسم العضو', required: true, min: 3, max: 120 });
  const phone = str(body?.phone ?? existing.phone, { name: 'رقم الهاتف', max: 30 });
  const address = str(body?.address ?? existing.address, { name: 'العنوان', max: 250 });
  const monthlyFee = body?.monthly_fee === undefined
    ? Number(existing.monthly_fee)
    : amount(body.monthly_fee, { name: 'رسوم الاشتراك الشهري', min: 0 });
  const joinedOn = body?.joined_on === undefined
    ? existing.joined_on
    : isoDate(body.joined_on, { name: 'تاريخ الانضمام' });
  const notes = body?.notes === undefined
    ? existing.notes
    : str(body.notes, { name: 'ملاحظات', max: 1000 });
  const active = body?.active === undefined ? Boolean(existing.active) : bool(body.active, true);

  await sql.begin(async (tx) => {
    await tx`update fund_members set full_name = ${fullName}, phone = ${phone}, address = ${address},
      monthly_fee = ${monthlyFee}, joined_on = ${joinedOn}, active = ${active}, notes = ${notes}
      where id = ${id}`;
    await audit(tx, user, active ? 'تعديل بيانات عضو' : 'إيقاف عضوية', 'member', id,
      `تحديث بيانات العضو ${fullName} (${existing.member_no})${active ? '' : ' — تم إيقاف العضوية'}`);
  });
  return c.json({ member: await memberRow(id) });
});

app.delete('/members/:id', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const id = c.req.param('id');
  const existingRows = await sql`select * from fund_members where id = ${id}`;
  if (!existingRows.length) throw new HttpError(404, 'العضو غير موجود');
  const existing = existingRows[0];
  const receipts = (await sql`select count(*) as c from fund_receipts where member_id = ${id}`)[0].c;
  const subscriptions = (await sql`select count(*) as c from fund_subscriptions where member_id = ${id}`)[0].c;
  if (Number(receipts) || Number(subscriptions)) {
    throw new HttpError(409, 'لا يمكن حذف عضو لديه سندات أو استحقاقات مسجلة. يمكنك إيقاف عضويته بدلاً من الحذف.');
  }
  await sql.begin(async (tx) => {
    await tx`delete from fund_members where id = ${id}`;
    await audit(tx, user, 'حذف عضو', 'member', id, `حذف العضو ${existing.full_name} (${existing.member_no})`);
  });
  return c.json({ ok: true });
});

/* ------------------------------ Subscriptions ----------------------------- */

app.get('/subscriptions', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const month = normalizeMonth(c.req.query('month'), { required: false }) ?? `${todayISO().slice(0, 7)}-01`;
  const status = String(c.req.query('status') ?? 'all');
  const search = String(c.req.query('search') ?? '').trim();

  const conditions = ['s.due_month = $1'];
  const params: any[] = [month];
  if (['unpaid', 'partial', 'paid'].includes(status)) {
    params.push(status);
    conditions.push(`s.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(m.full_name ilike $${n} or m.member_no ilike $${n})`);
  }
  const rows = await sql.unsafe(
    `select s.*, m.full_name, m.member_no, m.phone, m.active,
            (s.amount - s.paid_amount) as remaining
       from fund_subscriptions s
       join fund_members m on m.id = s.member_id
      where ${conditions.join(' and ')}
      order by m.member_no asc`,
    params
  );
  const summary = (await sql`select count(*) as count,
      coalesce(sum(s.amount), 0) as total,
      coalesce(sum(s.paid_amount), 0) as paid,
      coalesce(sum(s.amount - s.paid_amount), 0) as remaining
    from fund_subscriptions s join fund_members m on m.id = s.member_id
    where s.due_month = ${month}`)[0];

  return c.json({
    month,
    month_label: monthLabel(month),
    subscriptions: rows.map((row: any) => ({
      ...row,
      active: Boolean(row.active),
      remaining: round2(row.remaining),
    })),
    summary: {
      count: Number(summary.count),
      total: round2(summary.total),
      paid: round2(summary.paid),
      remaining: round2(summary.remaining),
    },
  });
});

app.post('/subscriptions/generate', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'manageMembers');
  const body = await c.req.json();
  const month = normalizeMonth(body?.month);
  const settings = await getSettings();

  const result = await sql.begin(async (tx) => {
    const members = await tx`select id, full_name, monthly_fee from fund_members where active = true`;
    let generated = 0;
    let skipped = 0;
    for (const member of members) {
      if (Number(member.monthly_fee) <= 0) {
        skipped += 1;
        continue;
      }
      const inserted = await tx`insert into fund_subscriptions (member_id, due_month, amount, paid_amount, status)
        values (${member.id}, ${month}, ${round2(member.monthly_fee)}, 0, 'unpaid')
        on conflict (member_id, due_month) do nothing returning id`;
      if (inserted.length) generated += 1;
      else skipped += 1;
    }
    await audit(tx, user, 'توليد استحقاقات شهرية', 'subscription', month,
      `توليد استحقاقات ${monthLabel(month)} — تم إنشاء ${generated} استحقاق وتخطي ${skipped}`);
    return { generated, skipped, total: members.length };
  });

  return c.json({
    month,
    month_label: monthLabel(month),
    generated: result.generated,
    skipped: result.skipped,
    total_active_members: result.total,
    default_fee: Number(settings.default_monthly_fee),
  }, 201);
});

app.post('/subscriptions/:id/pay', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'manageReceipts');
  const id = c.req.param('id');
  const body = await c.req.json();

  const result = await sql.begin(async (tx) => {
    const rows = await tx`select s.*, m.full_name, m.member_no
      from fund_subscriptions s join fund_members m on m.id = s.member_id
      where s.id = ${id} for update`;
    if (!rows.length) throw new HttpError(404, 'الاستحقاق غير موجود');
    const subscription = rows[0];
    const remaining = round2(Number(subscription.amount) - Number(subscription.paid_amount));
    if (remaining <= 0) throw new HttpError(409, 'هذا الاستحقاق مسدد بالكامل');
    const payment = amount(body?.amount, { name: 'مبلغ السداد' });
    if (payment > remaining) {
      throw new HttpError(400, `المبلغ يتجاوز المتبقي على العضو (${remaining} ر.ي)`);
    }
    const paymentMethod = oneOf(body?.payment_method ?? 'cash', ['cash', 'bank_transfer'], { name: 'طريقة الدفع' });
    const receiptDate = isoDate(body?.receipt_date, { name: 'تاريخ السند' });
    const notes = str(body?.notes, { name: 'ملاحظات', max: 1000 });
    const newPaid = round2(Number(subscription.paid_amount) + payment);
    const status = newPaid >= Number(subscription.amount) ? 'paid' : 'partial';
    const receiptId = crypto.randomUUID();

    await tx`update fund_subscriptions set paid_amount = ${newPaid}, status = ${status} where id = ${id}`;
    const receiptNo = await nextSequence(tx, 'receipt');
    await tx`insert into fund_receipts
      (id, receipt_no, receipt_type, member_id, subscription_id, donor_name, amount,
       payment_method, is_restricted, receipt_date, notes, created_by)
      values (${receiptId}, ${receiptNo}, 'subscription', ${subscription.member_id}, ${id},
       ${subscription.full_name}, ${payment}, ${paymentMethod}, false, ${receiptDate}, ${notes}, ${user.id})`;
    await audit(tx, user, 'تحصيل اشتراك شهري', 'receipt', receiptId,
      `سند قبض REC-${String(receiptNo).padStart(4, '0')} — العضو ${subscription.full_name} (${subscription.member_no}) — ${monthLabel(subscription.due_month)} — مبلغ ${payment} ر.ي`);
    await audit(tx, user, 'تحديث حالة استحقاق', 'subscription', id,
      `تم سداد ${payment} ر.ي من أصل ${subscription.amount} ر.ي — الحالة: ${status === 'paid' ? 'مسدد' : 'سداد جزئي'}`);
    return { receiptId, subscription: (await tx`select * from fund_subscriptions where id = ${id}`)[0] };
  });

  return c.json({ subscription: result.subscription, receipt: await getReceipt(result.receiptId) }, 201);
});

/* --------------------------------- Receipts ------------------------------- */

app.get('/receipts', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');

  const conditions: string[] = [];
  const params: any[] = [];
  const from = c.req.query('from');
  const to = c.req.query('to');
  const type = c.req.query('type');
  const restricted = c.req.query('restricted');
  const memberId = c.req.query('member_id');
  const search = String(c.req.query('search') ?? '').trim();

  if (from) {
    params.push(isoDate(from, { name: 'من تاريخ' }));
    conditions.push(`r.receipt_date >= $${params.length}`);
  }
  if (to) {
    params.push(isoDate(to, { name: 'إلى تاريخ' }));
    conditions.push(`r.receipt_date <= $${params.length}`);
  }
  if (['subscription', 'donation', 'other'].includes(type ?? '')) {
    params.push(type);
    conditions.push(`r.receipt_type = $${params.length}`);
  }
  if (restricted === '1') conditions.push('r.is_restricted = true');
  if (restricted === '0') conditions.push('r.is_restricted = false');
  if (memberId) {
    params.push(memberId);
    conditions.push(`r.member_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(coalesce(m.full_name, r.donor_name) ilike $${n} or r.notes ilike $${n} or cast(r.receipt_no as text) like $${n})`);
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const rows = await sql.unsafe(
    `select r.*, m.full_name as member_name, m.member_no, p.full_name as created_by_name
       from fund_receipts r
       left join fund_members m on m.id = r.member_id
       left join fund_user_profiles p on p.user_id = r.created_by
       ${where}
      order by r.receipt_date desc, r.receipt_no desc
      limit 1000`,
    params
  );

  return c.json({
    receipts: rows,
    summary: {
      count: rows.length,
      total: round2(rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
      restricted: round2(rows.filter((row: any) => row.is_restricted).reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
    },
  });
});

app.get('/receipts/:id', async (c) => {
  const user = await requireUser(c);
  const receipt = await getReceipt(c.req.param('id'));
  if (!receipt) throw new HttpError(404, 'السند غير موجود');
  if (user.role === 'member' && receipt.member_id !== user.linked_member_id) {
    throw new HttpError(403, 'لا تملك صلاحية الاطلاع على هذا السند');
  }
  return c.json({ receipt });
});

app.post('/receipts', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'manageReceipts');
  const body = await c.req.json();

  const receiptType = oneOf(body?.receipt_type, ['subscription', 'donation', 'other'], { name: 'نوع السند' });
  const paymentMethod = oneOf(body?.payment_method ?? 'cash', ['cash', 'bank_transfer'], { name: 'طريقة الدفع' });
  const receiptDate = isoDate(body?.receipt_date, { name: 'تاريخ السند' });
  const value = amount(body?.amount, { name: 'المبلغ' });
  const isRestricted = bool(body?.is_restricted, false);
  const restrictedPurpose = isRestricted
    ? str(body?.restricted_purpose, { name: 'الغرض المخصص', required: true, max: 250 })
    : null;
  const notes = str(body?.notes, { name: 'ملاحظات', max: 1000 });
  const attachment = validFileName(body?.attachment_url);
  let memberId = str(body?.member_id, { name: 'العضو', max: 60 });
  const subscriptionId = str(body?.subscription_id, { name: 'الاستحقاق', max: 60 });
  let donorName = str(body?.donor_name, { name: 'اسم المتبرع', max: 150 });

  if (receiptType === 'subscription') {
    if (!subscriptionId) {
      throw new HttpError(400, 'سند الاشتراك يجب أن يرتبط باستحقاق شهري. استخدم زر السداد في صفحة الاشتراكات');
    }
    const result = await sql.begin(async (tx) => {
      const rows = await tx`select s.*, m.full_name, m.member_no
        from fund_subscriptions s join fund_members m on m.id = s.member_id
        where s.id = ${subscriptionId} for update`;
      if (!rows.length) throw new HttpError(400, 'الاستحقاق المحدد غير موجود');
      const subscription = rows[0];
      if (memberId && memberId !== subscription.member_id) {
        throw new HttpError(400, 'العضو لا يطابق الاستحقاق المحدد');
      }
      if (subscription.paid_amount >= subscription.amount) throw new HttpError(409, 'هذا الاستحقاق مسدد بالكامل');
      if (value > Number(subscription.amount) - Number(subscription.paid_amount)) {
        throw new HttpError(400, `المبلغ يتجاوز المتبقي على العضو (${round2(Number(subscription.amount) - Number(subscription.paid_amount))} ر.ي)`);
      }
      memberId = subscription.member_id;
      donorName = subscription.full_name;
      const newPaid = round2(Number(subscription.paid_amount) + value);
      const status = newPaid >= Number(subscription.amount) ? 'paid' : 'partial';
      const receiptId = crypto.randomUUID();
      await tx`update fund_subscriptions set paid_amount = ${newPaid}, status = ${status} where id = ${subscriptionId}`;
      const receiptNo = await nextSequence(tx, 'receipt');
      await tx`insert into fund_receipts
        (id, receipt_no, receipt_type, member_id, subscription_id, donor_name, amount,
         payment_method, is_restricted, restricted_purpose, receipt_date, attachment_url, notes, created_by)
        values (${receiptId}, ${receiptNo}, 'subscription', ${memberId}, ${subscriptionId}, ${donorName},
         ${value}, ${paymentMethod}, false, null, ${receiptDate}, ${attachment}, ${notes}, ${user.id})`;
      await audit(tx, user, 'تسجيل سند قبض اشتراك', 'receipt', receiptId,
        `سند REC-${String(receiptNo).padStart(4, '0')} — ${subscription.full_name} — ${monthLabel(subscription.due_month)} — ${value} ر.ي`);
      return receiptId;
    });
    return c.json({ receipt: await getReceipt(result) }, 201);
  }

  if (memberId) {
    const memberRows = await sql`select * from fund_members where id = ${memberId}`;
    if (!memberRows.length) throw new HttpError(400, 'العضو المحدد غير موجود');
    if (!donorName) donorName = memberRows[0].full_name;
  }
  if (!donorName) throw new HttpError(400, 'اسم المتبرع أو الجهة مطلوب');

  const id = crypto.randomUUID();
  const receiptNo = await nextSequence(sql, 'receipt');
  await sql`insert into fund_receipts
    (id, receipt_no, receipt_type, member_id, subscription_id, donor_name, amount,
     payment_method, is_restricted, restricted_purpose, receipt_date, attachment_url, notes, created_by)
    values (${id}, ${receiptNo}, ${receiptType}, ${memberId}, null, ${donorName}, ${value},
     ${paymentMethod}, ${isRestricted}, ${restrictedPurpose}, ${receiptDate}, ${attachment}, ${notes}, ${user.id})`;
  await audit(sql, user, 'تسجيل سند قبض', 'receipt', id,
    `سند REC-${String(receiptNo).padStart(4, '0')} — ${receiptType === 'donation' ? 'تبرع' : 'إيراد آخر'} — ${donorName} — ${value} ر.ي${isRestricted ? ` (مخصص: ${restrictedPurpose})` : ''}`);
  return c.json({ receipt: await getReceipt(id) }, 201);
});

/* --------------------------------- Expenses -------------------------------- */

app.get('/expenses', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');

  const conditions: string[] = [];
  const params: any[] = [];
  const status = c.req.query('status');
  const category = c.req.query('category');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const search = String(c.req.query('search') ?? '').trim();

  if (['pending', 'approved', 'rejected', 'paid'].includes(status ?? '')) {
    params.push(status);
    conditions.push(`e.status = $${params.length}`);
  }
  if (['social_aid', 'charitable_aid', 'medical_aid', 'emergency_aid', 'operational'].includes(category ?? '')) {
    params.push(category);
    conditions.push(`e.category = $${params.length}`);
  }
  if (from) {
    params.push(isoDate(from, { name: 'من تاريخ' }));
    conditions.push(`e.requested_date >= $${params.length}`);
  }
  if (to) {
    params.push(isoDate(to, { name: 'إلى تاريخ' }));
    conditions.push(`e.requested_date <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(e.beneficiary_name ilike $${n} or e.description ilike $${n} or cast(e.request_no as text) like $${n} or e.payment_voucher_no ilike $${n})`);
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const rows = await sql.unsafe(
    `select e.*, p.full_name as created_by_name, d.full_name as disbursed_by_name
       from fund_expense_requests e
       left join fund_user_profiles p on p.user_id = e.created_by
       left join fund_user_profiles d on d.user_id = e.disbursed_by
       ${where}
      order by case e.status when 'pending' then 0 when 'approved' then 1 when 'paid' then 2 else 3 end,
               e.created_at desc
      limit 500`,
    params
  );

  const ids = rows.map((row: any) => row.id);
  const approvalRows = ids.length
    ? await sql`select * from fund_expense_approvals where request_id = any(${ids}) order by created_at asc`
    : [];
  const approvalMap = new Map<string, any[]>();
  for (const approval of approvalRows) {
    if (!approvalMap.has(approval.request_id)) approvalMap.set(approval.request_id, []);
    approvalMap.get(approval.request_id)!.push(approval);
  }

  const summary = (await sql`select
      coalesce(sum(case when status = 'pending' then amount else 0 end), 0) as pending_total,
      coalesce(sum(case when status = 'pending' then 1 else 0 end), 0) as pending_count,
      coalesce(sum(case when status = 'approved' then amount else 0 end), 0) as approved_total,
      coalesce(sum(case when status = 'approved' then 1 else 0 end), 0) as approved_count,
      coalesce(sum(case when status = 'paid' then amount else 0 end), 0) as paid_total,
      coalesce(sum(case when status = 'paid' then 1 else 0 end), 0) as paid_count,
      coalesce(sum(case when status = 'rejected' then amount else 0 end), 0) as rejected_total,
      coalesce(sum(case when status = 'rejected' then 1 else 0 end), 0) as rejected_count
    from fund_expense_requests`)[0];

  return c.json({
    expenses: rows.map((row: any) => ({ ...row, approvals: approvalMap.get(row.id) ?? [] })),
    summary: {
      ...summary,
      pending_total: round2(summary.pending_total),
      approved_total: round2(summary.approved_total),
      paid_total: round2(summary.paid_total),
      rejected_total: round2(summary.rejected_total),
      cash: await cashPosition(),
    },
  });
});

app.get('/expenses/:id', async (c) => {
  const user = await requireUser(c);
  if (user.role === 'member') throw new HttpError(403, 'غير مصرح');
  const expense = await getExpense(c.req.param('id'));
  if (!expense) throw new HttpError(404, 'طلب الصرف غير موجود');
  return c.json({ expense });
});

app.post('/expenses', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'createExpenses');
  const body = await c.req.json();
  const category = oneOf(body?.category, ['social_aid', 'charitable_aid', 'medical_aid', 'emergency_aid', 'operational'], { name: 'فئة الصرف' });
  const beneficiaryName = str(body?.beneficiary_name, { name: 'اسم المستفيد', required: true, min: 2, max: 150 });
  const beneficiaryPhone = str(body?.beneficiary_phone, { name: 'هاتف المستفيد', max: 30 });
  const description = str(body?.description, { name: 'وصف الطلب', required: true, min: 5, max: 2000 });
  const value = amount(body?.amount, { name: 'مبلغ الصرف' });
  const requestedDate = isoDate(body?.requested_date, { name: 'تاريخ الطلب' });
  const attachment = validFileName(body?.attachment_url);
  const notes = str(body?.notes, { name: 'ملاحظات', max: 1000 });
  const id = crypto.randomUUID();

  const result = await sql.begin(async (tx) => {
    const requestNo = await nextSequence(tx, 'expense_request');
    await tx`insert into fund_expense_requests
      (id, request_no, category, beneficiary_name, beneficiary_phone, description, amount,
       requested_date, status, approval_count, attachment_url, notes, created_by)
      values (${id}, ${requestNo}, ${category}, ${beneficiaryName}, ${beneficiaryPhone}, ${description},
       ${value}, ${requestedDate}, 'pending', 0, ${attachment}, ${notes}, ${user.id})`;
    await audit(tx, user, 'إنشاء طلب صرف', 'expense_request', id,
      `طلب EXP-${String(requestNo).padStart(4, '0')} — ${beneficiaryName} — ${value} ر.ي — بانتظار اعتماد شخصين`);
    await notifyRoles(tx, ['admin', 'treasurer', 'board_member'], {
      type: 'expense_pending',
      title: 'طلب صرف جديد بانتظار الاعتماد',
      body: `طلب صرف بمبلغ ${value} ر.ي لصالح ${beneficiaryName}`,
      link: '/expenses',
      entityType: 'expense_request',
      entityId: id,
    }, user.id);
    return requestNo;
  });

  return c.json({ expense: await getExpense(id) }, 201);
});

app.post('/expenses/:id/approve', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'approveExpenses');
  const id = c.req.param('id');
  const body = await c.req.json();
  const decision = oneOf(body?.decision, ['approved', 'rejected'], { name: 'قرار الاعتماد' });
  const notes = str(body?.notes, { name: 'ملاحظات', max: 1000 });

  await sql.begin(async (tx) => {
    const settings = await getSettings(tx);
    const rows = await tx`select * from fund_expense_requests where id = ${id} for update`;
    if (!rows.length) throw new HttpError(404, 'طلب الصرف غير موجود');
    const request = rows[0];
    if (request.status !== 'pending') throw new HttpError(409, 'لا يمكن الاعتماد: الطلب لم يعد بانتظار الاعتماد');
    if (request.created_by === user.id && !settings.allow_self_approval_demo) {
      throw new HttpError(403, 'لا يمكنك اعتماد طلب قمت بإنشائه. يجب أن يعتمده شخص آخر');
    }
    const existing = await tx`select 1 from fund_expense_approvals where request_id = ${id} and approver_id = ${user.id}`;
    if (existing.length) throw new HttpError(409, 'لقد اعتمدت هذا الطلب مسبقاً. لا يمكن الاعتماد مرتين');

    await tx`insert into fund_expense_approvals
      (request_id, approver_id, approver_name, approver_role, decision, notes)
      values (${id}, ${user.id}, ${user.full_name}, ${user.role}, ${decision}, ${notes})`;
    const approvedCount = Number((await tx`select count(*) as c from fund_expense_approvals
      where request_id = ${id} and decision = 'approved'`)[0].c);
    const approvalCount = Math.min(2, approvedCount);
    const status = decision === 'rejected' ? 'rejected' : approvedCount >= 2 ? 'approved' : 'pending';
    await tx`update fund_expense_requests set approval_count = ${approvalCount}, status = ${status} where id = ${id}`;
    await audit(tx, user, decision === 'approved' ? 'اعتماد طلب صرف' : 'رفض طلب صرف', 'expense_request', id,
      `طلب EXP-${String(request.request_no).padStart(4, '0')} — ${decision === 'approved' ? `اعتماد رقم ${approvedCount}` : 'رفض'} بواسطة ${user.full_name}${notes ? ` — ${notes}` : ''}`);

    if (decision === 'rejected') {
      await notifyUsers(tx, [request.created_by], {
        type: 'expense_rejected',
        title: 'تم رفض طلب صرف',
        body: `طلب الصرف EXP-${String(request.request_no).padStart(4, '0')} تم رفضه`,
        link: '/expenses',
        entityType: 'expense_request',
        entityId: id,
      });
    } else if (status === 'approved') {
      await notifyRoles(tx, ['admin', 'treasurer'], {
        type: 'expense_approved',
        title: 'طلب صرف جاهز للصرف',
        body: `تم اعتماد طلب الصرف EXP-${String(request.request_no).padStart(4, '0')} بمبلغ ${request.amount} ر.ي`,
        link: '/expenses',
        entityType: 'expense_request',
        entityId: id,
      });
    }
  });

  return c.json({ expense: await getExpense(id) });
});

app.post('/expenses/:id/pay', async (c) => {
  const user = await requireUser(c);
  requireCap(user, 'payExpenses');
  const id = c.req.param('id');

  const voucherNo = await sql.begin(async (tx) => {
    const rows = await tx`select * from fund_expense_requests where id = ${id} for update`;
    if (!rows.length) throw new HttpError(404, 'طلب الصرف غير موجود');
    const request = rows[0];
    if (request.status !== 'approved') throw new HttpError(409, 'لا يمكن الصرف: يجب اعتماد الطلب من شخصين مختلفين أولاً');
    const position = await cashPosition(tx);
    if (position.cash_balance < Number(request.amount)) {
      throw new HttpError(409, `الرصيد النقدي غير كافٍ للصرف. المتاح ${position.cash_balance} ر.ي والمطلوب ${request.amount} ر.ي`);
    }
    const seq = await nextSequence(tx, 'payment_voucher');
    const voucher = `PV-${String(seq).padStart(4, '0')}`;
    await tx`update fund_expense_requests
      set status = 'paid', payment_voucher_no = ${voucher}, disbursed_by = ${user.id}, disbursed_at = now()
      where id = ${id} and status = 'approved'`;
    await audit(tx, user, 'صرف مبلغ وإصدار سند صرف', 'expense_request', id,
      `سند ${voucher} — ${request.beneficiary_name} — ${request.amount} ر.ي — طلب EXP-${String(request.request_no).padStart(4, '0')}`);
    await notifyUsers(tx, [request.created_by], {
      type: 'expense_paid',
      title: 'تم صرف طلب الصرف',
      body: `تم صرف ${request.amount} ر.ي لصالح ${request.beneficiary_name} — سند ${voucher}`,
      link: '/expenses',
      entityType: 'expense_request',
      entityId: id,
    });
    return voucher;
  });

  return c.json({ expense: await getExpense(id), voucher_no: voucherNo });
});

/* --------------------------------- Reports -------------------------------- */

async function arrearsRows() {
  const rows = await sql`select m.id, m.member_no, m.full_name, m.phone, m.active,
      coalesce(sum(s.amount), 0) as accrued,
      coalesce(sum(s.paid_amount), 0) as paid,
      coalesce(sum(s.amount - s.paid_amount), 0) as arrears,
      coalesce(sum(case when s.status <> 'paid' then 1 else 0 end), 0) as open_months,
      min(case when s.status <> 'paid' then s.due_month end) as oldest_due
    from fund_members m
    left join fund_subscriptions s on s.member_id = m.id
    group by m.id
    having coalesce(sum(s.amount - s.paid_amount), 0) > 0
    order by arrears desc, m.member_no asc`;
  return rows.map((row: any) => ({
    ...row,
    active: Boolean(row.active),
    accrued: round2(row.accrued),
    paid: round2(row.paid),
    arrears: round2(row.arrears),
    open_months: Number(row.open_months),
  }));
}

async function donationRows(from: string, to: string) {
  return sql`select r.id, r.receipt_no, r.receipt_date, r.amount, r.payment_method,
      r.is_restricted, r.restricted_purpose, r.notes,
      coalesce(r.donor_name, m.full_name, 'متبرع') as donor_name,
      m.member_no, p.full_name as created_by_name
    from fund_receipts r
    left join fund_members m on m.id = r.member_id
    left join fund_user_profiles p on p.user_id = r.created_by
    where r.receipt_type = 'donation' and r.receipt_date between ${from} and ${to}
    order by r.receipt_date desc, r.receipt_no desc`;
}

async function disbursementRows(from: string, to: string) {
  const rows = await sql`select e.id, e.request_no, e.payment_voucher_no, e.category, e.beneficiary_name,
      e.beneficiary_phone, e.description, e.amount, e.disbursed_at, e.approval_count,
      d.full_name as disbursed_by_name,
      string_agg(case when a.decision = 'approved'
        then a.approver_name || ' (' || to_char(a.created_at at time zone 'Asia/Aden', 'YYYY-MM-DD') || ')'
        end, ' • ') as approvers
    from fund_expense_requests e
    left join fund_expense_approvals a on a.request_id = e.id
    left join fund_user_profiles d on d.user_id = e.disbursed_by
    where e.status = 'paid'
      and (e.disbursed_at at time zone 'Asia/Aden')::date between ${from} and ${to}
    group by e.id, d.full_name
    order by e.disbursed_at desc`;
  return rows.map((row: any) => ({
    ...row,
    category_label: EXPENSE_CATEGORY_LABELS[row.category] ?? row.category,
    disbursed_date: row.disbursed_at ? String(row.disbursed_at).slice(0, 10) : '',
  }));
}

app.get('/reports/summary', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const { from, to } = defaultRange(c.req.query());
  const position = await cashPosition();
  const arrears = await arrearsPosition();
  const period = await periodTotals(sql, from, to);
  const counts = (await sql`select
      (select count(*) from fund_receipts where receipt_date between ${from} and ${to}) as receipts_count,
      (select count(*) from fund_expense_requests where status = 'paid'
        and (disbursed_at at time zone 'Asia/Aden')::date between ${from} and ${to}) as expenses_count,
      (select count(*) from fund_members where active = true) as active_members`)[0];
  return c.json({ from, to, position, arrears, period, counts });
});

app.get('/reports/cash-ledger', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const { from, to } = defaultRange(c.req.query());
  return c.json(await cashLedger(from, to));
});

app.get('/reports/arrears', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const rows = await arrearsRows();
  const totals = rows.reduce((acc: any, row: any) => ({
    accrued: acc.accrued + row.accrued,
    paid: acc.paid + row.paid,
    arrears: acc.arrears + row.arrears,
    members: acc.members + 1,
  }), { accrued: 0, paid: 0, arrears: 0, members: 0 });
  return c.json({
    rows,
    totals: {
      accrued: round2(totals.accrued),
      paid: round2(totals.paid),
      arrears: round2(totals.arrears),
      members: totals.members,
    },
  });
});

app.get('/reports/donations', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const { from, to } = defaultRange(c.req.query());
  const rows = await donationRows(from, to);
  return c.json({
    from,
    to,
    rows,
    totals: {
      count: rows.length,
      total: round2(rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
      general: round2(rows.filter((row: any) => !row.is_restricted).reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
      restricted: round2(rows.filter((row: any) => row.is_restricted).reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
    },
  });
});

app.get('/reports/disbursements', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const { from, to } = defaultRange(c.req.query());
  const rows = await disbursementRows(from, to);
  const byCategory: Record<string, any> = {};
  for (const row of rows) {
    byCategory[row.category] ??= { label: row.category_label, total: 0, count: 0 };
    byCategory[row.category].total = round2(byCategory[row.category].total + Number(row.amount));
    byCategory[row.category].count += 1;
  }
  return c.json({
    from,
    to,
    rows,
    totals: {
      count: rows.length,
      total: round2(rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
      by_category: byCategory,
    },
  });
});

app.get('/reports/export', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const type = String(c.req.query('type') ?? 'cash');
  const { from, to } = defaultRange(c.req.query());

  if (type === 'cash') {
    const ledger = await cashLedger(from, to);
    return csvResponse(
      `كشف-حركة-الصندوق-${from}-${to}.csv`,
      ['التاريخ', 'رقم المستند', 'النوع', 'الطرف', 'البيان', 'وارد', 'صادر', 'الرصيد'],
      [
        ['', '', 'رصيد افتتاحي', '', 'الرصيد المرحّل إلى بداية الفترة', '', '', ledger.opening_balance],
        ...ledger.movements.map((movement: any) => [
          movement.date,
          movement.reference,
          movement.kind === 'receipt' ? 'قبض' : 'صرف',
          movement.party,
          movement.description,
          movement.credit || '',
          movement.debit || '',
          movement.balance,
        ]),
        ['', '', 'الإجمالي', '', `من ${from} إلى ${to}`, ledger.total_in, ledger.total_out, ledger.closing_balance],
      ]
    );
  }

  if (type === 'arrears') {
    const rows = await arrearsRows();
    return csvResponse(
      'تقرير-المتأخرات.csv',
      ['رقم العضوية', 'العضو', 'الهاتف', 'الحالة', 'إجمالي المستحق', 'المسدد', 'المتأخرات', 'أشهر مفتوحة', 'أقدم استحقاق'],
      rows.map((row: any) => [
        row.member_no, row.full_name, row.phone ?? '', row.active ? 'نشط' : 'موقوف',
        row.accrued, row.paid, row.arrears, row.open_months, row.oldest_due ?? '',
      ])
    );
  }

  if (type === 'donations') {
    const rows = await donationRows(from, to);
    return csvResponse(
      `تقرير-التبرعات-${from}-${to}.csv`,
      ['التاريخ', 'رقم السند', 'المتبرع', 'المبلغ', 'مخصص', 'الغرض', 'طريقة الدفع', 'ملاحظات'],
      rows.map((row: any) => [
        row.receipt_date, `REC-${String(row.receipt_no).padStart(4, '0')}`, row.donor_name, row.amount,
        row.is_restricted ? 'نعم' : 'لا', row.restricted_purpose ?? '',
        row.payment_method === 'cash' ? 'نقداً' : 'حوالة بنكية', row.notes ?? '',
      ])
    );
  }

  if (type === 'disbursements') {
    const rows = await disbursementRows(from, to);
    return csvResponse(
      `تقرير-المصروفات-${from}-${to}.csv`,
      ['تاريخ الصرف', 'سند الصرف', 'رقم الطلب', 'الفئة', 'المستفيد', 'المبلغ', 'المعتمدان', 'البيان'],
      rows.map((row: any) => [
        row.disbursed_date, row.payment_voucher_no ?? '', `EXP-${String(row.request_no).padStart(4, '0')}`,
        row.category_label, row.beneficiary_name, row.amount, row.approvers ?? '', row.description,
      ])
    );
  }

  if (type === 'subscriptions') {
    const month = `${from.slice(0, 7)}-01`;
    const rows = await sql`select s.*, m.full_name, m.member_no, (s.amount - s.paid_amount) as remaining
      from fund_subscriptions s join fund_members m on m.id = s.member_id
      where s.due_month = ${month} order by m.member_no`;
    return csvResponse(
      `تقرير-الاستحقاقات-${monthLabel(month)}.csv`,
      ['رقم العضوية', 'العضو', 'الشهر', 'المستحق', 'المسدد', 'المتبقي', 'الحالة'],
      rows.map((row: any) => [
        row.member_no, row.full_name, row.due_month, row.amount, row.paid_amount, row.remaining,
        row.status === 'paid' ? 'مسدد' : row.status === 'partial' ? 'سداد جزئي' : 'غير مسدد',
      ])
    );
  }

  throw new HttpError(400, 'نوع التقرير غير معروف');
});

/* --------------------------------- Admin ----------------------------------- */

function protocolSettings(settings: any) {
  return {
    ...settings,
    logo_file: settings.logo_url,
    logo_url: settings.logo_url
      ? `${SUPABASE_URL}/functions/v1/api/logo?forceFunctionRegion=ap-southeast-2&v=${encodeURIComponent(settings.updated_at)}`
      : null,
    allow_self_approval_demo: Boolean(settings.allow_self_approval_demo),
    allow_signups: Boolean(settings.allow_signups),
  };
}

app.get('/users', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const users = await sql`select p.*, u.email,
      u.created_at as account_created_at,
      m.full_name as linked_member_name, m.member_no as linked_member_no
    from fund_user_profiles p
    join auth.users u on u.id = p.user_id
    left join fund_members m on m.id = p.linked_member_id
    order by case p.role when 'admin' then 0 when 'treasurer' then 1 when 'accountant' then 2 when 'board_member' then 3 else 4 end,
             p.created_at asc`;
  const members = await sql`select id, member_no, full_name from fund_members where active = true order by member_no asc`;
  return c.json({
    users: users.map((row: any) => ({
      ...row,
      id: row.user_id,
      active: Boolean(row.active),
      role_label: ROLE_LABELS[row.role],
    })),
    members,
    roles: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
  });
});

app.post('/users', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const body = await c.req.json();
  const fullName = str(body?.full_name, { name: 'الاسم الكامل', required: true, min: 3, max: 120 });
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new HttpError(400, 'البريد الإلكتروني غير صالح');
  }
  const password = String(body?.password ?? '');
  if (password.length < 8) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  const role = oneOf(body?.role ?? 'member', ROLES, { name: 'الدور' });
  const phone = str(body?.phone, { name: 'رقم الهاتف', max: 30 });
  const linkedMemberId = str(body?.linked_member_id, { name: 'العضو المرتبط', max: 60 });
  if (linkedMemberId && !(await sql`select 1 from fund_members where id = ${linkedMemberId}`).length) {
    throw new HttpError(400, 'العضو المرتبط غير موجود');
  }

  const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    }),
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok) {
    if (create.status === 422 || String(created?.msg ?? created?.message ?? '').toLowerCase().includes('already')) {
      throw new HttpError(409, 'يوجد حساب مسجل بهذا البريد الإلكتروني');
    }
    console.error('auth create user failed', create.status, created);
    throw new HttpError(500, 'تعذر إنشاء حساب المستخدم');
  }
  const userId = created.id ?? created.user?.id;
  if (!userId) throw new HttpError(500, 'تعذر إنشاء حساب المستخدم');

  await sql.begin(async (tx) => {
    const profile = await tx`select 1 from fund_user_profiles where user_id = ${userId}`;
    if (profile.length) {
      await tx`update fund_user_profiles set role = ${role}, full_name = ${fullName}, phone = ${phone},
        linked_member_id = ${linkedMemberId}, active = true where user_id = ${userId}`;
    } else {
      await tx`insert into fund_user_profiles (user_id, full_name, email, phone, role, linked_member_id, active)
        values (${userId}, ${fullName}, ${email}, ${phone}, ${role}, ${linkedMemberId}, true)`;
    }
    await audit(tx, user, 'إنشاء حساب مستخدم', 'user', userId,
      `إنشاء حساب ${fullName} (${email}) بدور ${ROLE_LABELS[role]}`);
  });

  return c.json({ ok: true, user_id: userId }, 201);
});

app.patch('/users/:id', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const id = c.req.param('id');
  const rows = await sql`select * from fund_user_profiles where user_id = ${id}`;
  if (!rows.length) throw new HttpError(404, 'المستخدم غير موجود');
  const profile = rows[0];
  const body = await c.req.json();
  const isSelf = profile.user_id === user.id;

  const fullName = body?.full_name === undefined
    ? profile.full_name
    : str(body.full_name, { name: 'الاسم الكامل', required: true, min: 3, max: 120 });
  const role = body?.role === undefined ? profile.role : oneOf(body.role, ROLES, { name: 'الدور' });
  const active = body?.active === undefined ? Boolean(profile.active) : bool(body.active, true);
  const phone = body?.phone === undefined ? profile.phone : str(body.phone, { name: 'رقم الهاتف', max: 30 });
  const linkedMemberId = body?.linked_member_id === undefined
    ? profile.linked_member_id
    : str(body.linked_member_id, { name: 'العضو المرتبط', max: 60 });

  if (linkedMemberId && !(await sql`select 1 from fund_members where id = ${linkedMemberId}`).length) {
    throw new HttpError(400, 'العضو المرتبط غير موجود');
  }
  if (isSelf && (!active || role !== 'admin')) {
    throw new HttpError(400, 'لا يمكنك إيقاف حسابك أو إزالة صلاحية مدير النظام عن نفسك');
  }
  if (profile.role === 'admin' && (role !== 'admin' || !active)) {
    const remaining = Number((await sql`select count(*) as c from fund_user_profiles
      where role = 'admin' and active = true and user_id <> ${profile.user_id}`)[0].c);
    if (remaining === 0) throw new HttpError(409, 'يجب أن يبقى مدير نظام واحد نشط على الأقل');
  }

  await sql.begin(async (tx) => {
    await tx`update fund_user_profiles set full_name = ${fullName}, role = ${role}, active = ${active},
      phone = ${phone}, linked_member_id = ${linkedMemberId} where user_id = ${profile.user_id}`;
    await audit(tx, user, 'تعديل حساب مستخدم', 'user', profile.user_id,
      `تحديث المستخدم ${fullName} — الدور: ${ROLE_LABELS[role]} — الحالة: ${active ? 'نشط' : 'موقوف'}`);
  });

  return c.json({ ok: true });
});

app.patch('/users/:id/password', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const id = c.req.param('id');
  const rows = await sql`select * from fund_user_profiles where user_id = ${id}`;
  if (!rows.length) throw new HttpError(404, 'المستخدم غير موجود');
  const body = await c.req.json();
  const password = String(body?.new_password ?? '');
  if (password.length < 8) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');

  const update = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  if (!update.ok) throw new HttpError(500, 'تعذر تحديث كلمة المرور');
  await audit(sql, user, 'إعادة تعيين كلمة مرور', 'user', id,
    `إعادة تعيين كلمة مرور المستخدم ${rows[0].full_name}`);
  return c.json({ ok: true });
});

app.get('/settings', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  return c.json({ settings: protocolSettings(await getSettings()) });
});

app.patch('/settings', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const current = await getSettings();
  const body = await c.req.json();
  const fundName = str(body?.fund_name ?? current.fund_name, { name: 'اسم الصندوق', required: true, min: 5, max: 200 });
  if (!fundName.includes('صندوق') || fundName.includes('مؤسسة')) {
    throw new HttpError(400, 'يجب أن يبدأ الاسم الرسمي للصندوق بكلمة «صندوق»');
  }
  const defaultFee = body?.default_monthly_fee === undefined
    ? Number(current.default_monthly_fee)
    : amount(body.default_monthly_fee, { name: 'الاشتراك الشهري الافتراضي', min: 0 });
  const currency = str(body?.currency ?? current.currency, { name: 'العملة', required: true, max: 40 });
  let openingBalance = Number(current.opening_balance);
  if (body?.opening_balance !== undefined) {
    openingBalance = Number(body.opening_balance);
    if (!Number.isFinite(openingBalance) || Math.abs(openingBalance) > 1_000_000_000_000) {
      throw new HttpError(400, 'الرصيد الافتتاحي غير صالح');
    }
    openingBalance = round2(openingBalance);
  }
  const selfApproval = body?.allow_self_approval_demo === undefined
    ? Boolean(current.allow_self_approval_demo)
    : bool(body.allow_self_approval_demo, false);
  const allowSignups = body?.allow_signups === undefined
    ? Boolean(current.allow_signups)
    : bool(body.allow_signups, true);

  let logoFile = current.logo_url;
  if (body?.logo_file === null || body?.logo_file === '') {
    logoFile = null;
  } else if (body?.logo_file !== undefined) {
    logoFile = validFileName(body.logo_file);
    if (logoFile && !/\.(png|jpg|jpeg|webp)$/i.test(logoFile)) {
      throw new HttpError(400, 'صيغة شعار الصندوق غير مدعومة');
    }
  }

  await sql.begin(async (tx) => {
    await tx`update fund_settings set fund_name = ${fundName}, logo_url = ${logoFile},
      default_monthly_fee = ${defaultFee}, currency = ${currency}, opening_balance = ${openingBalance},
      allow_self_approval_demo = ${selfApproval}, allow_signups = ${allowSignups}, updated_at = now()
      where id = 'fund'`;
    await audit(tx, user, 'تحديث إعدادات الصندوق', 'settings', 'fund',
      `الاسم: ${fundName} — الاشتراك: ${defaultFee} — الرصيد الافتتاحي: ${openingBalance} — ${selfApproval ? 'تفعيل' : 'تعطيل'} تجاوز اعتماد المنشئ`);
  });

  return c.json({ settings: protocolSettings(await getSettings()) });
});

app.get('/audit', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'board_member');
  const { page, pageSize, offset } = pageParams(c.req.query());
  const conditions: string[] = [];
  const params: any[] = [];
  const from = c.req.query('from');
  const to = c.req.query('to');
  const entityType = c.req.query('entity_type');
  const search = String(c.req.query('search') ?? '').trim();

  if (from) {
    params.push(`${String(from).slice(0, 10)}T00:00:00`);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(`${String(to).slice(0, 10)}T23:59:59.999`);
    conditions.push(`created_at <= $${params.length}`);
  }
  if (entityType) {
    params.push(String(entityType));
    conditions.push(`entity_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(`(action ilike $${n} or details ilike $${n} or actor_name ilike $${n} or entity_id ilike $${n})`);
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const total = Number((await sql.unsafe(`select count(*) as c from fund_audit_logs ${where}`, params))[0].c);
  const rows = await sql.unsafe(
    `select * from fund_audit_logs ${where} order by created_at desc limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  const entityTypes = (await sql`select distinct entity_type from fund_audit_logs order by entity_type`)
    .map((row: any) => row.entity_type);
  return c.json({ logs: rows, total, page, pageSize, entity_types: entityTypes });
});

/* --------------------------------- Uploads --------------------------------- */

app.post('/uploads', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin', 'accountant', 'treasurer', 'board_member');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'لم يتم اختيار ملف');
  return c.json(await uploadToStorage(file, 'document'), 201);
});

app.post('/uploads/logo', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'لم يتم اختيار ملف الشعار');
  return c.json(await uploadToStorage(file, 'logo'), 201);
});

/* ------------------------------- Notifications ----------------------------- */

app.get('/notifications', async (c) => {
  const user = await requireUser(c);
  const unread = c.req.query('unread') === '1';
  const rows = unread
    ? await sql`select * from fund_notifications where user_id = ${user.id} and read_at is null order by created_at desc limit 50`
    : await sql`select * from fund_notifications where user_id = ${user.id} order by created_at desc limit 50`;
  const unreadCount = Number((await sql`select count(*) as c from fund_notifications
    where user_id = ${user.id} and read_at is null`)[0].c);
  return c.json({ notifications: rows, unread: unreadCount });
});

app.post('/notifications/:id/read', async (c) => {
  const user = await requireUser(c);
  await sql`update fund_notifications set read_at = now() where id = ${c.req.param('id')} and user_id = ${user.id}`;
  return c.json({ ok: true });
});

app.post('/notifications/read-all', async (c) => {
  const user = await requireUser(c);
  await sql`update fund_notifications set read_at = now() where user_id = ${user.id} and read_at is null`;
  return c.json({ ok: true });
});

/* --------------------------------- Backups --------------------------------- */

async function uploadBackupObject(path: string, bytes: Uint8Array) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BACKUP_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!response.ok) {
    console.error('backup upload failed', response.status, await response.text());
    throw new HttpError(500, 'تعذر رفع النسخة الاحتياطية إلى التخزين');
  }
}

async function backupDownloadUrl(storagePath: string) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${BACKUP_BUCKET}/${encodeURIComponent(storagePath)}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.signedURL) {
    console.error('backup sign failed', response.status, data);
    throw new HttpError(500, 'تعذر إنشاء رابط تنزيل النسخة الاحتياطية');
  }
  const separator = data.signedURL.includes('?') ? '&' : '?';
  return `${SUPABASE_URL}/storage/v1${data.signedURL}${separator}download=${encodeURIComponent(storagePath)}`;
}

app.get('/backups', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const rows = await sql`select id, filename, storage_path, size_bytes, counts, created_by, created_at
    from fund_backups order by created_at desc limit 50`;
  return c.json({ backups: rows, retention: BACKUP_RETENTION });
});

app.post('/backup', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');

  // Read every financial table inside one transaction so the snapshot is
  // internally consistent (no receipt without its subscription, etc.).
  const data: Record<string, any[]> = {};
  await sql.begin(async (tx) => {
    for (const table of BACKUP_TABLES) {
      data[table] = await tx`select * from ${tx(table)}`;
    }
  });

  const counts = Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length]));
  const generatedAt = new Date();
  const stamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '-');
  const filename = `banan-backup-${stamp}.json`;
  const payload = {
    format: 'banan-fund-backup',
    version: 1,
    generated_at: generatedAt.toISOString(),
    generated_by: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
    counts,
    data,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  await uploadBackupObject(filename, bytes);

  const inserted = await sql`insert into fund_backups
      (filename, storage_path, size_bytes, counts, created_by)
    values (${filename}, ${filename}, ${bytes.byteLength}, ${sql.json(counts)}, ${user.id})
    returning *`;
  const backup = inserted[0];

  // Keep only the newest copies. Retention failures must not invalidate the
  // backup that was just created successfully.
  try {
    const stale = await sql`select id, storage_path from fund_backups
      order by created_at desc offset ${BACKUP_RETENTION}`;
    if (stale.length) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BACKUP_BUCKET}`, {
        method: 'DELETE',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: stale.map((row: any) => row.storage_path) }),
      });
      await sql`delete from fund_backups where id in ${sql(stale.map((row: any) => row.id))}`;
    }
  } catch (error) {
    console.error('backup retention failed', error);
  }

  await audit(
    sql,
    user,
    'إنشاء نسخة احتياطية',
    'backup',
    backup.id,
    `نسخة ${filename} بحجم ${bytes.byteLength} بايت`
  );

  return c.json({ backup, url: await backupDownloadUrl(filename) }, 201);
});

app.get('/backups/:id', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const rows = await sql`select * from fund_backups where id = ${c.req.param('id')}`;
  if (!rows.length) throw new HttpError(404, 'النسخة الاحتياطية غير موجودة');
  return c.json({
    backup: rows[0],
    url: await backupDownloadUrl(rows[0].storage_path),
  });
});

app.delete('/backups/:id', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'admin');
  const rows = await sql`select * from fund_backups where id = ${c.req.param('id')}`;
  if (!rows.length) throw new HttpError(404, 'النسخة الاحتياطية غير موجودة');
  const backup = rows[0];
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BACKUP_BUCKET}/${backup.storage_path}`,
    {
      method: 'DELETE',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    }
  );
  if (!response.ok && response.status !== 404) {
    console.error('backup delete failed', response.status, await response.text());
    throw new HttpError(500, 'تعذر حذف ملف النسخة الاحتياطية');
  }
  await sql`delete from fund_backups where id = ${backup.id}`;
  await audit(
    sql,
    user,
    'حذف نسخة احتياطية',
    'backup',
    backup.id,
    `حذف النسخة ${backup.filename}`
  );
  return c.json({ ok: true });
});

/* --------------------------------- Errors ---------------------------------- */

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  console.error('api error', error);
  return c.json({ error: 'حدث خطأ غير متوقع في الخادم. يرجى المحاولة مرة أخرى' }, 500);
});

app.notFound((c) => c.json({ error: 'المسار المطلوب غير موجود' }, 404));

Deno.serve(app.fetch);
