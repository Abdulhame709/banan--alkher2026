import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Coins,
  Info,
  Landmark,
  Printer,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
import { useToast } from '../lib/toast';
import { formatDate, formatNumber, moneyIn, todayISO } from '../lib/format';
import { currentHijriYear, fromHijri } from '../lib/hijri';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  StatCard,
  TextInput,
  Textarea,
} from '../components/ui';
import { ReportPrint } from '../components/PrintSheet';
import type { SecondaryBoxData, SecondaryBoxTransfer } from '../types';

const firstOfHijriYear = () =>
  fromHijri(currentHijriYear(), 1, 1) ?? `${todayISO().slice(0, 4)}-01-01`;

const DIRECTION_LABELS: Record<SecondaryBoxTransfer['direction'], string> = {
  to_secondary: 'إلى الخزينة الثانية',
  to_primary: 'إلى الصندوق الرئيسي',
};

export function SecondaryBoxPage() {
  const { capabilities } = useAuth();
  const toast = useToast();
  const realtimeVersion = useRealtimeVersion();
  const [data, setData] = useState<SecondaryBoxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [from, setFrom] = useState(firstOfHijriYear());
  const [to, setTo] = useState(todayISO());
  const [form, setForm] = useState({
    direction: 'to_secondary' as 'to_secondary' | 'to_primary',
    amount: '',
    rate: '',
    transfer_date: todayISO(),
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<SecondaryBoxTransfer | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const canManage = Boolean(capabilities?.manageSecondaryBox);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const payload = await api.get<SecondaryBoxData>(
          `/secondary-box?from=${from}&to=${to}`
        );
        if (!active) return;
        setData(payload);
        setForm((current) => ({
          ...current,
          rate: current.rate || (payload.exchange_rate > 0 ? String(payload.exchange_rate) : ''),
        }));
      } catch (loadError) {
        if (active) setError(apiErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [from, to, refreshKey, realtimeVersion]);

  const rate = Number(form.rate) || 0;
  const inputAmount = Number(form.amount) || 0;
  const toSecondary = form.direction === 'to_secondary';
  const received = rate > 0
    ? (toSecondary ? inputAmount / rate : inputAmount * rate)
    : 0;
  const sourceCurrency = data
    ? (toSecondary ? data.primary_currency : data.currency)
    : '';
  const targetCurrency = data
    ? (toSecondary ? data.currency : data.primary_currency)
    : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    if (!(inputAmount > 0)) {
      setFormError('أدخل مبلغ التحويل');
      return;
    }
    if (!(rate > 0)) {
      setFormError('أدخل سعر صرف صحيحاً أكبر من صفر');
      return;
    }
    setSaving(true);
    try {
      await api.post('/secondary-box/transfers', {
        direction: form.direction,
        amount: inputAmount,
        rate,
        transfer_date: form.transfer_date,
        notes: form.notes.trim() || null,
      });
      toast.success('تم تسجيل التحويل بين الصندوقين بنجاح');
      setForm((current) => ({ ...current, amount: '', notes: '' }));
      setRefreshKey((value) => value + 1);
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
      toast.error(apiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.del(`/secondary-box/transfers/${deleting.id}`);
      toast.success('تم حذف التحويل وإعادة احتساب الرصيدين');
      setDeleting(null);
      setRefreshKey((value) => value + 1);
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError));
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading && !data) return <LoadingState label="جارٍ تحميل الخزينة الثانية…" />;

  if (error || !data) {
    return (
      <div className="page-stack">
        <Alert tone="danger" title="تعذر تحميل الخزينة الثانية">{error}</Alert>
        <Button onClick={() => setRefreshKey((value) => value + 1)} icon={<RefreshCw size={17} />}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  const movements = [...data.movements].reverse();
  const rangeLabel = `${formatDate(data.from)} — ${formatDate(data.to)}`;

  return (
    <div className="page-stack">
      <PageHeader
        title={`الخزينة الثانية (${data.currency})`}
        subtitle="خزينة نقدية مستقلة تماماً. تُموَّل بالتحويل من الصندوق الرئيسي وإليه، ورصيدها لا يُضاف إلى إجمالي الصندوق الرئيسي."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPrinting(true)} icon={<Printer size={17} />}>
              طباعة الكشف
            </Button>
            <Button variant="ghost" onClick={() => setRefreshKey((value) => value + 1)} icon={<RefreshCw size={17} />}>
              تحديث
            </Button>
          </>
        }
      />

      {!data.enabled && (
        <Alert tone="warning" title="الخزينة الثانية غير مفعلة">
          فعّل الخزينة الثانية من <Link to="/settings">إعدادات الصندوق</Link> لتسجيل التحويلات وعرض الكشف.
        </Alert>
      )}

      <Alert tone="info" title="حساب منفصل">
        رصيد هذه الخزينة بعملة {data.currency} ولا يدخل في إجمالي أرصدة الصندوق الرئيسي ولا في تقاريره.
        التحويل إلى الخزينة الثانية يخفض الرصيد النقدي للصندوق الرئيسي بقيمته بالعملة الأساسية، والتحويل منها
        يعيد المبلغ إلى الصندوق الرئيسي. تُعرض القيمة التقريبية بالعملة الأساسية للاسترشاد فقط.
      </Alert>

      <section className="stats-grid">
        <StatCard
          label={`رصيد الخزينة الثانية (${data.currency})`}
          value={moneyIn(data.balance, data.currency)}
          hint={`الرصيد الافتتاحي: ${moneyIn(data.opening_balance, data.currency)}`}
          icon={<Landmark size={22} />}
          tone="gold"
        />
        <StatCard
          label="إجمالي الوارد إلى الخزينة"
          value={moneyIn(data.total_in, data.currency)}
          hint={`عدد التحويلات: ${formatNumber(data.transfer_count)}`}
          icon={<ArrowDownLeft size={22} />}
          tone="emerald"
        />
        <StatCard
          label="إجمالي الصادر من الخزينة"
          value={moneyIn(data.total_out, data.currency)}
          hint="تحويلات عائدة إلى الصندوق الرئيسي"
          icon={<ArrowUpRight size={22} />}
          tone="slate"
        />
        <StatCard
          label="القيمة التقريبية بالعملة الأساسية"
          value={moneyIn(data.primary_equivalent, data.primary_currency)}
          hint={`بسعر ${formatNumber(data.exchange_rate)} — للعرض فقط`}
          icon={<Coins size={22} />}
          tone="blue"
        />
      </section>

      <Card>
        <CardHeader
          title="تحويل بين الصندوقين"
          subtitle={`أدخل المبلغ بعملة المصدر. سعر الصرف المحفوظ: 1 ${data.currency} = ${formatNumber(data.exchange_rate)} ${data.primary_currency}`}
          icon={<ArrowLeftRight size={19} />}
          action={<Badge tone={canManage ? 'success' : 'neutral'}>{canManage ? 'مسموح بالتسجيل' : 'عرض فقط'}</Badge>}
        />
        {!data.enabled ? (
          <EmptyState title="الخزينة الثانية غير مفعلة" description="يمكن تفعيلها من إعدادات الصندوق." icon={<Landmark size={28} />} />
        ) : (
          <form onSubmit={submit} className="form-stack">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="form-grid two">
              <Field label="اتجاه التحويل" required hint="من أين يخرج المبلغ وإلى أين يدخل">
                <Select
                  value={form.direction}
                  disabled={!canManage}
                  onChange={(event) => {
                    const direction = event.target.value as 'to_secondary' | 'to_primary';
                    setForm((current) => ({ ...current, direction, amount: '' }));
                    setFormError('');
                  }}
                >
                  <option value="to_secondary">من الصندوق الرئيسي إلى الخزينة الثانية</option>
                  <option value="to_primary">من الخزينة الثانية إلى الصندوق الرئيسي</option>
                </Select>
              </Field>
              <Field
                label={`المبلغ (${sourceCurrency || '—'})`}
                required
                hint={`المبلغ الذي سيخرج من ${toSecondary ? 'الصندوق الرئيسي' : 'الخزينة الثانية'}`}
              >
                <TextInput
                  type="number"
                  min="0.01"
                  step="0.01"
                  dir="ltr"
                  inputMode="decimal"
                  value={form.amount}
                  disabled={!canManage}
                  placeholder="0.00"
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                  required
                />
              </Field>
              <Field
                label="سعر الصرف المستخدم"
                required
                hint={`كم ${data.primary_currency} يساوي 1 ${data.currency}؟ يُحفظ مع التحويل ولا يتأثر بتغيير السعر لاحقاً`}
              >
                <TextInput
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  dir="ltr"
                  value={form.rate}
                  disabled={!canManage}
                  onChange={(event) => setForm((current) => ({ ...current, rate: event.target.value }))}
                  required
                />
              </Field>
              <Field label="تاريخ التحويل" required hint="يظهر بنفس ترتيب حركة الصندوق الرئيسي">
                <TextInput
                  type="date"
                  dir="ltr"
                  value={form.transfer_date}
                  disabled={!canManage}
                  onChange={(event) => setForm((current) => ({ ...current, transfer_date: event.target.value }))}
                  required
                />
              </Field>
            </div>

            <div className="financial-preview">
              <span>المبلغ المستلم في {toSecondary ? 'الخزينة الثانية' : 'الصندوق الرئيسي'}</span>
              <strong>
                {rate > 0 && inputAmount > 0
                  ? moneyIn(received, targetCurrency)
                  : '—'}
              </strong>
              <small>
                {rate > 0
                  ? `1 ${data.currency} = ${formatNumber(rate)} ${data.primary_currency} — يُحفظ سعر الصرف مع التحويل`
                  : 'أدخل سعر الصرف لحساب المبلغ المقابل'}
              </small>
            </div>

            <Field label="ملاحظات التحويل" hint="اختياري — تُحفظ في سجل التدقيق">
              <Textarea
                value={form.notes}
                disabled={!canManage}
                maxLength={500}
                placeholder="سبب التحويل أو رقم الإيصال…"
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </Field>

            <div className="toolbar-group">
              <Button type="submit" loading={saving} disabled={!canManage} icon={<Wallet size={17} />}>
                تسجيل التحويل
              </Button>
              {!canManage && <span className="muted">تحتاج صلاحية «إدارة الخزينة الثانية» لتسجيل التحويلات.</span>}
            </div>
          </form>
        )}
      </Card>

      <Card padding={false} className="table-card">
        <div className="report-head">
          <div>
            <h3>حركات الخزينة الثانية</h3>
            <p>الرصيد الافتتاحي للفترة {moneyIn(data.period_opening_balance, data.currency)} — من {rangeLabel}</p>
          </div>
          <div className="date-range">
            <label>من <TextInput type="date" dir="ltr" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>إلى <TextInput type="date" dir="ltr" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
        </div>
        {movements.length === 0 ? (
          <EmptyState
            title="لا توجد تحويلات في الفترة المحددة"
            description="سجّل أول تحويل من النموذج أعلاه أو وسّع نطاق التاريخ."
            icon={<Landmark size={28} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المستند</th>
                  <th>الاتجاه</th>
                  <th>من الصندوق الرئيسي</th>
                  <th>إلى الخزينة الثانية</th>
                  <th>سعر الصرف</th>
                  <th>رصيد الخزينة بعد الحركة</th>
                  <th>ملاحظات</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => {
                  const outbound = movement.direction === 'to_secondary';
                  return (
                    <tr key={movement.id}>
                      <td className="muted">{formatDate(movement.date)}</td>
                      <td className="mono">{movement.reference}</td>
                      <td>
                        <span className="movement-type">
                          <i className={outbound ? 'dot-gold' : 'dot-emerald'} />
                          {DIRECTION_LABELS[movement.direction]}
                        </span>
                      </td>
                      <td className={outbound ? 'text-gold' : 'text-emerald'}>
                        {moneyIn(movement.amount_primary, data.primary_currency)}
                      </td>
                      <td className={outbound ? 'text-emerald' : 'text-gold'}>
                        {moneyIn(movement.amount_secondary, data.currency)}
                      </td>
                      <td className="mono">{formatNumber(movement.rate)}</td>
                      <td className="amount-cell">{moneyIn(movement.balance_after, data.currency)}</td>
                      <td className="muted">
                        {movement.notes || '—'}
                        {movement.created_by_name && <small className="cell-sub">{movement.created_by_name}</small>}
                      </td>
                      {canManage && (
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleting(movement)}
                            icon={<Trash2 size={15} />}
                          >
                            حذف
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Alert tone="warning" title="قبل الحذف">
        حذف التحويل يعكس أثره على الرصيدين معاً. لا يُسمح بالحذف إذا كان سيؤدي إلى رصيد سالب في أي من
        الصندوقين. كل حذف يُسجل في سجل التدقيق مع رقم التحويل والمبلغ.
      </Alert>

      {deleting && (
        <Modal
          title={`حذف التحويل ${deleting.reference}`}
          subtitle="سيتم عكس أثر التحويل على الصندوق الرئيسي والخزينة الثانية"
          onClose={() => {
            if (!deleteBusy) setDeleting(null);
          }}
          icon={<Info size={20} />}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>إلغاء</Button>
              <Button variant="danger" onClick={confirmDelete} loading={deleteBusy} icon={<Trash2 size={16} />}>
                تأكيد الحذف
              </Button>
            </>
          }
        >
          <div className="form-stack">
            <Alert tone="warning">
              سيُحذف تحويل بمبلغ {moneyIn(deleting.amount_primary, data.primary_currency)} من الصندوق الرئيسي
              و{moneyIn(deleting.amount_secondary, data.currency)} من الخزينة الثانية.
            </Alert>
            <dl className="summary-list">
              <div><dt>التاريخ</dt><dd>{formatDate(deleting.date)}</dd></div>
              <div><dt>الاتجاه</dt><dd>{DIRECTION_LABELS[deleting.direction]}</dd></div>
              <div><dt>سعر الصرف</dt><dd>{formatNumber(deleting.rate)}</dd></div>
              <div><dt>سجّله</dt><dd>{deleting.created_by_name || '—'}</dd></div>
            </dl>
          </div>
        </Modal>
      )}

      {printing && (
        <ReportPrint
          title="كشف حركة الخزينة الثانية"
          subtitle={`${data.currency} — الفترة: ${rangeLabel}`}
          metrics={[
            { label: 'رصيد افتتاحي للفترة', value: moneyIn(data.period_opening_balance, data.currency) },
            { label: 'وارد', value: moneyIn(data.total_in, data.currency) },
            { label: 'صادر', value: moneyIn(data.total_out, data.currency) },
            { label: 'الرصيد الحالي', value: moneyIn(data.balance, data.currency) },
          ]}
          onClose={() => setPrinting(false)}
        >
          <table className="print-table compact">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المستند</th>
                <th>الاتجاه</th>
                <th>من الصندوق الرئيسي</th>
                <th>إلى الخزينة الثانية</th>
                <th>سعر الصرف</th>
                <th>رصيد الخزينة</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.date)}</td>
                  <td>{movement.reference}</td>
                  <td>{DIRECTION_LABELS[movement.direction]}</td>
                  <td>{moneyIn(movement.amount_primary, data.primary_currency, false)}</td>
                  <td>{moneyIn(movement.amount_secondary, data.currency, false)}</td>
                  <td>{formatNumber(movement.rate)}</td>
                  <td>{moneyIn(movement.balance_after, data.currency, false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>الإجمالي</th>
                <th>{moneyIn(data.total_in, data.primary_currency, false)} / {moneyIn(data.total_out, data.primary_currency, false)}</th>
                <th>{moneyIn(data.total_in, data.currency, false)} / {moneyIn(data.total_out, data.currency, false)}</th>
                <th></th>
                <th>{moneyIn(data.balance, data.currency, false)}</th>
              </tr>
            </tfoot>
          </table>
          <p className="print-note">
            هذه الخزينة منفصلة تماماً عن الصندوق الرئيسي. الرصيد الموضح بعملة {data.currency} ولا يُضاف إلى
            إجمالي أرصدة الصندوق الرئيسي. القيمة التقريبية بالعملة الأساسية بسعر{' '}
            {formatNumber(data.exchange_rate)} للاسترشاد فقط.
          </p>
        </ReportPrint>
      )}
    </div>
  );
}
