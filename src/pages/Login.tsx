import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  Eye,
  EyeOff,
  FileCheck2,
  LockKeyhole,
  Mail,
  Phone,
  Scale,
  ShieldCheck,
  User,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Field, TextInput } from '../components/ui';
import { Emblem, FUND_NAME, FUND_SUBTITLE } from '../components/Logo';
import type { PublicSettings } from '../types';

type Mode = 'login' | 'signup';

export function LoginPage() {
  const { user, login, signup, settings } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('login');
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(settings);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  });

  useEffect(() => {
    api
      .get<{ settings: PublicSettings }>('/public/settings')
      .then((data) => setPublicSettings(data.settings))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user) {
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    }
  }, [user, navigate, location.state]);

  const fundName = publicSettings?.fund_name ?? FUND_NAME;
  const logoUrl = publicSettings?.logo_url ?? null;
  const allowSignups = publicSettings?.allow_signups !== false;

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === 'signup' && form.password !== form.confirm) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }
    if (mode === 'signup' && form.password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    if (mode === 'signup' && !form.email.trim() && !form.phone.trim()) {
      setError('أدخل بريداً إلكترونياً أو رقم هاتف للدخول');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
        toast.success('تم تسجيل الدخول بنجاح');
      } else {
        const result = await signup({
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          password: form.password,
        });
        toast.success(result.message);
        setMode('login');
        setForm((current) => ({ ...current, password: '', confirm: '' }));
      }
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'تعذر إتمام العملية. حاول مرة أخرى');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-visual">
        <div className="auth-pattern" aria-hidden="true" />
        <div className="auth-visual-inner">
          <div className="auth-brand">
            {logoUrl ? (
              <img src={logoUrl} alt="شعار الصندوق" className="auth-logo" />
            ) : (
              <Emblem size={72} />
            )}
            <div>
              <span className="auth-brand-kicker">صناديق الخير والتنمية المجتمعية</span>
              <h1>{fundName}</h1>
              <p>الغدير – مقبنة – تعز</p>
            </div>
          </div>

          <div className="auth-hero">
            <h2>نبني الخير بأمانة…<br />ونحاسبه بشفافية.</h2>
            <p>
              نظام محاسبي وإداري متكامل لإدارة اشتراكات الأعضاء، التبرعات، المساعدات،
              والاعتمادات المزدوجة لصرف أموال الصندوق.
            </p>
          </div>

          <ul className="auth-features">
            <li>
              <span><Scale size={20} /></span>
              <div>
                <strong>فصل دقيق بين الاستحقاق والنقد</strong>
                <small>المتأخرات لا تُحتسب ضمن الرصيد النقدي المتاح</small>
              </div>
            </li>
            <li>
              <span><ShieldCheck size={20} /></span>
              <div>
                <strong>اعتماد مزدوج لكل صرف</strong>
                <small>شخصان مستقلان قبل تنفيذ أي صرف من الصندوق</small>
              </div>
            </li>
            <li>
              <span><FileCheck2 size={20} /></span>
              <div>
                <strong>سندات وتقارير موثقة</strong>
                <small>سندات قبض وصرف رسمية وسجل تدقيق غير قابل للتعديل</small>
              </div>
            </li>
          </ul>

          <div className="auth-visual-footer">
            <BadgeCheck size={18} />
            <span>النظام المحاسبي والإداري — صندوق بنان الخير للبنيان</span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            {logoUrl ? <img src={logoUrl} alt="شعار الصندوق" className="auth-logo-sm" /> : <Emblem size={48} />}
            <div>
              <strong>{fundName}</strong>
              <span>{FUND_SUBTITLE}</span>
            </div>
          </div>

          <header className="auth-card-head">
            <h2>{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}</h2>
            <p>
              {mode === 'login'
                ? 'أدخل بيانات حسابك للوصول إلى النظام المحاسبي للصندوق.'
                : 'سجّل حسابك للانضمام إلى النظام. يتم تفعيل الصلاحيات من مدير النظام.'}
            </p>
          </header>

          {allowSignups && (
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => { setMode('login'); setError(''); }}
              >
                دخول
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                className={mode === 'signup' ? 'active' : ''}
                onClick={() => { setMode('signup'); setError(''); }}
              >
                حساب جديد
              </button>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <>
                <Field label="الاسم الكامل" required>
                  <div className="input-with-icon">
                    <User size={17} />
                    <input
                      className="input"
                      value={form.full_name}
                      onChange={(event) => update('full_name', event.target.value)}
                      placeholder="مثال: أحمد علي الصبري"
                      required
                      autoComplete="name"
                    />
                  </div>
                </Field>
                <div className="form-grid two">
                  <Field label="البريد الإلكتروني" hint="اختياري إذا أدخلت رقم هاتف">
                    <div className="input-with-icon">
                      <Mail size={17} />
                      <input
                        className="input"
                        type="email"
                        value={form.email}
                        onChange={(event) => update('email', event.target.value)}
                        placeholder="name@example.com"
                        dir="ltr"
                        autoComplete="email"
                      />
                    </div>
                  </Field>
                  <Field label="رقم الهاتف" hint="اختياري إذا أدخلت بريداً إلكترونياً">
                    <div className="input-with-icon">
                      <Phone size={17} />
                      <input
                        className="input"
                        value={form.phone}
                        onChange={(event) => update('phone', event.target.value)}
                        placeholder="7xxxxxxxx"
                        dir="ltr"
                        autoComplete="tel"
                      />
                    </div>
                  </Field>
                </div>
                <p className="auth-hint">أدخل بريداً إلكترونياً أو رقم هاتف على الأقل. إذا أدخلت الهاتف فقط فسيكون الدخول بالهاتف بعد موافقة الإدارة.</p>
              </>
            )}

            {mode === 'login' && (
              <Field label="البريد الإلكتروني أو رقم الهاتف" required>
                <div className="input-with-icon">
                  <Mail size={17} />
                  <input
                    className="input"
                    type="text"
                    value={form.email}
                    onChange={(event) => update('email', event.target.value)}
                    placeholder="name@example.com أو 7xxxxxxxx"
                    required
                    dir="ltr"
                    autoComplete="username"
                  />
                </div>
              </Field>
            )}

            <Field label="كلمة المرور" required>
              <div className="input-with-icon">
                <LockKeyhole size={17} />
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(event) => update('password', event.target.value)}
                  placeholder="••••••••"
                  required
                  dir="ltr"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>

            {mode === 'signup' && (
              <Field label="تأكيد كلمة المرور" required>
                <div className="input-with-icon">
                  <LockKeyhole size={17} />
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={(event) => update('confirm', event.target.value)}
                    placeholder="••••••••"
                    required
                    dir="ltr"
                    autoComplete="new-password"
                  />
                </div>
              </Field>
            )}

            {error && <div className="auth-error">{error}</div>}

            <Button type="submit" size="lg" block loading={submitting} className="auth-submit">
              {mode === 'login' ? 'دخول إلى النظام' : 'إنشاء الحساب'}
              <ArrowLeft size={18} />
            </Button>

            {mode === 'signup' && (
              <p className="auth-hint">
                أول حساب يتم إنشاؤه في النظام يُمنح تلقائياً صلاحية «مدير النظام».
                بقية الحسابات تُنشأ بصلاحية «عضو» حتى يقوم المدير بتعديلها.
              </p>
            )}
          </form>

          <footer className="auth-card-footer">
            <span>© {new Date().getFullYear()} صندوق بنان الخير للبنيان</span>
            <Link to="/diagnostics" style={{ color: 'inherit', textDecoration: 'underline' }}>
              فحص الاتصال
            </Link>
            <span>الغدير – مقبنة – تعز</span>
          </footer>
        </div>
      </section>
    </div>
  );
}
