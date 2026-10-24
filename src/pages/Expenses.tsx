import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Edit3,
  FileText,
  HandCoins,
  Paperclip,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { api, apiErrorMessage, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
import { useToast } from '../lib/toast';
import {
  EXPENSE_CATEGORY_LABELS,
  expenseStatus,
  formatDate,
  formatDateTime,
  formatNumber,
  money,
  refExpense,
  todayISO,
} from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  TextInput,
  Textarea,
} from '../components/ui';
import { FileUpload } from '../components/FileUpload';
import { AmountInput, parseAmount } from '../components/AmountInput';
import { HijriDateInput } from '../components/HijriInputs';
import { PaymentVoucher } from '../components/PrintSheet';
import type { Expense, ExpenseApproval } from '../types';

interface ExpensesSummary {
  pending_total: number;
  pending_count: number;
  approved_total: number;
  approved_count: number;
  paid_total: number;
  paid_count: number;
  rejected_total: number;
  rejected_count: number;
  cash?: {
    cash_balance: number;
    committed_pending: number;
    net_available: number;
  };
}

const emptyForm = {
  category: 'social_aid',
  beneficiary_name: '',
  beneficiary_phone: '',
  description: '',
  amount: '',
  requested_date: todayISO(),
  notes: '',
  attachment_url: null as string | null,
};

