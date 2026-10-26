import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  Edit3,
  FileText,
  Gift,
  HeartHandshake,
  PenLine,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage, downloadCsv } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
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
import { MultiFileUpload } from '../components/MultiFileUpload';
import { AttachmentLinks } from '../components/AttachmentLinks';
import { SignatureModal } from '../components/SignaturePad';
import { AmountInput, parseAmount } from '../components/AmountInput';
import { HijriDateInput } from '../components/HijriInputs';
import { ReceiptVoucher } from '../components/PrintSheet';
import type { Attachment, Member, Receipt, Subscription, UploadedAttachment } from '../types';

export function ReceiptsPage() {
  const { capabilities } = useAuth();
  const realtimeVersion = useRealtimeVersion();
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
    searchParams.get('new') === '1' && Boolean(capabilities?.addReceipts)
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [printing, setPrinting] = useState<Receipt | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [signingReceipt, setSigningReceipt] = useState<Receipt | null>(null);
  const [savingSignature, setSavingSignature] = useState(false);
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
    attachments: [] as UploadedAttachment[],
  });
  const [memberArrears, setMemberArrears] = useState<{ total: number; months: number } | null>(null);
  const [loadingArrears, setLoadingArrears] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [editForm, setEditForm] = useState({
    donor_name: '',
    amount: '',
    payment_method: 'cash',
    is_restricted: false,
    restricted_purpose: '',
    receipt_date: todayISO(),
    notes: '',
    attachments: [] as UploadedAttachment[],
  });
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

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
  }, [search, type, restricted, from, to, realtimeVersion]);

  useEffect(() => {
    load();
    if (searchParams.get('new') === '1' && capabilities?.addReceipts) {
      setOpen(true);
      setSearchParams({}, { replace: true });
    }
    if (capabilities?.viewMembers) {
      api
        .get<{ members: Member[] }>('/members?status=active')
        .then((payload) => setMembers(payload.members))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.receipt_type !== 'subscription' || !form.member_id) {
      setMemberArrears(null);
      return;
    }
    let cancelled = false;
    setLoadingArrears(true);
    api
      .get<{ subscriptions: Subscription[] }>(`/members/${form.member_id}/statement`)
      .then((payload) => {
        if (cancelled) return;
        const open = (payload.subscriptions ?? []).filter(
          (row) => row.status !== 'paid' && Number(row.amount) > Number(row.paid_amount)
        );
        setMemberArrears({
          total: open.reduce((sum, row) => sum + (Number(row.amount) - Number(row.paid_amount)), 0),
          months: open.length,
        });
      })
      .catch(() => {
        if (!cancelled) setMemberArrears(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingArrears(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.receipt_type, form.member_id]);

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
      attachments: [],
    });
    setFormError('');
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    const value = parseAmount(form.amount);
    if (value <= 0) {
      setFormError('أدخل مبلغاً صحيحاً أكبر من صفر (بدون كسور)');
      return;
    }
    if (form.receipt_type === 'subscription' && !form.member_id) {
      setFormError('اختر العضو أولاً لتسجيل تحصيل الاشتراكات');
      return;
    }
    if (form.receipt_type !== 'subscription' && !form.member_id && !form.donor_name.trim()) {
      setFormError('اسم المتبرع أو الجهة مطلوب');
      return;
    }
    if (form.receipt_type !== 'subscription' && form.is_restricted && !form.restricted_purpose.trim()) {
      setFormError('حدد الغرض المخصص للتبرع');
      return;
    }
    setSaving(true);
    try {
      const payload = await api.post<{ receipt: Receipt }>('/receipts', {
        receipt_type: form.receipt_type,
        member_id: form.member_id || null,
        donor_name: form.receipt_type === 'subscription' ? null : form.donor_name.trim() || null,
        amount: value,
        payment_method: form.payment_method,
        is_restricted: form.receipt_type === 'subscription' ? false : form.is_restricted,
        restricted_purpose: form.receipt_type === 'subscription'
          ? null
          : form.is_restricted ? form.restricted_purpose.trim() : null,
        receipt_date: form.receipt_date,
        notes: form.notes.trim() || null,
        attachment_url: form.attachment_url,
        attachments: form.attachments,
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

  function openEditReceipt(receipt: Receipt) {
    setEditingReceipt(receipt);
    setEditForm({
      donor_name: receipt.donor_name ?? '',
      amount: String(receipt.amount),
      payment_method: receipt.payment_method,
      is_restricted: Boolean(receipt.is_restricted),
      restricted_purpose: receipt.restricted_purpose ?? '',
      receipt_date: receipt.receipt_date,
      notes: receipt.notes ?? '',
      attachments: [],
    });
    setExistingAttachments(receipt.attachments ?? []);
    setRemovedAttachmentIds([]);
    setEditError('');
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingReceipt) return;
    setEditError('');
    const value = parseAmount(editForm.amount);
    if (value <= 0) {
      setEditError('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }
    if (!editingReceipt.subscription_id && editForm.is_restricted && !editForm.restricted_purpose.trim()) {
      setEditError('حدد الغرض المخصص للتبرع');
      return;
    }
    setSavingEdit(true);
    try {
      await api.patch(`/receipts/${editingReceipt.id}`, {
        donor_name: editForm.donor_name.trim() || null,
        amount: value,
        payment_method: editForm.payment_method,
        is_restricted: editingReceipt.subscription_id ? false : editForm.is_restricted,
        restricted_purpose: editForm.is_restricted ? editForm.restricted_purpose.trim() : null,
        receipt_date: editForm.receipt_date,
        notes: editForm.notes.trim() || null,
        attachments: editForm.attachments,
        removed_attachment_ids: removedAttachmentIds,
      });
      toast.success('تم تحديث السند');
      setEditingReceipt(null);
      await load(false);
    } catch (saveError) {
      setEditError(apiErrorMessage(saveError));
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteReceipt(receipt: Receipt) {
    if (!window.confirm(`هل تريد حذف السند ${refReceipt(receipt.receipt_no)} بمبلغ ${money(receipt.amount)}؟ سيتم عكس توزيع المبلغ على الاستحقاقات إذا كان سند اشتراك.`)) return;
    try {
      await api.del(`/receipts/${receipt.id}`);
      toast.success('تم حذف السند');
      await load(false);
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError));
    }
  }

  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(cell); cell = ''; }
      else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (char !== '\r') cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((line) => line.some((value) => String(value ?? '').trim()));
  }

  function normalizeImportDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'number' && value > 20000) {
      return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
    }
    const text = String(value ?? '').trim();
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    return todayISO();
  }

  async function importReceipts(file: File) {
    setImporting(true);
    try {
      let rows: unknown[][] = [];
      if (file.name.toLowerCase().endsWith('.csv')) {
        rows = parseCsv(await file.text());
      } else {
        const { readSheet } = await import('read-excel-file/browser');
        rows = await readSheet(file);
      }
      if (rows.length < 2) throw new Error('الملف فارغ أو لا يحتوي على صفوف بيانات');
      const headers = rows[0].map((value) => String(value ?? '').trim());
      const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const typeIndex = find('نوع السند', 'receipt_type');
      const memberIndex = find('رقم العضوية', 'member_no');
      const donorIndex = find('اسم المتبرع', 'الجهة', 'المتبرع', 'donor_name');
      const amountIndex = find('المبلغ', 'amount');
      const methodIndex = find('طريقة الدفع', 'payment_method');
      const dateIndex = find('التاريخ', 'تاريخ السند', 'receipt_date');
      const restrictedIndex = find('مخصص', 'is_restricted');
      const purposeIndex = find('الغرض', 'الغرض المخصص', 'restricted_purpose');
      const notesIndex = find('ملاحظات', 'notes');

      const memberByNo = new Map(members.map((member) => [member.member_no, member.id]));
      const receipts = rows.slice(1).map((row) => {
        const typeText = String(row[typeIndex] ?? '').trim().toLowerCase();
        const typeValue = typeText.includes('اشتراك') || typeText === 'subscription'
          ? 'subscription'
          : typeText.includes('تبرع') || typeText === 'donation'
            ? 'donation'
            : 'other';
        const methodText = String(row[methodIndex] ?? '').trim().toLowerCase();
        const methodValue = methodText.includes('بنك') || methodText.includes('حوالة') || methodText === 'bank_transfer'
          ? 'bank_transfer'
          : 'cash';
        const restrictedText = String(row[restrictedIndex] ?? '').trim().toLowerCase();
        return {
          receipt_type: typeValue,
          member_id: memberByNo.get(String(row[memberIndex] ?? '').trim()) ?? null,
          donor_name: String(row[donorIndex] ?? '').trim() || null,
          amount: String(row[amountIndex] ?? '').replace(/[^\d]/g, ''),
          payment_method: methodValue,
          receipt_date: normalizeImportDate(row[dateIndex]),
          is_restricted: ['نعم', 'true', '1', 'مخصص'].includes(restrictedText),
          restricted_purpose: String(row[purposeIndex] ?? '').trim() || null,
          notes: String(row[notesIndex] ?? '').trim() || null,
        };
      }).filter((row) => row.amount && (row.donor_name || row.member_id));

      if (!receipts.length) throw new Error('لم يتم العثور على صفوف صالحة في الملف');
      if (receipts.some((row) => row.receipt_type === 'subscription')) {
        throw new Error('سندات الاشتراكات لا تُستورد من Excel. استخدم صفحة الاستحقاقات لتسجيل السداد.');
      }
      const result = await api.post<{ imported: number; skipped: number; errors: string[] }>(
        '/receipts/import',
        { receipts }
      );
      toast.success(`تم استيراد ${formatNumber(result.imported)} سند قبض`);
      if (result.errors?.length) toast.error(result.errors[0]);
      await load(false);
    } catch (importError) {
      toast.error(apiErrorMessage(importError));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function signReceipt(data: { signed_by_name: string; signature_data: string }) {
    if (!signingReceipt) return;
    setSavingSignature(true);
    try {
      const payload = await api.post<{ receipt: Receipt }>(`/receipts/${signingReceipt.id}/sign`, data);
      toast.success('تم حفظ التوقيع الإلكتروني');
      setSigningReceipt(null);
      setPrinting((current) => current?.id === payload.receipt.id ? payload.receipt : current);
      await load(false);
    } catch (signError) {
      toast.error(apiErrorMessage(signError));
    } finally {
      setSavingSignature(false);
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
            {capabilities?.exportReports && (
              <Button variant="secondary" icon={<Download size={17} />} onClick={exportDonations}>تصدير التبرعات CSV</Button>
            )}
            {capabilities?.addReceipts && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) importReceipts(file);
                  }}
                />
                <Button variant="secondary" icon={<Upload size={17} />} loading={importing} onClick={() => fileRef.current?.click()}>
                  استيراد Excel
                </Button>
              </>
            )}
            {capabilities?.addReceipts && (
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
            <label>من (هجري) <HijriDateInput value={from} onChange={setFrom} /></label>
            <label>إلى (هجري) <HijriDateInput value={to} onChange={setTo} /></label>
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
            action={capabilities?.addReceipts ? <Button onClick={openModal} icon={<Plus size={17} />}>تسجيل سند قبض</Button> : undefined}
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
                        {capabilities?.editReceipts && (
                          <button type="button" className="icon-btn" title="تعديل السند" onClick={() => openEditReceipt(receipt)}>
                            <Edit3 size={16} />
                          </button>
                        )}
                        {capabilities?.deleteReceipts && (
                          <button type="button" className="icon-btn danger-text" title="حذف السند" onClick={() => deleteReceipt(receipt)}>
                            <Trash2 size={16} />
                          </button>
                        )}
                        {capabilities?.printReceipts && (
                          <button type="button" className="icon-btn" title={receipt.signed_by_name ? 'تحديث التوقيع الإلكتروني' : 'توقيع إلكتروني'} onClick={() => setSigningReceipt(receipt)}>
                            <PenLine size={16} />
                          </button>
                        )}
                        <AttachmentLinks attachments={receipt.attachments} legacyUrl={receipt.attachment_url} compact />
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
          subtitle="تبرع، إيراد آخر، أو تحصيل اشتراكات عضو لعدة أشهر"
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
            <Alert tone="info" title="تحصيل عدة أشهر">
              اختر «تحصيل اشتراكات» ثم العضو. سيوزع النظام المبلغ تلقائياً على أقدم الأشهر غير المسددة،
              ويمكن لسند واحد أن يغطي عدة أشهر (مثال: 5,000 لخمسة أشهر).
            </Alert>
            <div className="form-grid two">
              <Field label="نوع السند" required>
                <Select
                  value={form.receipt_type}
                  onChange={(event) => setForm((current) => ({ ...current, receipt_type: event.target.value }))}
                >
                  <option value="donation">تبرع</option>
                  <option value="other">إيراد آخر</option>
                  <option value="subscription">تحصيل اشتراكات (عدة أشهر)</option>
                </Select>
              </Field>
              <Field label="تاريخ السند (هجري)" required>
                <HijriDateInput
                  value={form.receipt_date}
                  onChange={(value) => setForm((current) => ({ ...current, receipt_date: value }))}
                />
              </Field>
            </div>

            <div className="form-grid two">
              <Field
                label={form.receipt_type === 'subscription' ? 'العضو' : 'عضو مسجل (اختياري)'}
                required={form.receipt_type === 'subscription'}
                hint={form.receipt_type === 'subscription'
                  ? 'اختر العضو الذي تريد تحصيل اشتراكاته'
                  : 'اختر العضو إذا كان المتبرع من أعضاء الصندوق'}
              >
                <Select
                  value={form.member_id}
                  onChange={(event) => setForm((current) => ({ ...current, member_id: event.target.value }))}
                  required={form.receipt_type === 'subscription'}
                >
                  <option value="">— ليس عضواً مسجلاً —</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.member_no} — {member.full_name}</option>
                  ))}
                </Select>
              </Field>
              {form.receipt_type !== 'subscription' && (
                <Field label="اسم المتبرع / الجهة" required={!form.member_id}>
                  <TextInput
                    value={form.donor_name}
                    onChange={(event) => setForm((current) => ({ ...current, donor_name: event.target.value }))}
                    placeholder="اسم المتبرع أو الجهة"
                    disabled={Boolean(form.member_id)}
                  />
                </Field>
              )}
              <Field
                label="المبلغ (ر.ي)"
                required
                hint={form.receipt_type === 'subscription'
                  ? 'بدون حد أقصى — يوزع على أقدم الأشهر غير المسددة'
                  : 'أرقام صحيحة فقط — بدون كسور'}
              >
                <AmountInput
                  value={form.amount}
                  onChange={(value) => setForm((current) => ({ ...current, amount: value }))}
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

            {form.receipt_type === 'subscription' && form.member_id && (
              <Alert
                tone={memberArrears && memberArrears.total > 0 ? 'info' : 'warning'}
                title="متأخرات العضو"
              >
                {loadingArrears
                  ? 'جارٍ حساب المتأخرات…'
                  : memberArrears && memberArrears.total > 0
                    ? `إجمالي المتأخرات ${money(memberArrears.total)} على ${formatNumber(memberArrears.months)} شهراً. سيتم توزيع المبلغ على الأقدم أولاً.`
                    : 'لا توجد متأخرات مستحقة. أنشئ استحقاقات الأشهر أولاً من صفحة الاشتراكات.'}
              </Alert>
            )}

            {form.receipt_type !== 'subscription' && (
              <label className="switch-field">
                <input
                  type="checkbox"
                  checked={form.is_restricted}
                  onChange={(event) => setForm((current) => ({ ...current, is_restricted: event.target.checked }))}
                />
                <span className="switch" />
                <span>تبرع مخصص بغرض معين</span>
              </label>
            )}

            {form.receipt_type !== 'subscription' && form.is_restricted && (
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

            <MultiFileUpload
              value={form.attachments}
              onChange={(attachments) => setForm((current) => ({ ...current, attachments }))}
              label="مرفقات السند (اختياري)"
              hint="يمكن إرفاق حتى 10 ملفات — صورة إشعار الحوالة أو مستند التبرع، بحد أقصى 8 ميجابايت للملف"
            />
          </form>
        </Modal>
      )}

      {editingReceipt && (
        <Modal
          title={`تعديل السند ${refReceipt(editingReceipt.receipt_no)}`}
          subtitle={editingReceipt.receipt_type === 'subscription'
            ? editingReceipt.subscription_id
              ? 'سند اشتراك شهري — المبلغ مرتبط بكامل قيمة الاستحقاق'
              : 'سند تحصيل متعدد الأشهر — احذفه وأصدر سنداً جديداً للتعديل'
            : 'سند تبرع أو إيراد آخر'}
          icon={<Edit3 size={20} />}
          onClose={() => setEditingReceipt(null)}
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditingReceipt(null)} disabled={savingEdit}>إلغاء</Button>
              <Button type="submit" form="receipt-edit-form" loading={savingEdit}>حفظ التعديلات</Button>
            </>
          }
        >
          <form id="receipt-edit-form" onSubmit={submitEdit} className="form-stack">
            {editError && <Alert tone="danger">{editError}</Alert>}
            {editingReceipt.receipt_type === 'subscription' && (
              <Alert tone="info">
                {editingReceipt.subscription_id
                  ? 'لتعديل مبلغ سند الاشتراك، عدّل قيمة الاستحقاق من صفحة الاستحقاقات الشهرية أولاً.'
                  : 'لا يمكن تعديل مبلغ سند تحصيل متعدد الأشهر. احذفه وأصدر سنداً جديداً بالمبلغ الصحيح.'}
              </Alert>
            )}
            <div className="form-grid two">
              <Field
                label="اسم المتبرع / الجهة"
                required={editingReceipt.receipt_type !== 'subscription'}
              >
                <TextInput
                  value={editForm.donor_name}
                  onChange={(event) => setEditForm((current) => ({ ...current, donor_name: event.target.value }))}
                  disabled={editingReceipt.receipt_type === 'subscription'}
                />
              </Field>
              <Field
                label="المبلغ (ر.ي)"
                required
                hint={editingReceipt.receipt_type === 'subscription'
                  ? 'المبلغ ثابت لسندات الاشتراكات'
                  : 'أرقام صحيحة فقط'}
              >
                <AmountInput
                  value={editForm.amount}
                  onChange={(value) => setEditForm((current) => ({ ...current, amount: value }))}
                  disabled={editingReceipt.receipt_type === 'subscription'}
                  required
                />
              </Field>
              <Field label="طريقة الدفع" required>
                <Select
                  value={editForm.payment_method}
                  onChange={(event) => setEditForm((current) => ({ ...current, payment_method: event.target.value }))}
                >
                  <option value="cash">نقداً</option>
                  <option value="bank_transfer">حوالة بنكية</option>
                </Select>
              </Field>
              <Field label="تاريخ السند (هجري)" required>
                <HijriDateInput
                  value={editForm.receipt_date}
                  onChange={(value) => setEditForm((current) => ({ ...current, receipt_date: value }))}
                />
              </Field>
            </div>
            {editingReceipt.receipt_type !== 'subscription' && (
              <>
                <label className="switch-field">
                  <input
                    type="checkbox"
                    checked={editForm.is_restricted}
                    onChange={(event) => setEditForm((current) => ({ ...current, is_restricted: event.target.checked }))}
                  />
                  <span className="switch" />
                  <span>تبرع مخصص بغرض معين</span>
                </label>
                {editForm.is_restricted && (
                  <Field label="الغرض المخصص" required>
                    <TextInput
                      value={editForm.restricted_purpose}
                      onChange={(event) => setEditForm((current) => ({ ...current, restricted_purpose: event.target.value }))}
                      required
                    />
                  </Field>
                )}
              </>
            )}
            <Field label="ملاحظات">
              <Textarea
                value={editForm.notes}
                onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                rows={2}
              />
            </Field>
            <MultiFileUpload
              value={editForm.attachments}
              onChange={(attachments) => setEditForm((current) => ({ ...current, attachments }))}
              existing={existingAttachments}
              onRemoveExisting={(attachment) => {
                setExistingAttachments((current) => current.filter((item) => item.id !== attachment.id));
                setRemovedAttachmentIds((current) => [...current, attachment.id]);
              }}
              label="مرفقات السند"
              hint="أضف مرفقات جديدة أو احذف مرفقاً موجوداً، ثم احفظ التعديلات."
            />
          </form>
        </Modal>
      )}

      {signingReceipt && (
        <SignatureModal
          title="توقيع سند القبض إلكترونياً"
          subtitle={`${refReceipt(signingReceipt.receipt_no)} — ${money(signingReceipt.amount)}`}
          defaultName={signingReceipt.signed_by_name ?? ''}
          saving={savingSignature}
          onSave={signReceipt}
          onClose={() => setSigningReceipt(null)}
        />
      )}

      {printing && <ReceiptVoucher receipt={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
