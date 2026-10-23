/**
 * Seeds the Supabase project with the demo dataset used by the app.
 *
 * Reads the project URL + keys from SUPABASE_KEYS.txt (gitignored).
 * Safe to run once on an empty project. If members already exist it stops.
 *
 * Usage: node scripts/seed-supabase.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const base = 'C:/Users/Elite/Desktop/بنيان';
const keysRaw = fs.readFileSync(`${base}/SUPABASE_KEYS.txt`, 'utf8');

const url = keysRaw.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
if (!url) throw new Error('PROJECT_URL not found in SUPABASE_KEYS.txt');

const jwts = [...keysRaw.matchAll(/eyJ[A-Za-z0-9_\-.]+/g)].map((m) => m[0]);
const roleOf = (jwt) => {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    return null;
  }
};
const anonKey = jwts.find((j) => roleOf(j) === 'anon');
const serviceKey = jwts.find((j) => roleOf(j) === 'service_role');
if (!anonKey || !serviceKey) throw new Error('anon/service_role keys not found');

const PASSWORD = 'Banan@2026';

async function request(path, { method = 'GET', body, prefer = 'return=representation', key = serviceKey } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

const rest = (table, options) => request(`/rest/v1/${table}`, options);

async function ensureAuthUser(email, fullName, phone) {
  try {
    return await request('/auth/v1/admin/users', {
      method: 'POST',
      body: {
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName, phone },
      },
    });
  } catch (error) {
    if (!String(error.message).includes('422') && !String(error.message).toLowerCase().includes('already')) {
      throw error;
    }
    const list = await request('/auth/v1/admin/users?page=1&per_page=1000');
    const users = Array.isArray(list) ? list : list.users ?? [];
    const found = users.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (!found) throw error;
    return found;
  }
}

async function upsertProfile(user, fields) {
  const updated = await rest(`fund_user_profiles?user_id=eq.${user.id}`, {
    method: 'PATCH',
    body: fields,
  });
  if (Array.isArray(updated) && updated.length > 0) return updated[0];
  const created = await rest('fund_user_profiles', {
    method: 'POST',
    body: {
      user_id: user.id,
      email: user.email,
      full_name: fields.full_name ?? user.email,
      role: fields.role ?? 'member',
      active: true,
      ...fields,
    },
  });
  return created[0];
}

const existingMembers = await rest('fund_members?select=id&limit=1');
if (Array.isArray(existingMembers) && existingMembers.length > 0) {
  console.log('Database already contains members. Seed skipped.');
  process.exit(0);
}

/* ------------------------------- members ------------------------------- */
const memberSeeds = [
  ['محمد علي صالح الحكيمي', '771234501', 'الغدير - مقبنة - تعز', '2024-02-01'],
  ['عبدالله أحمد قاسم الشرعبي', '771234502', 'الغدير - مقبنة - تعز', '2024-02-01'],
  ['فاطمة عبده سعيد المقطري', '771234503', 'المقبنة - تعز', '2024-03-12'],
  ['صالح محمد عبدالله الحاج', '771234504', 'الغدير - مقبنة', '2024-03-20'],
  ['أسماء علي محسن الشامي', '771234505', 'المقبنة - تعز', '2024-04-05'],
  ['خالد عبدالرحمن سعيد الجابري', '771234506', 'الغدير - مقبنة', '2024-05-15'],
  ['نادية محمد أحمد القباطي', '771234507', 'المقبنة - تعز', '2024-06-01'],
  ['عبدالملك قاسم علي الصبري', '771234508', 'الغدير - مقبنة', '2024-07-10'],
  ['هدى يحيى عبدالله العزي', '771234509', 'المقبنة - تعز', '2024-08-18'],
  ['أحمد سعيد محمد المخلافي', '771234510', 'الغدير - مقبنة - تعز', '2024-09-02'],
  ['سعاد علي عبدالله الحبيشي', '771234511', 'المقبنة - تعز', '2024-10-11'],
  ['عمار عبدالوهاب محمد الشميري', '771234512', 'الغدير - مقبنة', '2024-11-01'],
  ['ليلى حسن أحمد العمري', '771234513', 'المقبنة - تعز', '2025-01-06'],
  ['يوسف محمد عبدالله الأهدل', '771234514', 'الغدير - مقبنة', '2025-02-14'],
];

