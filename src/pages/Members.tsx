import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Edit3,
  FileText,
  Plus,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { formatDate, formatNumber, money, todayISO } from '../lib/format';
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
  }, [search, status]);

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
    setSaving(true);
    try {
      const body = {
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        monthly_fee: Number(form.monthly_fee || 0),
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
            {capabilities?.manageMembers && (
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
            action={capabilities?.manageMembers && !search ? <Button onClick={openCreate}>إضافة عضو</Button> : undefined}
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
                        {capabilities?.manageMembers && (
                          <button type="button" className="icon-btn" title="تعديل" onClick={() => openEdit(member)}>
                            <Edit3 size={16} />
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
              <Field label="الاشتراك الشهري (ر.ي)" required hint="يُستخدم عند توليد الاستحقاقات القادمة">
                <TextInput type="number" min="0" step="1" value={form.monthly_fee} onChange={(e) => update('monthly_fee', e.target.value)} required />
              </Field>
              <Field label="تاريخ الانضمام">
                <TextInput type="date" value={form.joined_on} onChange={(e) => update('joined_on', e.target.value)} />
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
