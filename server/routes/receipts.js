import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { db, UPLOAD_DIR, nextSequence, withTx, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  amount as parseAmount,
  asyncHandler,
  bool,
  HttpError,
  isoDate,
  monthLabel,
  oneOf,
  requireCapability,
  requireRole,
  round2,
  str,
} from '../helpers.js';
import { getReceipt } from '../finance.js';

export const receiptsRouter = express.Router();
receiptsRouter.use(requireAuth);

const internal = requireRole('admin', 'accountant', 'treasurer', 'board_member');

export function validAttachmentName(name) {
  if (!name) return null;
  const base = path.basename(String(name));
  if (!/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|pdf)$/i.test(base)) {
    throw new HttpError(400, 'المرفق غير صالح');
  }
  if (!fs.existsSync(path.join(UPLOAD_DIR, base))) {
    throw new HttpError(400, 'الملف المرفق غير موجود');
  }
  return base;
}

receiptsRouter.get(
  '/receipts',
  internal,
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];
    if (req.query.from) {
      conditions.push('r.receipt_date >= ?');
      params.push(isoDate(req.query.from, { name: 'من تاريخ' }));
    }
    if (req.query.to) {
      conditions.push('r.receipt_date <= ?');
      params.push(isoDate(req.query.to, { name: 'إلى تاريخ' }));
    }
    if (['subscription', 'donation', 'other'].includes(req.query.type)) {
      conditions.push('r.receipt_type = ?');
      params.push(req.query.type);
    }
    if (req.query.restricted === '1') conditions.push('r.is_restricted = 1');
    if (req.query.restricted === '0') conditions.push('r.is_restricted = 0');
    if (req.query.member_id) {
      conditions.push('r.member_id = ?');
      params.push(req.query.member_id);
    }
    const search = String(req.query.search ?? '').trim();
    if (search) {
      conditions.push('(COALESCE(m.full_name, r.donor_name) LIKE ? OR r.notes LIKE ? OR CAST(r.receipt_no AS TEXT) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT r.*, m.full_name AS member_name, m.member_no, p.full_name AS created_by_name
           FROM fund_receipts r
           LEFT JOIN fund_members m ON m.id = r.member_id
           LEFT JOIN fund_user_profiles p ON p.user_id = r.created_by
           ${where}
          ORDER BY r.receipt_date DESC, r.receipt_no DESC
          LIMIT 1000`
      )
      .all(...params);
    const summary = {
      count: rows.length,
      total: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
      restricted: round2(
        rows.filter((row) => row.is_restricted).reduce((sum, row) => sum + row.amount, 0)
      ),
    };
    res.json({ receipts: rows, summary });
  })
);

receiptsRouter.get(
  '/receipts/:id',
  asyncHandler(async (req, res) => {
    const receipt = getReceipt(req.params.id);
    if (!receipt) throw new HttpError(404, 'سند القبض غير موجود');
    if (req.user.role === 'member' && receipt.member_id !== req.user.linked_member_id) {
      throw new HttpError(403, 'لا تملك صلاحية الاطلاع على هذا السند');
    }
    res.json({ receipt });
  })
);

receiptsRouter.post(
  '/receipts',
  requireCapability('manageReceipts'),
  asyncHandler(async (req, res) => {
    const receiptType = oneOf(
      req.body?.receipt_type,
      ['subscription', 'donation', 'other'],
      { name: 'نوع السند' }
    );
    const paymentMethod = oneOf(
      req.body?.payment_method ?? 'cash',
      ['cash', 'bank_transfer'],
      { name: 'طريقة الدفع' }
    );
    const receiptDate = isoDate(req.body?.receipt_date, { name: 'تاريخ السند' });
    const amount = parseAmount(req.body?.amount, { name: 'المبلغ' });
    const isRestricted = bool(req.body?.is_restricted, false);
    const restrictedPurpose = isRestricted
      ? str(req.body?.restricted_purpose, {
          name: 'الغرض المخصص',
          required: true,
          max: 250,
        })
      : null;
    const notes = str(req.body?.notes, { name: 'ملاحظات', max: 1000 });
    const attachment = validAttachmentName(req.body?.attachment_url);
    let memberId = str(req.body?.member_id, { name: 'العضو', max: 60 });
    const subscriptionId = str(req.body?.subscription_id, { name: 'الاستحقاق', max: 60 });
    let donorName = str(req.body?.donor_name, { name: 'اسم المتبرع', max: 150 });
    let member = null;

    if (memberId) {
      member = db.prepare('SELECT * FROM fund_members WHERE id = ?').get(memberId);
      if (!member) throw new HttpError(400, 'العضو المحدد غير موجود');
    }

    if (receiptType === 'subscription') {
      if (!subscriptionId) {
        throw new HttpError(400, 'سند الاشتراك يجب أن يرتبط باستحقاق شهري. استخدم زر السداد في صفحة الاشتراكات');
      }
      const subscription = db
        .prepare(
          `SELECT s.*, m.full_name, m.member_no FROM fund_subscriptions s
            JOIN fund_members m ON m.id = s.member_id WHERE s.id = ?`
        )
        .get(subscriptionId);
      if (!subscription) throw new HttpError(400, 'الاستحقاق المحدد غير موجود');
      if (memberId && memberId !== subscription.member_id) {
        throw new HttpError(400, 'العضو لا يطابق الاستحقاق المحدد');
      }
      memberId = subscription.member_id;
      member = { ...subscription, id: subscription.member_id };
      donorName = subscription.full_name;
      const remaining = round2(subscription.amount - subscription.paid_amount);
      if (remaining <= 0) throw new HttpError(409, 'هذا الاستحقاق مسدد بالكامل');
      if (amount > remaining) {
        throw new HttpError(400, `المبلغ يتجاوز المتبقي على العضو (${remaining} ر.ي)`);
      }
      const newPaid = round2(subscription.paid_amount + amount);
      const status = newPaid >= subscription.amount ? 'paid' : 'partial';
      const receiptId = crypto.randomUUID();
      let receiptNo;
      withTx(() => {
        db.prepare('UPDATE fund_subscriptions SET paid_amount = ?, status = ? WHERE id = ?').run(
          newPaid,
          status,
          subscription.id
        );
        receiptNo = nextSequence('receipt');
        db.prepare(
          `INSERT INTO fund_receipts
            (id, receipt_no, receipt_type, member_id, subscription_id, donor_name, amount,
             payment_method, is_restricted, restricted_purpose, receipt_date, attachment_url, notes, created_by)
           VALUES (?, ?, 'subscription', ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`
        ).run(
          receiptId,
          receiptNo,
          subscription.member_id,
          subscription.id,
          subscription.full_name,
          amount,
          paymentMethod,
          receiptDate,
          attachment,
          notes,
          req.user.id
        );
        audit({
          action: 'تسجيل سند قبض اشتراك',
          entityType: 'receipt',
          entityId: receiptId,
          actor: req.user,
          details: `سند REC-${String(receiptNo).padStart(4, '0')} — ${subscription.full_name} — ${monthLabel(subscription.due_month)} — ${amount} ر.ي`,
        });
      });
      return res.status(201).json({ receipt: getReceipt(receiptId) });
    }

    if (!donorName && member) donorName = member.full_name;
    if (!donorName) throw new HttpError(400, 'اسم المتبرع أو الجهة مطلوب');

    const id = crypto.randomUUID();
    let receiptNo;
    withTx(() => {
      receiptNo = nextSequence('receipt');
      db.prepare(
        `INSERT INTO fund_receipts
          (id, receipt_no, receipt_type, member_id, subscription_id, donor_name, amount,
           payment_method, is_restricted, restricted_purpose, receipt_date, attachment_url, notes, created_by)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        receiptNo,
        receiptType,
        memberId,
        donorName,
        amount,
        paymentMethod,
        isRestricted ? 1 : 0,
        restrictedPurpose,
        receiptDate,
        attachment,
        notes,
        req.user.id
      );
      audit({
        action: 'تسجيل سند قبض',
        entityType: 'receipt',
        entityId: id,
        actor: req.user,
        details: `سند REC-${String(receiptNo).padStart(4, '0')} — ${receiptType === 'donation' ? 'تبرع' : 'إيراد آخر'} — ${donorName} — ${amount} ر.ي${isRestricted ? ` (مخصص: ${restrictedPurpose})` : ''}`,
      });
    });
    res.status(201).json({ receipt: getReceipt(id) });
  })
);