const members = [];
for (let i = 0; i < memberSeeds.length; i += 1) {
  const [name, phone, address, joined] = memberSeeds[i];
  const id = crypto.randomUUID();
  await rest('fund_members', {
    method: 'POST',
    body: {
      id,
      member_no: `M-${String(i + 1).padStart(3, '0')}`,
      full_name: name,
      phone,
      address,
      monthly_fee: 1000,
      joined_on: joined,
      active: true,
      notes: i === 5 ? 'عضو مجلس الإدارة السابق' : null,
    },
  });
  members.push({ id, name, phone });
}
console.log(`Members: ${members.length}`);

/* -------------------------------- users -------------------------------- */
const admin = await ensureAuthUser('admin@banan.org', 'مدير صندوق بنان الخير للبنيان', '770000001');
const accountant = await ensureAuthUser('accountant@banan.org', 'محاسب الصندوق', '770000002');
const treasurer = await ensureAuthUser('treasurer@banan.org', 'أمين الصندوق', '770000003');
const board = await ensureAuthUser('board@banan.org', 'عضو مجلس الإدارة', '770000004');
const memberUser = await ensureAuthUser('member@banan.org', 'عضو تجريبي', '771234501');

await upsertProfile(admin, {
  full_name: 'مدير صندوق بنان الخير للبنيان',
  role: 'admin',
  phone: '770000001',
  active: true,
});
await upsertProfile(accountant, { full_name: 'محاسب الصندوق', role: 'accountant', phone: '770000002', active: true });
await upsertProfile(treasurer, { full_name: 'أمين الصندوق', role: 'treasurer', phone: '770000003', active: true });
await upsertProfile(board, { full_name: 'عضو مجلس الإدارة', role: 'board_member', phone: '770000004', active: true });
await upsertProfile(memberUser, {
  full_name: 'عضو تجريبي',
  role: 'member',
  phone: '771234501',
  active: true,
  linked_member_id: members[0].id,
});
console.log('Users: 5');

/* --------------------------- monthly dues ------------------------------ */
const months = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
const today = '2026-10-23';
let receiptNo = 0;

for (let mi = 0; mi < months.length; mi += 1) {
  for (let i = 0; i < members.length; i += 1) {
    let paid = 1000;
    if (mi === 0) {
      if (i % 9 === 5) paid = 0;
    } else if (mi === 1) {
      if (i === 3) paid = 400;
      else if (i % 11 === 7) paid = 0;
    } else if (mi === 2) {
      if (i % 4 === 0) paid = 1000;
      else if (i % 4 === 1) paid = 500;
      else paid = 0;
    } else if (i % 5 === 0) {
      paid = 1000;
    } else if (i % 5 === 1) {
      paid = 300;
    } else {
      paid = 0;
    }

    const status = paid >= 1000 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    const subscriptionId = crypto.randomUUID();
    await rest('fund_subscriptions', {
      method: 'POST',
      body: {
        id: subscriptionId,
        member_id: members[i].id,
        due_month: months[mi],
        amount: 1000,
        paid_amount: paid,
        status,
      },
    });

    if (paid > 0) {
      receiptNo += 1;
      const day = Math.min(4 + (i % 18), 28);
      let receiptDate = `${months[mi].slice(0, 7)}-${String(day).padStart(2, '0')}`;
      if (receiptDate > today) receiptDate = today;
      await rest('fund_receipts', {
        method: 'POST',
        body: {
          id: crypto.randomUUID(),
          receipt_no: receiptNo,
          receipt_type: 'subscription',
          member_id: members[i].id,
          subscription_id: subscriptionId,
          donor_name: members[i].name,
          amount: paid,
          payment_method: i % 3 === 0 ? 'bank_transfer' : 'cash',
          is_restricted: false,
          restricted_purpose: null,
          receipt_date: receiptDate,
          notes: paid < 1000 ? 'سداد جزئي لاشتراك شهري' : 'سداد اشتراك شهري',
          created_by: accountant.id,
        },
      });
    }
  }
}
console.log(`Subscriptions: ${months.length * members.length}, receipts so far: ${receiptNo}`);

