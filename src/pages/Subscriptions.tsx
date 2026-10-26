import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Banknote,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Coins,
  Edit3,
  Printer,
  ReceiptText,
  Trash2,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
import { useToast } from '../lib/toast';
import { formatNumber, money, monthLabel, monthOptions, subscriptionStatus, todayISO } from '../lib/format';
import {
  currentHijriMonthKey,
  hijriMonthKey,
  hijriMonthLabel,
} from '../lib/hijri';
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
  Progress,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  TextInput,
} from '../components/ui';
import { AmountInput, parseAmount } from '../components/AmountInput';
import { HijriDateInput, HijriMonthInput } from '../components/HijriInputs';
import { ReceiptVoucher } from '../components/PrintSheet';
import type { Member, Receipt, Subscription } from '../types';

interface SubscriptionSummary {
  count: number;
  total: number;
  paid: number;
  remaining: number;
}

export function SubscriptionsPage() {
  const { capabilities } = useAuth();
  const realtimeVersion = useRealtimeVersion();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState(currentHijriMonthKey());
  const [status, setStatus] = useState<'all' | 'unpaid' | 'partial' | 'paid'>(
    searchParams.get('status') === 'unpaid' ? 'unpaid' : 'all'
  );
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Subscription[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [summary, setSummary] = useState<SubscriptionSummary>({ count: 0, total: 0, paid: 0, remaining: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [generateOpen, setGenerateOpen] = useState(
    searchParams.get('generate') === '1' && Boolean(capabilities?.addSubscriptions)
  );
  const [generateFrom, setGenerateFrom] = useState(month);
  const [generateTo, setGenerateTo] = useState(month);
  const [generateMembers, setGenerateMembers] = useState<Member[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const [paying, setPaying] = useState<Subscription | null>(null);
  const [payForm, setPayForm] = useState({
    payment_method: 'cash',
    receipt_date: todayISO(),
    notes: '',
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [printReceipt, setPrintReceipt] = useState<Receipt | null>(null);

  const [editingDue, setEditingDue] = useState<Subscription | null>(null);
  const [editForm, setEditForm] = useState({ amount: '', month: currentHijriMonthKey() });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const months = useMemo(() => monthOptions(30, 4), []);

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ hijri: month });
      if (status !== 'all') params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      const payload = await api.get<{
        subscriptions: Subscription[];
        summary: SubscriptionSummary;
        month: string;
      }>(`/subscriptions?${params.toString()}`);
      setRows(payload.subscriptions);
      setSelected((current) => current.filter((id) => payload.subscriptions.some((row) => row.id === id)));
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
  }, [month, status, search, realtimeVersion]);

  useEffect(() => {
    load();
    if (searchParams.get('generate') === '1' && capabilities?.addSubscriptions) {
      setGenerateFrom(searchParams.get('month') ?? month);
      setGenerateTo(searchParams.get('month') ?? month);
      openGenerate();
    }
    if (searchParams.get('pay') === '1') {
      toast.info('اختر استحقاقاً غير مسدد من القائمة لتسجيل السداد');
    }
    if (searchParams.toString()) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openGenerate() {
    setGenerateError('');
    setGenerateOpen(true);
    if (!generateMembers.length) {
      try {
        const payload = await api.get<{ members: Member[] }>('/members?status=active');
        setGenerateMembers(payload.members);
        setSelectedMemberIds(payload.members.map((member) => member.id));
      } catch (loadError) {
        setGenerateError(apiErrorMessage(loadError));
      }
    }
  }

  function openPayment(subscription: Subscription) {
    setPaying(subscription);
    setPaymentError('');
    setPayForm({ payment_method: 'cash', receipt_date: todayISO(), notes: '' });
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!paying) return;
    setPaymentError('');
    const remaining = paying.remaining ?? paying.amount - paying.paid_amount;
    setSavingPayment(true);
    try {
      const payload = await api.post<{ receipt: Receipt }>(`/subscriptions/${paying.id}/pay`, {
        amount: remaining,
        payment_method: payForm.payment_method,
        receipt_date: payForm.receipt_date,
        notes: payForm.notes,
      });
      toast.success('تم سداد كامل الاستحقاق وإصدار سند القبض');
      setPaying(null);
      setPrintReceipt(payload.receipt);
      await load(false);
    } catch (submitError) {
      setPaymentError(apiErrorMessage(submitError));
    } finally {
      setSavingPayment(false);
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setGenerateError('');
    if (!selectedMemberIds.length) {
      setGenerateError('اختر عضواً واحداً على الأقل');
      return;
    }
    setGenerating(true);
    try {
      const payload = await api.post<{
        generated: number;
        skipped: number;
        months: number;
        month_labels: string[];
      }>('/subscriptions/generate', {
        from_hijri: generateFrom,
        to_hijri: generateTo,
        member_ids: selectedMemberIds,
      });
      toast.success(
        `تم توليد ${formatNumber(payload.generated)} استحقاقاً على ${formatNumber(payload.months)} شهراً، وتخطي ${formatNumber(payload.skipped)} مكرر`
      );
      setGenerateOpen(false);
      setMonth(generateFrom);
      await load(false);
    } catch (generateErrorValue) {
      setGenerateError(apiErrorMessage(generateErrorValue));
    } finally {
      setGenerating(false);
    }
  }

  function openEditDue(row: Subscription) {
    setEditingDue(row);
    setEditError('');
    setEditForm({
      amount: String(row.amount),
      month: row.hijri_year && row.hijri_month
        ? hijriMonthKey(row.hijri_year, row.hijri_month)
        : currentHijriMonthKey(),
    });
  }

  async function submitEditDue(event: FormEvent) {
    event.preventDefault();
    if (!editingDue) return;
    setEditError('');
    setSavingEdit(true);
    try {
      await api.patch(`/subscriptions/${editingDue.id}`, {
        amount: parseAmount(editForm.amount),
        hijri: editForm.month,
      });
      toast.success('تم تحديث الاستحقاق');
      setEditingDue(null);
      await load(false);
    } catch (editErrorValue) {
      setEditError(apiErrorMessage(editErrorValue));
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteDue(row: Subscription) {
    const rowMonth = row.hijri_year && row.hijri_month
      ? hijriMonthLabel(hijriMonthKey(row.hijri_year, row.hijri_month))
      : monthLabel(String(row.due_month).slice(0, 7));
    if (!window.confirm(`هل تريد حذف استحقاق ${rowMonth} للعضو «${row.full_name}»؟`)) return;
    try {
      await api.del(`/subscriptions/${row.id}`);
      toast.success('تم حذف الاستحقاق');
      await load(false);
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError));
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function toggleAllSelected() {
    setSelected((current) =>
      current.length === rows.length ? [] : rows.map((row) => row.id)
    );
  }

  async function bulkDeleteDues() {
    if (!selected.length) return;
    if (!window.confirm(`هل تريد حذف ${formatNumber(selected.length)} استحقاق محدد؟ سيتم منع حذف الاستحقاقات المسددة أو المرتبطة بسندات.`)) return;
    setBulkDeleting(true);
    try {
      const result = await api.post<{ deleted: number; blocked: number; missing: number; errors: string[] }>(
        '/subscriptions/bulk-delete',
        { ids: selected }
      );
      toast.success(`تم حذف ${formatNumber(result.deleted)} استحقاق`);
      if (result.blocked || result.missing) {
        toast.error(result.errors[0] ?? `تعذر حذف ${formatNumber(result.blocked + result.missing)} استحقاق`);
      }
      setSelected([]);
      await load(false);
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError));
    } finally {
      setBulkDeleting(false);
    }
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  const collectionRate = summary.total > 0 ? (summary.paid / summary.total) * 100 : 0;
  const monthText = hijriMonthLabel(month);

  return (
    <div className="page-stack">
      <PageHeader
        title="الاستحقاقات الشهرية"
        subtitle="استحقاق شهري هجري تلقائي، سداد شهر واحد من القائمة، أو سداد اشتراكات عدة أشهر من سندات القبض."
        actions={
          <>
            {capabilities?.addReceipts && (
              <Button
                variant="secondary"
                icon={<ReceiptText size={17} />}
                onClick={() => navigate('/receipts?new=1&type=subscription')}
              >
                سداد عدة أشهر
              </Button>
            )}
            {capabilities?.addSubscriptions && (
              <Button
                variant="secondary"
                icon={<CalendarPlus size={17} />}
                onClick={openGenerate}
              >
                توليد استحقاقات فترة
              </Button>
            )}
            {capabilities?.paySubscriptions && (
              <Button
                icon={<Banknote size={17} />}
                onClick={() => {
                  setStatus('unpaid');
                  toast.info('اختر استحقاقاً من القائمة لتسجيل السداد');
                }}
              >
                تحصيل سداد
              </Button>
            )}
          </>
        }
      />

      <Alert tone="info" title="الاستحقاقات التلقائية">
        يتم إنشاء استحقاق الشهر الهجري الجديد تلقائياً لجميع الأعضاء النشطين عند أول دخول للنظام أو عبر المهمة اليومية.
        لا تحتاج إلى الضغط على زر التوليد كل شهر. زر «توليد استحقاقات فترة» مخصص للفترات السابقة أو الجماعية.
      </Alert>

      <section className="stats-grid four">
        <StatCard label="عدد الاستحقاقات" value={formatNumber(summary.count)} hint={monthText} icon={<CalendarClock size={21} />} tone="slate" />
        <StatCard label="إجمالي المستحق" value={money(summary.total)} hint="قيمة الاشتراكات المولدة" icon={<Coins size={21} />} tone="blue" />
        <StatCard label="المحصل" value={money(summary.paid)} hint={`نسبة التحصيل ${Math.round(collectionRate)}%`} icon={<Wallet size={21} />} tone="emerald" />
        <StatCard label="المتبقي للتحصيل" value={money(summary.remaining)} hint="لا يدخل ضمن الرصيد النقدي" icon={<ReceiptText size={21} />} tone="amber" />
      </section>

      <Card className="collection-card">
        <div className="collection-head">
          <div>
            <span>تحصيل استحقاقات {monthText}</span>
            <strong>{Math.round(collectionRate)}%</strong>
          </div>
          <div className="collection-values">
            <span>محصل: {money(summary.paid)}</span>
            <span>متبقي: {money(summary.remaining)}</span>
          </div>
        </div>
        <Progress value={summary.paid} max={summary.total} />
      </Card>

      <Card padding={false} className="table-card">
        <div className="table-toolbar">
          <div className="toolbar-group">
            <div className="month-select">
              <CalendarClock size={17} />
              <Select value={month} onChange={(event) => setMonth(event.target.value)}>
                {months.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالعضو أو رقم العضوية…" />
          </div>
          <Tabs
            active={status}
            onChange={setStatus}
            tabs={[
              { value: 'all', label: 'الكل' },
              { value: 'unpaid', label: 'غير مسدد' },
              { value: 'partial', label: 'سداد جزئي قديم' },
              { value: 'paid', label: 'مسدد' },
            ]}
          />
          {capabilities?.deleteSubscriptions && selected.length > 0 && (
            <div className="selection-actions">
              <span>تم اختيار {formatNumber(selected.length)}</span>
              <Button variant="danger" size="sm" icon={<Trash2 size={15} />} loading={bulkDeleting} onClick={bulkDeleteDues}>
                حذف المحدد
              </Button>
              <button type="button" className="text-button" onClick={() => setSelected([])}>إلغاء</button>
            </div>
          )}
        </div>

        {loading ? (
          <LoadingState label="جارٍ تحميل الاستحقاقات…" />
        ) : error ? (
          <div className="table-message"><Alert tone="danger" title="تعذر تحميل البيانات">{error}</Alert></div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="لا توجد استحقاقات لهذا الشهر"
            description="سيتم إنشاء استحقاق الشهر تلقائياً عند أول دخول. يمكنك أيضاً توليد فترة سابقة أو جماعية."
            icon={<CalendarPlus size={28} />}
            action={capabilities?.addSubscriptions ? (
              <Button onClick={openGenerate} icon={<CalendarPlus size={17} />}>توليد استحقاقات فترة</Button>
            ) : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table responsive-table">
              <thead>
                <tr>
                  {capabilities?.deleteSubscriptions && (
                    <th className="checkbox-cell">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selected.length === rows.length}
                        onChange={toggleAllSelected}
                        aria-label="تحديد جميع الاستحقاقات"
                      />
                    </th>
                  )}
                  <th>العضو</th>
                  <th>الشهر الهجري</th>
                  <th>المستحق</th>
                  <th>المسدد</th>
                  <th>المتبقي</th>
                  <th>الحالة</th>
                  <th>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowStatus = subscriptionStatus(row.status);
                  const remaining = row.remaining ?? row.amount - row.paid_amount;
                  const rowMonth = row.hijri_year && row.hijri_month
                    ? hijriMonthLabel(hijriMonthKey(row.hijri_year, row.hijri_month))
                    : monthText;
                  return (
                    <tr key={row.id} className={selected.includes(row.id) ? 'row-selected' : undefined}>
                      {capabilities?.deleteSubscriptions && (
                        <td className="checkbox-cell" data-label="تحديد">
                          <input
                            type="checkbox"
                            checked={selected.includes(row.id)}
                            onChange={() => toggleSelected(row.id)}
                            aria-label={`تحديد استحقاق ${row.full_name}`}
                          />
                        </td>
                      )}
                      <td data-label="العضو">
                        <div className="person-cell">
                          <span className="avatar avatar-xs">{(row.full_name ?? '?').charAt(0)}</span>
                          <div>
                            <strong>{row.full_name}</strong>
                            <small>{row.member_no}</small>
                          </div>
                        </div>
                      </td>
                      <td data-label="الشهر">{rowMonth}</td>
                      <td data-label="المستحق">{money(row.amount)}</td>
                      <td data-label="المسدد" className="text-emerald">{money(row.paid_amount)}</td>
                      <td data-label="المتبقي" className={remaining > 0 ? 'danger-text' : ''}>{money(remaining)}</td>
                      <td data-label="الحالة"><Badge tone={rowStatus.tone} dot>{rowStatus.label}</Badge></td>
                      <td data-label="الإجراء">
                        <div className="row-actions">
                          {row.status === 'paid' ? (
                            <span className="paid-check"><CheckCircle2 size={18} /> مكتمل</span>
                          ) : capabilities?.paySubscriptions ? (
                            <Button size="sm" variant="soft" icon={<Banknote size={15} />} onClick={() => openPayment(row)}>
                              سداد كامل
                            </Button>
                          ) : null}
                          {capabilities?.editSubscriptions && (
                            <button type="button" className="icon-btn" title="تعديل الاستحقاق" onClick={() => openEditDue(row)}>
                              <Edit3 size={16} />
                            </button>
                          )}
                          {capabilities?.deleteSubscriptions && row.status !== 'paid' && (
                            <button type="button" className="icon-btn danger-text" title="حذف الاستحقاق" onClick={() => deleteDue(row)}>
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {generateOpen && (
        <Modal
          title="توليد استحقاقات هجرية"
          subtitle="اختر شهراً واحداً أو فترة أشهر، وحدد الأعضاء المطلوبين. يتم تخطي المكرر تلقائياً."
          icon={<CalendarPlus size={20} />}
          onClose={() => setGenerateOpen(false)}
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setGenerateOpen(false)} disabled={generating}>إلغاء</Button>
              <Button type="submit" form="generate-form" loading={generating} icon={<CalendarPlus size={17} />}>
                توليد الاستحقاقات
              </Button>
            </>
          }
        >
          <form id="generate-form" onSubmit={generate} className="form-stack">
            {generateError && <Alert tone="danger">{generateError}</Alert>}
            <div className="form-grid two">
              <Field label="من شهر (هجري)" required>
                <HijriMonthInput value={generateFrom} onChange={setGenerateFrom} back={60} forward={12} />
              </Field>
              <Field label="إلى شهر (هجري)" required>
                <HijriMonthInput value={generateTo} onChange={setGenerateTo} back={60} forward={12} />
              </Field>
            </div>
            <div className="member-picker-head">
              <strong>الأعضاء ({formatNumber(selectedMemberIds.length)} من {formatNumber(generateMembers.length)})</strong>
              <button
                type="button"
                className="text-button"
                onClick={() => setSelectedMemberIds(
                  selectedMemberIds.length === generateMembers.length ? [] : generateMembers.map((member) => member.id)
                )}
              >
                {selectedMemberIds.length === generateMembers.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
              </button>
            </div>
            <div className="member-picker">
              {generateMembers.map((member) => (
                <label key={member.id} className="member-pick-row">
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(member.id)}
                    onChange={() => toggleMember(member.id)}
                  />
                  <span className="avatar avatar-xs">{member.full_name.charAt(0)}</span>
                  <span>
                    <strong>{member.full_name}</strong>
                    <small>{member.member_no} — {money(member.monthly_fee)}</small>
                  </span>
                </label>
              ))}
              {!generateMembers.length && <p className="muted">لا يوجد أعضاء نشطون.</p>}
            </div>
            <Alert tone="info" title="آلية التوليد">
              يتم إنشاء استحقاق واحد لكل عضو لكل شهر هجري في الفترة المحددة، بقيمة الاشتراك الشهري المسجل.
              لن يتم إنشاء استحقاق مكرر، ولن تتأثر الأعضاء الموقوفة.
            </Alert>
          </form>
        </Modal>
      )}

      {paying && (
        <Modal
          title="سداد كامل استحقاق الشهر"
          subtitle={`${paying.full_name} — ${paying.hijri_year && paying.hijri_month ? hijriMonthLabel(hijriMonthKey(paying.hijri_year, paying.hijri_month)) : monthLabel(String(paying.due_month).slice(0, 7))}`}
          icon={<Banknote size={20} />}
          onClose={() => setPaying(null)}
          size="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPaying(null)} disabled={savingPayment}>إلغاء</Button>
              <Button type="submit" form="payment-form" loading={savingPayment} icon={<ReceiptText size={17} />}>
                سداد كامل وإصدار سند
              </Button>
            </>
          }
        >
          <form id="payment-form" onSubmit={submitPayment} className="form-stack">
            {paymentError && <Alert tone="danger">{paymentError}</Alert>}
            <div className="payment-summary">
              <div><span>المستحق</span><strong>{money(paying.amount)}</strong></div>
              <div><span>المسدد سابقاً</span><strong>{money(paying.paid_amount)}</strong></div>
              <div><span>المطلوب سداده كاملاً</span><strong className="danger-text">{money(paying.remaining ?? paying.amount - paying.paid_amount)}</strong></div>
            </div>
            <div className="form-grid two">
              <Field label="طريقة الدفع" required>
                <Select
                  value={payForm.payment_method}
                  onChange={(event) => setPayForm((current) => ({ ...current, payment_method: event.target.value }))}
                >
                  <option value="cash">نقداً</option>
                  <option value="bank_transfer">حوالة بنكية</option>
                </Select>
              </Field>
              <Field label="تاريخ السند (هجري)" required>
                <HijriDateInput
                  value={payForm.receipt_date}
                  onChange={(value) => setPayForm((current) => ({ ...current, receipt_date: value }))}
                />
              </Field>
            </div>
            <Field label="ملاحظات">
              <TextInput
                value={payForm.notes}
                onChange={(event) => setPayForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="ملاحظة اختيارية على السند"
              />
            </Field>
            <Alert tone="warning">
              السداد الجزئي غير مسموح. سيتم سداد كامل المتبقي دفعة واحدة وتحديث حالة الاستحقاق إلى «مسدد».
            </Alert>
          </form>
        </Modal>
      )}

      {editingDue && (
        <Modal
          title="تعديل استحقاق شهري"
          subtitle={`${editingDue.full_name} — ${editingDue.member_no}`}
          icon={<Edit3 size={20} />}
          onClose={() => setEditingDue(null)}
          size="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditingDue(null)} disabled={savingEdit}>إلغاء</Button>
              <Button type="submit" form="edit-due-form" loading={savingEdit}>حفظ التعديلات</Button>
            </>
          }
        >
          <form id="edit-due-form" onSubmit={submitEditDue} className="form-stack">
            {editError && <Alert tone="danger">{editError}</Alert>}
            <div className="form-grid two">
              <Field label="قيمة الاستحقاق (ر.ي)" required hint="أرقام صحيحة فقط">
                <AmountInput value={editForm.amount} onChange={(value) => setEditForm((current) => ({ ...current, amount: value }))} required />
              </Field>
              <Field label="الشهر الهجري" required>
                <HijriMonthInput value={editForm.month} onChange={(value) => setEditForm((current) => ({ ...current, month: value }))} back={60} forward={12} />
              </Field>
            </div>
            <Alert tone="info">
              لا يمكن جعل القيمة أقل من المبلغ المسدد. إذا كان الاستحقاق مسدداً بالكامل فسيتم إبقاء حالته «مسدد».
            </Alert>
          </form>
        </Modal>
      )}

      {printReceipt && <ReceiptVoucher receipt={printReceipt} onClose={() => setPrintReceipt(null)} />}
    </div>
  );
}