export function ExpensesPage() {
  const { user, capabilities } = useAuth();
  const realtimeVersion = useRealtimeVersion();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpensesSummary>({
    pending_total: 0,
    pending_count: 0,
    approved_total: 0,
    approved_count: 0,
    paid_total: 0,
    paid_count: 0,
    rejected_total: 0,
    rejected_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(
    searchParams.get('new') === '1' && Boolean(capabilities?.addExpenses)
  );
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [approvalTarget, setApprovalTarget] = useState<{ expense: Expense; decision: 'approved' | 'rejected' } | null>(null);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [payTarget, setPayTarget] = useState<Expense | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [printExpense, setPrintExpense] = useState<Expense | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (category !== 'all') params.set('category', category);
      if (search.trim()) params.set('search', search.trim());
      const payload = await api.get<{ expenses: Expense[]; summary: ExpensesSummary }>(
        `/expenses?${params.toString()}`
      );
      setExpenses(payload.expenses);
      setSummary(payload.summary);
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => load(false), 220);
    return () => window.clearTimeout(timer);
  }, [status, category, search, realtimeVersion]);

  useEffect(() => {
    load();
    if (searchParams.get('status')) {
      setStatus(searchParams.get('status') ?? 'all');
    }
    if (searchParams.get('new') === '1' && capabilities?.addExpenses) setCreateOpen(true);
    if (searchParams.toString()) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setForm(emptyForm);
    setFormError('');
    setCreateOpen(true);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    if (form.description.trim().length < 5) {
      setFormError('وصف الحالة مطلوب (5 أحرف على الأقل)');
      return;
    }
    const value = parseAmount(form.amount);
    if (value <= 0) {
      setFormError('أدخل مبلغاً صحيحاً أكبر من صفر (بدون كسور)');
      return;
    }
    setSaving(true);
    try {
      await api.post('/expenses', {
        category: form.category,
        beneficiary_name: form.beneficiary_name.trim(),
        beneficiary_phone: form.beneficiary_phone.trim() || null,
        description: form.description.trim(),
        amount: value,
        requested_date: form.requested_date,
        notes: form.notes.trim() || null,
        attachment_url: form.attachment_url,
      });
      toast.success('تم إنشاء طلب الصرف. بانتظار اعتماد الأمين العام ثم مدير الصندوق');
      setCreateOpen(false);
      await load(false);
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  function startApproval(expense: Expense, decision: 'approved' | 'rejected') {
    setApprovalTarget({ expense, decision });
    setApprovalNotes('');
    setApprovalError('');
  }

  async function submitApproval(event: FormEvent) {
    event.preventDefault();
    if (!approvalTarget) return;
    setApproving(true);
    setApprovalError('');
    try {
      const payload = await api.post<{ expense: Expense }>(
        `/expenses/${approvalTarget.expense.id}/approve`,
        { decision: approvalTarget.decision, notes: approvalNotes.trim() || null }
      );
      const updated = payload.expense;
      if (updated.status === 'approved') {
        toast.success('اكتمل الاعتماد الثاني. الطلب جاهز لأمين الصندوق للصرف');
      } else if (approvalTarget.decision === 'rejected') {
        toast.info('تم رفض طلب الصرف');
      } else {
        toast.success('تم تسجيل اعتماد الأمين العام. بانتظار اعتماد مدير الصندوق');
      }
      setApprovalTarget(null);
      await load(false);
    } catch (submitError) {
      setApprovalError(apiErrorMessage(submitError));
    } finally {
      setApproving(false);
    }
  }

  async function submitPay() {
    if (!payTarget) return;
    setPaying(true);
    setPayError('');
    try {
      const payload = await api.post<{ expense: Expense; voucher_no: string }>(
        `/expenses/${payTarget.id}/pay`
      );
      toast.success(`تم صرف المبلغ وإصدار سند الصرف ${payload.voucher_no}`);
      setPayTarget(null);
      setPrintExpense(payload.expense);
      await load(false);
    } catch (submitError) {
      setPayError(apiErrorMessage(submitError));
    } finally {
      setPaying(false);
    }
  }

  function nextApprovalStage(expense: Expense) {
    const approvedStages = expense.approvals
      .filter((approval) => approval.decision === 'approved')
      .map((approval) => Number(approval.stage));
    if (approvedStages.includes(1)) return 2;
    return 1;
  }

  function canApprove(expense: Expense) {
    if (!capabilities?.approveExpenses) return false;
    if (expense.status !== 'pending') return false;
    const alreadyApproved = expense.approvals.some((approval) => approval.approver_id === user?.id);
    if (alreadyApproved) return false;
    if (expense.created_by === user?.id) return false;
    const stage = nextApprovalStage(expense);
    if (stage === 2 && expense.approvals.some((approval) => approval.decision === 'approved' && Number(approval.stage) === 2)) {
      return false;
    }
    return user?.role === 'admin'
      || (stage === 1 && user?.role === 'secretary_general')
      || (stage === 2 && user?.role === 'fund_manager');
  }

  function openEditExpense(expense: Expense) {
    setEditingExpense(expense);
    setEditForm({
      category: expense.category,
      beneficiary_name: expense.beneficiary_name,
      beneficiary_phone: expense.beneficiary_phone ?? '',
      description: expense.description,
      amount: String(expense.amount),
      requested_date: expense.requested_date,
      notes: expense.notes ?? '',
      attachment_url: expense.attachment_url ?? null,
    });
    setEditError('');
  }

  async function submitEditExpense(event: FormEvent) {
    event.preventDefault();
    if (!editingExpense) return;
    setEditError('');
    const value = parseAmount(editForm.amount);
    if (value <= 0) {
      setEditError('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }
    setSavingEdit(true);
    try {
      await api.patch(`/expenses/${editingExpense.id}`, {
        category: editForm.category,
        beneficiary_name: editForm.beneficiary_name.trim(),
        beneficiary_phone: editForm.beneficiary_phone.trim() || null,
        description: editForm.description.trim(),
        amount: value,
        requested_date: editForm.requested_date,
        notes: editForm.notes.trim() || null,
        attachment_url: editForm.attachment_url,
      });
      toast.success('تم تحديث طلب الصرف');
      setEditingExpense(null);
      await load(false);
    } catch (saveError) {
      setEditError(apiErrorMessage(saveError));
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteExpense(expense: Expense) {
    if (!window.confirm(`هل تريد حذف طلب الصرف ${refExpense(expense.request_no)} نهائياً؟`)) return;
    try {
      await api.del(`/expenses/${expense.id}`);
      toast.success('تم حذف طلب الصرف');
      await load(false);
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError));
    }
  }

  async function toggleApproval(expense: Expense, approval: ExpenseApproval) {
    const decision = approval.decision === 'approved' ? 'rejected' : 'approved';
    if (!window.confirm(`تغيير قرار ${approval.approver_name} إلى «${decision === 'approved' ? 'اعتماد' : 'رفض'}»؟`)) return;
    try {
      await api.patch(`/expenses/${expense.id}/approvals/${approval.id}`, { decision, notes: approval.notes });
      toast.success('تم تحديث قرار الاعتماد');
      await load(false);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  }

  async function deleteApproval(expense: Expense, approval: ExpenseApproval) {
    if (!window.confirm(`حذف قرار ${approval.approver_name} من سجل الاعتمادات؟`)) return;
    try {
      await api.del(`/expenses/${expense.id}/approvals/${approval.id}`);
      toast.success('تم حذف قرار الاعتماد');
      await load(false);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  }

  const cash = summary.cash;
  const collection = summary.pending_count + summary.approved_count + summary.paid_count;

  return (
    <div className="page-stack">
      <PageHeader
        title="طلبات الصرف والاعتمادات"
        subtitle="اعتماد مزدوج مستقل لكل صرف، مع رقابة على الرصيد النقدي وسند صرف رسمي."
        actions={
          capabilities?.addExpenses ? (
            <Button icon={<Plus size={17} />} onClick={openCreate}>طلب صرف جديد</Button>
          ) : null
        }
      />

      <Alert tone="gold" title="قواعد الرقابة المالية">
        تسلسل الاعتماد: المحاسب ينشئ الطلب ← الأمين العام يعتمده أولاً ← مدير الصندوق يعتمده ثانياً ←
        أمين الصندوق يصرف المبلغ. لا يمكن اعتماد طلب من قِبل منشئه، ولا يجوز للشخص نفسه الاعتماد مرتين.
        لا يتم الصرف إلا عند اكتمال الاعتمادين وكفاية الرصيد النقدي الفعلي.
      </Alert>

      <section className="stats-grid four">
        <StatCard label="بانتظار الاعتماد" value={formatNumber(summary.pending_count)} hint={money(summary.pending_total)} icon={<Clock3 size={21} />} tone="amber" />
        <StatCard label="معتمد بانتظار الصرف" value={formatNumber(summary.approved_count)} hint={money(summary.approved_total)} icon={<ShieldCheck size={21} />} tone="blue" />
        <StatCard label="تم صرفه" value={formatNumber(summary.paid_count)} hint={money(summary.paid_total)} icon={<CircleDollarSign size={21} />} tone="emerald" />
        <StatCard label="طلبات مرفوضة" value={formatNumber(summary.rejected_count)} hint={money(summary.rejected_total)} icon={<XCircle size={21} />} tone="red" />
      </section>

      {cash && (
        <div className="cash-strip">
          <div><span>الرصيد النقدي الفعلي</span><strong>{money(cash.cash_balance)}</strong></div>
          <div><span>معتمد بانتظار الصرف</span><strong className="text-gold">{money(cash.committed_pending)}</strong></div>
          <div><span>الصافي المتاح</span><strong className={cash.net_available >= 0 ? 'text-emerald' : 'text-danger'}>{money(cash.net_available)}</strong></div>
          <Badge tone={cash.net_available >= 0 ? 'success' : 'danger'} dot>
            {cash.net_available >= 0 ? 'الرصيد سليم' : 'تجاوز في الالتزامات'}
          </Badge>
        </div>
      )}

      <Card padding={false} className="expenses-card">
        <div className="table-toolbar filters-toolbar">
          <div className="toolbar-group">
            <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالمستفيد أو رقم الطلب…" />
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">جميع الفئات</option>
              {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>
          <Tabs
            active={status}
            onChange={setStatus}
            tabs={[
              { value: 'all', label: 'الكل', count: collection + summary.rejected_count },
              { value: 'pending', label: 'بانتظار الاعتماد', count: summary.pending_count },
              { value: 'approved', label: 'جاهز للصرف', count: summary.approved_count },
              { value: 'paid', label: 'المصروفة', count: summary.paid_count },
              { value: 'rejected', label: 'المرفوضة', count: summary.rejected_count },
            ]}
          />
        </div>

        {loading ? (
          <LoadingState label="جارٍ تحميل طلبات الصرف…" />
        ) : error ? (
          <div className="table-message"><Alert tone="danger" title="تعذر تحميل البيانات">{error}</Alert></div>
        ) : expenses.length === 0 ? (
          <EmptyState
            title="لا توجد طلبات صرف"
            description="أنشئ طلب صرف جديد لمساعدة مستفيد أو لتغطية مصروف تشغيلي."
            icon={<HandCoins size={28} />}
            action={capabilities?.addExpenses ? <Button onClick={openCreate} icon={<Plus size={17} />}>طلب صرف جديد</Button> : undefined}
          />
        ) : (
          <div className="expense-grid">
            {expenses.map((expense) => {
              const statusMeta = expenseStatus(expense.status);
              const approvedEntries = expense.approvals
                .filter((approval) => approval.decision === 'approved')
                .sort((a, b) => Number(a.stage) - Number(b.stage));
              const rejection = expense.approvals.find((approval) => approval.decision === 'rejected');
              const isCreator = expense.created_by === user?.id;
              return (
                <article key={expense.id} className={`expense-card status-${expense.status}`}>
                  <header className="expense-card-head">
                    <div className="expense-ref">
                      <span className="expense-ref-icon"><HandCoins size={19} /></span>
                      <div>
                        <strong>{refExpense(expense.request_no)}</strong>
                        <small>{formatDate(expense.requested_date)}</small>
                      </div>
                    </div>
                    <Badge tone={statusMeta.tone} dot>{statusMeta.label}</Badge>
                  </header>

                  <div className="expense-amount">
                    <span>{EXPENSE_CATEGORY_LABELS[expense.category]}</span>
                    <strong>{money(expense.amount)}</strong>
                  </div>

                  <div className="expense-beneficiary">
                    <div>
                      <span>المستفيد</span>
                      <strong>{expense.beneficiary_name}</strong>
                      <small dir="ltr">{expense.beneficiary_phone || '—'}</small>
                    </div>
                    <p>{expense.description}</p>
                  </div>

                  {expense.attachment_url && (
                    <a className="expense-attachment" href={fileUrl(expense.attachment_url)} target="_blank" rel="noreferrer">
                      <Paperclip size={15} /> عرض المستند الداعم
                    </a>
                  )}

                  <div className="approval-tracker">
                    <div className="track-step done">
                      <span className="track-node"><UserCheck size={15} /></span>
                      <strong>المنشئ</strong>
                      <small>{expense.created_by_name ?? '—'}</small>
                      <em>{formatDate(expense.created_at)}</em>
                    </div>
                    {[0, 1].map((index) => {
                      const approval: ExpenseApproval | undefined = approvedEntries[index];
                      return (
                        <div key={index} className={`track-step ${approval ? 'done' : 'waiting'}`}>
                          <span className="track-node">{approval ? <Check size={15} /> : <Clock3 size={15} />}</span>
                          <strong>{index === 0 ? 'الاعتماد الأول' : 'الاعتماد الثاني'}</strong>
                          <small>{approval ? `${approval.approver_name} — ${index === 0 ? 'الأمين العام' : 'مدير الصندوق'}` : (index === 0 ? 'بانتظار الأمين العام' : 'بانتظار مدير الصندوق')}</small>
                          <em>{approval ? formatDate(approval.created_at) : '—'}</em>
                          {approval && user?.role === 'admin' && (
                            <div className="approval-admin-actions">
                              <button type="button" className="icon-btn" title="تغيير القرار" onClick={() => toggleApproval(expense, approval)}>
                                <Edit3 size={13} />
                              </button>
                              <button type="button" className="icon-btn danger-text" title="حذف القرار" onClick={() => deleteApproval(expense, approval)}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className={`track-step ${expense.status === 'paid' ? 'done' : expense.status === 'rejected' ? 'rejected' : 'waiting'}`}>
                      <span className="track-node">
                        {expense.status === 'paid' ? <BadgeCheck size={15} /> : expense.status === 'rejected' ? <XCircle size={15} /> : <Wallet size={15} />}
                      </span>
                      <strong>الصرف</strong>
                      <small>{expense.status === 'paid' ? expense.payment_voucher_no : expense.status === 'rejected' ? 'مرفوض' : 'بانتظار الصرف'}</small>
                      <em>{expense.disbursed_at ? formatDate(expense.disbursed_at) : '—'}</em>
                    </div>
                  </div>

                  {rejection && (
                    <div className="rejection-note">
                      <XCircle size={15} />
                      <span>رفضه {rejection.approver_name}{rejection.notes ? ` — ${rejection.notes}` : ''}</span>
                    </div>
                  )}

                  {expense.notes && <p className="expense-notes">ملاحظات: {expense.notes}</p>}

                  <footer className="expense-card-foot">
                    {expense.status === 'pending' && (
                      <>
                        {canApprove(expense) ? (
                          <div className="expense-actions">
                            <Button size="sm" variant="primary" icon={<Check size={15} />} onClick={() => startApproval(expense, 'approved')}>
                              اعتماد
                            </Button>
                            <Button size="sm" variant="ghost" icon={<XCircle size={15} />} onClick={() => startApproval(expense, 'rejected')}>
                              رفض
                            </Button>
                          </div>
                        ) : isCreator ? (
                          <span className="expense-hint"><AlertTriangle size={15} /> لا يمكنك اعتماد طلبك — يلزم اعتماد شخص آخر</span>
                        ) : expense.approvals.some((approval) => approval.approver_id === user?.id) ? (
                          <span className="expense-hint"><CheckCircle2 size={15} /> اعتمدت هذا الطلب — بانتظار شخص آخر</span>
                        ) : (
                          <span className="expense-hint"><Clock3 size={15} /> بانتظار اعتماد {2 - expense.approval_count} شخص</span>
                        )}
                      </>
                    )}

                    {expense.status === 'approved' && (
                      capabilities?.payExpenses ? (
                        <div className="expense-actions">
                          <Button size="sm" variant="gold" icon={<Wallet size={15} />} onClick={() => { setPayError(''); setPayTarget(expense); }}>
                            صرف المبلغ
                          </Button>
                          <span className="expense-hint"><BadgeCheck size={15} /> مكتمل الاعتماد</span>
                        </div>
                      ) : (
                        <span className="expense-hint"><ShieldCheck size={15} /> معتمد — بانتظار أمين الصندوق للصرف</span>
                      )
                    )}

                    {expense.status === 'paid' && (
                      <div className="expense-actions">
                        <Button size="sm" variant="secondary" icon={<Printer size={15} />} onClick={() => setPrintExpense(expense)}>
                          طباعة سند الصرف
                        </Button>
                        <span className="expense-hint"><BadgeCheck size={15} /> صُرف بواسطة {expense.disbursed_by_name ?? '—'}</span>
                      </div>
                    )}

                    {expense.status === 'rejected' && (
                      <span className="expense-hint"><XCircle size={15} /> طلب مرفوض — لا يمكن صرفه</span>
                    )}

                    {(isCreator || user?.role === 'admin') && (expense.status === 'pending' || expense.status === 'rejected') && (
                      <div className="expense-actions expense-admin-actions">
                        {capabilities?.editExpenses && expense.approvals.length === 0 && (
                          <Button size="sm" variant="secondary" icon={<Edit3 size={15} />} onClick={() => openEditExpense(expense)}>
                            تعديل
                          </Button>
                        )}
                        {capabilities?.deleteExpenses && (
                          <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => deleteExpense(expense)}>
                            حذف
                          </Button>
                        )}
                      </div>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      {createOpen && (
        <Modal
          title="طلب صرف جديد"
          subtitle="سيبدأ الطلب بحالة «بانتظار الاعتماد» ويحتاج اعتماد شخصين مختلفين"
          icon={<HandCoins size={20} />}
          size="lg"
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>إلغاء</Button>
              <Button type="submit" form="expense-form" loading={saving} icon={<HandCoins size={17} />}>
                إرسال طلب الصرف
              </Button>
            </>
          }
        >
          <form id="expense-form" onSubmit={submitCreate} className="form-stack">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="form-grid two">
              <Field label="فئة الصرف" required>
                <Select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                >
                  {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="تاريخ الطلب (هجري)" required>
                <HijriDateInput
                  value={form.requested_date}
                  onChange={(value) => setForm((current) => ({ ...current, requested_date: value }))}
                />
              </Field>
              <Field label="اسم المستفيد" required>
                <TextInput
                  value={form.beneficiary_name}
                  onChange={(event) => setForm((current) => ({ ...current, beneficiary_name: event.target.value }))}
                  placeholder="اسم الشخص أو الجهة المستفيدة"
                  required
                />
              </Field>
              <Field label="هاتف المستفيد">
                <TextInput
                  value={form.beneficiary_phone}
                  onChange={(event) => setForm((current) => ({ ...current, beneficiary_phone: event.target.value }))}
                  placeholder="7xxxxxxxx"
                  dir="ltr"
                />
              </Field>
              <Field label="المبلغ المطلوب (ر.ي)" required hint="أرقام صحيحة فقط — بدون كسور">
                <AmountInput
                  value={form.amount}
                  onChange={(value) => setForm((current) => ({ ...current, amount: value }))}
                  required
                />
              </Field>
              <Field label="ملاحظات">
                <TextInput
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="ملاحظة إضافية (اختياري)"
                />
              </Field>
            </div>
            <Field label="وصف الحالة / سبب الصرف" required>
              <Textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="اشرح الحالة والظروف والجهة المستفيدة والمستندات المرفقة…"
                rows={4}
                required
              />
            </Field>
            <FileUpload
              value={form.attachment_url}
              onChange={(file) => setForm((current) => ({ ...current, attachment_url: file }))}
              label="مستند داعم (اختياري)"
              hint="تقرير طبي، بحث اجتماعي، عرض سعر… صورة أو PDF بحد أقصى 8 ميجابايت"
            />
            <Alert tone="info">
              سيُسجل الطلب باسمك، ولا يمكنك اعتماده بنفسك. يعتمده الأمين العام أولاً ثم مدير الصندوق،
              وبعدها يصرفه أمين الصندوق.
            </Alert>
          </form>
        </Modal>
      )}

      {editingExpense && (
        <Modal
          title={`تعديل طلب الصرف ${refExpense(editingExpense.request_no)}`}
          subtitle="يمكن تعديل الطلب قبل بدء الاعتماد فقط"
          icon={<Edit3 size={20} />}
          size="lg"
          onClose={() => setEditingExpense(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditingExpense(null)} disabled={savingEdit}>إلغاء</Button>
              <Button type="submit" form="expense-edit-form" loading={savingEdit}>حفظ التعديلات</Button>
            </>
          }
        >
          <form id="expense-edit-form" onSubmit={submitEditExpense} className="form-stack">
            {editError && <Alert tone="danger">{editError}</Alert>}
            <div className="form-grid two">
              <Field label="فئة الصرف" required>
                <Select
                  value={editForm.category}
                  onChange={(event) => setEditForm((current) => ({ ...current, category: event.target.value }))}
                >
                  {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="تاريخ الطلب (هجري)" required>
                <HijriDateInput
                  value={editForm.requested_date}
                  onChange={(value) => setEditForm((current) => ({ ...current, requested_date: value }))}
                />
              </Field>
              <Field label="اسم المستفيد" required>
                <TextInput
                  value={editForm.beneficiary_name}
                  onChange={(event) => setEditForm((current) => ({ ...current, beneficiary_name: event.target.value }))}
                  required
                />
              </Field>
              <Field label="هاتف المستفيد">
                <TextInput
                  value={editForm.beneficiary_phone}
                  onChange={(event) => setEditForm((current) => ({ ...current, beneficiary_phone: event.target.value }))}
                  dir="ltr"
                />
              </Field>
              <Field label="المبلغ المطلوب (ر.ي)" required hint="أرقام صحيحة فقط">
                <AmountInput
                  value={editForm.amount}
                  onChange={(value) => setEditForm((current) => ({ ...current, amount: value }))}
                  required
                />
              </Field>
              <Field label="ملاحظات">
                <TextInput
                  value={editForm.notes}
                  onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </Field>
            </div>
            <Field label="وصف الحالة / سبب الصرف" required>
              <Textarea
                value={editForm.description}
                onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))}
                rows={4}
                required
              />
            </Field>
            <FileUpload
              value={editForm.attachment_url}
              onChange={(file) => setEditForm((current) => ({ ...current, attachment_url: file }))}
              label="مستند داعم (اختياري)"
            />
          </form>
        </Modal>
      )}

      {approvalTarget && (
        <Modal
          title={approvalTarget.decision === 'approved' ? 'تأكيد اعتماد طلب الصرف' : 'رفض طلب الصرف'}
          subtitle={`${refExpense(approvalTarget.expense.request_no)} — ${approvalTarget.expense.beneficiary_name}`}
          icon={approvalTarget.decision === 'approved' ? <ShieldCheck size={20} /> : <XCircle size={20} />}
          size="md"
          onClose={() => setApprovalTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setApprovalTarget(null)} disabled={approving}>إلغاء</Button>
              <Button
                type="submit"
                form="approval-form"
                variant={approvalTarget.decision === 'approved' ? 'primary' : 'danger'}
                loading={approving}
              >
                {approvalTarget.decision === 'approved' ? 'تأكيد الاعتماد' : 'تأكيد الرفض'}
              </Button>
            </>
          }
        >
          <form id="approval-form" onSubmit={submitApproval} className="form-stack">
            {approvalError && <Alert tone="danger">{approvalError}</Alert>}
            <div className="approval-dialog-summary">
              <div><span>المبلغ</span><strong>{money(approvalTarget.expense.amount)}</strong></div>
              <div><span>المستفيد</span><strong>{approvalTarget.expense.beneficiary_name}</strong></div>
              <div><span>الاعتمادات الحالية</span><strong>{approvalTarget.expense.approval_count}/2</strong></div>
            </div>
            {approvalTarget.decision === 'approved' ? (
              <Alert tone="info" title="أثر الاعتماد">
                {nextApprovalStage(approvalTarget.expense) === 2
                  ? 'هذا هو الاعتماد الثاني (مدير الصندوق): سيصبح الطلب معتمداً نهائياً وجاهزاً لأمين الصندوق للصرف.'
                  : 'هذا هو الاعتماد الأول (الأمين العام): سيبقى الطلب بانتظار اعتماد مدير الصندوق.'}
              </Alert>
            ) : (
              <Alert tone="danger" title="أثر الرفض">
                سيتم رفض الطلب نهائياً ولن يمكن صرفه. لا يمكن التراجع عن هذا القرار من النظام.
              </Alert>
            )}
            <Field label="ملاحظات القرار">
              <Textarea
                value={approvalNotes}
                onChange={(event) => setApprovalNotes(event.target.value)}
                placeholder="سبب الاعتماد أو الرفض (اختياري)…"
                rows={3}
              />
            </Field>
          </form>
        </Modal>
      )}

      {payTarget && (
        <Modal
          title="صرف مبلغ وإصدار سند صرف"
          subtitle={`${refExpense(payTarget.request_no)} — ${payTarget.beneficiary_name}`}
          icon={<Wallet size={20} />}
          size="md"
          onClose={() => setPayTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPayTarget(null)} disabled={paying}>إلغاء</Button>
              <Button
                variant="gold"
                onClick={submitPay}
                loading={paying}
                disabled={Boolean(cash && cash.cash_balance < payTarget.amount)}
                icon={<Wallet size={17} />}
              >
                تأكيد الصرف وإصدار السند
              </Button>
            </>
          }
        >
          <div className="form-stack">
            {payError && <Alert tone="danger">{payError}</Alert>}
            <div className="approval-dialog-summary">
              <div><span>المبلغ المطلوب</span><strong className="text-gold">{money(payTarget.amount)}</strong></div>
              <div><span>الرصيد النقدي الفعلي</span><strong>{cash ? money(cash.cash_balance) : '—'}</strong></div>
              <div><span>الصافي المتاح</span><strong>{cash ? money(cash.net_available) : '—'}</strong></div>
            </div>
            {cash && cash.cash_balance < payTarget.amount ? (
              <Alert tone="danger" title="الرصيد غير كافٍ">
                لا يمكن تنفيذ الصرف: الرصيد النقدي الفعلي ({money(cash.cash_balance)}) أقل من مبلغ الطلب
                ({money(payTarget.amount)}). يجب تحصيل إيرادات إضافية أولاً.
              </Alert>
            ) : (
              <Alert tone="success" title="الرصيد كافٍ">
                سيتم خصم المبلغ من الرصيد النقدي الفعلي، وتوليد رقم سند صرف رسمي تلقائياً.
              </Alert>
            )}
            <div className="pay-approval-box">
              <strong>المعتمدان</strong>
              {payTarget.approvals.filter((approval) => approval.decision === 'approved').map((approval) => (
                <div key={approval.id}>
                  <span>{approval.approver_name}</span>
                  <small>{formatDateTime(approval.created_at)}</small>
                </div>
              ))}
            </div>
            <Alert tone="warning">
              بعد الصرف لا يمكن التراجع عن العملية من النظام. تأكد من استلام المستفيد للمبلغ قبل التأكيد.
            </Alert>
          </div>
        </Modal>
      )}

      {printExpense && <PaymentVoucher expense={printExpense} onClose={() => setPrintExpense(null)} />}
    </div>
  );
}
