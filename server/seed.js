/**
 * Seeds a complete demonstration dataset once. Safe to run on an empty database.
 * Credentials are printed to the console and documented in README.md.
 */
import crypto from 'node:crypto';
import { db, withTx, audit, getSettings, nextSequence } from './db.js';
import { hashPassword } from './auth.js';

const existing = db.prepare('SELECT COUNT(*) AS c FROM fund_user_profiles').get().c;
if (existing > 0) {
  console.log('قاعدة البيانات تحتوي على مستخدمين بالفعل — تم إلغاء التهيئة التجريبية.');
  process.exit(0);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = iso(now);
const monthStart = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return iso(d);
};
const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return iso(d);
};
const dateInMonth = (month, day) => {
  const d = new Date(`${month.slice(0, 7)}-${pad(day)}T12:00:00`);
  return iso(d) > today ? today : iso(d);
};

const memberSeeds = [
  ['أحمد علي محمد الصبري', '771234501', 'الغدير - حارة المسجد', '2024-02-01'],
  ['فاطمة عبده سعيد الشميري', '771234502', 'الغدير - السوق القديم', '2024-02-01'],
  ['محمد عبدالله أحمد المقبني', '771234503', 'مقبنة - الحديدة', '2024-03-12'],
  ['سميرة قاسم ناصر الحميري', '771234504', 'الغدير - الجبل', '2024-03-20'],
  ['عبدالكريم صالح محسن', '771234505', 'مقبنة - وادي بنان', '2024-04-05'],
  ['هدى محمد عبدالرحمن', '771234506', 'الغدير - الشعب', '2024-05-15'],
  ['ياسر أحمد قائد', '771234507', 'مقبنة - الجرن', '2024-06-01'],
  ['أمل عبدالوهاب الشاذلي', '771234508', 'الغدير - المدرسة', '2024-07-10'],
  ['صالح علي هزاع', '771234509', 'مقبنة - بني حماد', '2024-08-18'],
  ['نجاة محسن عبدالله', '771234510', 'الغدير - القرية العليا', '2024-09-02'],
  ['عبدالرحمن ناصر علي', '771234511', 'مقبنة - السوق', '2024-10-11'],
  ['ابتسام أحمد صالح', '771234512', 'الغدير - الحوض', '2024-11-01'],
  ['خالد عبدالله منصور', '771234513', 'مقبنة - البيضاء', '2025-01-06'],
  ['نادية عليوة سعيد', '771234514', 'الغدير - دار الصندوق', '2025-02-14'],
];

const password = 'Banan@2026';
const passwordHash = await hashPassword(password);

const ids = {};
const members = [];

