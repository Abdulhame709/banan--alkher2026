import { useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  Coins,
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
import { formatDateTime, money, moneyIn, secondaryAmount } from '../lib/format';
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
import { AmountInput, parseAmount } from '../components/AmountInput';
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
    secondary_currency: 'ريال سعودي',
    exchange_rate: '0',
    secondary_enabled: false,
    opening_balance: '0',
    allow_signups: true,
    auto_dues_enabled: true,
    cash_alert_threshold: '0',
    commitment_alert_percent: '80',
    approval_alert_days: '3',
    reminder_day: '25',
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
        secondary_currency: payload.settings.secondary_currency ?? 'ريال سعودي',
        exchange_rate: String(payload.settings.exchange_rate ?? 0),
        secondary_enabled: Boolean(payload.settings.secondary_enabled),
        opening_balance: String(payload.settings.opening_balance),
        allow_signups: Boolean(payload.settings.allow_signups),
        auto_dues_enabled: payload.settings.auto_dues_enabled !== false,
        cash_alert_threshold: String(payload.settings.cash_alert_threshold ?? 0),
        commitment_alert_percent: String(payload.settings.commitment_alert_percent ?? 80),
        approval_alert_days: String(payload.settings.approval_alert_days ?? 3),
        reminder_day: String(payload.settings.reminder_day ?? 25),
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
    const monthlyFee = parseAmount(form.default_monthly_fee);
    if (monthlyFee <= 0) {
      setFormError('أدخل اشتراكاً شهرياً صحيحاً أكبر من صفر (بدون كسور)');
      return;
    }
    setSaving(true);
    try {
      const payload = await api.patch<{ settings: FundSettings }>('/settings', {
        fund_name: form.fund_name.trim(),
        logo_file: form.logo_file,
        default_monthly_fee: monthlyFee,
        currency: form.currency.trim(),
        secondary_currency: form.secondary_currency.trim() || 'ريال سعودي',
        exchange_rate: Number(form.exchange_rate) || 0,
        secondary_enabled: form.secondary_enabled,
        opening_balance: parseAmount(form.opening_balance),
        allow_signups: form.allow_signups,
        auto_dues_enabled: form.auto_dues_enabled,
        cash_alert_threshold: parseAmount(form.cash_alert_threshold),
        commitment_alert_percent: Number(form.commitment_alert_percent) || 0,
        approval_alert_days: Number(form.approval_alert_days) || 1,
        reminder_day: Number(form.reminder_day) || 25,
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
                <Field label="الاشتراك الشهري الافتراضي (ر.ي)" required hint="أرقام صحيحة فقط — يُستخدم عند إضافة عضو جديد">
                  <AmountInput
                    value={form.default_monthly_fee}
                    onChange={(value) => setForm((current) => ({ ...current, default_monthly_fee: value }))}
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
              <Field label="الرصيد الافتتاحي (ر.ي)" required hint="أرقام صحيحة فقط — الرصيد النقدي عند بداية استخدام النظام">
                <AmountInput
                  value={form.opening_balance}
                  onChange={(value) => setForm((current) => ({ ...current, opening_balance: value }))}
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
            <CardHeader title="العملة الثانية وسعر الصرف" subtitle="إظهار مقابل تقريبي بالريال السعودي أو أي عملة أخرى بجانب المبالغ" icon={<Coins size={19} />} />
            <div className="settings-switches">
              <label className="setting-row">
                <div>
                  <strong>إظهار المبالغ بالعملة الثانية</strong>
                  <span>عند التفعيل يظهر المقابل التقريبي أسفل المبلغ في السندات وكشوف الحساب والتقارير. تبقى كل القيود والحسابات بالعملة الأساسية.</span>
                </div>
                <span className="switch-field">
                  <input
                    type="checkbox"
                    checked={form.secondary_enabled}
                    onChange={(event) => setForm((current) => ({ ...current, secondary_enabled: event.target.checked }))}
                  />
                  <span className="switch" />
                </span>
              </label>
            </div>
            <div className="form-grid two">
              <Field label="اسم العملة الثانية" required hint="مثال: ريال سعودي">
                <TextInput
                  value={form.secondary_currency}
                  onChange={(event) => setForm((current) => ({ ...current, secondary_currency: event.target.value }))}
                  required
                />
              </Field>
              <Field
                label="سعر الصرف"
                required
                hint={`كم ${form.currency || 'ريال يمني'} يساوي 1 ${form.secondary_currency || 'ريال سعودي'}؟ مثال: 400`}
              >
                <TextInput
                  type="number"
                  min={0}
                  step="0.0001"
                  dir="ltr"
                  value={form.exchange_rate}
                  onChange={(event) => setForm((current) => ({ ...current, exchange_rate: event.target.value }))}
                  required
                />
              </Field>
            </div>
            <div className="financial-preview">
              <span>معاينة سعر الصرف</span>
              <strong>
                {money(5000)} ≈{' '}
                {moneyIn(
                  secondaryAmount(5000, Number(form.exchange_rate)),
                  form.secondary_currency || 'ريال سعودي'
                )}
              </strong>
              <small>
                {Number(form.exchange_rate) > 0
                  ? `1 ${form.secondary_currency || 'ريال سعودي'} = ${moneyIn(Number(form.exchange_rate), form.currency || 'ريال يمني')}`
                  : 'أدخل سعر الصرف لتفعيل العرض بالعملة الثانية'}
              </small>
            </div>
            <Alert tone="info">
              سعر الصرف يُحدَّث يدوياً من هنا ولا يُجلب تلقائياً. عند تغييره تتغير قيمة العرض فقط،
              ولا تتغير المبالغ المسجلة أو الأرصدة. حدّثه عند تغير السوق ووثّق التغيير في سجل التدقيق.
            </Alert>
          </Card>

          <Card>
            <CardHeader title="خيارات التشغيل والرقابة" subtitle="ضبط التسجيل الذاتي وسياسة الاعتماد" icon={<SlidersHorizontal size={19} />} />
            <div className="settings-switches">
              <label className="setting-row">
                <div>
                  <strong>السماح بالتسجيل الذاتي</strong>
                  <span>تمكين المستخدمين من إنشاء حسابات جديدة من صفحة الدخول. الحسابات الجديدة تُنشأ بصلاحية «عضو» وتنتظر موافقة الإدارة قبل تفعيلها.</span>
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
                  <strong>توليد الاستحقاقات الشهرية تلقائياً</strong>
                  <span>إنشاء استحقاق الشهر الهجري الجديد لجميع الأعضاء النشطين عند أول دخول أو عبر المهمة اليومية. لا حاجة للضغط على زر التوليد كل شهر.</span>
                </div>
                <span className="switch-field">
                  <input
                    type="checkbox"
                    checked={form.auto_dues_enabled}
                    onChange={(event) => setForm((current) => ({ ...current, auto_dues_enabled: event.target.checked }))}
                  />
                  <span className="switch" />
                </span>
              </label>
            </div>
            <Alert tone="success" title="اعتماد مزدوج إلزامي">
              لا يمكن لمنشئ طلب الصرف اعتماده بنفسه، ولا يمكن للشخص نفسه اعتماد المرحلتين. هذا الإجراء ثابت في النظام ولا يمكن تجاوزه من الإعدادات.
            </Alert>
          </Card>

          <Card>
            <CardHeader title="التنبيهات الذكية والتذكيرات" subtitle="حدود الإنذار المبكر وموعد تذكير المتأخرين" icon={<SlidersHorizontal size={19} />} />
            <div className="form-grid two">
              <Field label="حد الرصيد المنخفض (ر.ي)" hint="ينبّه عند نزول الرصيد النقدي إلى هذا الحد أو أقل — صفر لتعطيل التنبيه">
                <AmountInput
                  value={form.cash_alert_threshold}
                  onChange={(value) => setForm((current) => ({ ...current, cash_alert_threshold: value }))}
                />
              </Field>
              <Field label="نسبة الالتزامات من الرصيد (%)" hint="ينبّه عند تجاوز الطلبات المعتمدة غير المصروفة هذه النسبة">
                <TextInput
                  type="number"
                  min={1}
                  max={100}
                  value={form.commitment_alert_percent}
                  onChange={(event) => setForm((current) => ({ ...current, commitment_alert_percent: event.target.value }))}
                  dir="ltr"
                />
              </Field>
              <Field label="أيام تأخر الاعتماد" hint="ينبّه عند بقاء طلب صرف دون اعتماد كامل لهذه المدة">
                <TextInput
                  type="number"
                  min={1}
                  max={60}
                  value={form.approval_alert_days}
                  onChange={(event) => setForm((current) => ({ ...current, approval_alert_days: event.target.value }))}
                  dir="ltr"
                />
              </Field>
              <Field label="يوم التذكير الشهري" hint="يوم الشهر الهجري لإرسال تذكير المتأخرات قبل نهاية الشهر">
                <TextInput
                  type="number"
                  min={20}
                  max={29}
                  value={form.reminder_day}
                  onChange={(event) => setForm((current) => ({ ...current, reminder_day: event.target.value }))}
                  dir="ltr"
                />
              </Field>
            </div>
            <Alert tone="info">
              تظهر هذه التنبيهات في لوحة التحكم. التذكيرات تُنشئ روابط واتساب ورسائل SMS جاهزة، ويُسجل إرسالها في سجل التذكيرات.
            </Alert>
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
              <li><span>سياسة الاعتماد</span><strong>اعتماد مزدوج صارم</strong></li>
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
