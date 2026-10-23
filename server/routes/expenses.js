import crypto from 'node:crypto';
import express from 'express';
import { db, getSettings, nextSequence, withTx, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  amount as parseAmount,
  asyncHandler,
  HttpError,
  isoDate,
  oneOf,
  requireCapability,
  requireRole,
  round2,
  str,
} from '../helpers.js';
import { approvalsForRequests, cashPosition, getExpense } from '../finance.js';
import { validAttachmentName } from './receipts.js';

export const expensesRouter = express.Router();
expensesRouter.use(requireAuth);

const internal = requireRole('admin', 'accountant', 'treasurer', 'board_member');

const CATEGORIES = ['social_aid', 'charitable_aid', 'medical_aid', 'emergency_aid', 'operational'];

expensesRouter.get(
  '/expenses',
  internal,
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];
    if (['pending', 'approved', 'rejected', 'paid'].includes(req.query.status)) {
      conditions.push('e.status = ?');
      params.push(req.query.status);
    }
    if (CATEGORIES.includes(req.query.category)) {
      conditions.push('e.category = ?');
      params.push(req.query.category);
    }
    if (req.query.from) {
      conditions.push('e.requested_date >= ?');
      params.push(isoDate(req.query.from, { name: 'من تاريخ' }));
    }
    if (req.query.to) {
      conditions.push('e.requested_date <= ?');
      params.push(isoDate(req.query.to, { name: 'إلى تاريخ' }));
    }
    const search = String(req.query.search ?? '').trim();
    if (search) {
      conditions.push(
        '(e.beneficiary_name LIKE ? OR e.description LIKE ? OR CAST(e.request_no AS TEXT) LIKE ? OR e.payment_voucher_no LIKE ?)'
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT e.*, p.full_name AS created_by_name, d.full_name AS disbursed_by_name
           FROM fund_expense_requests e
           LEFT JOIN fund_user_profiles p ON p.user_id = e.created_by
           LEFT JOIN fund_user_profiles d ON d.user_id = e.disbursed_by
           ${where}
          ORDER BY
            CASE e.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END,
            e.created_at DESC
          LIMIT 500`
      )
      .all(...params);
    const approvals = approvalsForRequests(rows.map((row) => row.id));
    const summary = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_total,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
           COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS approved_total,
           COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_total,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count,
           COALESCE(SUM(CASE WHEN status = 'rejected' THEN amount ELSE 0 END), 0) AS rejected_total,
           COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count
         FROM fund_expense_requests`
      )
      .get();
    res.json({
      expenses: rows.map((row) => ({
        ...row,
        approvals: approvals.get(row.id) ?? [],
      })),
      summary: { ...summary, cash: cashPosition() },
    });
  })
);

expensesRouter.get(
  '/expenses/:id',
  asyncHandler(async (req, res) => {
    const expense = getExpense(req.params.id);
    if (!expense) throw new HttpError(404, 'طلب الصرف غير موجود');
    if (req.user.role === 'member') throw new HttpError(403, 'غير مصرح');
    res.json({ expense });
  })
);

