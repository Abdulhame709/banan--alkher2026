import { useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  ImagePlus,
  Info,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { formatDateTime, money } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  LoadingState,
  PageHeader,
  TextInput,
} from '../components/ui';
import { FileUpload } from '../components/FileUpload';
import { BackupCard } from '../components/BackupCard';
import { Emblem } from '../components/Logo';
import type { FundSettings } from '../types';

export function SettingsPage() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<FundSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    fund_name: '',
    logo_file: null as string | null,
    default_monthly_fee: '1000',
    currency: 'ريال يمني',
    opening_balance: '0',
    allow_self_approval_demo: false,
    allow_signups: true,
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = await api.get<{ settings: FundSettings }>('/settings');
      setSettings(payload.settings);
      setForm({
        fund_name: payload.settings.fund_name,
        logo_file: payload.settings.logo_file,
        default_monthly_fee: String(payload.settings.default_monthly_fee),
        currency: payload.settings.currency,
        opening_balance: String(payload.settings.opening_balance),
        allow_self_approval_demo: Boolean(payload.settings.allow_self_approval_demo),
        allow_signups: Boolean(payload.settings.allow_signups),
      });
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = await api.patch<{ settings: FundSettings }>('/settings', {
        fund_name: form.fund_name.trim(),
        logo_file: form.logo_file,
        default_monthly_fee: Number(form.default_monthly_fee || 0),
        currency: form.currency.trim(),
        opening_balance: Number(form.opening_balance || 0),
        allow_self_approval_demo: form.allow_self_approval_demo,
        allow_signups: form.allow_signups,
      });
      setSettings(payload.settings);
      toast.success('تم حفظ إعدادات الصندوق بنجاح');
      await refresh();
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
      toast.error(apiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="جارٍ تحميل الإعدادات…" />;
  if (error || !settings) {
    return (
      <div className="page-stack">
        <Alert tone="danger" title="تعذر تحميل الإعدادات">{error}</Alert>
        <Button onClick={load} icon={<RefreshCw size={17} />}>إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="إعدادات الصندوق"
        subtitle="الهوية الرسمية، الشعار، الرصيد الافتتاحي، والاشتراك الشهري الافتراضي."
        actions={<Badge tone="gold"><ShieldCheck size={14} /> صلاحية مدير النظام</Badge>}
      />

      <form onSubmit={submit} className="settings-layout">
        <div className="settings-main">
          <Card>
            <CardHeader title="الهوية الرسمية للصندوق" subtitle="تظهر في الشاشات وسندات القبض والصرف والتقارير" icon={<Building2 size={19} />} />
            <div className="form-stack">
              {formError && <Alert tone="danger">{formError}</Alert>}
              <Field label="الاسم الرسمي للصندوق" required hint="يجب أن يبدأ الاسم الرسمي بكلمة «صندوق»">
                <TextInput
                  value={form.fund_name}
                  onChange={(event) => setForm((current) => ({ ...current, fund_name: event.target.value }))}
                  required
                />
              </Field>
              <div className="form-grid two">
                <Field label="العملة" required>
                  <TextInput
                    value={form.currency}
                    onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
                    required
                  />
                </Field>
                <Field label="الاشتراك الشهري الافتراضي (ر.ي)" required hint="يُستخدم عند إضافة عضو جديد">
                  <TextInput
                    type="number"
                    min="0"
                    step="1"
                    value={form.default_monthly_fee}
                    onChange={(event) => setForm((current) => ({ ...current, default_monthly_fee: event.target.value }))}
                    required
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="شعار الصندوق" subtitle="يظهر في صفحة الدخول، القائمة، لوحة التحكم، والسندات المطبوعة" icon={<ImagePlus size={19} />} />
            <div className="logo-settings">
              <div className="logo-preview">
                {form.logo_file ? (
                  <img src={fileUrl(form.logo_file)} alt="شعار الصندوق" />
                ) : (
                  <Emblem size={96} />
                )}
                <small>{form.logo_file ? 'الشعار المرفوع' : 'الشعار الافتراضي (SVG)'}</small>
              </div>
              <div className="logo-upload">
                <FileUpload
                  value={form.logo_file}
                  onChange={(file) => setForm((current) => ({ ...current, logo_file: file }))}
                  kind="logo"
                  label="رفع شعار رسمي"
                  hint="PNG أو JPG أو WebP — يفضل مربع بخلفية شفافة أو داكنة، بحد أقصى 8 ميجابايت"
                />
                {form.logo_file && (
                  <Button variant="ghost" size="sm" onClick={() => setForm((current) => ({ ...current, logo_file: null }))}>
                    إزالة الشعار واستخدام الافتراضي
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="الإعدادات المالية" subtitle="الرصيد الافتتاحي يؤثر مباشرة على الرصيد النقدي الفعلي" icon={<Wallet size={19} />} />
            <div className="form-grid two">
              <Field label="الرصيد الافتتاحي (ر.ي)" required hint="الرصيد النقدي عند بداية استخدام النظام">
                <TextInput
                  type="number"
                  step="0.01"
                  value={form.opening_balance}
                  onChange={(event) => setForm((current) => ({ ...current, opening_balance: event.target.value }))}
                  required
                />
              </Field>
              <div className="financial-preview">
                <span>الرصيد النقدي الافتتاحي الحالي</span>
                <strong>{money(Number(form.opening_balance || 0))}</strong>
                <small>لا يشمل المتأخرات على الأعضاء</small>
              </div>
            </div>
            <Alert tone="warning">
              تعديل الرصيد الافتتاحي يعيد احتساب الرصيد النقدي الفعلي. يُستخدم عادةً مرة واحدة عند بداية
              التشغيل أو بعد جرد رسمي موثق. كل تعديل يُسجل في سجل التدقيق.
            </Alert>
          </Card>

          <Card>
            <CardHeader title="خيارات التشغيل والرقابة" subtitle="ضبط التسجيل الذاتي وسياسة الاعتماد أثناء الاختبار" icon={<SlidersHorizontal size={19} />} />
            <div className="settings-switches">
              <label className="setting-row">
                <div>
                  <strong>السماح بالتسجيل الذاتي</strong>
                  <span>تمكين المستخدمين من إنشاء حسابات جديدة من صفحة الدخول. الحسابات الجديدة تُنشأ بصلاحية «عضو».</span>
                </div>
                <span className="switch-field">
                  <input
                    type="checkbox"
                    checked={form.allow_signups}
                    onChange={(event) => setForm((current) => ({ ...current, allow_signups: event.target.checked }))}
                  />
                  <span className="switch" />
                </span>
              </label>
              <label className="setting-row">
                <div>
                  <strong>تجاوز اختبار الاعتماد الذاتي</strong>
                  <span>السماح لمنشئ الطلب باعتماده بنفسه — للاختبار فقط. يُنصح بإبقائه معطلاً في التشغيل الفعلي.</span>
                </div>
                <span className="switch-field">
                  <input
                    type="checkbox"
                    checked={form.allow_self_approval_demo}
                    onChange={(event) => setForm((current) => ({ ...current, allow_self_approval_demo: event.target.checked }))}
                  />
                  <span className="switch" />
                </span>
              </label>
            </div>
            {form.allow_self_approval_demo && (
              <Alert tone="danger" title="تحذير رقابي">
                تجاوز الاعتماد الذاتي يُضعف مبدأ الاعتماد المزدوج. استخدمه فقط أثناء اختبار النظام على حساب واحد.
              </Alert>
            )}
          </Card>

          <div className="settings-save-bar">
            <div>
              <strong>حفظ التغييرات</strong>
              <span>آخر تحديث: {formatDateTime(settings.updated_at)}</span>
            </div>
            <Button type="submit" loading={saving} icon={<Save size={17} />}>حفظ الإعدادات</Button>
          </div>
        </div>

        <aside className="settings-side">
          <Card>
            <CardHeader title="ملخص الهوية" subtitle="معاينة مباشرة" icon={<Info size={19} />} />
            <div className="brand-preview">
              {form.logo_file ? (
                <img src={fileUrl(form.logo_file)} alt="الشعار" className="brand-preview-logo" />
              ) : (
                <Emblem size={72} />
              )}
              <strong>{form.fund_name || 'صندوق بنان الخير للبنيان'}</strong>
              <span>الغدير – مقبنة – تعز</span>
              <small>النظام المحاسبي والإداري</small>
            </div>
          </Card>

          <Card>
            <CardHeader title="سلامة البيانات" subtitle="معلومات النظام" icon={<ShieldCheck size={19} />} />
            <ul className="system-info">
              <li><span>قاعدة البيانات</span><strong>PostgreSQL — Supabase</strong></li>
              <li><span>تخزين الملفات</span><strong>Supabase Storage</strong></li>
              <li><span>سجل التدقيق</span><strong>غير قابل للتعديل أو الحذف</strong></li>
              <li><span>جلسات الدخول</span><strong>Supabase Auth — مشفرة</strong></li>
              <li><span>التحديثات</span><strong>فورية بين المستخدمين</strong></li>
              <li><span>سياسة الاعتماد</span><strong>{form.allow_self_approval_demo ? 'تجاوز اختباري مفعّل' : 'اعتماد مزدوج صارم'}</strong></li>
            </ul>
          </Card>

          <Alert tone="info" title="نسخ احتياطي">
            استخدم زر «إنشاء نسخة الآن» في قسم النسخ الاحتياطية بالأسفل. تُحفظ النسخ في تخزين
            Supabase الخاص ويُحتفظ بآخر 30 نسخة تلقائياً، ويمكن تنزيل أي نسخة في أي وقت.
          </Alert>
        </aside>
      </form>

      <BackupCard />
    </div>
  );
}
