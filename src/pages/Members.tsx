import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Download,
  Edit3,
  FileText,
  Plus,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
import { useToast } from '../lib/toast';
import { formatNumber, money, todayISO } from '../lib/format';
import { AmountInput, parseAmount } from '../components/AmountInput';
import { HijriDateInput } from '../components/HijriInputs';
import { fromHijri } from '../lib/hijri';
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
import { MemberStatementPrint } from '../components/PrintSheet';
import type { Member, Receipt, Subscription } from '../types';

interface MemberFormState {
  full_name: string;
  phone: string;
  address: string;
  monthly_fee: string;
  joined_on: string;
  active: boolean;
  notes: string;
}

const emptyForm: MemberFormState = {
  full_name: '',
  phone: '',
  address: 'الغدير - مقبنة - تعز',
  monthly_fee: '1000',
  joined_on: todayISO(),
  active: true,
  notes: '',
};

export function MembersPage() {
  const { capabilities, settings } = useAuth();
  const realtimeVersion = useRealtimeVersion();
  const navigate = useNavigate();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<MemberFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [statement, setStatement] = useState<{
    member: Member;
    subscriptions: Subscription[];
    receipts: Receipt[];
  } | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (status !== 'all') params.set('status', status);
      const payload = await api.get<{ members: Member[] }>(`/members?${params.toString()}`);
      setMembers(payload.members);
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => load(false), 250);
    return () => window.clearTimeout(timer);
  }, [search, status, realtimeVersion]);

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, monthly_fee: String(settings?.default_monthly_fee ?? 1000) });
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(member: Member) {
    setEditing(member);
    setForm({
      full_name: member.full_name,
      phone: member.phone ?? '',
      address: member.address ?? '',
      monthly_fee: String(member.monthly_fee),
      joined_on: member.joined_on,
      active: member.active,
      notes: member.notes ?? '',
    });
    setFormError('');
    setFormOpen(true);
  }

  function update<K extends keyof MemberFormState>(key: K, value: MemberFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    if (!form.full_name.trim() || form.full_name.trim().length < 3) {
      setFormError('اسم العضو مطلوب (3 أحرف على الأقل)');
      return;
    }
    const monthlyFee = parseAmount(form.monthly_fee);
    if (monthlyFee <= 0) {
      setFormError('أدخل اشتراكاً شهرياً صحيحاً أكبر من صفر (بدون كسور)');
      return;
    }
    setSaving(true);
    try {
      const body = {
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        monthly_fee: monthlyFee,
        joined_on: form.joined_on,
        active: form.active,
        notes: form.notes.trim(),
      };
      if (editing) {
        await api.patch(`/members/${editing.id}`, body);
        toast.success('تم تحديث بيانات العضو بنجاح');
      } else {
        await api.post('/members', body);
        toast.success('تمت إضافة العضو بنجاح');
      }
      setFormOpen(false);
      await load(false);
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function openStatement(member: Member) {
    setStatementLoading(true);
    try {
      const payload = await api.get<{
        member: Member;
        subscriptions: Subscription[];
        receipts: Receipt[];
      }>(`/members/${member.id}/statement`);
      setStatement(payload);
    } catch (statementError) {
      toast.error(apiErrorMessage(statementError));
    } finally {
      setStatementLoading(false);
    }
  }

  async function exportMembers() {
    try {
      const writeXlsxFile = (await import('write-excel-file/browser')).default;
      const rows: any[][] = [
        ['رقم العضوية', 'الاسم', 'الهاتف', 'العنوان', 'الاشتراك الشهري', 'تاريخ الانضمام', 'الحالة', 'ملاحظات'],
        ...members.map((member) => [
          member.member_no,
          member.full_name,
          member.phone ?? '',
          member.address ?? '',
          Number(member.monthly_fee),
          member.joined_on ?? '',
          member.active ? 'نشط' : 'موقوف',
          member.notes ?? '',
        ]),
      ];
      await writeXlsxFile(rows, { sheet: 'الأعضاء', rightToLeft: true }).toFile('اعضاء-صندوق-بنان.xlsx');
      toast.success('تم تصدير قائمة الأعضاء إلى Excel');
    } catch (exportError) {
      toast.error(apiErrorMessage(exportError));
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
    return rows;
  }

  function parseImportedDate(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number') {
      return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).toISOString().slice(0, 10);
    }
    const text = String(value ?? '').trim();
    const hijri = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (hijri && Number(hijri[1]) < 1500) {
      return fromHijri(Number(hijri[1]), Number(hijri[2]), Number(hijri[3])) ?? todayISO();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    return todayISO();
  }

  async function importFile(file: File) {
    setImporting(true);
    try {
      let rows: any[][] = [];
      if (file.name.toLowerCase().endsWith('.csv')) {
        rows = parseCsv(await file.text());
      } else {
        const { readSheet } = await import('read-excel-file/browser');
        rows = await readSheet(file);
      }
      if (!rows.length) throw new Error('الملف فارغ');
      const headers = rows[0].map((value) => String(value ?? '').trim());
      const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const nameIndex = find('الاسم', 'اسم العضو', 'full_name');
      const phoneIndex = find('الهاتف', 'رقم الهاتف', 'phone');
      const addressIndex = find('العنوان', 'address');
      const feeIndex = find('الاشتراك الشهري', 'الاشتراك', 'monthly_fee');
      const joinedIndex = find('تاريخ الانضمام', 'joined_on');
      const activeIndex = find('الحالة', 'active');
      const notesIndex = find('ملاحظات', 'notes');
      if (nameIndex < 0) throw new Error('الملف يجب أن يحتوي على عمود «الاسم»');
      const imported = rows.slice(1)
        .filter((row) => String(row[nameIndex] ?? '').trim())
        .map((row) => ({
          full_name: String(row[nameIndex] ?? '').trim(),
          phone: phoneIndex >= 0 ? String(row[phoneIndex] ?? '').trim() : '',
          address: addressIndex >= 0 ? String(row[addressIndex] ?? '').trim() : '',
          monthly_fee: feeIndex >= 0 ? parseAmount(row[feeIndex] as any) : Number(settings?.default_monthly_fee ?? 1000),
          joined_on: joinedIndex >= 0 ? parseImportedDate(row[joinedIndex]) : todayISO(),
          active: activeIndex >= 0
            ? !['موقوف', 'غير نشط', '0', 'false', 'لا'].includes(String(row[activeIndex] ?? '').trim())
            : true,
          notes: notesIndex >= 0 ? String(row[notesIndex] ?? '').trim() : '',
        }));
      if (!imported.length) throw new Error('لا توجد صفوف صالحة للاستيراد');
      const invalidFee = imported.find((row) => !Number.isInteger(row.monthly_fee) || row.monthly_fee <= 0);
      if (invalidFee) {
        throw new Error(`الاشتراك الشهري للعضو «${invalidFee.full_name}» غير صالح. استخدم رقماً صحيحاً أكبر من صفر بدون كسور.`);
      }
      const result = await api.post<{ imported: number; skipped: number; errors: string[] }>('/members/import', { members: imported });
      toast.success(`تم استيراد ${formatNumber(result.imported)} عضو، وتخطي ${formatNumber(result.skipped)}`);
      if (result.errors?.length) toast.error(result.errors[0]);
      await load(false);
    } catch (importError) {
      toast.error(apiErrorMessage(importError));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function deleteMember(member: Member) {
    if (!window.confirm(`هل تريد حذف العضو «${member.full_name}»؟ لا يمكن التراجع.`)) return;
    try {
      await api.del(`/members/${member.id}`);
      toast.success('تم حذف العضو');
      await load(false);
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError));
    }
  }

  const totals = members.reduce(
    (acc, member) => ({
      accrued: acc.accrued + member.total_accrued,
      paid: acc.paid + member.total_paid,
      arrears: acc.arrears + member.arrears,
      active: acc.active + (member.active ? 1 : 0),
    }),
    { accrued: 0, paid: 0, arrears: 0, active: 0 }
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="إدارة الأعضاء"
        subtitle="سجل الأعضاء، أرصدة الاستحقاقات، والمتأخرات — مع كشف حساب قابل للطباعة."
        actions={
          <>
            <Button variant="secondary" icon={<CalendarClock size={17} />} onClick={() => navigate('/subscriptions')}>
              الاستحقاقات الشهرية
            </Button>
            {capabilities?.exportMembers && (
              <Button variant="secondary" icon={<Download size={17} />} onClick={exportMembers}>
                تصدير Excel
              </Button>
            )}
            {capabilities?.importMembers && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) importFile(file);
                  }}
                />
                <Button variant="secondary" icon={<Upload size={17} />} loading={importing} onClick={() => fileRef.current?.click()}>
                  استيراد Excel
                </Button>
              </>
            )}
            {capabilities?.addMembers && (
              <Button icon={<Plus size={17} />} onClick={openCreate}>إضافة عضو</Button>
            )}
          </>
        }
      />

      <section className="stats-grid four">
        <StatCard label="إجمالي الأعضاء" value={formatNumber(members.length)} hint={`${formatNumber(totals.active)} عضو نشط`} icon={<Users size={21} />} tone="emerald" />
        <StatCard label="إجمالي المستحقات" value={money(totals.accrued)} hint="استحقاقات متراكمة" icon={<Wallet size={21} />} tone="blue" />
        <StatCard label="إجمالي المسدد" value={money(totals.paid)} hint="المبالغ المحصلة" icon={<UserCheck size={21} />} tone="gold" />
        <StatCard label="المتأخرات" value={money(totals.arrears)} hint="لا تدخل ضمن الرصيد النقدي" icon={<CalendarClock size={21} />} tone="amber" />
      </section>

      <Card padding={false} className="table-card">
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالاسم أو رقم العضوية أو الهاتف…" />
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">الأعضاء النشطون</option>
            <option value="inactive">الأعضاء الموقوفون</option>
            <option value="all">جميع الأعضاء</option>
          </Select>
        </div>

        {loading ? (
          <LoadingState label="جارٍ تحميل الأعضاء…" />
        ) : error ? (
          <div className="table-message"><Alert tone="danger" title="تعذر تحميل البيانات">{error}</Alert></div>
        ) : members.length === 0 ? (
          <EmptyState
            title={search ? 'لا توجد نتائج مطابقة' : 'لا يوجد أعضاء مسجلون'}
            description={search ? 'جرّب تعديل كلمة البحث أو الفلتر.' : 'ابدأ بإضافة أول عضو إلى الصندوق.'}
            icon={<UserPlus size={28} />}
            action={capabilities?.addMembers && !search ? <Button onClick={openCreate}>إضافة عضو</Button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>رقم العضوية</th>
                  <th>العضو</th>
                  <th>الهاتف</th>
                  <th>الاشتراك</th>
                  <th>المستحق</th>
                  <th>المسدد</th>
                  <th>المتأخرات</th>
                  <th>الحالة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="mono">{member.member_no}</td>
                    <td>
                      <div className="person-cell">
                        <span className="avatar avatar-xs">{member.full_name.charAt(0)}</span>
                        <div>
                          <strong>{member.full_name}</strong>
                          <small>{member.address}</small>
                        </div>
                      </div>
                    </td>
                    <td className="mono" dir="ltr">{member.phone || '—'}</td>
                    <td>{money(member.monthly_fee)}</td>
                    <td>{money(member.total_accrued)}</td>
                    <td className="text-emerald">{money(member.total_paid)}</td>
                    <td>
                      {member.arrears > 0 ? (
                        <span className="amount danger-text">{money(member.arrears)}</span>
                      ) : (
                        <Badge tone="success">مسدد</Badge>
                      )}
                    </td>
                    <td>
                      <Badge tone={member.active ? 'success' : 'neutral'} dot>
                        {member.active ? 'نشط' : 'موقوف'}
                      </Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title="كشف حساب وطباعة" onClick={() => openStatement(member)} disabled={statementLoading}>
                          <FileText size={16} />
                        </button>
                        {capabilities?.editMembers && (
                          <button type="button" className="icon-btn" title="تعديل" onClick={() => openEdit(member)}>
                            <Edit3 size={16} />
                          </button>
                        )}
                        {capabilities?.deleteMembers && (
                          <button type="button" className="icon-btn danger-text" title="حذف" onClick={() => deleteMember(member)}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>الإجمالي ({formatNumber(members.length)} عضو)</td>
                  <td>{money(totals.accrued)}</td>
                  <td className="text-emerald">{money(totals.paid)}</td>
                  <td className="danger-text">{money(totals.arrears)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="page-note">
        <Alert tone="info" title="ملاحظة محاسبية">
          المتأخرات المعروضة هي استحقاقات لم تُحصل بعد، وتُسجل بشكل منفصل تماماً عن الرصيد النقدي الفعلي للصندوق.
        </Alert>
      </div>

      {formOpen && (
        <Modal
          title={editing ? 'تعديل بيانات العضو' : 'إضافة عضو جديد'}
          subtitle={editing ? `رقم العضوية ${editing.member_no}` : 'سيتم توليد رقم العضوية تلقائياً بالصيغة M-001'}
          onClose={() => setFormOpen(false)}
          size="lg"
          icon={<UserPlus size={20} />}
          footer={
            <>
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>إلغاء</Button>
              <Button type="submit" form="member-form" loading={saving}>{editing ? 'حفظ التعديلات' : 'إضافة العضو'}</Button>
            </>
          }
        >
          <form id="member-form" onSubmit={submit} className="form-stack">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="form-grid two">
              <Field label="اسم العضو" required>
                <TextInput value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="الاسم الثلاثي" required />
              </Field>
              <Field label="رقم الهاتف">
                <TextInput value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="7xxxxxxxx" dir="ltr" />
              </Field>
              <Field label="العنوان">
                <TextInput value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="الغدير - مقبنة - تعز" />
              </Field>
              <Field label="الاشتراك الشهري (ر.ي)" required hint="أرقام صحيحة فقط — يُستخدم عند توليد الاستحقاقات القادمة">
                <AmountInput value={form.monthly_fee} onChange={(value) => update('monthly_fee', value)} required />
              </Field>
              <Field label="تاريخ الانضمام (هجري)">
                <HijriDateInput value={form.joined_on} onChange={(value) => update('joined_on', value)} />
              </Field>
              <Field label="حالة العضوية">
                <label className="switch-field">
                  <input type="checkbox" checked={form.active} onChange={(e) => update('active', e.target.checked)} />
                  <span className="switch" />
                  <span>{form.active ? 'عضوية نشطة' : 'عضوية موقوفة'}</span>
                </label>
              </Field>
            </div>
            <Field label="ملاحظات">
              <Textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="ملاحظات إضافية عن العضو…" rows={3} />
            </Field>
            {editing && (
              <p className="form-hint">
                إيقاف العضوية يمنع توليد استحقاقات جديدة، ولا يحذف السجل المالي السابق.
              </p>
            )}
          </form>
        </Modal>
      )}

      {statement && (
        <MemberStatementPrint
          member={statement.member}
          subscriptions={statement.subscriptions}
          receipts={statement.receipts}
          onClose={() => setStatement(null)}
        />
      )}
    </div>
  );
}
