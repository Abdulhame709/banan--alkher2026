import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banknote,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Coins,
  CreditCard,
  Printer,
  ReceiptText,
  Search,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
import { useToast } from '../lib/toast';
import {
  formatDate,
  formatNumber,
  money,
  monthLabel,
  monthOptions,
  subscriptionStatus,
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
  Progress,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  TextInput,
  Textarea,
} from '../components/ui';
import { ReceiptVoucher } from '../components/PrintSheet';
import type { Receipt, Subscription } from '../types';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState(monthOptions().find((option) => option.value === todayISO().slice(0, 7))?.value ?? todayISO().slice(0, 7));
  const [status, setStatus] = useState<'all' | 'unpaid' | 'partial' | 'paid'>(
    searchParams.get('status') === 'unpaid' ? 'unpaid' : 'all'
  );
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary>({ count: 0, total: 0, paid: 0, remaining: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [generateOpen, setGenerateOpen] = useState(
    searchParams.get('generate') === '1' && Boolean(capabilities?.manageMembers)
  );
  const [generateMonth, setGenerateMonth] = useState(month);
  const [generating, setGenerating] = useState(false);

  const [paying, setPaying] = useState<Subscription | null>(null);
  const [payForm, setPayForm] = useState({
    amount: '',
    payment_method: 'cash',
    receipt_date: todayISO(),
    notes: '',
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [printReceipt, setPrintReceipt] = useState<Receipt | null>(null);

  const months = useMemo(() => monthOptions(18, 3), []);

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ month });
      if (status !== 'all') params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      const payload = await api.get<{
        subscriptions: Subscription[];
        summary: SubscriptionSummary;
        month: string;
      }>(`/subscriptions?${params.toString()}`);
      setRows(payload.subscriptions);
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
    if (searchParams.get('generate') === '1' && capabilities?.manageMembers) {
      setGenerateMonth(searchParams.get('month') ?? month);
      setGenerateOpen(true);
    }
    if (searchParams.get('pay') === '1') {
      toast.info('اختر استحقاقاً غير مسدد من القائمة لتسجيل السداد');
    }
    if (searchParams.toString()) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPayment(subscription: Subscription) {
    const remaining = subscription.remaining ?? subscription.amount - subscription.paid_amount;
    setPaying(subscription);
    setPaymentError('');
    setPayForm({
      amount: String(remaining),
      payment_method: 'cash',
      receipt_date: todayISO(),
      notes: '',
    });
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!paying) return;
    setPaymentError('');
    const amount = Number(payForm.amount);
    const remaining = paying.remaining ?? paying.amount - paying.paid_amount;
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }
    if (amount > remaining) {
      setPaymentError(`المبلغ يتجاوز المتبقي (${money(remaining)})`);
      return;
    }
    setSavingPayment(true);
    try {
      const payload = await api.post<{ receipt: Receipt }>(`/subscriptions/${paying.id}/pay`, {
        amount,
        payment_method: payForm.payment_method,
        receipt_date: payForm.receipt_date,
        notes: payForm.notes,
      });
      toast.success('تم تسجيل السداد وإصدار سند القبض بنجاح');
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
    setGenerating(true);
    try {
      const payload = await api.post<{ generated: number; skipped: number; month_label: string }>(
        '/subscriptions/generate',
        { month: generateMonth }
      );
      toast.success(
        `تم توليد ${payload.generated} استحقاقاً لشهر ${payload.month_label}، وتخطي ${payload.skipped} عضواً لديه استحقاق مسبق`
      );
      setGenerateOpen(false);
      setMonth(generateMonth);
      await load(false);
    } catch (generateError) {
      toast.error(apiErrorMessage(generateError));
    } finally {
      setGenerating(false);
    }
  }

  const collectionRate = summary.total > 0 ? (summary.paid / summary.total) * 100 : 0;

  return (
    <div className="page-stack">
      <PageHeader
        title="الاستحقاقات الشهرية"
        subtitle="توليد اشتراكات الأعضاء النشطين، تحصيل السداد الكلي أو الجزئي، وإصدار سندات القبض تلقائياً."
        actions={
          <>
            {capabilities?.manageMembers && (
              <Button
                variant="secondary"
                icon={<CalendarPlus size={17} />}
                onClick={() => { setGenerateMonth(month); setGenerateOpen(true); }}
              >
                توليد استحقاقات الشهر
              </Button>
            )}
            {capabilities?.manageReceipts && (
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

      <section className="stats-grid four">
        <StatCard label="عدد الاستحقاقات" value={formatNumber(summary.count)} hint={monthLabel(month)} icon={<CalendarClock size={21} />} tone="slate" />
        <StatCard label="إجمالي المستحق" value={money(summary.total)} hint="قيمة الاشتراكات المولدة" icon={<Coins size={21} />} tone="blue" />
        <StatCard label="المحصل" value={money(summary.paid)} hint={`نسبة التحصيل ${Math.round(collectionRate)}%`} icon={<Wallet size={21} />} tone="emerald" />
        <StatCard label="المتبقي للتحصيل" value={money(summary.remaining)} hint="لا يدخل ضمن الرصيد النقدي" icon={<ReceiptText size={21} />} tone="amber" />
      </section>

      <Card className="collection-card">
        <div className="collection-head">
          <div>
            <span>تحصيل استحقاقات {monthLabel(month)}</span>
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
              { value: 'partial', label: 'سداد جزئي' },
              { value: 'paid', label: 'مسدد' },
            ]}
          />
        </div>

        {loading ? (
          <LoadingState label="جارٍ تحميل الاستحقاقات…" />
        ) : error ? (
          <div className="table-message"><Alert tone="danger" title="تعذر تحميل البيانات">{error}</Alert></div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="لا توجد استحقاقات لهذا الشهر"
            description={
              summary.count === 0
                ? 'يمكنك توليد استحقاقات الشهر لجميع الأعضاء النشطين بضغطة واحدة.'
                : 'لا توجد نتائج مطابقة للفلاتر المحددة.'
            }
            icon={<CalendarPlus size={28} />}
            action={
              summary.count === 0 && capabilities?.manageMembers ? (
                <Button onClick={() => { setGenerateMonth(month); setGenerateOpen(true); }} icon={<CalendarPlus size={17} />}>
                  توليد الاستحقاقات
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>العضو</th>
                  <th>الشهر</th>
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
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="person-cell">
                          <span className="avatar avatar-xs">{(row.full_name ?? '?').charAt(0)}</span>
                          <div>
                            <strong>{row.full_name}</strong>
                            <small>{row.member_no}</small>
                          </div>
                        </div>
                      </td>
                      <td>{monthLabel(row.due_month)}</td>
                      <td>{money(row.amount)}</td>
                      <td className="text-emerald">{money(row.paid_amount)}</td>
                      <td className={remaining > 0 ? 'danger-text' : ''}>{money(remaining)}</td>
                      <td><Badge tone={rowStatus.tone} dot>{rowStatus.label}</Badge></td>
                      <td>
                        {row.status === 'paid' ? (
                          <span className="paid-check"><CheckCircle2 size={18} /> مكتمل</span>
                        ) : capabilities?.manageReceipts ? (
                          <Button size="sm" variant="soft" icon={<Banknote size={15} />} onClick={() => openPayment(row)}>
                            تسجيل سداد
                          </Button>
                        ) : (
                          <span className="muted">—</span>
                        )}
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
          title="توليد استحقاقات الشهر"
          subtitle="إنشاء استحقاق شهري لكل عضو نشط تلقائياً مع تخطي المكرر"
          icon={<CalendarPlus size={20} />}
          onClose={() => setGenerateOpen(false)}
          size="md"
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
            <Field label="شهر الاستحقاق" required hint="يُسجل الاستحقاق في أول يوم من الشهر المحدد">
              <TextInput type="month" value={generateMonth} onChange={(event) => setGenerateMonth(event.target.value)} required />
            </Field>
            <Alert tone="info" title="آلية التوليد">
              سيتم إنشاء استحقاق بقيمة الاشتراك الشهري المسجل لكل عضو نشط. لن يتم إنشاء استحقاق مكرر
              لنفس العضو في نفس الشهر، ولن تتأثر الأعضاء الموقوفة.
            </Alert>
          </form>
        </Modal>
      )}

      {paying && (
        <Modal
          title="تسجيل سداد اشتراك"
          subtitle={`${paying.full_name} — ${monthLabel(paying.due_month)}`}
          icon={<Banknote size={20} />}
          onClose={() => setPaying(null)}
          size="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPaying(null)} disabled={savingPayment}>إلغاء</Button>
              <Button type="submit" form="payment-form" loading={savingPayment} icon={<ReceiptText size={17} />}>
                سداد وإصدار سند قبض
              </Button>
            </>
          }
        >
          <form id="payment-form" onSubmit={submitPayment} className="form-stack">
            {paymentError && <Alert tone="danger">{paymentError}</Alert>}
            <div className="payment-summary">
              <div><span>المستحق</span><strong>{money(paying.amount)}</strong></div>
              <div><span>المسدد سابقاً</span><strong>{money(paying.paid_amount)}</strong></div>
              <div><span>المتبقي</span><strong className="danger-text">{money(paying.remaining ?? paying.amount - paying.paid_amount)}</strong></div>
            </div>
            <div className="form-grid two">
              <Field label="مبلغ السداد (ر.ي)" required hint={`الحد الأقصى: ${money(paying.remaining ?? paying.amount - paying.paid_amount)}`}>
                <TextInput
                  type="number"
                  min="0.01"
                  step="1"
                  max={paying.remaining ?? paying.amount - paying.paid_amount}
                  value={payForm.amount}
                  onChange={(event) => setPayForm((current) => ({ ...current, amount: event.target.value }))}
                  required
                />
              </Field>
              <Field label="طريقة الدفع" required>
                <Select
                  value={payForm.payment_method}
                  onChange={(event) => setPayForm((current) => ({ ...current, payment_method: event.target.value }))}
                >
                  <option value="cash">نقداً</option>
                  <option value="bank_transfer">حوالة بنكية</option>
                </Select>
              </Field>
              <Field label="تاريخ السند" required>
                <TextInput
                  type="date"
                  value={payForm.receipt_date}
                  onChange={(event) => setPayForm((current) => ({ ...current, receipt_date: event.target.value }))}
                  required
                />
              </Field>
              <Field label="ملاحظات">
                <TextInput
                  value={payForm.notes}
                  onChange={(event) => setPayForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="ملاحظة اختيارية على السند"
                />
              </Field>
            </div>
            <div className="quick-amounts">
              <button
                type="button"
                onClick={() => setPayForm((current) => ({
                  ...current,
                  amount: String(paying.remaining ?? paying.amount - paying.paid_amount),
                }))}
              >
                سداد كامل المتبقي
              </button>
              <button
                type="button"
                onClick={() => setPayForm((current) => ({
                  ...current,
                  amount: String(Math.round((paying.remaining ?? paying.amount - paying.paid_amount) / 2)),
                }))}
              >
                نصف المتبقي
              </button>
            </div>
            <Alert tone="info">
              سيتم تحديث حالة الاستحقاق تلقائياً وإنشاء سند قبض رسمي مرتبط بهذا السداد.
            </Alert>
          </form>
        </Modal>
      )}

      {printReceipt && <ReceiptVoucher receipt={printReceipt} onClose={() => setPrintReceipt(null)} />}
    </div>
  );
}
