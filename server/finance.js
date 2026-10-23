import { db, getSettings } from './db.js';
import { round2, todayISO } from './helpers.js';

/**
 * Accrual vs cash separation is enforced here:
 * unpaid subscription balances never enter the cash position.
 */
export function cashPosition() {
  const settings = getSettings();
  const receipts =
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM fund_receipts').get().total;
  const paidExpenses = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM fund_expense_requests WHERE status = 'paid'")
    .get().total;
  const committed = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM fund_expense_requests WHERE status = 'approved'")
    .get().total;
  const cash = round2(Number(settings.opening_balance) + Number(receipts) - Number(paidExpenses));
  return {
    opening_balance: round2(settings.opening_balance),
    total_receipts: round2(receipts),
    total_paid_expenses: round2(paidExpenses),
    cash_balance: cash,
    committed_pending: round2(committed),
    net_available: round2(cash - committed),
  };
}

export function arrearsPosition() {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount - paid_amount), 0) AS arrears,
              COALESCE(SUM(CASE WHEN status != 'paid' THEN 1 ELSE 0 END), 0) AS open_months,
              COALESCE(SUM(amount), 0) AS accrued,
              COALESCE(SUM(paid_amount), 0) AS collected
         FROM fund_subscriptions`
    )
    .get();
  return {
    total_arrears: round2(row.arrears),
    open_months: Number(row.open_months),
    total_accrued: round2(row.accrued),
    total_collected: round2(row.collected),
  };
}

export function periodTotals(from, to) {
  const receipts = db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM fund_receipts WHERE receipt_date BETWEEN ? AND ?'
    )
    .get(from, to).total;
  const paidExpenses = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM fund_expense_requests
        WHERE status = 'paid' AND substr(disbursed_at, 1, 10) BETWEEN ? AND ?`
    )
    .get(from, to).total;
  return {
    receipts: round2(receipts),
    paid_expenses: round2(paidExpenses),
    net: round2(Number(receipts) - Number(paidExpenses)),
  };
}

export function approvalsForRequests(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM fund_expense_approvals
        WHERE request_id IN (${placeholders})
        ORDER BY created_at ASC`
    )
    .all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.request_id)) map.set(row.request_id, []);
    map.get(row.request_id).push(row);
  }
  return map;
}

export function getReceipt(id) {
  return db
    .prepare(
      `SELECT r.*, m.full_name AS member_name, m.member_no,
              p.full_name AS created_by_name
         FROM fund_receipts r
         LEFT JOIN fund_members m ON m.id = r.member_id
         LEFT JOIN fund_user_profiles p ON p.user_id = r.created_by
        WHERE r.id = ?`
    )
    .get(id);
}

export function getExpense(id) {
  const expense = db
    .prepare(
      `SELECT e.*, p.full_name AS created_by_name, d.full_name AS disbursed_by_name
         FROM fund_expense_requests e
         LEFT JOIN fund_user_profiles p ON p.user_id = e.created_by
         LEFT JOIN fund_user_profiles d ON d.user_id = e.disbursed_by
        WHERE e.id = ?`
    )
    .get(id);
  if (!expense) return null;
  expense.approvals = db
    .prepare(
      'SELECT * FROM fund_expense_approvals WHERE request_id = ? ORDER BY created_at ASC'
    )
    .all(id);
  return expense;
}

export function memberStatement(memberId) {
  const member = db
    .prepare('SELECT * FROM v_member_financials WHERE id = ?')
    .get(memberId);
  if (!member) return null;
  const subscriptions = db
    .prepare(
      `SELECT s.*,
              COALESCE((SELECT SUM(r.amount) FROM fund_receipts r WHERE r.subscription_id = s.id), 0) AS receipted
         FROM fund_subscriptions s
        WHERE s.member_id = ?
        ORDER BY s.due_month ASC`
    )
    .all(memberId);
  const receipts = db
    .prepare(
      `SELECT * FROM fund_receipts
        WHERE member_id = ?
        ORDER BY receipt_date DESC, receipt_no DESC`
    )
    .all(memberId);
  const byMonth = new Map();
  for (const receipt of receipts) {
    if (!receipt.subscription_id) continue;
    if (!byMonth.has(receipt.subscription_id)) byMonth.set(receipt.subscription_id, []);
    byMonth.get(receipt.subscription_id).push(receipt);
  }
  for (const subscription of subscriptions) {
    subscription.receipts = byMonth.get(subscription.id) ?? [];
  }
  return { member, subscriptions, receipts };
}

/**
 * Cash ledger with opening balance carried into the range and a running balance.
 */
export function cashLedger(from, to) {
  const settings = getSettings();
  const priorReceipts = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM fund_receipts WHERE receipt_date < ?')
    .get(from).total;
  const priorExpenses = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM fund_expense_requests
        WHERE status = 'paid' AND substr(disbursed_at, 1, 10) < ?`
    )
    .get(from).total;
  const opening = round2(Number(settings.opening_balance) + Number(priorReceipts) - Number(priorExpenses));

  const receipts = db
    .prepare(
      `SELECT r.id, r.receipt_no, r.receipt_type, r.receipt_date AS date,
              COALESCE(m.full_name, r.donor_name, 'متبرع') AS party,
              COALESCE(r.restricted_purpose, CASE r.receipt_type
                WHEN 'subscription' THEN 'سداد اشتراك شهري'
                WHEN 'donation' THEN 'تبرع عام'
                ELSE 'إيراد آخر' END) AS description,
              r.amount, r.payment_method, r.created_at
         FROM fund_receipts r
         LEFT JOIN fund_members m ON m.id = r.member_id
        WHERE r.receipt_date BETWEEN ? AND ?`
    )
    .all(from, to);

  const expenses = db
    .prepare(
      `SELECT e.id, e.request_no, e.category, substr(e.disbursed_at, 1, 10) AS date,
              e.beneficiary_name AS party, e.description,
              e.amount, e.payment_voucher_no, e.disbursed_at AS created_at
         FROM fund_expense_requests e
        WHERE e.status = 'paid' AND substr(e.disbursed_at, 1, 10) BETWEEN ? AND ?`
    )
    .all(from, to);

  const movements = [
    ...receipts.map((row) => ({
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
    ...expenses.map((row) => ({
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
    a.date === b.date
      ? String(a.created_at).localeCompare(String(b.created_at))
      : a.date.localeCompare(b.date)
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

export function defaultRange(query) {
  const today = todayISO();
  const from = query.from ? String(query.from).slice(0, 10) : `${today.slice(0, 4)}-01-01`;
  const to = query.to ? String(query.to).slice(0, 10) : today;
  return { from, to };
}
