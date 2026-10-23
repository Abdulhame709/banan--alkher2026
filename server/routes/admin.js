import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { db, getSettings, UPLOAD_DIR, withTx, audit } from '../db.js';
import { hashPassword, requireAuth } from '../auth.js';
import {
  amount as parseAmount,
  asyncHandler,
  bool,
  HttpError,
  oneOf,
  pageParams,
  requireRole,
  ROLES,
  ROLE_LABELS,
  round2,
  str,
} from '../helpers.js';

export const adminRouter = express.Router();
adminRouter.use(requireAuth);

const adminOnly = requireRole('admin');
const auditViewers = requireRole('admin', 'board_member');

function protocolSettings() {
  const settings = getSettings();
  return {
    ...settings,
    logo_file: settings.logo_url,
    logo_url: settings.logo_url
      ? `/api/logo?v=${encodeURIComponent(settings.updated_at)}`
      : null,
    allow_self_approval_demo: Boolean(settings.allow_self_approval_demo),
    allow_signups: Boolean(settings.allow_signups),
  };
}

/* ------------------------------- users ---------------------------------- */
adminRouter.get(
  '/users',
  adminOnly,
  asyncHandler(async (req, res) => {
    const users = db
      .prepare(
        `SELECT p.*, u.email AS email, u.created_at AS account_created_at,
                m.full_name AS linked_member_name, m.member_no AS linked_member_no
           FROM fund_user_profiles p
           JOIN auth_users u ON u.id = p.user_id
           LEFT JOIN fund_members m ON m.id = p.linked_member_id
          ORDER BY CASE p.role WHEN 'admin' THEN 0 WHEN 'treasurer' THEN 1 WHEN 'accountant' THEN 2 WHEN 'board_member' THEN 3 ELSE 4 END,
                   p.created_at ASC`
      )
      .all()
      .map((row) => ({
        ...row,
        active: Boolean(row.active),
        role_label: ROLE_LABELS[row.role],
      }));
    const members = db
      .prepare(
        `SELECT id, member_no, full_name FROM fund_members
          WHERE active = 1 ORDER BY member_no ASC`
      )
      .all();
    res.json({ users, members, roles: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })) });
  })
);

