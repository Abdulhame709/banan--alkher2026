import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  asyncHandler,
  csvResponse,
  EXPENSE_CATEGORY_LABELS,
  monthLabel,
  requireRole,
  round2,
} from '../helpers.js';
import {
  arrearsPosition,
  cashLedger,
  cashPosition,
  defaultRange,
  periodTotals,
} from '../finance.js';

export const reportsRouter = express.Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requireRole('admin', 'accountant', 'treasurer', 'board_member'));

function arrearsRows() {
  return db
    .prepare(
      `SELECT m.id, m.member_no, m.full_name, m.phone, m.active,
              COALESCE(SUM(s.amount), 0) AS accrued,
              COALESCE(SUM(s.paid_amount), 0) AS paid,
              COALESCE(SUM(s.amount - s.paid_amount), 0) AS arrears,
              SUM(CASE WHEN s.status != 'paid' THEN 1 ELSE 0 END) AS open_months,
              MIN(CASE WHEN s.status != 'paid' THEN s.due_month END) AS oldest_due
         FROM fund_members m
         LEFT JOIN fund_subscriptions s ON s.member_id = m.id
        GROUP BY m.id
       HAVING arrears > 0
        ORDER BY arrears DESC, m.member_no ASC`
    )
    .all()
    .map((row) => ({
      ...row,
      active: Boolean(row.active),
      accrued: round2(row.accrued),
      paid: round2(row.paid),
      arrears: round2(row.arrears),
      open_months: Number(row.open_months),
    }));
}

function donationRows(from, to) {
  return db
    .prepare(
      `SELECT r.id, r.receipt_no, r.receipt_date, r.amount, r.payment_method,
              r.is_restricted, r.restricted_purpose, r.notes,
              COALESCE(r.donor_name, m.full_name, 'متبرع') AS donor_name,
              m.member_no, p.full_name AS created_by_name
         FROM fund_receipts r
         LEFT JOIN fund_members m ON m.id = r.member_id
         LEFT JOIN fund_user_profiles p ON p.user_id = r.created_by
        WHERE r.receipt_type = 'donation' AND r.receipt_date BETWEEN ? AND ?
        ORDER BY r.receipt_date DESC, r.receipt_no DESC`
    )
    .all(from, to);
}

function disbursementRows(from, to) {
  return db
    .prepare(
      `SELECT e.id, e.request_no, e.payment_voucher_no, e.category, e.beneficiary_name,
              e.beneficiary_phone, e.description, e.amount, e.disbursed_at,
              e.approval_count, d.full_name AS disbursed_by_name,
              GROUP_CONCAT(
                CASE WHEN a.decision = 'approved'
                     THEN a.approver_name || ' (' || substr(a.created_at, 1, 10) || ')'
                END, ' • '
              ) AS approvers
         FROM fund_expense_requests e
         LEFT JOIN fund_expense_approvals a ON a.request_id = e.id
         LEFT JOIN fund_user_profiles d ON d.user_id = e.disbursed_by
        WHERE e.status = 'paid' AND substr(e.disbursed_at, 1, 10) BETWEEN ? AND ?
        GROUP BY e.id
        ORDER BY e.disbursed_at DESC`
    )
    .all(from, to)
    .map((row) => ({
      ...row,
      category_label: EXPENSE_CATEGORY_LABELS[row.category] ?? row.category,
      disbursed_date: row.disbursed_at ? String(row.disbursed_at).slice(0, 10) : '',
    }));
}