/* ------------------------------ donations ------------------------------ */
const donations = [
  ['فاعل خير من أبناء الغدير', 50000, false, null, '2026-08-12', 'cash', 'دعم عام لأنشطة الصندوق'],
  ['أسرة آل الشرعبي', 25000, false, null, '2026-09-03', 'bank_transfer', 'دعم عام'],
  ['أحد المحسنين', 30000, false, null, '2026-10-02', 'cash', 'دعم عام لأنشطة الصندوق'],
  ['محسن (كفالة يتيم)', 40000, true, 'كفالة يتيم – تعليم ومصاريف دراسية', '2026-09-18', 'bank_transfer', 'تبرع مخصص – لا يخلط مع النقد العام'],
  ['متبرع من المغتربين', 30000, true, 'سلال غذائية للأسر الأشد فقراً', '2026-10-09', 'cash', 'تبرع مخصص'],
];

for (let i = 0; i < donations.length; i += 1) {
  const [donor, amount, restricted, purpose, date, method, notes] = donations[i];
  receiptNo += 1;
  await rest('fund_receipts', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      receipt_no: receiptNo,
      receipt_type: 'donation',
      member_id: null,
      subscription_id: null,
      donor_name: donor,
      amount,
      payment_method: method,
      is_restricted: restricted,
      restricted_purpose: purpose,
      receipt_date: date,
      notes,
      created_by: i % 2 === 0 ? accountant.id : treasurer.id,
    },
  });
}
console.log(`Receipts total: ${receiptNo}`);

/* ------------------------------ expenses ------------------------------- */
const approvers = {
  admin: { id: admin.id, name: 'مدير صندوق بنان الخير للبنيان', role: 'admin' },
  accountant: { id: accountant.id, name: 'محاسب الصندوق', role: 'accountant' },
  treasurer: { id: treasurer.id, name: 'أمين الصندوق', role: 'treasurer' },
  board: { id: board.id, name: 'عضو مجلس الإدارة', role: 'board_member' },
};

