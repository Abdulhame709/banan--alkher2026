export type Role =
  | 'admin'
  | 'fund_manager'
  | 'secretary_general'
  | 'accountant'
  | 'treasurer'
  | 'board_member'
  | 'member';

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  role_label: string;
  active: number | boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  permissions: Record<string, boolean>;
  linked_member_id: string | null;
  phone_login_enabled: boolean;
  created_at: string;
}

export interface Capabilities {
  /* Legacy capabilities kept for the existing screens. */
  manageMembers: boolean;
  manageReceipts: boolean;
  createExpenses: boolean;
  approveExpenses: boolean;
  payExpenses: boolean;
  viewReports: boolean;
  viewAudit: boolean;
  admin: boolean;

  /* Granular capabilities driven by the per-user permissions matrix. */
  viewDashboard: boolean;
  viewMembers: boolean;
  addMembers: boolean;
  editMembers: boolean;
  deleteMembers: boolean;
  importMembers: boolean;
  exportMembers: boolean;
  viewSubscriptions: boolean;
  addSubscriptions: boolean;
  editSubscriptions: boolean;
  deleteSubscriptions: boolean;
  paySubscriptions: boolean;
  viewReceipts: boolean;
  addReceipts: boolean;
  editReceipts: boolean;
  deleteReceipts: boolean;
  printReceipts: boolean;
  viewExpenses: boolean;
  addExpenses: boolean;
  editExpenses: boolean;
  deleteExpenses: boolean;
  printExpenses: boolean;
  exportReports: boolean;
  printReports: boolean;
  manageUsers: boolean;
  manageSettings: boolean;
  manageBackups: boolean;
  restoreBackup: boolean;
  permissions: Record<string, boolean>;
}

export interface PublicSettings {
  fund_name: string;
  logo_url: string | null;
  currency: string;
  default_monthly_fee: number;
  allow_signups: boolean;
  auto_dues_enabled: boolean;
  allow_self_approval_demo?: boolean;
}

export interface FundSettings extends PublicSettings {
  id: string;
  logo_file: string | null;
  opening_balance: number;
  allow_self_approval_demo: boolean;
  auto_dues_enabled: boolean;
  cash_alert_threshold: number;
  commitment_alert_percent: number;
  approval_alert_days: number;
  reminder_day: number;
  updated_at: string;
}

