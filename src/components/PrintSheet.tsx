import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  EXPENSE_CATEGORY_LABELS,
  formatDate,
  formatDateTime,
  money,
  monthLabel,
  numberToArabicWords,
  PAYMENT_METHOD_LABELS,
  refReceipt,
  subscriptionStatus,
} from '../lib/format';
import { FundLogo } from './Logo';
import type { Expense, Member, Receipt, Subscription } from '../types';

export function PrintPreview({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
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

  const target = document.getElementById('print-root');
  if (!target) return null;

  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar">
        <div>
          <strong>{title}</strong>
          <span>معاينة الطباعة — مقاس A4</span>
        </div>
        <div className="print-toolbar-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
            <Printer size={16} />
            <span>طباعة / حفظ PDF</span>
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

export function ReceiptVoucher({
  receipt,
  onClose,
}: {
  receipt: Receipt;
  onClose: () => void;
}) {
  const { settings } = useAuth();
  const isDonation = receipt.receipt_type === 'donation';
  const party = receipt.member_name || receipt.donor_name || '—';
  return (
    <PrintPreview title={`سند قبض ${refReceipt(receipt.receipt_no)}`} onClose={onClose}>
      <article className="print-sheet voucher-sheet">
        <PrintLetterhead />
        <div className="voucher-title-row">
          <div className="voucher-stamp">
            <span>سند قبض</span>
            <small>{receipt.receipt_type === 'subscription' ? 'تحصيل اشتراك' : isDonation ? 'إيراد تبرع' : 'إيراد'}</small>
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
        </div>

        <dl className="voucher-grid">
          <div><dt>استلمنا من</dt><dd>{party}</dd></div>
          <div><dt>{receipt.member_no ? 'رقم العضوية' : 'نوع الإيراد'}</dt><dd>{receipt.member_no || (isDonation ? 'تبرع' : 'إيراد آخر')}</dd></div>
          <div><dt>نوع السند</dt><dd>{isDonation ? (receipt.is_restricted ? 'تبرع مخصص' : 'تبرع عام') : receipt.receipt_type === 'subscription' ? 'اشتراك شهري' : 'إيراد آخر'}</dd></div>
          <div><dt>الغرض / البيان</dt><dd>{receipt.restricted_purpose || (receipt.receipt_type === 'subscription' ? 'سداد استحقاق شهري' : isDonation ? 'تبرع عام لدعم أنشطة الصندوق' : 'إيراد متنوع')}</dd></div>
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
          <div><span>إجمالي المستحقات</span><strong>{money(totalDue)}</strong></div>
          <div><span>إجمالي المسدد</span><strong className="text-emerald">{money(totalPaid)}</strong></div>
          <div><span>المتأخرات</span><strong className="text-danger">{money(arrears)}</strong></div>
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
                <td>{receipt.receipt_type === 'subscription' ? 'اشتراك' : receipt.receipt_type === 'donation' ? 'تبرع' : 'أخرى'}</td>
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
