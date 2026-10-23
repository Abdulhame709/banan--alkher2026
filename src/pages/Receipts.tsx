import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  FileText,
  Gift,
  HeartHandshake,
  Paperclip,
  Plus,
  ReceiptText,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage, downloadCsv } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import {
  formatDate,
  formatNumber,
  money,
  PAYMENT_METHOD_LABELS,
  RECEIPT_TYPE_LABELS,
  refReceipt,
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
  TextInput,
  Textarea,
} from '../components/ui';
import { FileUpload } from '../components/FileUpload';
import { ReceiptVoucher } from '../components/PrintSheet';
import type { Member, Receipt } from '../types';

export function ReceiptsPage() {
  const { capabilities } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [summary, setSummary] = useState({ count: 0, total: 0, restricted: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [restricted, setRestricted] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(
    searchParams.get('new') === '1' && Boolean(capabilities?.manageReceipts)
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [printing, setPrinting] = useState<Receipt | null>(null);
  const [form, setForm] = useState({
    receipt_type: 'donation',
    member_id: '',
    donor_name: '',
    amount: '',
    payment_method: 'cash',
    is_restricted: false,
    restricted_purpose: '',
    receipt_date: todayISO(),
    notes: '',
    attachment_url: null as string | null,
  });

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (type !== 'all') params.set('type', type);
      if (restricted !== 'all') params.set('restricted', restricted);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const payload = await api.get<{
        receipts: Receipt[];
        summary: { count: number; total: number; restricted: number };
      }>(`/receipts?${params.toString()}`);
      setReceipts(payload.receipts);
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
  }, [search, type, restricted, from, to]);

  useEffect(() => {
    load();
    if (searchParams.get('new') === '1' && capabilities?.manageReceipts) {
      setOpen(true);
      setSearchParams({}, { replace: true });
    }
    if (capabilities?.manageReceipts) {
      api
        .get<{ members: Member[] }>('/members?status=active')
        .then((payload) => setMembers(payload.members))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(
    () => ({
      count: receipts.length,
      subscriptions: receipts.filter((row) => row.receipt_type === 'subscription').reduce((sum, row) => sum + row.amount, 0),
      donations: receipts.filter((row) => row.receipt_type === 'donation').reduce((sum, row) => sum + row.amount, 0),
      other: receipts.filter((row) => row.receipt_type === 'other').reduce((sum, row) => sum + row.amount, 0),
    }),
    [receipts]
  );

  function openModal() {
    setForm({
      receipt_type: 'donation',
      member_id: '',
      donor_name: '',
      amount: '',
      payment_method: 'cash',
      is_restricted: false,
      restricted_purpose: '',
      receipt_date: todayISO(),
      notes: '',
      attachment_url: null,
    });
    setFormError('');
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    if (Number(form.amount) <= 0) {
      setFormError('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }
    if (!form.member_id && !form.donor_name.trim()) {
      setFormError('اسم المتبرع أو الجهة مطلوب');
      return;
    }
    if (form.is_restricted && !form.restricted_purpose.trim()) {
      setFormError('حدد الغرض المخصص للتبرع');
      return;
    }
    setSaving(true);
    try {
      const payload = await api.post<{ receipt: Receipt }>('/receipts', {
        receipt_type: form.receipt_type,
        member_id: form.member_id || null,
        donor_name: form.donor_name.trim() || null,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        is_restricted: form.is_restricted,
        restricted_purpose: form.is_restricted ? form.restricted_purpose.trim() : null,
        receipt_date: form.receipt_date,
        notes: form.notes.trim() || null,
        attachment_url: form.attachment_url,
      });
      toast.success(`تم إصدار سند القبض ${refReceipt(payload.receipt.receipt_no)} بنجاح`);
      setOpen(false);
      setPrinting(payload.receipt);
      await load(false);
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function exportDonations() {
    try {
      const params = new URLSearchParams({ type: 'donations' });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      await downloadCsv(`/reports/export?${params.toString()}`, 'تقرير-التبرعات.csv');
      toast.success('تم تصدير تقرير التبرعات');
    } catch (exportError) {
      toast.error(apiErrorMessage(exportError));
    }
  }

  function resetFilters() {
    setSearch('');
    setType('all');
    setRestricted('all');
    setFrom('');
    setTo('');
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="سندات القبض والتبرعات"
        subtitle="تسجيل الإيرادات والتبرعات العامة والمخصصة، مع سند قبض رسمي قابل للطباعة."
        actions={
          <>
            <Button variant="secondary" icon={<Download size={17} />} onClick={exportDonations}>تصدير التبرعات CSV</Button>
            {capabilities?.manageReceipts && (
              <Button icon={<Plus size={17} />} onClick={openModal}>تسجيل سند قبض</Button>
            )}
          </>
        }
      />

      <section className="stats-grid four">
        <StatCard label="سندات ضمن النتائج" value={formatNumber(totals.count)} hint="حسب الفلاتر الحالية" icon={<ReceiptText size={21} />} tone="slate" />
        <StatCard label="إجمالي المقبوضات" value={money(summary.total)} hint="اشتراكات وتبرعات وإيرادات" icon={<Wallet size={21} />} tone="emerald" />
        <StatCard label="التبرعات" value={money(totals.donations)} hint="عامة ومخصصة" icon={<Gift size={21} />} tone="gold" />
        <StatCard label="تبرعات مخصصة" value={money(summary.restricted)} hint="مرتبطة بغرض محدد" icon={<HeartHandshake size={21} />} tone="blue" />
      </section>

      <Card padding={false} className="table-card">
        <div className="table-toolbar filters-toolbar">
          <div className="toolbar-group">
            <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالاسم أو رقم السند…" />
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">جميع الأنواع</option>
              <option value="subscription">اشتراكات</option>
              <option value="donation">تبرعات</option>
              <option value="other">إيرادات أخرى</option>
            </Select>
            <Select value={restricted} onChange={(event) => setRestricted(event.target.value)}>
              <option value="all">جميع التبرعات</option>
              <option value="0">غير مخصصة</option>
              <option value="1">مخصصة</option>
            </Select>
          </div>
          <div className="toolbar-group date-range">
            <label>من <input type="date" className="input" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>إلى <input type="date" className="input" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <button type="button" className="icon-btn" onClick={resetFilters} title="إعادة تعيين الفلاتر">
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <LoadingState label="جارٍ تحميل السندات…" />
        ) : error ? (
          <div className="table-message"><Alert tone="danger" title="تعذر تحميل البيانات">{error}</Alert></div>
        ) : receipts.length === 0 ? (
          <EmptyState
            title="لا توجد سندات قبض"
            description="ابدأ بتسجيل أول تبرع أو إيراد للصندوق."
            icon={<ReceiptText size={28} />}
            action={capabilities?.manageReceipts ? <Button onClick={openModal} icon={<Plus size={17} />}>تسجيل سند قبض</Button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>السند</th>
                  <th>التاريخ</th>
                  <th>الطرف</th>
                  <th>النوع</th>
                  <th>المبلغ</th>
                  <th>الصفة</th>
                  <th>طريقة الدفع</th>
                  <th>بواسطة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="mono">{refReceipt(receipt.receipt_no)}</td>
                    <td className="muted">{formatDate(receipt.receipt_date)}</td>
                    <td>
                      <strong>{receipt.member_name || receipt.donor_name || '—'}</strong>
                      {receipt.member_no && <small className="cell-sub">{receipt.member_no}</small>}
                    </td>
                    <td>
                      <Badge tone={receipt.receipt_type === 'subscription' ? 'info' : receipt.receipt_type === 'donation' ? 'gold' : 'neutral'}>
                        {RECEIPT_TYPE_LABELS[receipt.receipt_type]}
                      </Badge>
                    </td>
                    <td className="amount-cell">{money(receipt.amount)}</td>
                    <td>
                      {receipt.is_restricted ? (
                        <span className="restricted-tag" title={receipt.restricted_purpose ?? ''}>
                          مخصص: {receipt.restricted_purpose}
                        </span>
                      ) : (
                        <Badge tone="neutral">عام</Badge>
                      )}
                    </td>
                    <td>{PAYMENT_METHOD_LABELS[receipt.payment_method]}</td>
                    <td className="muted">{receipt.created_by_name ?? '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title="معاينة وطباعة السند" onClick={() => setPrinting(receipt)}>
                          <FileText size={16} />
                        </button>
                        {receipt.attachment_url && (
                          <a
                            className="icon-btn"
                            href={`/api/files/${receipt.attachment_url}`}
                            target="_blank"
                            rel="noreferrer"
                            title="عرض المرفق"
                          >
                            <Paperclip size={16} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>الإجمالي</td>
                  <td>{money(summary.total)}</td>
                  <td colSpan={4}>منها مخصص: {money(summary.restricted)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <Modal
          title="تسجيل سند قبض جديد"
          subtitle="إيراد تبرع عام أو مخصص أو إيراد آخر"
          icon={<ReceiptText size={20} />}
          onClose={() => setOpen(false)}
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button>
              <Button type="submit" form="receipt-form" loading={saving} icon={<ReceiptText size={17} />}>
                حفظ وإصدار السند
              </Button>
            </>
          }
        >
          <form id="receipt-form" onSubmit={submit} className="form-stack">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <Alert tone="info" title="سندات الاشتراكات">
              سندات الاشتراكات تُصدر تلقائياً من صفحة الاستحقاقات الشهرية عند تسجيل السداد، لضمان ربطها بالاستحقاق الصحيح.
            </Alert>
            <div className="form-grid two">
              <Field label="نوع السند" required>
                <Select
                  value={form.receipt_type}
                  onChange={(event) => setForm((current) => ({ ...current, receipt_type: event.target.value }))}
                >
                  <option value="donation">تبرع</option>
                  <option value="other">إيراد آخر</option>
                </Select>
              </Field>
              <Field label="تاريخ السند" required>
                <TextInput
                  type="date"
                  value={form.receipt_date}
                  onChange={(event) => setForm((current) => ({ ...current, receipt_date: event.target.value }))}
                  required
                />
              </Field>
            </div>

            <div className="form-grid two">
              <Field label="عضو مسجل (اختياري)" hint="اختر العضو إذا كان المتبرع من أعضاء الصندوق">
                <Select
                  value={form.member_id}
                  onChange={(event) => setForm((current) => ({ ...current, member_id: event.target.value }))}
                >
                  <option value="">— ليس عضواً مسجلاً —</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.member_no} — {member.full_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="اسم المتبرع / الجهة" required={!form.member_id}>
                <TextInput
                  value={form.donor_name}
                  onChange={(event) => setForm((current) => ({ ...current, donor_name: event.target.value }))}
                  placeholder="اسم المتبرع أو الجهة"
                  disabled={Boolean(form.member_id)}
                />
              </Field>
              <Field label="المبلغ (ر.ي)" required>
                <TextInput
                  type="number"
                  min="0.01"
                  step="1"
                  value={form.amount}
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="0"
                  required
                />
              </Field>
              <Field label="طريقة الدفع" required>
                <Select
                  value={form.payment_method}
                  onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}
                >
                  <option value="cash">نقداً</option>
                  <option value="bank_transfer">حوالة بنكية</option>
                </Select>
              </Field>
            </div>

            <label className="switch-field">
              <input
                type="checkbox"
                checked={form.is_restricted}
                onChange={(event) => setForm((current) => ({ ...current, is_restricted: event.target.checked }))}
              />
              <span className="switch" />
              <span>تبرع مخصص بغرض معين</span>
            </label>

            {form.is_restricted && (
              <Field label="الغرض المخصص" required hint="لا يجوز صرف هذا المبلغ في غير الغرض المحدد">
                <TextInput
                  value={form.restricted_purpose}
                  onChange={(event) => setForm((current) => ({ ...current, restricted_purpose: event.target.value }))}
                  placeholder="مثال: علاج مرضى الفشل الكلوي"
                  required
                />
              </Field>
            )}

            <Field label="ملاحظات">
              <Textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="ملاحظات إضافية تظهر على السند…"
                rows={2}
              />
            </Field>

            <FileUpload
              value={form.attachment_url}
              onChange={(file) => setForm((current) => ({ ...current, attachment_url: file }))}
              label="مرفق السند (اختياري)"
              hint="صورة إشعار الحوالة أو مستند التبرع — صورة أو PDF بحد أقصى 8 ميجابايت"
            />
          </form>
        </Modal>
      )}

      {printing && <ReceiptVoucher receipt={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