adminRouter.post(
  '/users',
  adminOnly,
  asyncHandler(async (req, res) => {
    const fullName = str(req.body?.full_name, {
      name: 'الاسم الكامل',
      required: true,
      min: 3,
      max: 120,
    });
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
      throw new HttpError(400, 'البريد الإلكتروني غير صالح');
    }
    const password = String(req.body?.password ?? '');
    if (password.length < 8) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    const role = oneOf(req.body?.role ?? 'member', ROLES, { name: 'الدور' });
    const phone = str(req.body?.phone, { name: 'رقم الهاتف', max: 30 });
    const linkedMemberId = str(req.body?.linked_member_id, { name: 'العضو المرتبط', max: 60 });
    if (linkedMemberId && !db.prepare('SELECT 1 FROM fund_members WHERE id = ?').get(linkedMemberId)) {
      throw new HttpError(400, 'العضو المرتبط غير موجود');
    }
    if (db.prepare('SELECT 1 FROM auth_users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'يوجد حساب مسجل بهذا البريد الإلكتروني');
    }
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    withTx(() => {
      db.prepare(
        `INSERT INTO auth_users (id, email, password_hash, full_name, phone)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, email, passwordHash, fullName, phone);
      db.prepare(
        `UPDATE fund_user_profiles
            SET role = ?, full_name = ?, phone = ?, linked_member_id = ?
          WHERE user_id = ?`
      ).run(role, fullName, phone, linkedMemberId, id);
      audit({
        action: 'إنشاء حساب مستخدم',
        entityType: 'user',
        entityId: id,
        actor: req.user,
        details: `إنشاء حساب ${fullName} (${email}) بدور ${ROLE_LABELS[role]}`,
      });
    });
    res.status(201).json({ ok: true, user_id: id });
  })
);

adminRouter.patch(
  '/users/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const profile = db
      .prepare('SELECT * FROM fund_user_profiles WHERE user_id = ?')
      .get(req.params.id);
    if (!profile) throw new HttpError(404, 'المستخدم غير موجود');
    const isSelf = profile.user_id === req.user.id;

    const fullName =
      req.body?.full_name === undefined
        ? profile.full_name
        : str(req.body.full_name, { name: 'الاسم الكامل', required: true, min: 3, max: 120 });
    const role =
      req.body?.role === undefined
        ? profile.role
        : oneOf(req.body.role, ROLES, { name: 'الدور' });
    const active =
      req.body?.active === undefined ? Boolean(profile.active) : bool(req.body.active, true);
    const phone =
      req.body?.phone === undefined
        ? profile.phone
        : str(req.body.phone, { name: 'رقم الهاتف', max: 30 });
    const linkedMemberId =
      req.body?.linked_member_id === undefined
        ? profile.linked_member_id
        : str(req.body.linked_member_id, { name: 'العضو المرتبط', max: 60 });

    if (linkedMemberId && !db.prepare('SELECT 1 FROM fund_members WHERE id = ?').get(linkedMemberId)) {
      throw new HttpError(400, 'العضو المرتبط غير موجود');
    }
    if (isSelf && (!active || role !== 'admin')) {
      throw new HttpError(400, 'لا يمكنك إيقاف حسابك أو إزالة صلاحية مدير النظام عن نفسك');
    }
    if (profile.role === 'admin' && (role !== 'admin' || !active)) {
      const remainingAdmins = db
        .prepare(
          `SELECT COUNT(*) AS c FROM fund_user_profiles
            WHERE role = 'admin' AND active = 1 AND user_id != ?`
        )
        .get(profile.user_id).c;
      if (remainingAdmins === 0) {
        throw new HttpError(409, 'يجب أن يبقى مدير نظام واحد نشط على الأقل');
      }
    }

    withTx(() => {
      db.prepare(
        `UPDATE fund_user_profiles
            SET full_name = ?, role = ?, active = ?, phone = ?, linked_member_id = ?
          WHERE user_id = ?`
      ).run(fullName, role, active ? 1 : 0, phone, linkedMemberId, profile.user_id);
      db.prepare('UPDATE auth_users SET full_name = ?, phone = ? WHERE id = ?').run(
        fullName,
        phone,
        profile.user_id
      );
      if (!active) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(profile.user_id);
      }
      audit({
        action: 'تعديل حساب مستخدم',
        entityType: 'user',
        entityId: profile.user_id,
        actor: req.user,
        details: `تحديث المستخدم ${fullName} — الدور: ${ROLE_LABELS[role]} — الحالة: ${active ? 'نشط' : 'موقوف'}`,
      });
    });
    res.json({ ok: true });
  })
);

adminRouter.patch(
  '/users/:id/password',
  adminOnly,
  asyncHandler(async (req, res) => {
    const profile = db
      .prepare('SELECT * FROM fund_user_profiles WHERE user_id = ?')
      .get(req.params.id);
    if (!profile) throw new HttpError(404, 'المستخدم غير موجود');
    const password = String(req.body?.new_password ?? '');
    if (password.length < 8) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    const hash = await hashPassword(password);
    withTx(() => {
      db.prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?').run(hash, profile.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(profile.user_id);
      audit({
        action: 'إعادة تعيين كلمة مرور',
        entityType: 'user',
        entityId: profile.user_id,
        actor: req.user,
        details: `إعادة تعيين كلمة مرور المستخدم ${profile.full_name}`,
      });
    });
    res.json({ ok: true });
  })
);

/* ------------------------------ settings -------------------------------- */
adminRouter.get(
  '/settings',
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json({ settings: protocolSettings() });
  })
);

adminRouter.patch(
  '/settings',
  adminOnly,
  asyncHandler(async (req, res) => {
    const current = getSettings();
    const fundName = str(req.body?.fund_name ?? current.fund_name, {
      name: 'اسم الصندوق',
      required: true,
      min: 5,
      max: 200,
    });
    if (!fundName.includes('صندوق') || fundName.includes('مؤسسة')) {
      throw new HttpError(400, 'يجب أن يبدأ الاسم الرسمي للصندوق بكلمة «صندوق»');
    }
    const defaultFee =
      req.body?.default_monthly_fee === undefined
        ? Number(current.default_monthly_fee)
        : parseAmount(req.body.default_monthly_fee, {
            name: 'الاشتراك الشهري الافتراضي',
            min: 0,
          });
    const currency = str(req.body?.currency ?? current.currency, {
      name: 'العملة',
      required: true,
      max: 40,
    });
    let openingBalance = Number(current.opening_balance);
    if (req.body?.opening_balance !== undefined) {
      openingBalance = Number(req.body.opening_balance);
      if (!Number.isFinite(openingBalance) || Math.abs(openingBalance) > 1_000_000_000_000) {
        throw new HttpError(400, 'الرصيد الافتتاحي غير صالح');
      }
      openingBalance = round2(openingBalance);
    }
    const selfApproval =
      req.body?.allow_self_approval_demo === undefined
        ? Boolean(current.allow_self_approval_demo)
        : bool(req.body.allow_self_approval_demo, false);
    const allowSignups =
      req.body?.allow_signups === undefined
        ? Boolean(current.allow_signups)
        : bool(req.body.allow_signups, true);

    let logoFile = current.logo_url;
    if (req.body?.logo_file === null || req.body?.logo_file === '') {
      logoFile = null;
    } else if (req.body?.logo_file !== undefined) {
      logoFile = path.basename(String(req.body.logo_file));
      if (!/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$/i.test(logoFile)) {
        throw new HttpError(400, 'صيغة شعار الصندوق غير مدعومة');
      }
      if (!fs.existsSync(path.join(UPLOAD_DIR, logoFile))) {
        throw new HttpError(400, 'ملف الشعار غير موجود');
      }
    }

    withTx(() => {
      db.prepare(
        `UPDATE fund_settings
            SET fund_name = ?, logo_url = ?, default_monthly_fee = ?, currency = ?,
                opening_balance = ?, allow_self_approval_demo = ?, allow_signups = ?, updated_at = ?
          WHERE id = 'fund'`
      ).run(
        fundName,
        logoFile,
        defaultFee,
        currency,
        openingBalance,
        selfApproval ? 1 : 0,
        allowSignups ? 1 : 0,
        new Date().toISOString()
      );
      audit({
        action: 'تحديث إعدادات الصندوق',
        entityType: 'settings',
        entityId: 'fund',
        actor: req.user,
        details: `الاسم: ${fundName} — الاشتراك: ${defaultFee} — الرصيد الافتتاحي: ${openingBalance} — ${selfApproval ? 'تفعيل' : 'تعطيل'} تجاوز اعتماد المنشئ`,
      });
    });
    res.json({ settings: protocolSettings() });
  })
);

/* -------------------------------- audit --------------------------------- */
adminRouter.get(
  '/audit',
  auditViewers,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const conditions = [];
    const params = [];
    if (req.query.from) {
      conditions.push('created_at >= ?');
      params.push(`${String(req.query.from).slice(0, 10)}T00:00:00`);
    }
    if (req.query.to) {
      conditions.push('created_at <= ?');
      params.push(`${String(req.query.to).slice(0, 10)}T23:59:59.999`);
    }
    if (req.query.entity_type) {
      conditions.push('entity_type = ?');
      params.push(String(req.query.entity_type));
    }
    const search = String(req.query.search ?? '').trim();
    if (search) {
      conditions.push('(action LIKE ? OR details LIKE ? OR actor_name LIKE ? OR entity_id LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS c FROM fund_audit_logs ${where}`).get(...params).c;
    const rows = db
      .prepare(
        `SELECT * FROM fund_audit_logs ${where}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset);
    const entityTypes = db
      .prepare('SELECT DISTINCT entity_type FROM fund_audit_logs ORDER BY entity_type')
      .all()
      .map((row) => row.entity_type);
    res.json({ logs: rows, total, page, pageSize, entity_types: entityTypes });
  })
);
