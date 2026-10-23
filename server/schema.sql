PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- Authentication identities. Application data never stores raw passwords.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 1) Fund settings (single row, id = 'fund')
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_settings (
  id                       TEXT PRIMARY KEY,
  fund_name                TEXT NOT NULL DEFAULT 'صندوق بنان الخير للبنيان – الغدير – مقبنة – تعز',
  logo_url                 TEXT,
  default_monthly_fee      REAL NOT NULL DEFAULT 1000 CHECK (default_monthly_fee >= 0),
  currency                 TEXT NOT NULL DEFAULT 'ريال يمني',
  opening_balance          REAL NOT NULL DEFAULT 0,
  allow_self_approval_demo INTEGER NOT NULL DEFAULT 0 CHECK (allow_self_approval_demo IN (0,1)),
  allow_signups            INTEGER NOT NULL DEFAULT 1 CHECK (allow_signups IN (0,1)),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO fund_settings (id) VALUES ('fund');

-- ---------------------------------------------------------------------------
-- 2) User profiles & roles. The trigger bootstraps every new profile and
--    makes the very first registered user the administrator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_user_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  role              TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin','accountant','treasurer','board_member','member')),
  linked_member_id  TEXT REFERENCES fund_members(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- 3) Members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_members (
  id          TEXT PRIMARY KEY,
  member_no   TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  address     TEXT DEFAULT 'الغدير - مقبنة - تعز',
  monthly_fee REAL NOT NULL DEFAULT 1000 CHECK (monthly_fee >= 0),
  joined_on   TEXT NOT NULL DEFAULT (date('now')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_members_active ON fund_members(active);
CREATE INDEX IF NOT EXISTS idx_members_name ON fund_members(full_name);

-- ---------------------------------------------------------------------------
-- 4) Monthly accruals / dues
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_subscriptions (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES fund_members(id) ON DELETE CASCADE,
  due_month   TEXT NOT NULL CHECK (due_month GLOB '????-??-01'),
  amount      REAL NOT NULL DEFAULT 1000 CHECK (amount > 0),
  paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status      TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (member_id, due_month),
  CHECK (paid_amount <= amount)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_member ON fund_subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_month ON fund_subscriptions(due_month);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON fund_subscriptions(status);

-- ---------------------------------------------------------------------------
-- 5) Receipt vouchers (subscriptions, donations, other income)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_receipts (
  id                 TEXT PRIMARY KEY,
  receipt_no         INTEGER NOT NULL UNIQUE,
  receipt_type       TEXT NOT NULL CHECK (receipt_type IN ('subscription','donation','other')),
  member_id          TEXT REFERENCES fund_members(id) ON DELETE SET NULL,
  subscription_id    TEXT REFERENCES fund_subscriptions(id) ON DELETE SET NULL,
  donor_name         TEXT,
  amount             REAL NOT NULL CHECK (amount > 0),
  payment_method     TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank_transfer')),
  is_restricted      INTEGER NOT NULL DEFAULT 0 CHECK (is_restricted IN (0,1)),
  restricted_purpose TEXT,
  receipt_date       TEXT NOT NULL DEFAULT (date('now')),
  attachment_url     TEXT,
  notes              TEXT,
  created_by         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON fund_receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipts_member ON fund_receipts(member_id);
CREATE INDEX IF NOT EXISTS idx_receipts_type ON fund_receipts(receipt_type);

-- ---------------------------------------------------------------------------
-- 6) Expense / aid requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_expense_requests (
  id                  TEXT PRIMARY KEY,
  request_no          INTEGER NOT NULL UNIQUE,
  category            TEXT NOT NULL CHECK (category IN ('social_aid','charitable_aid','medical_aid','emergency_aid','operational')),
  beneficiary_name    TEXT NOT NULL,
  beneficiary_phone   TEXT,
  description         TEXT NOT NULL,
  amount              REAL NOT NULL CHECK (amount > 0),
  requested_date      TEXT NOT NULL DEFAULT (date('now')),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  approval_count      INTEGER NOT NULL DEFAULT 0 CHECK (approval_count BETWEEN 0 AND 2),
  payment_voucher_no  TEXT UNIQUE,
  attachment_url      TEXT,
  notes               TEXT,
  created_by          TEXT,
  disbursed_by        TEXT,
  disbursed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON fund_expense_requests(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON fund_expense_requests(requested_date);

-- ---------------------------------------------------------------------------
-- 7) Independent dual-approval records
--    UNIQUE(request_id, approver_id): nobody can approve the same request twice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_expense_approvals (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES fund_expense_requests(id) ON DELETE CASCADE,
  approver_id   TEXT NOT NULL,
  approver_name TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (request_id, approver_id)
);
CREATE INDEX IF NOT EXISTS idx_approvals_request ON fund_expense_approvals(request_id);

-- ---------------------------------------------------------------------------
-- 8) Immutable audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_audit_logs (
  id          TEXT PRIMARY KEY,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  actor_id    TEXT,
  actor_name  TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON fund_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON fund_audit_logs(entity_type, entity_id);

-- Audit rows are append-only, even for administrators.
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON fund_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'سجل التدقيق غير قابل للتعديل');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON fund_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'سجل التدقيق غير قابل للحذف');
END;

-- ---------------------------------------------------------------------------
-- Voucher number sequences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequences (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sequences (name, value) VALUES ('receipt', 0);
INSERT OR IGNORE INTO sequences (name, value) VALUES ('expense_request', 0);
INSERT OR IGNORE INTO sequences (name, value) VALUES ('payment_voucher', 0);

-- ---------------------------------------------------------------------------
-- Auto-bootstrap profile trigger. The first registered identity receives the
-- administrator role and the official fund manager name.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_bootstrap_user_profile
AFTER INSERT ON auth_users
BEGIN
  INSERT INTO fund_user_profiles (user_id, full_name, email, phone, role, active)
  VALUES (
    NEW.id,
    CASE
      WHEN (SELECT COUNT(*) FROM fund_user_profiles) = 0
        THEN 'مدير صندوق بنان الخير للبنيان'
      ELSE NEW.full_name
    END,
    NEW.email,
    NEW.phone,
    CASE
      WHEN (SELECT COUNT(*) FROM fund_user_profiles) = 0 THEN 'admin'
      ELSE 'member'
    END,
    1
  );
END;

-- ---------------------------------------------------------------------------
-- Derived member financial position (accrual view — never cash).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_member_financials;
CREATE VIEW v_member_financials AS
SELECT
  m.id,
  m.member_no,
  m.full_name,
  m.phone,
  m.address,
  m.monthly_fee,
  m.joined_on,
  m.active,
  m.notes,
  m.created_at,
  COALESCE(SUM(s.amount), 0)                             AS total_accrued,
  COALESCE(SUM(s.paid_amount), 0)                        AS total_paid,
  COALESCE(SUM(s.amount - s.paid_amount), 0)             AS arrears,
  SUM(CASE WHEN s.status != 'paid' THEN 1 ELSE 0 END)    AS open_months,
  COUNT(s.id)                                            AS due_months
FROM fund_members m
LEFT JOIN fund_subscriptions s ON s.member_id = m.id
GROUP BY m.id;
