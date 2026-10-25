import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  KeyRound,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
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
  admin: 'مدير النظام: صلاحية كاملة على جميع أجزاء النظام وإدارة المستخدمين والإعدادات.',
  fund_manager: 'مدير الصندوق: يشرف على أعمال الصندوق ويعتمد طلبات الصرف في المرحلة الثانية.',
  secretary_general: 'الأمين العام: يعتمد طلبات الصرف في المرحلة الأولى ويتابع التقارير والبيانات.',
  accountant: 'المحاسب: إدخال وتعديل البيانات المالية وإصدار السندات وطلبات الصرف.',
  treasurer: 'أمين الصندوق: تحصيل الأموال وتسجيل السندات وصرف المبالغ المعتمدة.',
  board_member: 'عضو مجلس الإدارة: اطلاع وقراءة التقارير والبيانات دون تعديل.',
  member: 'حساب عضو: بوابة شخصية لعرض الاشتراكات والسندات الخاصة به.',
};

const PERMISSION_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'لوحة التحكم',
    items: [['dashboard.view', 'عرض لوحة التحكم']],
  },
  {
    title: 'الأعضاء',
    items: [
      ['members.view', 'عرض الأعضاء'],
      ['members.add', 'إضافة عضو'],
      ['members.edit', 'تعديل عضو'],
      ['members.delete', 'حذف عضو'],
      ['members.import', 'استيراد من Excel'],
      ['members.export', 'تصدير إلى Excel'],
    ],
  },
  {
    title: 'الاستحقاقات الشهرية',
    items: [
      ['subscriptions.view', 'عرض الاستحقاقات'],
      ['subscriptions.add', 'توليد استحقاقات'],
      ['subscriptions.edit', 'تعديل استحقاق'],
      ['subscriptions.delete', 'حذف استحقاق'],
      ['subscriptions.pay', 'تحصيل سداد'],
    ],
  },
  {
    title: 'سندات القبض والتبرعات',
    items: [
      ['receipts.view', 'عرض السندات'],
      ['receipts.add', 'إضافة سند'],
      ['receipts.edit', 'تعديل سند'],
      ['receipts.delete', 'حذف سند'],
      ['receipts.print', 'طباعة سند'],
    ],
  },
  {
    title: 'طلبات الصرف',
    items: [
      ['expenses.view', 'عرض طلبات الصرف'],
      ['expenses.add', 'إنشاء طلب صرف'],
      ['expenses.edit', 'تعديل طلب صرف'],
      ['expenses.delete', 'حذف طلب صرف'],
      ['expenses.approve', 'اعتماد طلبات الصرف'],
      ['expenses.pay', 'صرف الأموال'],
      ['expenses.print', 'طباعة سند صرف'],
    ],
  },
  {
    title: 'التقارير والتدقيق',
    items: [
      ['reports.view', 'عرض التقارير'],
      ['reports.export', 'تصدير التقارير'],
      ['reports.print', 'طباعة التقارير'],
      ['audit.view', 'عرض سجل التدقيق'],
    ],
  },
  {
    title: 'الإدارة والنظام',
    items: [
      ['users.manage', 'إدارة المستخدمين'],
      ['settings.manage', 'إدارة الإعدادات'],
      ['backups.manage', 'إدارة النسخ الاحتياطية'],
      ['backups.restore', 'استعادة نسخة احتياطية'],
    ],
  },
];

