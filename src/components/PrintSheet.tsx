import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, QrCode, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { hijriMonthKey, hijriMonthLabel } from '../lib/hijri';
import { downloadElementAsPdf } from '../lib/pdf';
import { verifyDocumentUrl } from '../lib/public';
import {
  EXPENSE_CATEGORY_LABELS,
  formatDate,
  formatDateTime,
  money,
  moneyIn,
  monthLabel,
  numberToArabicWords,
  PAYMENT_METHOD_LABELS,
  refReceipt,
  secondaryAmount,
  subscriptionStatus,
} from '../lib/format';
import { FundLogo } from './Logo';
import type { Attachment, Expense, Member, Receipt, Subscription } from '../types';

export function PrintPreview({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    const root = document.getElementById('print-root');
    root?.classList.add('print-open');
    document.body.classList.add('has-print-preview');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      root?.classList.remove('print-open');
      document.body.classList.remove('has-print-preview');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function downloadPdf() {
    const sheet = document.querySelector('.print-scroll .print-sheet') as HTMLElement | null;
    if (!sheet) return;
    setDownloadError('');
    setDownloading(true);
    try {
      await downloadElementAsPdf(sheet, title);
    } catch {
      setDownloadError('تعذر إنشاء ملف PDF. استخدم زر الطباعة ثم اختر «حفظ كـ PDF».');
    } finally {
      setDownloading(false);
    }
  }

  const target = document.getElementById('print-root');
  if (!target) return null;

  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar">
        <div>
          <strong>{title}</strong>
          <span>معاينة الطباعة — مقاس A4</span>
          {downloadError && <small className="print-toolbar-error">{downloadError}</small>}
        </div>
        <div className="print-toolbar-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={downloadPdf} disabled={downloading}>
            <Download size={16} />
            <span>{downloading ? 'جارٍ إنشاء PDF…' : 'تنزيل PDF'}</span>
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
            <Printer size={16} />
            <span>طباعة</span>
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="إغلاق المعاينة">
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="print-scroll">{children}</div>
    </div>,
    target
  );
}

export function PrintLetterhead({ documentTitle }: { documentTitle?: string }) {
  const { settings } = useAuth();
  return (
    <header className="print-letterhead">
      <div className="print-brand">
        <FundLogo size={68} />
        <div>
          <h1>{settings?.fund_name ?? 'صندوق بنان الخير للبنيان – الغدير – مقبنة – تعز'}</h1>
          <p>الغدير – مقبنة – تعز</p>
          <small>النظام المحاسبي والإداري</small>
        </div>
      </div>
      {documentTitle && <div className="print-doc-title">{documentTitle}</div>}
    </header>
  );
}

function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="print-signatures">
      {labels.map((label) => (
        <div key={label} className="signature-box">
          <span>{label}</span>
          <div className="signature-line" />
          <small>التوقيع والتاريخ</small>
        </div>
      ))}
    </div>
  );
}

function PrintAttachments({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="print-attachments">
      <span>المرفقات ({attachments.length})</span>
      <ul>
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <PaperclipIcon />
            {attachment.original_name || attachment.file_name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function VerificationBlock({
  type,
  token,
  signatureData,
  signedByName,
  signedAt,
  attachments,
}: {
  type: 'receipt' | 'expense';
  token?: string | null;
  signatureData?: string | null;
  signedByName?: string | null;
  signedAt?: string | null;
  attachments?: Attachment[];
}) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let active = true;
    if (!token) {
      setQr('');
      return;
    }
    void import('qrcode')
      .then((module) =>
        module.toDataURL(verifyDocumentUrl(type, token), {
          margin: 1,
          width: 180,
          color: { dark: '#0f172a', light: '#ffffff' },
        })
      )
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr('');
      });
    return () => {
      active = false;
    };
  }, [type, token]);

  return (
    <div className="print-verification">
      <div className="print-verification-qr">
        {qr ? <img src={qr} alt="رمز التحقق" /> : <QrCode size={54} />}
        <small>امسح الرمز للتحقق</small>
      </div>
      <div className="print-verification-signature">
        <span><ShieldCheck size={15} /> التوقيع الإلكتروني</span>
        {signatureData ? (
          <>
            <img src={signatureData} alt={`توقيع ${signedByName ?? ''}`} />
            <strong>{signedByName || 'موقّع إلكترونياً'}</strong>
            <small>{signedAt ? formatDateTime(signedAt) : ''}</small>
          </>
        ) : (
          <small className="muted">لم يُسجل توقيع إلكتروني بعد.</small>
        )}
      </div>
      <PrintAttachments attachments={attachments} />
    </div>
  );
}

