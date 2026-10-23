import crypto from 'node:crypto';
import express from 'express';
import { db, getSettings, nextSequence, withTx, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  amount as parseAmount,
  asyncHandler,
  HttpError,
  isoDate,
  monthLabel,
  normalizeMonth,
  oneOf,
  requireCapability,
  requireRole,
  round2,
  str,
  todayISO,
} from '../helpers.js';
import { getReceipt } from '../finance.js';

export const subscriptionsRouter = express.Router();
subscriptionsRouter.use(requireAuth);

const internal = requireRole('admin', 'accountant', 'treasurer', 'board_member');

subscriptionsRouter.get(
  '/subscriptions',
  internal,
  asyncHandler(async (req, res) => {
    const month = normalizeMonth(req.query.month, { required: false }) ?? `${todayISO().slice(0, 7)}-01`;
    const status = String(req.query.status ?? 'all');
    const search = String(req.query.search ?? '').trim();
    const conditions = ['s.due_month = ?'];
    const params = [month];
    if (['unpaid', 'partial', 'paid'].includes(status)) {
      conditions.push('s.status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(m.full_name LIKE ? OR m.member_no LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const rows = db
      .prepare(
        `SELECT s.*, m.full_name, m.member_no, m.phone, m.active,
                (s.amount - s.paid_amount) AS remaining
           FROM fund_subscriptions s
           JOIN fund_members m ON m.id = s.member_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY m.member_no ASC`
      )
      .all(...params);
    const summary = db
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(s.amount), 0) AS total,
                COALESCE(SUM(s.paid_amount), 0) AS paid,
                COALESCE(SUM(s.amount - s.paid_amount), 0) AS remaining
           FROM fund_subscriptions s
           JOIN fund_members m ON m.id = s.member_id
          WHERE s.due_month = ?`
      )
      .get(month);
    res.json({
      month,
      month_label: monthLabel(month),
      subscriptions: rows.map((row) => ({
        ...row,
        active: Boolean(row.active),
        remaining: round2(row.remaining),
      })),
      summary: {
        count: summary.count,
        total: round2(summary.total),
        paid: round2(summary.paid),
        remaining: round2(summary.remaining),
      },
    });
  })
);

subscriptionsRouter.post(
  '/subscriptions/generate',
  requireCapability('manageMembers'),
  asyncHandler(async (req, res) => {
    const month = normalizeMonth(req.body?.month);
    const settings = getSettings();
    const members = db
      .prepare('SELECT id, full_name, monthly_fee FROM fund_members WHERE active = 1')
      .all();
    let generated = 0;
    let skipped = 0;
    withTx(() => {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO fund_subscriptions (id, member_id, due_month, amount, paid_amount, status)
         VALUES (?, ?, ?, ?, 0, 'unpaid')`
      );
      for (const member of members) {
        if (Number(member.monthly_fee) <= 0) {
          skipped += 1;
          continue;
        }
        const result = insert.run(
          crypto.randomUUID(),
          member.id,
          month,
          round2(member.monthly_fee)
        );
        if (result.changes) generated += 1;
        else skipped += 1;
      }
      audit({
        action: 'توليد استحقاقات شهرية',
        entityType: 'subscription',
        entityId: month,
        actor: req.user,
        details: `توليد استحقاقات ${monthLabel(month)} — تم إنشاء ${generated} استحقاق وتخطي ${skipped}`,
      });
    });
    res.status(201).json({
      month,
      month_label: monthLabel(month),
      generated,
      skipped,
      total_active_members: members.length,
      default_fee: Number(settings.default_monthly_fee),
    });
  })
);

subscriptionsRouter.post(
  '/subscriptions/:id/pay',
  requireCapability('manageReceipts'),
  asyncHandler(async (req, res) => {
    const subscription = db
      .prepare(
        `SELECT s.*, m.full_name, m.member_no FROM fund_subscriptions s
          JOIN fund_members m ON m.id = s.member_id WHERE s.id = ?`
      )
      .get(req.params.id);
    if (!subscription) throw new HttpError(404, 'الاستحقاق غير موجود');
    const remaining = round2(subscription.amount - subscription.paid_amount);
    if (remaining <= 0) throw new HttpError(409, 'هذا الاستحقاق مسدد بالكامل');
    const payment = parseAmount(req.body?.amount, { name: 'مبلغ السداد' });
    if (payment > remaining) {
      throw new HttpError(400, `المبلغ يتجاوز المتبقي على العضو (${remaining} ر.ي)`);
    }
    const paymentMethod = oneOf(
      req.body?.payment_method ?? 'cash',
      ['cash', 'bank_transfer'],
      { name: 'طريقة الدفع' }
    );
    const receiptDate = isoDate(req.body?.receipt_date, { name: 'تاريخ السند' });
    const notes = str(req.body?.notes, { name: 'ملاحظات', max: 1000 });
    const newPaid = round2(subscription.paid_amount + payment);
    const status = newPaid >= subscription.amount ? 'paid' : 'partial';
    const receiptId = crypto.randomUUID();
    let receiptNo;
    withTx(() => {
      db.prepare(
        'UPDATE fund_subscriptions SET paid_amount = ?, status = ? WHERE id = ?'
      ).run(newPaid, status, subscription.id);
      receiptNo = nextSequence('receipt');
      db.prepare(
        `INSERT INTO fund_receipts
          (id, receipt_no, receipt_type, member_id, subscription_id, donor_name, amount,
           payment_method, is_restricted, receipt_date, notes, created_by)
         VALUES (?, ?, 'subscription', ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(
        receiptId,
        receiptNo,
        subscription.member_id,
        subscription.id,
        subscription.full_name,
        payment,
        paymentMethod,
        receiptDate,
        notes,
        req.user.id
      );
      audit({
        action: 'تحصيل اشتراك شهري',
        entityType: 'receipt',
        entityId: receiptId,
        actor: req.user,
        details: `سند قبض REC-${String(receiptNo).padStart(4, '0')} — العضو ${subscription.full_name} (${subscription.member_no}) — ${monthLabel(subscription.due_month)} — مبلغ ${payment} ر.ي`
      });
      audit({
        action: 'تحديث حالة استحقاق',
        entityType: 'subscription',
        entityId: subscription.id,
        actor: req.user,
        details: `تم سداد ${payment} ر.ي من أصل ${subscription.amount} ر.ي — الحالة: ${status === 'paid' ? 'مسدد' : 'سداد جزئي'}`
      });
    });
    res.status(201).json({
      subscription: db.prepare('SELECT * FROM fund_subscriptions WHERE id = ?').get(subscription.id),
      receipt: getReceipt(receiptId),
    });
  })
);