const expenseSeeds = [
  {
    category: 'social_aid',
    beneficiary: 'أسرة متعففة – الغدير',
    phone: '773110001',
    description: 'مساعدة اجتماعية عاجلة لأسرة متعففة لشراء احتياجات أساسية',
    amount: 25000,
    requestedDate: '2026-09-05',
    status: 'paid',
    createdBy: 'accountant',
    approvals: [
      { key: 'treasurer', decision: 'approved', date: '2026-09-06' },
      { key: 'board', decision: 'approved', date: '2026-09-07' },
    ],
    voucher: 'PV-0001',
    disbursedBy: 'treasurer',
    disbursedAt: '2026-09-07T09:30:00.000Z',
  },
  {
    category: 'medical_aid',
    beneficiary: 'مريض – مقبنة',
    phone: '773110002',
    description: 'مساعدة في تكاليف علاج ومستلزمات طبية لمريض من أبناء المنطقة',
    amount: 40000,
    requestedDate: '2026-09-13',
    status: 'paid',
    createdBy: 'accountant',
    approvals: [
      { key: 'admin', decision: 'approved', date: '2026-09-14' },
      { key: 'board', decision: 'approved', date: '2026-09-15' },
    ],
    voucher: 'PV-0002',
    disbursedBy: 'admin',
    disbursedAt: '2026-09-17T11:15:00.000Z',
  },
  {
    category: 'operational',
    beneficiary: 'مكتب الصندوق – المقبنة',
    phone: '773110003',
    description: 'مصاريف تشغيلية وقرطاسية وطباعة مستندات الصندوق',
    amount: 12000,
    requestedDate: '2026-10-03',
    status: 'paid',
    createdBy: 'board',
    approvals: [
      { key: 'admin', decision: 'approved', date: '2026-10-03' },
      { key: 'treasurer', decision: 'approved', date: '2026-10-04' },
    ],
    voucher: 'PV-0003',
    disbursedBy: 'treasurer',
    disbursedAt: '2026-10-04T10:00:00.000Z',
  },
  {
    category: 'charitable_aid',
    beneficiary: 'أسرة محتاجة – المقبنة',
    phone: '773110004',
    description: 'مساعدات غذائية عاجلة لأسرة محتاجة خلال الشهر الحالي',
    amount: 30000,
    requestedDate: '2026-10-06',
    status: 'approved',
    createdBy: 'accountant',
    approvals: [
      { key: 'admin', decision: 'approved', date: '2026-10-07' },
      { key: 'board', decision: 'approved', date: '2026-10-08' },
    ],
    voucher: null,
    disbursedBy: null,
    disbursedAt: null,
  },
  {
    category: 'emergency_aid',
    beneficiary: 'حالة إنسانية – الغدير',
    phone: '773110005',
    description: 'مساعدة إنسانية عاجلة لأسرة تضررت من ظروف معيشية قاسية',
    amount: 15000,
    requestedDate: '2026-10-08',
    status: 'pending',
    createdBy: 'accountant',
    approvals: [{ key: 'treasurer', decision: 'approved', date: '2026-10-09' }],
    voucher: null,
    disbursedBy: null,
    disbursedAt: null,
  },
  {
    category: 'social_aid',
    beneficiary: 'أسرة أرملة – مقبنة',
    phone: '773110006',
    description: 'معونة شهرية لأسر الأرامل ضمن برنامج الرعاية الاجتماعية',
    amount: 10000,
    requestedDate: '2026-10-09',
    status: 'pending',
    createdBy: 'board',
    approvals: [],
    voucher: null,
    disbursedBy: null,
    disbursedAt: null,
  },
  {
    category: 'operational',
    beneficiary: 'صيانة معدات – مكتب الصندوق',
    phone: '773110007',
    description: 'صيانة أجهزة المكتب والطابعة',
    amount: 8000,
    requestedDate: '2026-09-21',
    status: 'rejected',
    createdBy: 'accountant',
    approvals: [{ key: 'admin', decision: 'rejected', date: '2026-09-22', notes: 'المبلغ غير متاح في البند التشغيلي' }],
    voucher: null,
    disbursedBy: null,
    disbursedAt: null,
  },
];

let requestNo = 0;
for (const seed of expenseSeeds) {
  requestNo += 1;
  const requestId = crypto.randomUUID();
  const approved = seed.approvals.filter((a) => a.decision === 'approved').length;
  await rest('fund_expense_requests', {
    method: 'POST',
    body: {
      id: requestId,
      request_no: requestNo,
      category: seed.category,
      beneficiary_name: seed.beneficiary,
      beneficiary_phone: seed.phone,
      description: seed.description,
      amount: seed.amount,
      requested_date: seed.requestedDate,
      status: seed.status,
      approval_count: seed.status === 'rejected' ? 0 : approved,
      payment_voucher_no: seed.voucher,
      attachment_url: null,
      notes: null,
      created_by: approvers[seed.createdBy].id,
      disbursed_by: seed.disbursedBy ? approvers[seed.disbursedBy].id : null,
      disbursed_at: seed.disbursedAt,
    },
  });

  for (const approval of seed.approvals) {
    const person = approvers[approval.key];
    await rest('fund_expense_approvals', {
      method: 'POST',
      body: {
        id: crypto.randomUUID(),
        request_id: requestId,
        approver_id: person.id,
        approver_name: person.name,
        approver_role: person.role,
        decision: approval.decision,
        notes: approval.notes ?? (approval.decision === 'approved' ? 'موافق' : null),
        created_at: `${approval.date}T09:30:00.000Z`,
      },
    });
  }
}
console.log(`Expenses: ${expenseSeeds.length}`);

/* ----------------------------- notifications --------------------------- */
const pending = await rest('fund_expense_requests?request_no=eq.5&select=id,beneficiary_name,amount');
const pendingExpense = Array.isArray(pending) ? pending[0] : null;

