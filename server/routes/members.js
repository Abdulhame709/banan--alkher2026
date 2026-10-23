import crypto from 'node:crypto';
import express from 'express';
import { db, getSettings, withTx, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  amount as parseAmount,
  asyncHandler,
  bool,
  HttpError,
  isoDate,
  requireCapability,
  requireRole,
  str,
} from '../helpers.js';
import { memberStatement } from '../finance.js';

export const membersRouter = express.Router();
membersRouter.use(requireAuth);

const internal = requireRole('admin', 'accountant', 'treasurer', 'board_member');

function nextMemberNo() {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(CAST(SUBSTR(member_no, 3) AS INTEGER)), 0) AS max FROM fund_members WHERE member_no LIKE 'M-%'"
    )
    .get();
  return `M-${String(Number(row.max) + 1).padStart(3, '0')}`;
}

function memberRow(id) {
  return db.prepare('SELECT * FROM v_member_financials WHERE id = ?').get(id);
}

membersRouter.get(
  '/members',
  internal,
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const status = String(req.query.status ?? 'all');
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push('(full_name LIKE ? OR member_no LIKE ? OR phone LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (status === 'active') conditions.push('active = 1');
    if (status === 'inactive') conditions.push('active = 0');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM v_member_financials ${where} ORDER BY member_no ASC`)
      .all(...params);
    res.json({
      members: rows.map((row) => ({
        ...row,
        active: Boolean(row.active),
        total_accrued: Number(row.total_accrued),
        total_paid: Number(row.total_paid),
        arrears: Number(row.arrears),
      })),
    });
  })
);

membersRouter.get(
  '/members/:id/statement',
  asyncHandler(async (req, res) => {
    if (req.user.role === 'member' && req.user.linked_member_id !== req.params.id) {
      throw new HttpError(403, 'لا تملك صلاحية الاطلاع على كشف حساب هذا العضو');
    }
    if (!['admin', 'accountant', 'treasurer', 'board_member', 'member'].includes(req.user.role)) {
      throw new HttpError(403, 'غير مصرح');
    }
    const statement = memberStatement(req.params.id);
    if (!statement) throw new HttpError(404, 'العضو غير موجود');
    res.json(statement);
  })
);

membersRouter.post(
  '/members',
  requireCapability('manageMembers'),
  asyncHandler(async (req, res) => {
    const settings = getSettings();
    const fullName = str(req.body?.full_name, {
      name: 'اسم العضو',
      required: true,
      min: 3,
      max: 120,
    });
    const phone = str(req.body?.phone, { name: 'رقم الهاتف', max: 30 });
    const address =
      str(req.body?.address, { name: 'العنوان', max: 250 }) || 'الغدير - مقبنة - تعز';
    const monthlyFee = req.body?.monthly_fee === undefined || req.body?.monthly_fee === ''
      ? Number(settings.default_monthly_fee)
      : parseAmount(req.body.monthly_fee, { name: 'رسوم الاشتراك الشهري', min: 0 });
    const joinedOn = isoDate(req.body?.joined_on, { name: 'تاريخ الانضمام' });
    const notes = str(req.body?.notes, { name: 'ملاحظات', max: 1000 });
    const active = bool(req.body?.active, true);
    let memberNo = str(req.body?.member_no, { name: 'رقم العضوية', max: 30 });
    if (memberNo && !/^M-\d{1,6}$/.test(memberNo)) {
      throw new HttpError(400, 'رقم العضوية يجب أن يكون بالصيغة M-001');
    }
    if (memberNo && db.prepare('SELECT 1 FROM fund_members WHERE member_no = ?').get(memberNo)) {
      throw new HttpError(409, 'رقم العضوية مستخدم مسبقاً');
    }

    const id = crypto.randomUUID();
    withTx(() => {
      memberNo ||= nextMemberNo();
      db.prepare(
        `INSERT INTO fund_members
          (id, member_no, full_name, phone, address, monthly_fee, joined_on, active, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, memberNo, fullName, phone, address, monthlyFee, joinedOn, active ? 1 : 0, notes);
      audit({
        action: 'إضافة عضو جديد',
        entityType: 'member',
        entityId: id,
        actor: req.user,
        details: `إضافة العضو ${fullName} برقم عضوية ${memberNo}`,
      });
    });
    res.status(201).json({ member: memberRow(id) });
  })
);

membersRouter.patch(
  '/members/:id',
  requireCapability('manageMembers'),
  asyncHandler(async (req, res) => {
    const existing = db.prepare('SELECT * FROM fund_members WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'العضو غير موجود');

    const fullName = str(req.body?.full_name ?? existing.full_name, {
      name: 'اسم العضو',
      required: true,
      min: 3,
      max: 120,
    });
    const phone = str(req.body?.phone ?? existing.phone, { name: 'رقم الهاتف', max: 30 });
    const address = str(req.body?.address ?? existing.address, { name: 'العنوان', max: 250 });
    const monthlyFee =
      req.body?.monthly_fee === undefined
        ? Number(existing.monthly_fee)
        : parseAmount(req.body.monthly_fee, { name: 'رسوم الاشتراك الشهري', min: 0 });
    const joinedOn =
      req.body?.joined_on === undefined
        ? existing.joined_on
        : isoDate(req.body.joined_on, { name: 'تاريخ الانضمام' });
    const notes =
      req.body?.notes === undefined
        ? existing.notes
        : str(req.body.notes, { name: 'ملاحظات', max: 1000 });
    const active = req.body?.active === undefined ? Boolean(existing.active) : bool(req.body.active, true);

    withTx(() => {
      db.prepare(
        `UPDATE fund_members
            SET full_name = ?, phone = ?, address = ?, monthly_fee = ?, joined_on = ?, active = ?, notes = ?
          WHERE id = ?`
      ).run(fullName, phone, address, monthlyFee, joinedOn, active ? 1 : 0, notes, existing.id);
      audit({
        action: active ? 'تعديل بيانات عضو' : 'إيقاف عضوية',
        entityType: 'member',
        entityId: existing.id,
        actor: req.user,
        details: `تحديث بيانات العضو ${fullName} (${existing.member_no})${active ? '' : ' — تم إيقاف العضوية'}`,
      });
    });
    res.json({ member: memberRow(existing.id) });
  })
);

membersRouter.delete(
  '/members/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = db.prepare('SELECT * FROM fund_members WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'العضو غير موجود');
    const linked = db
      .prepare('SELECT COUNT(*) AS c FROM fund_receipts WHERE member_id = ?')
      .get(existing.id).c;
    const subscriptions = db
      .prepare('SELECT COUNT(*) AS c FROM fund_subscriptions WHERE member_id = ?')
      .get(existing.id).c;
    if (linked || subscriptions) {
      throw new HttpError(
        409,
        'لا يمكن حذف عضو لديه سندات أو استحقاقات مسجلة. يمكنك إيقاف عضويته بدلاً من الحذف.'
      );
    }
    withTx(() => {
      db.prepare('DELETE FROM fund_members WHERE id = ?').run(existing.id);
      audit({
        action: 'حذف عضو',
        entityType: 'member',
        entityId: existing.id,
        actor: req.user,
        details: `حذف العضو ${existing.full_name} (${existing.member_no})`,
      });
    });
    res.json({ ok: true });
  })
);
