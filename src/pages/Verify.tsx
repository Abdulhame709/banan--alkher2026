import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BadgeCheck, FileCheck2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { formatDate, formatDateTime, money } from '../lib/format';
import { Alert, Badge, Button, Card, LoadingState } from '../components/ui';
import { Emblem } from '../components/Logo';

interface VerifyPayload {
  ok: boolean;
  type: 'receipt' | 'expense';
  fund_name: string;
  document_no: string;
  amount: number;
  date: string | null;
  party: string;
  document_label: string;
  status: string;
  signed_by_name: string | null;
  signed_at: string | null;
  signature_present: boolean;
  verified_at: string;
}

export function VerifyPage() {
  const { type, token } = useParams();
  const [data, setData] = useState<VerifyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const payload = await api.get<VerifyPayload>(
          `/public/verify/${encodeURIComponent(type ?? '')}/${encodeURIComponent(token ?? '')}`
        );
        if (active) setData(payload);
      } catch (loadError) {
        if (active) setError(apiErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [type, token]);

  return (
    <main className="verify-page">
      <div className="verify-shell">
        <header className="verify-brand">
          <Emblem size={58} />
          <div>
            <strong>{data?.fund_name ?? 'صندوق بنان الخير للبنيان'}</strong>
            <span>بوابة التحقق من صحة المستندات الرسمية</span>
          </div>
        </header>

        {loading ? (
          <Card><LoadingState label="جارٍ التحقق من المستند…" /></Card>
        ) : error ? (
          <Card>
            <div className="verify-result verify-invalid">
              <span className="verify-icon danger"><ShieldAlert size={34} /></span>
              <h1>تعذر التحقق من المستند</h1>
              <p>{error}</p>
              <Alert tone="warning">
                تأكد من مسح رمز QR الموجود على المستند الأصلي، أو تواصل مع إدارة الصندوق.
              </Alert>
              <Link to="/login"><Button variant="secondary" icon={<ArrowRight size={16} />}>العودة لتسجيل الدخول</Button></Link>
            </div>
          </Card>
        ) : data ? (
          <Card>
            <div className="verify-result">
              <span className="verify-icon success"><ShieldCheck size={38} /></span>
              <Badge tone="success" dot>مستند موثّق</Badge>
              <h1>{data.document_label}</h1>
              <p>تم العثور على المستند في سجلات الصندوق الرسمية.</p>

              <dl className="verify-grid">
                <div><dt>رقم المستند</dt><dd>{data.document_no}</dd></div>
                <div><dt>المبلغ</dt><dd>{money(data.amount)}</dd></div>
                <div><dt>التاريخ</dt><dd>{data.date ? formatDate(data.date) : '—'}</dd></div>
                <div><dt>الطرف / المستفيد</dt><dd>{data.party || '—'}</dd></div>
                <div><dt>الحالة</dt><dd>{data.status}</dd></div>
                <div><dt>نوع المستند</dt><dd>{data.type === 'receipt' ? 'سند قبض' : 'سند صرف'}</dd></div>
                <div className="span-2">
                  <dt>التوقيع الإلكتروني</dt>
                  <dd>
                    {data.signature_present ? (
                      <span className="verify-signature"><BadgeCheck size={16} /> موقّع بواسطة {data.signed_by_name} — {data.signed_at ? formatDateTime(data.signed_at) : ''}</span>
                    ) : (
                      <span className="muted">لم يُسجل توقيع إلكتروني على هذا المستند</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="verify-footer">
                <span><FileCheck2 size={16} /> وقت التحقق: {formatDateTime(data.verified_at)}</span>
                <span>هذه الصفحة للتحقق فقط ولا تُعد بديلاً عن المستند الأصلي.</span>
              </div>
            </div>
          </Card>
        ) : null}

        <footer className="verify-page-footer">
          <span>صندوق بنان الخير للبنيان — الغدير – مقبنة – تعز</span>
          <Link to="/login">دخول النظام</Link>
        </footer>
      </div>
    </main>
  );
}
