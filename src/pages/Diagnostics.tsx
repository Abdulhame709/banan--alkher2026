import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Activity, ArrowRight, CheckCircle2, Copy, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '../components/ui';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
  ms?: number;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

async function runCheck(name: string, task: () => Promise<Response>): Promise<Check> {
  const started = performance.now();
  try {
    const response = await task();
    return {
      name,
      ok: response.ok || response.type === 'opaque',
      detail: response.type === 'opaque' ? 'تم الاتصال بالشبكة' : `HTTP ${response.status}`,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      ms: Math.round(performance.now() - started),
    };
  }
}

export function DiagnosticsPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run() {
    setRunning(true);
    setCopied(false);
    const timeout = AbortSignal.timeout(15000);
    const results: Check[] = [];
    const isWeb = !Capacitor.isNativePlatform()
      && (window.location.protocol === 'http:' || window.location.protocol === 'https:');
    if (isWeb) {
      results.push(await runCheck('استضافة الصفحة', () =>
        fetch(window.location.href, { method: 'HEAD', cache: 'no-store', signal: timeout })));
    } else {
      results.push({ name: 'استضافة الصفحة', ok: true, detail: 'داخل التطبيق — لا ينطبق' });
    }
    results.push(await runCheck('الإنترنت العام (Google)', () =>
      fetch('https://www.google.com/generate_204', { mode: 'no-cors', cache: 'no-store', signal: timeout })));
    results.push(await runCheck('Supabase / API', () =>
      fetch(`${API_BASE}/health?db=1`, { cache: 'no-store', signal: timeout })));
    setChecks(results);
    setRunning(false);
  }

  async function copyReport() {
    const lines = [
      `الرابط: ${window.location.href}`,
      `API: ${API_BASE}`,
      `Supabase: ${SUPABASE_URL}`,
      ...checks.map((check) => `${check.name}: ${check.ok ? 'ناجح' : 'فاشل'} — ${check.detail}${check.ms ? ` (${check.ms}ms)` : ''}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const apiCheck = checks.find((check) => check.name === 'Supabase / API');
  const internetCheck = checks.find((check) => check.name === 'الإنترنت العام (Google)');

  return (
    <div className="page-stack" style={{ maxWidth: 760, margin: '40px auto', padding: '0 16px' }}>
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Activity size={28} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>فحص الاتصال</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--slate-500)' }}>
              يساعدك على معرفة هل المشكلة في استضافة الصفحة أم في Supabase أم في الشبكة.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8, margin: '18px 0', direction: 'ltr', textAlign: 'left', fontSize: 13 }}>
          <div><strong>Page:</strong> {window.location.origin}</div>
          <div><strong>API:</strong> {API_BASE || 'غير مضبوط'}</div>
          <div><strong>Supabase:</strong> {SUPABASE_URL || 'غير مضبوط'}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button onClick={run} loading={running}>
            <RefreshCw size={17} />
            تشغيل الفحص
          </Button>
          {checks.length > 0 && (
            <Button variant="secondary" onClick={copyReport}>
              <Copy size={17} />
              {copied ? 'تم النسخ' : 'نسخ التقرير'}
            </Button>
          )}
        </div>

        {checks.length > 0 && (
          <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
            {checks.map((check) => (
              <div
                key={check.name}
                className="card"
                style={{ padding: 14, display: 'flex', alignItems: 'flex-start', gap: 10 }}
              >
                {check.ok ? <CheckCircle2 size={20} color="var(--emerald-700)" /> : <XCircle size={20} color="var(--danger)" />}
                <div style={{ flex: 1 }}>
                  <strong>{check.name}</strong>
                  <div style={{ color: 'var(--slate-500)', fontSize: 13, marginTop: 2 }}>
                    {check.detail}{check.ms ? ` — ${check.ms}ms` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {apiCheck && (
          <div className="card card-pad" style={{ marginTop: 16, background: 'var(--bg)' }}>
            <strong>النتيجة العملية</strong>
            <p style={{ margin: '8px 0 0', lineHeight: 1.8 }}>
              {apiCheck.ok
                ? 'الاتصال بـ Supabase يعمل من هذه الشبكة. إذا كانت الصفحة لا تفتح أحياناً فالمشكلة قد تكون مؤقتة أو في استضافة الصفحة.'
                : internetCheck?.ok
                  ? 'الإنترنت يعمل لكن Supabase / API لا يستجيب. غالباً النطاق supabase.co محجوب أو الشبكة تمنع الاتصال. الحل: نطاق مخصص لـ Supabase أو وسيط عكسي، وليس تغيير كود التطبيق.'
                  : 'تعذر الوصول إلى الإنترنت العام أيضاً. جرّب شبكة أخرى أو تحقق من VPN/المشغّل. لا يمكن للنظام تجاوز حجب الشبكة من داخل التطبيق.'}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowRight size={16} />
            العودة لتسجيل الدخول
          </Link>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            لوحة التحكم
          </Link>
        </div>
      </div>
    </div>
  );
}