export function UsersPage() {
  const { user: currentUser, refresh } = useAuth();
  const realtimeVersion = useRealtimeVersion();
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
    phone_login_enabled: false,
  });
  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [approvalTarget, setApprovalTarget] = useState<AdminUser | null>(null);
  const [approvalRole, setApprovalRole] = useState<Role>('member');
  const [approvalMemberId, setApprovalMemberId] = useState('');
  const [approvalPhoneLogin, setApprovalPhoneLogin] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [approvalError, setApprovalError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = await api.get<{
        users: AdminUser[];
        members: Member[];
        roles: Array<{ value: Role; label: string }>;
        permission_keys: string[];
        role_permissions: Record<string, string[]>;
      }>('/users');
      setUsers(payload.users);
      setMembers(payload.members);
      setRoles(payload.roles);
      setPermissionKeys(payload.permission_keys ?? []);
      setRolePermissions(payload.role_permissions ?? {});
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [realtimeVersion]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((row) =>
      `${row.full_name} ${row.email} ${row.phone ?? ''} ${ROLE_LABELS[row.role]}`.toLowerCase().includes(query)
    );
  }, [users, search]);

  function defaultPermissionsFor(role: Role) {
    const defaults = role === 'admin'
      ? permissionKeys
      : (rolePermissions[role] ?? []);
    const result: Record<string, boolean> = {};
    for (const key of permissionKeys) result[key] = defaults.includes(key);
    return result;
  }

  function togglePermission(key: string) {
    setPermissions((current) => ({ ...current, [key]: !current[key] }));
  }

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
      phone_login_enabled: false,
    });
    setPermissions(defaultPermissionsFor('member'));
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
      phone_login_enabled: Boolean(target.phone_login_enabled),
    });
    setPermissions({ ...defaultPermissionsFor(target.role), ...(target.permissions ?? {}) });
    setFormError('');
    setFormOpen(true);
  }

  function changeRole(role: Role) {
    setForm((current) => ({ ...current, role }));
    setPermissions(defaultPermissionsFor(role));
  }

  async function approveUser(event: FormEvent) {
    event.preventDefault();
    if (!approvalTarget) return;
    setApprovalError('');
    setApprovalSaving(true);
    try {
      await api.post(`/users/${approvalTarget.id}/approve`, {
        role: approvalRole,
        linked_member_id: approvalMemberId || null,
        phone_login_enabled: approvalPhoneLogin,
        permissions: defaultPermissionsFor(approvalRole),
      });
      toast.success(`تمت الموافقة على ${approvalTarget.full_name}`);
      setApprovalTarget(null);
      await load();
    } catch (approveError) {
      setApprovalError(apiErrorMessage(approveError));
    } finally {
      setApprovalSaving(false);
    }
  }

  async function rejectUser(target: AdminUser) {
    const reason = window.prompt(`سبب رفض طلب تسجيل «${target.full_name}» (اختياري):`, '');
    if (reason === null) return;
    try {
      await api.post(`/users/${target.id}/reject`, { reason: reason.trim() || null });
      toast.success('تم رفض طلب التسجيل');
      await load();
    } catch (rejectError) {
      toast.error(apiErrorMessage(rejectError));
    }
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
          phone_login_enabled: form.phone_login_enabled,
          role: form.role,
          active: form.active,
          linked_member_id: form.linked_member_id || null,
          permissions,
        });
        toast.success('تم تحديث بيانات المستخدم');
        if (editing.id === currentUser?.id) await refresh();
      } else {
        await api.post('/users', {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          password: form.password,
          phone: form.phone.trim() || null,
          phone_login_enabled: form.phone_login_enabled,
          role: form.role,
          linked_member_id: form.linked_member_id || null,
          permissions,
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

  const pendingUsers = users.filter((row) => row.approval_status === 'pending');
  const stats = {
    total: users.length,
    active: users.filter((row) => row.active && row.approval_status === 'approved').length,
    admins: users.filter((row) => row.role === 'admin' && row.approval_status === 'approved').length,
    pending: pendingUsers.length,
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
        <StatCard label="طلبات تسجيل معلقة" value={formatNumber(stats.pending)} hint="بانتظار موافقة الإدارة" icon={<ShieldAlert size={21} />} tone="amber" />
      </section>

      {pendingUsers.length > 0 && (
        <Card className="pending-card">
          <div className="pending-head">
            <div>
              <h3><ShieldAlert size={19} /> طلبات تسجيل جديدة</h3>
              <p>لا يستطيع أي مستخدم جديد الدخول قبل موافقتك وتحديد دوره وصلاحياته.</p>
            </div>
            <Badge tone="warning" dot>{formatNumber(pendingUsers.length)} طلب</Badge>
          </div>
          <div className="pending-list">
            {pendingUsers.map((row) => (
              <div key={row.id} className="pending-row">
                <span className="avatar">{row.full_name.charAt(0)}</span>
                <div className="pending-info">
                  <strong>{row.full_name}</strong>
                  <small dir="ltr">{row.email}</small>
                  <small>{formatDate(row.account_created_at)}</small>
                </div>
                <div className="row-actions">
                  <Button
                    size="sm"
                    icon={<Check size={15} />}
                    onClick={() => {
                      setApprovalTarget(row);
                      setApprovalRole('member');
                      setApprovalMemberId(row.linked_member_id ?? '');
                      setApprovalPhoneLogin(Boolean(row.phone_login_enabled));
                      setApprovalError('');
                    }}
                  >
                    موافقة
                  </Button>
                  <Button size="sm" variant="ghost" icon={<X size={15} />} onClick={() => rejectUser(row)}>
                    رفض
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

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
                          {row.phone_login_enabled && <small className="phone-login-tag">دخول بالهاتف مفعّل</small>}
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
                <Select value={form.role} onChange={(e) => changeRole(e.target.value as Role)}>
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

            <label className="switch-field">
              <input
                type="checkbox"
                checked={form.phone_login_enabled}
                onChange={(e) => setForm((current) => ({ ...current, phone_login_enabled: e.target.checked }))}
              />
              <span className="switch" />
              <span>السماح بالدخول برقم الهاتف بدلاً من البريد الإلكتروني</span>
            </label>
            {form.phone_login_enabled && (
              <Alert tone={form.phone.trim() ? 'info' : 'warning'}>
                {form.phone.trim()
                  ? 'سيتمكن المستخدم من تسجيل الدخول بهذا الرقم وكلمة المرور. يجب أن يكون الرقم فريداً بين الحسابات المفعّلة.'
                  : 'أدخل رقم هاتف صالحاً أولاً، ثم فعّل هذا الخيار.'}
              </Alert>
            )}

            <div className="permission-matrix">
              <div className="permission-matrix-head">
                <div>
                  <strong>مصفوفة الصلاحيات التفصيلية</strong>
                  <p>حدد ما يستطيع هذا المستخدم رؤيته أو إضافته أو تعديله أو حذفه أو طباعته.</p>
                </div>
                <Badge tone="info">{form.role === 'admin' ? 'صلاحية كاملة' : 'قابلة للتخصيص'}</Badge>
              </div>
              <div className="permission-groups">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.title} className="permission-group">
                    <h4>{group.title}</h4>
                    <div className="permission-items">
                      {group.items.map(([key, label]) => {
                        const checked = form.role === 'admin' ? true : Boolean(permissions[key]);
                        return (
                          <label key={key} className={`permission-item ${checked ? 'checked' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={form.role === 'admin'}
                              onChange={() => togglePermission(key)}
                            />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <Alert tone="info">
                صلاحيات الدور الافتراضية تُطبق تلقائياً، ويمكنك تخصيصها لكل مستخدم. مدير النظام يملك كل الصلاحيات دائماً.
              </Alert>
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

      {approvalTarget && (
        <Modal
          title="الموافقة على طلب تسجيل"
          subtitle={`${approvalTarget.full_name} — ${approvalTarget.email}`}
          icon={<ShieldCheck size={20} />}
          size="md"
          onClose={() => setApprovalTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setApprovalTarget(null)} disabled={approvalSaving}>إلغاء</Button>
              <Button type="submit" form="approval-form" loading={approvalSaving} icon={<Check size={16} />}>
                تفعيل الحساب
              </Button>
            </>
          }
        >
          <form id="approval-form" onSubmit={approveUser} className="form-stack">
            {approvalError && <Alert tone="danger">{approvalError}</Alert>}
            <div className="form-grid two">
              <Field label="الدور" required>
                <Select
                  value={approvalRole}
                  onChange={(event) => setApprovalRole(event.target.value as Role)}
                >
                  {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </Select>
              </Field>
              <Field label="ربط بسجل عضو" hint="مطلوب لحساب العضو">
                <Select value={approvalMemberId} onChange={(event) => setApprovalMemberId(event.target.value)}>
                  <option value="">— بدون ربط —</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.member_no} — {member.full_name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="switch-field">
              <input
                type="checkbox"
                checked={approvalPhoneLogin}
                onChange={(event) => setApprovalPhoneLogin(event.target.checked)}
              />
              <span>
                <strong>السماح بالدخول برقم الهاتف</strong>
                <small>{approvalTarget.phone ? `سيتمكن من الدخول بالرقم ${approvalTarget.phone}` : 'أضف رقم هاتف للحساب أولاً من شاشة التعديل'}</small>
              </span>
            </label>
            <Alert tone="warning">
              سيتم تفعيل الحساب فوراً وإرسال إشعار للمستخدم. تأكد من اختيار الدور الصحيح قبل المتابعة.
            </Alert>
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
