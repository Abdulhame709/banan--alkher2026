import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  KeyRound,
  Mail,
  Pencil,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { formatDate, formatNumber, ROLE_LABELS } from '../lib/format';
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
} from '../components/ui';
import type { Member, Role, User } from '../types';

interface AdminUser extends User {
  account_created_at: string;
  linked_member_name: string | null;
  linked_member_no: string | null;
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'صلاحية كاملة على النظام والإعدادات والمستخدمين والاعتمادات والصرف.',
  accountant: 'إدارة الأعضاء والاستحقاقات وسندات القبض والتقارير المالية.',
  treasurer: 'التحصيل، اعتماد طلبات الصرف، وتنفيذ الصرف عند كفاية الرصيد.',
  board_member: 'مراجعة مالية واعتماد طلبات الصرف والاطلاع على سجل التدقيق.',
  member: 'بوابة عضو للاطلاع على الاشتراكات والمدفوعات الخاصة به فقط.',
};

export function UsersPage() {
  const { user: currentUser, refresh } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Array<{ value: Role; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    role: 'member' as Role,
    linked_member_id: '',
    active: true,
  });
  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = await api.get<{
        users: AdminUser[];
        members: Member[];
        roles: Array<{ value: Role; label: string }>;
      }>('/users');
      setUsers(payload.users);
      setMembers(payload.members);
      setRoles(payload.roles);
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((row) =>
      `${row.full_name} ${row.email} ${row.phone ?? ''} ${ROLE_LABELS[row.role]}`.toLowerCase().includes(query)
    );
  }, [users, search]);

  function openCreate() {
    setEditing(null);
    setForm({
      full_name: '',
      email: '',
      password: '',
      phone: '',
      role: 'member',
      linked_member_id: '',
      active: true,
    });
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(target: AdminUser) {
    setEditing(target);
    setForm({
      full_name: target.full_name,
      email: target.email,
      password: '',
      phone: target.phone ?? '',
      role: target.role,
      linked_member_id: target.linked_member_id ?? '',
      active: Boolean(target.active),
    });
    setFormError('');
    setFormOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, {
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          role: form.role,
          active: form.active,
          linked_member_id: form.linked_member_id || null,
        });
        toast.success('تم تحديث بيانات المستخدم');
        if (editing.id === currentUser?.id) await refresh();
      } else {
        await api.post('/users', {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          password: form.password,
          phone: form.phone.trim() || null,
          role: form.role,
          linked_member_id: form.linked_member_id || null,
        });
        toast.success('تم إنشاء حساب المستخدم بنجاح');
      }
      setFormOpen(false);
      await load();
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordTarget) return;
    setPasswordError('');
    if (newPassword.length < 8) {
      setPasswordError('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    setSavingPassword(true);
    try {
      await api.patch(`/users/${passwordTarget.id}/password`, { new_password: newPassword });
      toast.success('تمت إعادة تعيين كلمة المرور وإنهاء جلسات المستخدم');
      setPasswordTarget(null);
      setNewPassword('');
    } catch (passwordSaveError) {
      setPasswordError(apiErrorMessage(passwordSaveError));
    } finally {
      setSavingPassword(false);
    }
  }

  const stats = {
    total: users.length,
    active: users.filter((row) => row.active).length,
    admins: users.filter((row) => row.role === 'admin').length,
    members: users.filter((row) => row.role === 'member').length,
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="إدارة المستخدمين والصلاحيات"
        subtitle="إنشاء حسابات النظام وتحديد الأدوار وربط حسابات الأعضاء بسجلاتهم."
        actions={<Button icon={<UserPlus size={17} />} onClick={openCreate}>إضافة مستخدم</Button>}
      />

      <section className="stats-grid four">
        <StatCard label="إجمالي المستخدمين" value={formatNumber(stats.total)} hint="جميع الحسابات" icon={<Users size={21} />} tone="slate" />
        <StatCard label="الحسابات النشطة" value={formatNumber(stats.active)} hint="يمكنها تسجيل الدخول" icon={<UserCog size={21} />} tone="emerald" />
        <StatCard label="مديرو النظام" value={formatNumber(stats.admins)} hint="صلاحية كاملة" icon={<ShieldCheck size={21} />} tone="gold" />
        <StatCard label="حسابات أعضاء" value={formatNumber(stats.members)} hint="بوابة العضو" icon={<Users size={21} />} tone="blue" />
      </section>

      <div className="roles-guide">
        {roles.map((role) => (
          <div key={role.value} className="role-guide-item">
            <Badge tone={role.value === 'admin' ? 'gold' : role.value === 'member' ? 'neutral' : 'info'}>{role.label}</Badge>
            <p>{ROLE_DESCRIPTIONS[role.value]}</p>
          </div>
        ))}
      </div>

      <Card padding={false} className="table-card">
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالاسم أو البريد أو الدور…" />
        </div>
        {loading ? (
          <LoadingState label="جارٍ تحميل المستخدمين…" />
        ) : error ? (
          <div className="table-message"><Alert tone="danger" title="تعذر تحميل البيانات">{error}</Alert></div>
        ) : filtered.length === 0 ? (
          <EmptyState title="لا يوجد مستخدمون مطابقون" description="جرّب تعديل البحث أو أضف مستخدماً جديداً." icon={<Users size={28} />} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>البريد الإلكتروني</th>
                  <th>الدور</th>
                  <th>العضو المرتبط</th>
                  <th>الحالة</th>
                  <th>تاريخ الإنشاء</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="person-cell">
                        <span className="avatar avatar-xs">{row.full_name.charAt(0)}</span>
                        <div>
                          <strong>{row.full_name}{row.id === currentUser?.id && <span className="self-tag">أنت</span>}</strong>
                          <small dir="ltr">{row.phone ?? '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td dir="ltr" className="mono">{row.email}</td>
                    <td>
                      <Badge tone={row.role === 'admin' ? 'gold' : row.role === 'member' ? 'neutral' : 'info'}>
                        {ROLE_LABELS[row.role]}
                      </Badge>
                    </td>
                    <td>{row.linked_member_name ? `${row.linked_member_no} — ${row.linked_member_name}` : '—'}</td>
                    <td><Badge tone={row.active ? 'success' : 'danger'} dot>{row.active ? 'نشط' : 'موقوف'}</Badge></td>
                    <td className="muted">{formatDate(row.account_created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title="تعديل" onClick={() => openEdit(row)}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className="icon-btn" title="إعادة تعيين كلمة المرور" onClick={() => { setPasswordTarget(row); setNewPassword(''); setPasswordError(''); }}>
                          <KeyRound size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Alert tone="warning" title="ملاحظة أمنية">
        لا يمكن إيقاف حسابك أو إزالة صلاحية مدير النظام عن نفسك، ويجب أن يبقى مدير نظام نشط واحد على الأقل.
        إعادة تعيين كلمة المرور تُنهي جميع جلسات المستخدم فوراً.
      </Alert>

      {formOpen && (
        <Modal
          title={editing ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}
          subtitle={editing ? editing.email : 'إنشاء حساب مباشرة بصلاحية محددة'}
          icon={<UserCog size={20} />}
          size="lg"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>إلغاء</Button>
              <Button type="submit" form="user-form" loading={saving}>{editing ? 'حفظ التعديلات' : 'إنشاء الحساب'}</Button>
            </>
          }
        >
          <form id="user-form" onSubmit={submit} className="form-stack">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="form-grid two">
              <Field label="الاسم الكامل" required>
                <TextInput value={form.full_name} onChange={(e) => setForm((current) => ({ ...current, full_name: e.target.value }))} required />
              </Field>
              <Field label="رقم الهاتف">
                <TextInput value={form.phone} onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))} dir="ltr" />
              </Field>
              {!editing && (
                <>
                  <Field label="البريد الإلكتروني" required>
                    <TextInput type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} dir="ltr" required />
                  </Field>
                  <Field label="كلمة المرور" required hint="8 أحرف على الأقل">
                    <TextInput type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} dir="ltr" required />
                  </Field>
                </>
              )}
              <Field label="الدور والصلاحية" required>
                <Select value={form.role} onChange={(e) => setForm((current) => ({ ...current, role: e.target.value as Role }))}>
                  {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </Select>
              </Field>
              <Field label="ربط بسجل عضو" hint="مطلوب لحسابات الأعضاء للاطلاع على بوابتهم">
                <Select value={form.linked_member_id} onChange={(e) => setForm((current) => ({ ...current, linked_member_id: e.target.value }))}>
                  <option value="">— بدون ربط —</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.member_no} — {member.full_name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            {editing && (
              <label className="switch-field">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))}
                  disabled={editing.id === currentUser?.id}
                />
                <span className="switch" />
                <span>الحساب نشط ويمكنه تسجيل الدخول</span>
              </label>
            )}
            {editing && (
              <Alert tone="info">
                تعديل الدور يغير الصلاحيات فوراً. لا يمكن إيقاف حسابك الحالي أو إزالة دور المدير عن آخر مدير نشط.
              </Alert>
            )}
          </form>
        </Modal>
      )}

      {passwordTarget && (
        <Modal
          title="إعادة تعيين كلمة المرور"
          subtitle={passwordTarget.full_name}
          icon={<KeyRound size={20} />}
          size="sm"
          onClose={() => setPasswordTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPasswordTarget(null)} disabled={savingPassword}>إلغاء</Button>
              <Button type="submit" form="password-form" loading={savingPassword}>تغيير كلمة المرور</Button>
            </>
          }
        >
          <form id="password-form" onSubmit={submitPassword} className="form-stack">
            {passwordError && <Alert tone="danger">{passwordError}</Alert>}
            <Field label="كلمة المرور الجديدة" required hint="8 أحرف على الأقل — ستُنهى جميع جلسات المستخدم">
              <TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} dir="ltr" required />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}