export function ReceiptVoucher({
  receipt,
  onClose,
}: {
  receipt: Receipt;
  onClose: () => void;
}) {
  const { settings } = useAuth();
  const isDonation = receipt.receipt_type === 'donation';
  const isSubscription = receipt.receipt_type === 'subscription';
  const isMultiMonth = isSubscription && !receipt.subscription_id;
  const party = receipt.member_name || receipt.donor_name || '—';
  return (
    <PrintPreview title={`سند قبض ${refReceipt(receipt.receipt_no)}`} onClose={onClose}>
      <article className="print-sheet voucher-sheet">
        <PrintLetterhead />
        <div className="voucher-title-row">
          <div className="voucher-stamp">
            <span>سند قبض</span>
            <small>{isMultiMonth ? 'سداد اشتراكات' : isSubscription ? 'تحصيل اشتراك' : isDonation ? 'إيراد تبرع' : 'إيراد'}</small>
          </div>
          <div className="voucher-meta">
            <div><span>رقم السند</span><strong>{refReceipt(receipt.receipt_no)}</strong></div>
            <div><span>التاريخ</span><strong>{formatDate(receipt.receipt_date)}</strong></div>
            <div><span>طريقة الدفع</span><strong>{PAYMENT_METHOD_LABELS[receipt.payment_method]}</strong></div>
          </div>
        </div>

        <div className="voucher-amount-banner">
          <span>المبلغ المستلم</span>
          <strong>{money(receipt.amount, false)} <small>{settings?.currency ?? 'ريال يمني'}</small></strong>
          {settings?.secondary_enabled && Number(settings.exchange_rate) > 0 && (
            <small className="voucher-secondary">
              ≈ {moneyIn(secondaryAmount(receipt.amount, settings.exchange_rate), settings.secondary_currency || 'ريال سعودي')}
            </small>
          )}
        </div>

        <dl className="voucher-grid">
          <div><dt>استلمنا من</dt><dd>{party}</dd></div>
          <div><dt>{receipt.member_no ? 'رقم العضوية' : 'نوع الإيراد'}</dt><dd>{receipt.member_no || (isDonation ? 'تبرع' : 'إيراد آخر')}</dd></div>
          <div><dt>نوع السند</dt><dd>{isDonation ? (receipt.is_restricted ? 'تبرع مخصص' : 'تبرع عام') : isMultiMonth ? 'سداد اشتراكات (عدة أشهر)' : isSubscription ? 'اشتراك شهري' : 'إيراد آخر'}</dd></div>
          <div><dt>الغرض / البيان</dt><dd>{receipt.restricted_purpose || (isMultiMonth ? 'سداد مستحقات اشتراكات متعددة (توزيع على أقدم الأشهر)' : isSubscription ? 'سداد استحقاق شهري' : isDonation ? 'تبرع عام لدعم أنشطة الصندوق' : 'إيراد متنوع')}</dd></div>
          {isMultiMonth && receipt.allocations?.length ? (
            <div className="span-2">
              <dt>الأشهر المسددة</dt>
              <dd>{receipt.allocations.map((allocation) => allocation.hijri_year && allocation.hijri_month
                ? hijriMonthLabel(hijriMonthKey(allocation.hijri_year, allocation.hijri_month))
                : monthLabel(String(allocation.due_month).slice(0, 7))).join('، ')}</dd>
            </div>
          ) : null}
          {receipt.notes && <div className="span-2"><dt>ملاحظات</dt><dd>{receipt.notes}</dd></div>}
        </dl>

        <div className="print-tafqit">
          <span>المبلغ كتابةً</span>
          <p>{numberToArabicWords(receipt.amount)}</p>
        </div>

        <div className="print-note">
          هذا السند يُعد إثباتاً رسمياً للمبلغ المذكور أعلاه، ويُحفظ ضمن السجلات المالية للصندوق.
        </div>

        <Signatures labels={['المحاسب', 'أمين الصندوق', 'المستلم']} />

        <VerificationBlock
          type="receipt"
          token={receipt.verify_token}
          signatureData={receipt.signature_data}
          signedByName={receipt.signed_by_name}
          signedAt={receipt.signed_at}
          attachments={receipt.attachments}
        />

        <footer className="print-footer">
          <span>صندوق بنان الخير للبنيان — الغدير – مقبنة – تعز</span>
          <span>أُنشئ بواسطة: {receipt.created_by_name || 'النظام المحاسبي'}</span>
        </footer>
      </article>
    </PrintPreview>
  );
}