expensesRouter.post(
  '/expenses',
  requireCapability('createExpenses'),
  asyncHandler(async (req, res) => {
    const category = oneOf(req.body?.category, CATEGORIES, { name: 'فئة الصرف' });
    const beneficiaryName = str(req.body?.beneficiary_name, {
      name: 'اسم المستفيد',
      required: true,
      min: 2,
      max: 150,
    });
    const beneficiaryPhone = str(req.body?.beneficiary_phone, { name: 'هاتف المستفيد', max: 30 });
    const description = str(req.body?.description, {
      name: 'وصف الحالة',
      required: true,
      min: 5,
      max: 2000,
    });
    const amount = parseAmount(req.body?.amount, { name: 'مبلغ الصرف' });
    const requestedDate = isoDate(req.body?.requested_date, { name: 'تاريخ الطلب' });
    const attachment = validAttachmentName(req.body?.attachment_url);
    const notes = str(req.body?.notes, { name: 'ملاحظات', max: 1000 });
    const id = crypto.randomUUID();
    let requestNo;
    withTx(() => {
      requestNo = nextSequence('expense_request');
      db.prepare(
        `INSERT INTO fund_expense_requests
          (id, request_no, category, beneficiary_name, beneficiary_phone, description, amount,
           requested_date, status, approval_count, attachment_url, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
      ).run(
        id,
        requestNo,
        category,
        beneficiaryName,
        beneficiaryPhone,
        description,
        amount,
        requestedDate,
        attachment,
        notes,
        req.user.id
      );
      audit({
        action: 'إنشاء طلب صرف',
        entityType: 'expense_request',
        entityId: id,
        actor: req.user,
        details: `طلب EXP-${String(requestNo).padStart(4, '0')} — ${beneficiaryName} — ${amount} ر.ي — بانتظار اعتماد شخصين`,
      });
    });
    res.status(201).json({ expense: getExpense(id) });
  })
);

expensesRouter.post(
  '/expenses/:id/approve',
  requireCapability('approveExpenses'),
  asyncHandler(async (req, res) => {
    const decision = oneOf(req.body?.decision, ['approved', 'rejected'], {
      name: 'قرار الاعتماد',
    });
    const notes = str(req.body?.notes, { name: 'ملاحظات', max: 1000 });
    const settings = getSettings();
    let request;
    withTx(() => {
      request = db
        .prepare('SELECT * FROM fund_expense_requests WHERE id = ?')
        .get(req.params.id);
      if (!request) throw new HttpError(404, 'طلب الصرف غير موجود');
      if (request.status !== 'pending') {
        throw new HttpError(409, 'لا يمكن الاعتماد: الطلب لم يعد بانتظار الاعتماد');
      }
      if (request.created_by === req.user.id && !settings.allow_self_approval_demo) {
        throw new HttpError(403, 'لا يمكنك اعتماد طلب قمت بإنشائه. يجب أن يعتمده شخص آخر');
      }
      const existing = db
        .prepare(
          'SELECT 1 FROM fund_expense_approvals WHERE request_id = ? AND approver_id = ?'
        )
        .get(request.id, req.user.id);
      if (existing) {
        throw new HttpError(409, 'لقد اعتمدت هذا الطلب مسبقاً. لا يمكن الاعتماد مرتين');
      }
      db.prepare(
        `INSERT INTO fund_expense_approvals
          (id, request_id, approver_id, approver_name, approver_role, decision, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        request.id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        decision,
        notes
      );
      const approvedCount = db
        .prepare(
          "SELECT COUNT(*) AS c FROM fund_expense_approvals WHERE request_id = ? AND decision = 'approved'"
        )
        .get(request.id).c;
      const approvalCount = Math.min(2, approvedCount);
      const status =
        decision === 'rejected' ? 'rejected' : approvedCount >= 2 ? 'approved' : 'pending';
      db.prepare(
        'UPDATE fund_expense_requests SET approval_count = ?, status = ? WHERE id = ?'
      ).run(approvalCount, status, request.id);
      audit({
        action: decision === 'approved' ? 'اعتماد طلب صرف' : 'رفض طلب صرف',
        entityType: 'expense_request',
        entityId: request.id,
        actor: req.user,
        details: `طلب EXP-${String(request.request_no).padStart(4, '0')} — ${decision === 'approved' ? `اعتماد رقم ${approvedCount}` : 'رفض'} بواسطة ${req.user.full_name}${notes ? ` — ${notes}` : ''}`,
      });
    });
    res.json({ expense: getExpense(req.params.id) });
  })
);

expensesRouter.post(
  '/expenses/:id/pay',
  requireCapability('payExpenses'),
  asyncHandler(async (req, res) => {
    let voucherNo;
    withTx(() => {
      const request = db
        .prepare('SELECT * FROM fund_expense_requests WHERE id = ?')
        .get(req.params.id);
      if (!request) throw new HttpError(404, 'طلب الصرف غير موجود');
      if (request.status !== 'approved') {
        throw new HttpError(409, 'لا يمكن الصرف: يجب اعتماد الطلب من شخصين مختلفين أولاً');
      }
      const position = cashPosition();
      if (position.cash_balance < request.amount) {
        throw new HttpError(
          409,
          `الرصيد النقدي غير كافٍ للصرف. المتاح ${position.cash_balance} ر.ي والمطلوب ${request.amount} ر.ي`
        );
      }
      const seq = nextSequence('payment_voucher');
      voucherNo = `PV-${String(seq).padStart(4, '0')}`;
      db.prepare(
        `UPDATE fund_expense_requests
            SET status = 'paid', payment_voucher_no = ?, disbursed_by = ?, disbursed_at = ?
          WHERE id = ? AND status = 'approved'`
      ).run(voucherNo, req.user.id, new Date().toISOString(), request.id);
      audit({
        action: 'صرف مبلغ وإصدار سند صرف',
        entityType: 'expense_request',
        entityId: request.id,
        actor: req.user,
        details: `سند ${voucherNo} — ${request.beneficiary_name} — ${request.amount} ر.ي — طلب EXP-${String(request.request_no).padStart(4, '0')}`,
      });
    });
    res.json({ expense: getExpense(req.params.id), voucher_no: voucherNo });
  })
);
