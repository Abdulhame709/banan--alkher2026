import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, EXPENSE_CATEGORY_LABELS, round2, todayISO } from '../helpers.js';
import { arrearsPosition, cashPosition, memberStatement } from '../finance.js';

export const dashboardRouter = express.Router();
dashboardRouter.use(requireAuth);

function lastMonths(count, anchor = todayISO()) {
  const [year, month] = anchor.split('-').map(Number);
  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}

dashboardRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    if (req.user.role === 'member') {
      if (!req.user.linked_member_id) {
        return res.json({
          restricted: true,
          member: null,
          message: 'لم يتم ربط حسابك بعضوية في الصندوق بعد. يرجى التواصل مع إدارة الصندوق.',
        });
      }
      const statement = memberStatement(req.user.linked_member_id);
      if (!statement) {
        return res.json({ restricted: true, member: null, message: 'تعذر العثور على بيانات العضوية المرتبطة بحسابك.' });
      }
      return res.json({
        restricted: true,
        member: statement.member,
        subscriptions: statement.subscriptions.slice(-12).reverse(),
        receipts: statement.receipts.slice(0, 8),
      });
    }

    const position = cashPosition();
    const arrears = arrearsPosition();
    const revenue = db
      .prepare(
        `SELECT receipt_type, is_restricted, COALESCE(SUM(amount), 0) AS total
           FROM fund_receipts GROUP BY receipt_type, is_restricted`
      )
      .all();
    const revenueBreakdown = {
      subscriptions: 0,
      general_donations: 0,
      restricted_donations: 0,
      other: 0,
    };
    for (const row of revenue) {
      if (row.receipt_type === 'subscription') revenueBreakdown.subscriptions += row.total;
      else if (row.receipt_type === 'donation' && row.is_restricted) revenueBreakdown.restricted_donations += row.total;
      else if (row.receipt_type === 'donation') revenueBreakdown.general_donations += row.total;
      else revenueBreakdown.other += row.total;
    }

    const expensesByCategory = db
      .prepare(
        `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM fund_expense_requests WHERE status = 'paid'
          GROUP BY category ORDER BY total DESC`
      )
      .all()
      .map((row) => ({
        ...row,
        label: EXPENSE_CATEGORY_LABELS[row.category] ?? row.category,
        total: round2(row.total),
      }));

    const pending = db
      .prepare(
        `SELECT e.*, p.full_name AS created_by_name
           FROM fund_expense_requests e
           LEFT JOIN fund_user_profiles p ON p.user_id = e.created_by
          WHERE e.status = 'pending'
          ORDER BY e.created_at DESC LIMIT 6`
      )
      .all();

    const pendingSummary = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
           FROM fund_expense_requests WHERE status = 'pending'`
      )
      .get();

    const recentReceipts = db
      .prepare(
        `SELECT r.id, r.receipt_no, r.receipt_type, r.amount, r.receipt_date,
                COALESCE(m.full_name, r.donor_name, 'متبرع') AS party, r.is_restricted
           FROM fund_receipts r LEFT JOIN fund_members m ON m.id = r.member_id
          ORDER BY r.receipt_date DESC, r.receipt_no DESC LIMIT 6`
      )
      .all();

    const approved = db
      .prepare(
        `SELECT e.id, e.request_no, e.beneficiary_name, e.amount, e.category, e.approval_count
           FROM fund_expense_requests e WHERE e.status = 'approved'
          ORDER BY e.created_at ASC LIMIT 5`
      )
      .all();

    const memberStats = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN substr(joined_on, 1, 7) = ? THEN 1 ELSE 0 END) AS new_this_month
           FROM fund_members`
      )
      .get(todayISO().slice(0, 7));

    const months = lastMonths(6);
    const receiptTrend = db
      .prepare(
        `SELECT substr(receipt_date, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
           FROM fund_receipts GROUP BY month`
      )
      .all();
    const expenseTrend = db
      .prepare(
        `SELECT substr(disbursed_at, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
           FROM fund_expense_requests WHERE status = 'paid' GROUP BY month`
      )
      .all();
    const receiptMap = new Map(receiptTrend.map((row) => [row.month, round2(row.total)]));
    const expenseMap = new Map(expenseTrend.map((row) => [row.month, round2(row.total)]));

    res.json({
      restricted: false,
      position,
      arrears: {
        ...arrears,
        members_in_arrears: db
          .prepare(
            `SELECT COUNT(*) AS count FROM (
               SELECT member_id FROM fund_subscriptions WHERE status != 'paid' GROUP BY member_id
             )`
          )
          .get().count,
      },
      revenue_breakdown: {
        subscriptions: round2(revenueBreakdown.subscriptions),
        general_donations: round2(revenueBreakdown.general_donations),
        restricted_donations: round2(revenueBreakdown.restricted_donations),
        other: round2(revenueBreakdown.other),
      },
      expenses_by_category: expensesByCategory,
      pending_requests: pending,
      pending_summary: { count: pendingSummary.count, total: round2(pendingSummary.total) },
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
  })
);