export function PaymentVoucher({
  expense,
  onClose,
}: {
  expense: Expense;
  onClose: () => void;
}) {
  const { settings } = useAuth();
  const approvals = expense.approvals?.filter((row) => row.decision === 'approved') ?? [];
  const slots = [approvals[0], approvals[1]];
  return (
    <PrintPreview title={`سند صرف ${expense.payment_voucher_no ?? ''}`} onClose={onClose}>
      <article className="print-sheet voucher-sheet">
        <PrintLetterhead />
        <div className="voucher-title-row">
          <div className="voucher-stamp voucher-stamp-gold">
            <span>سند صرف</span>
            <small>{EXPENSE_CATEGORY_LABELS[expense.category]}</small>
          </div>
          <div className="voucher-meta">
            <div><span>رقم سند الصرف</span><strong>{expense.payment_voucher_no ?? '—'}</strong></div>
            <div><span>رقم الطلب</span><strong>EXP-{String(expense.request_no).padStart(4, '0')}</strong></div>
            <div><span>تاريخ الصرف</span><strong>{formatDate(expense.disbursed_at)}</strong></div>
          </div>
        </div>

        <div className="voucher-amount-banner banner-gold">
          <span>المبلغ المصروف</span>
          <strong>{money(expense.amount, false)} <small>{settings?.currency ?? 'ريال يمني'}</small></strong>
          {settings?.secondary_enabled && Number(settings.exchange_rate) > 0 && (
            <small className="voucher-secondary">
              ≈ {moneyIn(secondaryAmount(expense.amount, settings.exchange_rate), settings.secondary_currency || 'ريال سعودي')}
            </small>
          )}
        </div>

        <dl className="voucher-grid">
          <div><dt>المستفيد</dt><dd>{expense.beneficiary_name}</dd></div>
          <div><dt>هاتف المستفيد</dt><dd>{expense.beneficiary_phone || '—'}</dd></div>
          <div><dt>فئة الصرف</dt><dd>{EXPENSE_CATEGORY_LABELS[expense.category]}</dd></div>
          <div><dt>تاريخ الطلب</dt><dd>{formatDate(expense.requested_date)}</dd></div>
          <div className="span-2"><dt>وصف الحالة / البيان</dt><dd>{expense.description}</dd></div>
          {expense.notes && <div className="span-2"><dt>ملاحظات</dt><dd>{expense.notes}</dd></div>}
        </dl>

        <div className="print-tafqit">
          <span>المبلغ كتابةً</span>
          <p>{numberToArabicWords(expense.amount)}</p>
        </div>

        <h3 className="print-subtitle">اعتماد الصرف المزدوج</h3>
        <div className="approval-print-grid">
          {slots.map((approval, index) => (
            <div key={index} className="approval-print-card">
              <span className="approval-print-index">الاعتماد {index === 0 ? 'الأول' : 'الثاني'}</span>
              {approval ? (
                <>
                  <strong>{approval.approver_name}</strong>
                  <small>{approval.approver_role === 'admin' ? 'مدير النظام' : approval.approver_role === 'treasurer' ? 'أمين الصندوق' : 'عضو مجلس الإدارة'}</small>
                  <em>تمت الموافقة — {formatDateTime(approval.created_at)}</em>
                </>
              ) : (
                <em>لم يُسجل اعتماد</em>
              )}
              <div className="signature-line" />
            </div>
          ))}
        </div>

        <div className="disbursement-print-row">
          <div>
            <span>تم الصرف بواسطة</span>
            <strong>{expense.disbursed_by_name || '—'}</strong>
          </div>
          <div>
            <span>تاريخ ووقت الصرف</span>
            <strong>{formatDateTime(expense.disbursed_at)}</strong>
          </div>
          <div>
            <span>رقم سند الصرف</span>
            <strong>{expense.payment_voucher_no || '—'}</strong>
          </div>
        </div>

        <Signatures labels={['المستلم', 'أمين الصندوق', 'المدقق المالي']} />

        <VerificationBlock
          type="expense"
          token={expense.verify_token}
          signatureData={expense.signature_data}
          signedByName={expense.signed_by_name}
          signedAt={expense.signed_at}
          attachments={expense.attachments}
        />

        <footer className="print-footer">
          <span>صندوق بنان الخير للبنيان — الغدير – مقبنة – تعز</span>
          <span>{expense.approvals?.length ? 'سند صرف معتمد من شخصين مستقلين' : ''}</span>
        </footer>
      </article>
    </PrintPreview>
  );
}