export interface Attachment {
  id: string;
  entity_type: 'receipt' | 'expense';
  entity_id: string;
  file_name: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

export interface UploadedAttachment {
  file: string;
  name: string;
  mime: string | null;
  size: number;
}

export interface SessionPayload {
  user: User;
  capabilities: Capabilities;
  settings: PublicSettings;
}

export interface Member {
  id: string;
  member_no: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  monthly_fee: number;
  joined_on: string;
  active: boolean;
  notes: string | null;
  created_at: string;
  total_accrued: number;
  total_paid: number;
  arrears: number;
  open_months: number;
  due_months: number;
}

export type SubscriptionStatus = 'unpaid' | 'partial' | 'paid';

export interface Subscription {
  id: string;
  member_id: string;
  due_month: string;
  hijri_year: number | null;
  hijri_month: number | null;
  hijri_label?: string;
  amount: number;
  paid_amount: number;
  status: SubscriptionStatus;
  created_at: string;
  full_name?: string;
  member_no?: string;
  phone?: string | null;
  active?: boolean;
  remaining?: number;
  receipts?: Receipt[];
}

export type ReceiptType = 'subscription' | 'donation' | 'other';

export interface ReceiptAllocation {
  id: string;
  receipt_id: string;
  subscription_id: string;
  amount: number;
  due_month: string;
  hijri_year: number | null;
  hijri_month: number | null;
  subscription_amount: number;
}

export interface Receipt {
  id: string;
  receipt_no: number;
  receipt_type: ReceiptType;
  member_id: string | null;
  subscription_id: string | null;
  donor_name: string | null;
  amount: number;
  payment_method: 'cash' | 'bank_transfer';
  is_restricted: number | boolean;
  restricted_purpose: string | null;
  receipt_date: string;
  attachment_url: string | null;
  attachments?: Attachment[];
  allocations?: ReceiptAllocation[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
  verify_token: string;
  signed_by_name: string | null;
  signed_by_id: string | null;
  signed_at: string | null;
  signature_data: string | null;
  member_name?: string | null;
  member_no?: string | null;
  created_by_name?: string | null;
}

export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type ExpenseCategory =
  | 'social_aid'
  | 'charitable_aid'
  | 'medical_aid'
  | 'emergency_aid'
  | 'operational';

export interface ExpenseApproval {
  id: string;
  request_id: string;
  approver_id: string;
  approver_name: string;
  approver_role: string;
  stage: 1 | 2;
  decision: 'approved' | 'rejected';
  notes: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  request_no: number;
  category: ExpenseCategory;
  beneficiary_name: string;
  beneficiary_phone: string | null;
  description: string;
  amount: number;
  requested_date: string;
  status: ExpenseStatus;
  approval_count: number;
  payment_voucher_no: string | null;
  attachment_url: string | null;
  attachments?: Attachment[];
  notes: string | null;
  created_by: string | null;
  disbursed_by: string | null;
  disbursed_at: string | null;
  created_at: string;
  verify_token: string;
  signed_by_name: string | null;
  signed_by_id: string | null;
  signed_at: string | null;
  signature_data: string | null;
  created_by_name?: string | null;
  disbursed_by_name?: string | null;
  approvals: ExpenseApproval[];
}

export interface SmartAlert {
  id: string;
  severity: 'danger' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  link: string;
}

export interface DashboardData {
  restricted: boolean;
  alerts?: SmartAlert[];
  position: {
    opening_balance: number;
    total_receipts: number;
    total_paid_expenses: number;
    cash_balance: number;
    committed_pending: number;
    net_available: number;
  };
  arrears: {
    total_arrears: number;
    open_months: number;
    total_accrued: number;
    total_collected: number;
    members_in_arrears: number;
  };
  revenue_breakdown: {
    subscriptions: number;
    general_donations: number;
    restricted_donations: number;
    other: number;
  };
  expenses_by_category: Array<{ category: ExpenseCategory; label: string; total: number; count: number }>;
  pending_requests: Expense[];
  pending_summary: { count: number; total: number };
  approved_requests: Expense[];
  recent_receipts: Array<{
    id: string;
    receipt_no: number;
    receipt_type: ReceiptType;
    amount: number;
    receipt_date: string;
    party: string;
    is_restricted: number;
  }>;
  members: { total: number; active: number; new_this_month: number };
  trend: Array<{ month: string; receipts: number; expenses: number }>;
}

export interface MemberDashboard {
  restricted: true;
  member: Member | null;
  subscriptions?: Subscription[];
  receipts?: Receipt[];
  message?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  details: string | null;
  created_at: string;
}

export interface FundNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CashLedger {
  from: string;
  to: string;
  opening_balance: number;
  closing_balance: number;
  total_in: number;
  total_out: number;
  movements: Array<{
    id: string;
    kind: 'receipt' | 'expense';
    date: string;
    reference: string;
    description: string;
    party: string;
    debit: number;
    credit: number;
    balance: number;
    created_at: string;
  }>;
}

export interface AnnualReport {
  year: number;
  months: Array<{ month: string; receipts: number; expenses: number; net: number }>;
  totals: {
    receipts: number;
    expenses: number;
    net: number;
    collection_rate: number;
    active_members: number;
    total_members: number;
    new_members: number;
  };
  previous: { receipts: number; expenses: number; net: number };
  growth: { receipts: number | null; expenses: number | null; net: number | null };
  member_growth: Array<{ month: string; count: number }>;
}

export interface ApiError {
  error: string;
  code?: string;
}