reportsRouter.get(
  '/reports/summary',
  asyncHandler(async (req, res) => {
    const { from, to } = defaultRange(req.query);
    const position = cashPosition();
    const arrears = arrearsPosition();
    const period = periodTotals(from, to);
    const counts = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM fund_receipts WHERE receipt_date BETWEEN ? AND ?) AS receipts_count,
          (SELECT COUNT(*) FROM fund_expense_requests WHERE status = 'paid' AND substr(disbursed_at, 1, 10) BETWEEN ? AND ?) AS expenses_count,
          (SELECT COUNT(*) FROM fund_members WHERE active = 1) AS active_members`
      )
      .get(from, to, from, to);
    res.json({ from, to, position, arrears, period, counts });
  })
);

reportsRouter.get(
  '/reports/cash-ledger',
  asyncHandler(async (req, res) => {
    const { from, to } = defaultRange(req.query);
    res.json(cashLedger(from, to));
  })
);

reportsRouter.get(
  '/reports/arrears',
  asyncHandler(async (req, res) => {
    const rows = arrearsRows();
    const totals = rows.reduce(
      (acc, row) => ({
        accrued: acc.accrued + row.accrued,
        paid: acc.paid + row.paid,
        arrears: acc.arrears + row.arrears,
        members: acc.members + 1,
      }),
      { accrued: 0, paid: 0, arrears: 0, members: 0 }
    );
    res.json({
      rows,
      totals: {
        accrued: round2(totals.accrued),
        paid: round2(totals.paid),
        arrears: round2(totals.arrears),
        members: totals.members,
      },
    });
  })
);

reportsRouter.get(
  '/reports/donations',
  asyncHandler(async (req, res) => {
    const { from, to } = defaultRange(req.query);
    const rows = donationRows(from, to);
    res.json({
      from,
      to,
      rows,
      totals: {
        count: rows.length,
        total: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
        general: round2(rows.filter((row) => !row.is_restricted).reduce((sum, row) => sum + row.amount, 0)),
        restricted: round2(rows.filter((row) => row.is_restricted).reduce((sum, row) => sum + row.amount, 0)),
      },
    });
  })
);

reportsRouter.get(
  '/reports/disbursements',
  asyncHandler(async (req, res) => {
    const { from, to } = defaultRange(req.query);
    const rows = disbursementRows(from, to);
    const byCategory = {};
    for (const row of rows) {
      byCategory[row.category] ??= { label: row.category_label, total: 0, count: 0 };
      byCategory[row.category].total = round2(byCategory[row.category].total + row.amount);
      byCategory[row.category].count += 1;
    }
    res.json({
      from,
      to,
      rows,
      totals: {
        count: rows.length,
        total: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
        by_category: byCategory,
      },
    });
  })
);

reportsRouter.get(
  '/reports/export',
  asyncHandler(async (req, res) => {
    const type = String(req.query.type ?? 'cash');
    const { from, to } = defaultRange(req.query);

    if (type === 'cash') {
      const ledger = cashLedger(from, to);
      const headers = ['التاريخ', 'رقم المستند', 'النوع', 'الطرف', 'البيان', 'وارد', 'صادر', 'الرصيد'];
      const rows = [
        ['', '', 'رصيد افتتاحي', '', 'الرصيد المرحّل إلى بداية الفترة', '', '', ledger.opening_balance],
        ...ledger.movements.map((movement) => [
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
      ];
      return csvResponse(res, `كشف-حركة-الصندوق-${from}-${to}.csv`, headers, rows);
    }

    if (type === 'arrears') {
      const rows = arrearsRows();
      return csvResponse(
        res,
        'تقرير-المتأخرات.csv',
        ['رقم العضوية', 'العضو', 'الهاتف', 'الحالة', 'إجمالي المستحق', 'المسدد', 'المتأخرات', 'أشهر مفتوحة', 'أقدم استحقاق'],
        rows.map((row) => [
          row.member_no,
          row.full_name,
          row.phone ?? '',
          row.active ? 'نشط' : 'موقوف',
          row.accrued,
          row.paid,
          row.arrears,
          row.open_months,
          row.oldest_due ?? '',
        ])
      );
    }

    if (type === 'donations') {
      const rows = donationRows(from, to);
      return csvResponse(
        res,
        `تقرير-التبرعات-${from}-${to}.csv`,
        ['التاريخ', 'رقم السند', 'المتبرع', 'المبلغ', 'مخصص', 'الغرض', 'طريقة الدفع', 'ملاحظات'],
        rows.map((row) => [
          row.receipt_date,
          `REC-${String(row.receipt_no).padStart(4, '0')}`,
          row.donor_name,
          row.amount,
          row.is_restricted ? 'نعم' : 'لا',
          row.restricted_purpose ?? '',
          row.payment_method === 'cash' ? 'نقداً' : 'حوالة بنكية',
          row.notes ?? '',
        ])
      );
    }

    if (type === 'disbursements') {
      const rows = disbursementRows(from, to);
      return csvResponse(
        res,
        `تقرير-المصروفات-${from}-${to}.csv`,
        ['تاريخ الصرف', 'سند الصرف', 'رقم الطلب', 'الفئة', 'المستفيد', 'المبلغ', 'المعتمدان', 'البيان'],
        rows.map((row) => [
          row.disbursed_date,
          row.payment_voucher_no ?? '',
          `EXP-${String(row.request_no).padStart(4, '0')}`,
          row.category_label,
          row.beneficiary_name,
          row.amount,
          row.approvers ?? '',
          row.description,
        ])
      );
    }

    if (type === 'subscriptions') {
      const month = `${from.slice(0, 7)}-01`;
      const rows = db
        .prepare(
          `SELECT s.*, m.full_name, m.member_no,
                  (s.amount - s.paid_amount) AS remaining
             FROM fund_subscriptions s JOIN fund_members m ON m.id = s.member_id
            WHERE s.due_month = ?
            ORDER BY m.member_no`
        )
        .all(month);
      return csvResponse(
        res,
        `تقرير-الاستحقاقات-${monthLabel(month)}.csv`,
        ['رقم العضوية', 'العضو', 'الشهر', 'المستحق', 'المسدد', 'المتبقي', 'الحالة'],
        rows.map((row) => [
          row.member_no,
          row.full_name,
          row.due_month,
          row.amount,
          row.paid_amount,
          row.remaining,
          row.status === 'paid' ? 'مسدد' : row.status === 'partial' ? 'سداد جزئي' : 'غير مسدد',
        ])
      );
    }

    res.status(400).json({ error: 'نوع التقرير غير معروف' });
  })
);