withTx(() => {
  /* ------------------------------ members ------------------------------ */
  const insertMember = db.prepare(
    `INSERT INTO fund_members (id, member_no, full_name, phone, address, monthly_fee, joined_on, active, notes)
     VALUES (?, ?, ?, ?, ?, 1000, ?, 1, ?)`
  );
  memberSeeds.forEach(([name, phone, address, joined], index) => {
    const id = crypto.randomUUID();
    members.push({ id, name, no: `M-${String(index + 1).padStart(3, '0')}` });
    insertMember.run(
      id,
      `M-${String(index + 1).padStart(3, '0')}`,
      name,
      phone,
      address,
      joined,
      index === 5 ? 'من الأعضاء المؤسسين للصندوق' : null
    );
  });

  /* ------------------------------- users ------------------------------- */
  const insertUser = db.prepare(
    `INSERT INTO auth_users (id, email, password_hash, full_name, phone) VALUES (?, ?, ?, ?, ?)`
  );
  const users = [
    ['admin', 'admin@banan.org', 'مدير صندوق بنان الخير للبنيان', '770000001', 'admin'],
    ['accountant', 'accountant@banan.org', 'سامي عبدالله الحميري', '770000002', 'accountant'],
    ['treasurer', 'treasurer@banan.org', 'هدى محمد الشميري', '770000003', 'treasurer'],
    ['board', 'board@banan.org', 'عبدالرحمن علي المقبني', '770000004', 'board_member'],
    ['member', 'member@banan.org', 'أحمد علي محمد الصبري', '771234501', 'member'],
  ];
  for (const [key, email, name, phone, role] of users) {
    const id = crypto.randomUUID();
    ids[key] = id;
    insertUser.run(id, email, passwordHash, name, phone);
    if (role !== 'admin') {
      db.prepare('UPDATE fund_user_profiles SET role = ?, linked_member_id = ? WHERE user_id = ?').run(
        role,
        key === 'member' ? members[0].id : null,
        id
      );
    }
  }

  /* --------------------- memberships / monthly dues -------------------- */
  const months = [-3, -2, -1, 0].map(monthStart);
  const dueFees = new Map();
  const insertDue = db.prepare(
    `INSERT INTO fund_subscriptions (id, member_id, due_month, amount, paid_amount, status)
     VALUES (?, ?, ?, 1000, ?, ?)`
  );
  const insertReceipt = db.prepare(
    `INSERT INTO fund_receipts
      (id, receipt_no, receipt_type, member_id, subscription_id, donor_name, amount,
       payment_method, is_restricted, restricted_purpose, receipt_date, notes, created_by)
     VALUES (?, ?, 'subscription', ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`
  );

  months.forEach((month, monthIndex) => {
    members.forEach((member, memberIndex) => {
      let paid = 1000;
      if (monthIndex === 0) {
        if (memberIndex % 9 === 5) paid = 0;
      } else if (monthIndex === 1) {
        if (memberIndex === 3) paid = 400;
        else if (memberIndex % 11 === 7) paid = 0;
      } else if (monthIndex === 2) {
        if (memberIndex % 4 === 0) paid = 1000;
        else if (memberIndex % 4 === 1) paid = 500;
        else paid = 0;
      } else {
        if (memberIndex % 5 === 0) paid = 1000;
        else if (memberIndex % 5 === 1) paid = 300;
        else paid = 0;
      }
      const status = paid >= 1000 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      const dueId = crypto.randomUUID();
      dueFees.set(`${member.id}:${month}`, { id: dueId, paid, status });
      insertDue.run(dueId, member.id, month, paid, status);
      if (paid > 0) {
        const no = nextSequence('receipt');
        insertReceipt.run(
          crypto.randomUUID(),
          no,
          member.id,
          dueId,
          member.name,
          paid,
          memberIndex % 3 === 0 ? 'bank_transfer' : 'cash',
          dateInMonth(month, 4 + (memberIndex % 18)),
          paid < 1000 ? 'سداد جزئي لاستحقاق شهري' : 'سداد اشتراك شهري',
          ids.accountant
        );
      }
    });
  });

  /* --------------------------- donations -------------------------------- */
  const donations = [
    ['فاعل خير من أبناء الغدير', 50000, false, null, monthStart(-2), 12],
    ['أسرة المرحوم عبدالله صالح', 25000, false, null, monthStart(-1), 3],
    ['تجار سوق مقبنة', 30000, false, null, monthStart(0), 2],
    ['متبرع (مخصص للعلاج)', 40000, true, 'مساعدة مرضى الفشل الكلوي', monthStart(-1), 18],
    ['جمعية الخير التعاونية', 30000, true, 'كفالة الأيتام وتوزيع السلال الغذائية', monthStart(0), 9],
  ];
  const insertDonation = db.prepare(
    `INSERT INTO fund_receipts
      (id, receipt_no, receipt_type, donor_name, amount, payment_method, is_restricted,
       restricted_purpose, receipt_date, notes, created_by)
     VALUES (?, ?, 'donation', ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  donations.forEach(([donor, amount, restricted, purpose, month, day], index) => {
    insertDonation.run(
      crypto.randomUUID(),
      nextSequence('receipt'),
      donor,
      amount,
      index % 2 === 0 ? 'cash' : 'bank_transfer',
      restricted ? 1 : 0,
      purpose,
      dateInMonth(month, day),
      restricted ? 'تبرع مخصص — لا يجوز صرفه في غير الغرض المحدد' : 'تبرع عام لدعم أنشطة الصندوق',
      index % 2 === 0 ? ids.accountant : ids.treasurer
    );
  });

  /* --------------------------- expenses --------------------------------- */
  const insertExpense = db.prepare(
    `INSERT INTO fund_expense_requests
      (id, request_no, category, beneficiary_name, beneficiary_phone, description, amount,
       requested_date, status, approval_count, payment_voucher_no, notes, created_by,
       disbursed_by, disbursed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertApproval = db.prepare(
    `INSERT INTO fund_expense_approvals
      (id, request_id, approver_id, approver_name, approver_role, decision, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const approvers = {
    admin: { id: ids.admin, name: 'مدير صندوق بنان الخير للبنيان', role: 'admin' },
    treasurer: { id: ids.treasurer, name: 'هدى محمد الشميري', role: 'treasurer' },
    board: { id: ids.board, name: 'عبدالرحمن علي المقبني', role: 'board_member' },
  };

  const expenseSeeds = [
    {
      category: 'social_aid',
      beneficiary: 'أسرة أحمد عبده الشرعبي',
      phone: '773110001',
      description: 'مساعدة اجتماعية عاجلة لأسرة متعففة لديها خمسة أيتام',
      amount: 25000,
      requestedDate: addDays(monthStart(-1), 4),
      status: 'paid',
      approvers: ['treasurer', 'board'],
      disburseBy: 'treasurer',
      createdBy: 'accountant',
      voucher: 'PV-0001',
      disbursedAt: `${addDays(monthStart(-1), 6)}T09:30:00.000Z`,
    },
    {
      category: 'medical_aid',
      beneficiary: 'سعاد محمد قاسم',
      phone: '773110002',
      description: 'دعم تكاليف عملية قلب مفتوح في مستشفى الثورة - تعز',
      amount: 40000,
      requestedDate: addDays(monthStart(-1), 12),
      status: 'paid',
      approvers: ['admin', 'board'],
      disburseBy: 'admin',
      createdBy: 'accountant',
      voucher: 'PV-0002',
      disbursedAt: `${addDays(monthStart(-1), 16)}T11:15:00.000Z`,
    },
    {
      category: 'operational',
      beneficiary: 'مكتبة الأمل - الغدير',
      phone: '773110003',
      description: 'مستلزمات مكتبية وقرطاسية لتسيير أعمال الصندوق الشهرية',
      amount: 12000,
      requestedDate: addDays(monthStart(0), 2),
      status: 'paid',
      approvers: ['treasurer', 'board'],
      disburseBy: 'treasurer',
      createdBy: 'board',
      voucher: 'PV-0003',
      disbursedAt: `${addDays(monthStart(0), 3)}T10:00:00.000Z`,
    },
    {
      category: 'charitable_aid',
      beneficiary: 'جمعية رعاية الأيتام - مقبنة',
      phone: '773110004',
      description: 'دعم كفالة عشرين يتيماً ضمن برنامج الكفالة الشهري',
      amount: 30000,
      requestedDate: addDays(monthStart(0), 5),
      status: 'approved',
      approvers: ['admin', 'board'],
      disburseBy: null,
      createdBy: 'accountant',
      voucher: null,
      disbursedAt: null,
    },
    {
      category: 'emergency_aid',
      beneficiary: 'عبدالله ناجي الصلاحي',
      phone: '773110005',
      description: 'مساعدات طارئة لأسرة تضررت من انهيار جزئي لمنزلها بسبب الأمطار',
      amount: 15000,
      requestedDate: addDays(monthStart(0), 7),
      status: 'pending',
      approvers: ['treasurer'],
      disburseBy: null,
      createdBy: 'accountant',
      voucher: null,
      disbursedAt: null,
    },
    {
      category: 'social_aid',
      beneficiary: 'مريم عبدالرحيم الحكيمي',
      phone: '773110006',
      description: 'مساعدة شهرية لأرملة لديها ثلاثة أطفال في سن الدراسة',
      amount: 10000,
      requestedDate: addDays(monthStart(0), 8),
      status: 'pending',
      approvers: [],
      disburseBy: null,
      createdBy: 'board',
      voucher: null,
      disbursedAt: null,
    },
    {
      category: 'operational',
      beneficiary: 'شركة الكهرباء - فرع تعز',
      phone: '773110007',
      description: 'سداد فاتورة كهرباء مقر الصندوق',
      amount: 8000,
      requestedDate: addDays(monthStart(-1), 20),
      status: 'rejected',
      approvers: [],
      rejectedBy: 'admin',
      disburseBy: null,
      createdBy: 'accountant',
      voucher: null,
      disbursedAt: null,
    },
  ];

  expenseSeeds.forEach((seed, index) => {
    const requestId = crypto.randomUUID();
    const requestNo = nextSequence('expense_request');
    const approvalCount = seed.approvers.length;
    insertExpense.run(
      requestId,
      requestNo,
      seed.category,
      seed.beneficiary,
      seed.phone,
      seed.description,
      seed.amount,
      seed.requestedDate,
      seed.status,
      approvalCount,
      seed.voucher,
      null,
      ids[seed.createdBy],
      seed.disburseBy ? ids[seed.disburseBy] : null,
      seed.disbursedAt
    );
    seed.approvers.forEach((key, approverIndex) => {
      const approver = approvers[key];
      insertApproval.run(
        crypto.randomUUID(),
        requestId,
        approver.id,
        approver.name,
        approver.role,
        'approved',
        approverIndex === 0 ? 'تم التحقق من المستندات والحالة' : 'موافق بعد المراجعة',
        `${addDays(seed.requestedDate, approverIndex + 1)}T0${8 + approverIndex}:30:00.000Z`
      );
    });
    if (seed.rejectedBy) {
      const approver = approvers[seed.rejectedBy];
      insertApproval.run(
        crypto.randomUUID(),
        requestId,
        approver.id,
        approver.name,
        approver.role,
        'rejected',
        'مصروف تشغيلي غير ضروري حالياً',
        `${addDays(seed.requestedDate, 1)}T09:00:00.000Z`
      );
    }
    audit({
      action: seed.status === 'paid' ? 'صرف مبلغ وإصدار سند صرف' : 'إنشاء طلب صرف',
      entityType: 'expense_request',
      entityId: requestId,
      actor: { id: ids[seed.createdBy], full_name: users.find((u) => u[0] === seed.createdBy)?.[2] },
      details: `${seed.voucher ?? `EXP-${String(requestNo).padStart(4, '0')}`} — ${seed.beneficiary} — ${seed.amount} ر.ي`,
    });
  });

  db.prepare(
    `UPDATE sequences
        SET value = COALESCE((SELECT MAX(CAST(SUBSTR(payment_voucher_no, 4) AS INTEGER))
                                FROM fund_expense_requests
                               WHERE payment_voucher_no LIKE 'PV-%'), 0)
      WHERE name = 'payment_voucher'`
  ).run();

  /* ----------------------------- audit seed ----------------------------- */
  audit({
    action: 'تهيئة النظام التجريبية',
    entityType: 'system',
    entityId: 'seed',
    actor: { id: ids.admin, full_name: 'مدير صندوق بنان الخير للبنيان' },
    details: `تهيئة بيانات تجريبية: ${members.length} عضواً، ${months.length} أشهر استحقاقات، صندوق برصيد افتتاحي ${getSettings().opening_balance} ر.ي`,
  });
});

console.log('\nتمت تهيئة قاعدة البيانات التجريبية بنجاح.\n');
console.log('حسابات الدخول:');
console.log('  مدير النظام      admin@banan.org       / Banan@2026');
console.log('  محاسب            accountant@banan.org  / Banan@2026');
console.log('  أمين الصندوق     treasurer@banan.org   / Banan@2026');
console.log('  عضو مجلس        board@banan.org       / Banan@2026');
console.log('  عضو (بوابة عضو)  member@banan.org      / Banan@2026\n');