export function MemberStatementPrint({
  member,
  subscriptions,
  receipts,
  onClose,
}: {
  member: Member;
  subscriptions: Subscription[];
  receipts: Receipt[];
  onClose: () => void;
}) {
  const { settings } = useAuth();
  const totalPaid = subscriptions.reduce((sum, row) => sum + row.paid_amount, 0);
  const totalDue = subscriptions.reduce((sum, row) => sum + row.amount, 0);
  const arrears = totalDue - totalPaid;
  const secondary = (amount: number) =>
    settings?.secondary_enabled && Number(settings.exchange_rate) > 0
      ? `≈ ${moneyIn(secondaryAmount(amount, settings.exchange_rate), settings.secondary_currency || 'ريال سعودي')}`
      : null;
  return (
    <PrintPreview title={`كشف حساب العضو ${member.member_no}`} onClose={onClose}>
      <article className="print-sheet statement-sheet">
        <PrintLetterhead documentTitle="كشف حساب عضو" />

        <dl className="statement-member-grid">
          <div><dt>اسم العضو</dt><dd>{member.full_name}</dd></div>
          <div><dt>رقم العضوية</dt><dd>{member.member_no}</dd></div>
          <div><dt>الهاتف</dt><dd>{member.phone || '—'}</dd></div>
          <div><dt>تاريخ الانضمام</dt><dd>{formatDate(member.joined_on)}</dd></div>
          <div><dt>العنوان</dt><dd>{member.address || '—'}</dd></div>
          <div><dt>الاشتراك الشهري</dt><dd>{money(member.monthly_fee)}</dd></div>
        </dl>

        <div className="statement-summary">
          <div><span>إجمالي المستحقات</span><strong>{money(totalDue)}</strong>{secondary(totalDue) && <small className="dual-secondary">{secondary(totalDue)}</small>}</div>
          <div><span>إجمالي المسدد</span><strong className="text-emerald">{money(totalPaid)}</strong>{secondary(totalPaid) && <small className="dual-secondary">{secondary(totalPaid)}</small>}</div>
          <div><span>المتأخرات</span><strong className="text-danger">{money(arrears)}</strong>{secondary(arrears) && <small className="dual-secondary">{secondary(arrears)}</small>}</div>
        </div>

        <h3 className="print-subtitle">تفصيل الاستحقاقات الشهرية</h3>
        <table className="print-table">
          <thead>
            <tr>
              <th>الشهر</th>
              <th>المستحق</th>
              <th>المسدد</th>
              <th>المتبقي</th>
              <th>الحالة</th>
              <th>سندات القبض</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.length === 0 && (
              <tr><td colSpan={6} className="empty-row">لا توجد استحقاقات مسجلة</td></tr>
            )}
            {subscriptions.map((row) => {
              const status = subscriptionStatus(row.status);
              return (
                <tr key={row.id}>
                  <td>{monthLabel(row.due_month)}</td>
                  <td>{money(row.amount, false)}</td>
                  <td>{money(row.paid_amount, false)}</td>
                  <td>{money(row.amount - row.paid_amount, false)}</td>
                  <td>{status.label}</td>
                  <td>{row.receipts?.map((receipt) => refReceipt(receipt.receipt_no)).join('، ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>الإجمالي</th>
              <th>{money(totalDue, false)}</th>
              <th>{money(totalPaid, false)}</th>
              <th>{money(arrears, false)}</th>
              <th colSpan={2}></th>
            </tr>
          </tfoot>
        </table>

        <h3 className="print-subtitle">سجل سندات القبض ({receipts.length})</h3>
        <table className="print-table compact">
          <thead>
            <tr>
              <th>رقم السند</th>
              <th>التاريخ</th>
              <th>النوع</th>
              <th>المبلغ</th>
              <th>طريقة الدفع</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 && (
              <tr><td colSpan={5} className="empty-row">لا توجد سندات مسجلة</td></tr>
            )}
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td>{refReceipt(receipt.receipt_no)}</td>
                <td>{formatDate(receipt.receipt_date)}</td>
                <td>{receipt.receipt_type === 'subscription'
                  ? (receipt.subscription_id ? 'اشتراك شهري' : 'سداد اشتراكات')
                  : receipt.receipt_type === 'donation' ? 'تبرع' : 'أخرى'}</td>
                <td>{money(receipt.amount, false)}</td>
                <td>{PAYMENT_METHOD_LABELS[receipt.payment_method]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-note">
          المتأخرات المذكورة أعلاه هي مبالغ مستحقة على العضو ولا تُعد جزءاً من الرصيد النقدي للصندوق حتى يتم تحصيلها.
          العملة: {settings?.currency ?? 'ريال يمني'}.
        </div>

        <Signatures labels={['المحاسب', 'أمين الصندوق', 'عضو الصندوق']} />

        <footer className="print-footer">
          <span>صندوق بنان الخير للبنيان — الغدير – مقبنة – تعز</span>
          <span>تاريخ الطباعة: {formatDate(new Date().toISOString())}</span>
        </footer>
      </article>
    </PrintPreview>
  );
}

export function ReportPrint({
  title,
  subtitle,
  metrics,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  metrics?: Array<{ label: string; value: string }>;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <PrintPreview title={title} onClose={onClose}>
      <article className="print-sheet report-sheet">
        <PrintLetterhead documentTitle={title} />
        {subtitle && <p className="report-period">{subtitle}</p>}
        {metrics && metrics.length > 0 && (
          <div className="report-metrics">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        )}
        {children}
        <Signatures labels={['المحاسب', 'أمين الصندوق', 'رئيس مجلس الإدارة']} />
        <footer className="print-footer">
          <span>صندوق بنان الخير للبنيان — الغدير – مقبنة – تعز</span>
          <span>تم إنشاء التقرير من النظام المحاسبي</span>
        </footer>
      </article>
    </PrintPreview>
  );
}