await rest('fund_notifications', {
  method: 'POST',
  body: {
    user_id: admin.id,
    type: 'welcome',
    title: 'مرحباً بك في صندوق بنان الخير',
    body: 'تم تجهيز النظام بنجاح. يمكنك إدارة الأعضاء والاشتراكات والطلبات من القائمة.',
    link: '/',
  },
});
if (pendingExpense) {
  await rest('fund_notifications', {
    method: 'POST',
    body: {
      user_id: admin.id,
      type: 'expense_pending',
      title: 'طلب صرف بانتظار الاعتماد',
      body: `طلب صرف بمبلغ ${pendingExpense.amount} ر.ي لصالح ${pendingExpense.beneficiary_name}`,
      link: '/expenses',
      entity_type: 'expense_request',
      entity_id: pendingExpense.id,
    },
  });
  await rest('fund_notifications', {
    method: 'POST',
    body: {
      user_id: treasurer.id,
      type: 'expense_pending',
      title: 'طلب صرف بانتظار اعتمادك',
      body: `طلب صرف بمبلغ ${pendingExpense.amount} ر.ي لصالح ${pendingExpense.beneficiary_name}`,
      link: '/expenses',
      entity_type: 'expense_request',
      entity_id: pendingExpense.id,
    },
  });
}

/* -------------------------------- settings ----------------------------- */
await rest('fund_settings?id=eq.fund', {
  method: 'PATCH',
  body: {
    fund_name: 'صندوق بنان الخير للبنيان – الغدير – مقبنة – تعز',
    default_monthly_fee: 1000,
    currency: 'ريال يمني',
    opening_balance: 250000,
    allow_self_approval_demo: false,
    allow_signups: true,
    updated_at: new Date().toISOString(),
  },
});

await rest('sequences?name=eq.receipt', { method: 'PATCH', body: { value: receiptNo } });
await rest('sequences?name=eq.expense_request', { method: 'PATCH', body: { value: requestNo } });
await rest('sequences?name=eq.payment_voucher', { method: 'PATCH', body: { value: 3 } });

/* -------------------------------- audit -------------------------------- */
await rest('fund_audit_logs', {
  method: 'POST',
  body: {
    id: crypto.randomUUID(),
    action: 'تهيئة بيانات تجريبية',
    entity_type: 'system',
    entity_id: 'seed',
    actor_id: admin.id,
    actor_name: 'مدير صندوق بنان الخير للبنيان',
    details: `تهيئة النظام: ${members.length} عضواً، ${months.length} أشهر استحقاقات، 5 تبرعات، 7 طلبات صرف، رصيد افتتاحي 250000 ر.ي`,
  },
});

/* ------------------------------ verification --------------------------- */
const tables = [
  'fund_settings',
  'fund_members',
  'fund_user_profiles',
  'fund_subscriptions',
  'fund_receipts',
  'fund_expense_requests',
  'fund_expense_approvals',
  'fund_notifications',
  'fund_audit_logs',
];
const counts = {};
for (const table of tables) {
  const column = table === 'fund_user_profiles' ? 'user_id' : 'id';
  const rows = await rest(`${table}?select=${column}`);
  counts[table] = Array.isArray(rows) ? rows.length : '?';
}

const receipts = await rest('fund_receipts?select=amount');
const paidExpenses = await rest('fund_expense_requests?status=eq.paid&select=amount');
const subs = await rest('fund_subscriptions?select=amount,paid_amount');
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
const receiptsTotal = sum(receipts, 'amount');
const expensesTotal = sum(paidExpenses, 'amount');
const arrears = subs.reduce((total, row) => total + Number(row.amount) - Number(row.paid_amount), 0);

console.log('\nCounts:', counts);
console.log('Receipts total:', receiptsTotal);
console.log('Paid expenses total:', expensesTotal);
console.log('Cash (opening 250000 + receipts - paid expenses):', 250000 + receiptsTotal - expensesTotal);
console.log('Arrears (accrual, excluded from cash):', arrears);

/* ------------------------------- login test ---------------------------- */
const loginRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@banan.org', password: PASSWORD }),
});
const loginText = await loginRes.text();
console.log('Admin login test:', loginRes.status, loginRes.ok ? 'OK' : loginText.slice(0, 300));
