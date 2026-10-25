import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CalendarPlus,
  Coins,
  FileText,
  HandCoins,
  HeartHandshake,
  Landmark,
  Plus,
  ReceiptText,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtimeVersion } from '../lib/realtime';
import { useToast } from '../lib/toast';
import {
  EXPENSE_CATEGORY_LABELS,
  expenseStatus,
  formatDate,
  formatNumber,
  money,
  monthLabel,
  refExpense,
  refReceipt,
  subscriptionStatus,
  todayISO,
} from '../lib/format';
import {
  Amount,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingState,
  PageHeader,
  Progress,
  StatCard,
} from '../components/ui';
import { FundLogo } from '../components/Logo';
import {
  MemberStatementPrint,
  ReceiptVoucher,
} from '../components/PrintSheet';
import type {
  DashboardData,
  Member,
  MemberDashboard,
  Receipt,
  Subscription,
} from '../types';

export function DashboardPage() {
  const { user, capabilities } = useAuth();
  const realtimeVersion = useRealtimeVersion();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | MemberDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [printReceipt, setPrintReceipt] = useState<Receipt | null>(null);
  const [statement, setStatement] = useState<{
    member: Member;
    subscriptions: Subscription[];
    receipts: Receipt[];
  } | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = await api.get<DashboardData | MemberDashboard>('/dashboard');
      setData(payload);
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [realtimeVersion]);

  async function openReceipt(id: string) {
    try {
      const payload = await api.get<{ receipt: Receipt }>(`/receipts/${id}`);
      setPrintReceipt(payload.receipt);
    } catch (receiptError) {
      toast.error(apiErrorMessage(receiptError));
    }
  }

  async function openStatement(memberId: string) {
    try {
      const payload = await api.get<{
        member: Member;
        subscriptions: Subscription[];
        receipts: Receipt[];
      }>(`/members/${memberId}/statement`);
      setStatement(payload);
    } catch (statementError) {
      toast.error(apiErrorMessage(statementError));
    }
  }

  if (loading) {
    return <LoadingState label="جارٍ تحميل لوحة التحكم…" />;
  }

  if (error || !data) {
    return (
      <div className="page-stack">
        <div className="error-panel">
          <AlertCircle size={28} />
          <h2>تعذر تحميل لوحة التحكم</h2>
          <p>{error || 'حدث خطأ غير متوقع'}</p>
          <Button onClick={load}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  if ('member' in data) {
    return (
      <>
        <MemberHome
          data={data}
          onStatement={() => data.member && openStatement(data.member.id)}
        />
        {statement && (
          <MemberStatementPrint
            member={statement.member}
            subscriptions={statement.subscriptions}
            receipts={statement.receipts}
            onClose={() => setStatement(null)}
          />
        )}
      </>
    );
  }

  const dashboard = data as DashboardData;
  const { position, arrears, revenue_breakdown: revenue, pending_summary: pending } = dashboard;
  const revenueTotal =
    revenue.subscriptions + revenue.general_donations + revenue.restricted_donations + revenue.other;
  const expenseTotal = dashboard.expenses_by_category.reduce((sum, row) => sum + row.total, 0);
  const collectionRate =
    arrears.total_accrued > 0 ? (arrears.total_collected / arrears.total_accrued) * 100 : 0;

  const slices = [
    { label: 'اشتراكات الأعضاء', value: revenue.subscriptions, color: '#065f46' },
    { label: 'تبرعات عامة', value: revenue.general_donations, color: '#d97706' },
    { label: 'تبرعات مخصصة', value: revenue.restricted_donations, color: '#0d9488' },
    { label: 'إيرادات أخرى', value: revenue.other, color: '#94a3b8' },
  ];
  let cursor = 0;
  const gradient = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const start = cursor;
      const end = cursor + (revenueTotal > 0 ? (slice.value / revenueTotal) * 100 : 0);
      cursor = end;
      return `${slice.color} ${start}% ${end}%`;
    })
    .join(', ');

  const maxTrend = Math.max(
    1,
    ...dashboard.trend.flatMap((row) => [row.receipts, row.expenses])
  );

  return (
    <div className="page-stack dashboard-page">
      <PageHeader
        eyebrow={`اليوم: ${formatDate(todayISO())}`}
        title={`السلام عليكم، ${user?.full_name ?? ''}`}
        subtitle="نظرة مالية شاملة على أرصدة الصندوق، التحصيلات، والاعتمادات المعلقة."
        actions={
          capabilities?.addReceipts ? (
            <Button icon={<Plus size={17} />} onClick={() => navigate('/receipts?new=1')}>
              تسجيل إيراد
            </Button>
          ) : null
        }
      />

      <section className="dashboard-banner">
        <div className="banner-emblem">
          <FundLogo size={64} />
        </div>
        <div className="banner-content">
          <span className="banner-kicker">الرصيد النقدي الفعلي المتاح</span>
          <div className="banner-value">
            {money(position.cash_balance)}
          </div>
          <p>
            يشمل الرصيد الافتتاحي والمقبوضات الفعلية ناقص المصروفات المدفوعة، ولا يشمل
            المتأخرات على الأعضاء.
          </p>
        </div>
        <div className="banner-side">
          <div>
            <span>الصافي المتاح للصرف الجديد</span>
            <strong>{money(position.net_available)}</strong>
          </div>
          <div>
            <span>معتمد بانتظار الصرف</span>
            <strong className="text-gold">{money(position.committed_pending)}</strong>
          </div>
        </div>
        <div className="banner-pattern" aria-hidden="true" />
      </section>

      {dashboard.alerts && dashboard.alerts.length > 0 && (
        <section className="smart-alerts">
          <div className="smart-alerts-head">
            <span><AlertCircle size={18} /> تنبيهات ذكية</span>
            <small>تُحدّث تلقائياً حسب إعدادات الحدود والمدة</small>
          </div>
          <div className="smart-alerts-grid">
            {dashboard.alerts.map((alert) => (
              <Link key={alert.id} to={alert.link} className={`smart-alert smart-alert-${alert.severity}`}>
                <span className="smart-alert-dot" />
                <div>
                  <strong>{alert.title}</strong>
                  <p>{alert.message}</p>
                </div>
                <ArrowLeft size={16} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="stats-grid">
        <StatCard
          label="الرصيد النقدي الفعلي"
          value={money(position.cash_balance)}
          hint="افتتاحي + مقبوضات − مصروفات مدفوعة"
          icon={<Wallet size={22} />}
          tone="emerald"
        />
        <StatCard
          label="إجمالي الإيرادات المحصلة"
          value={money(position.total_receipts)}
          hint={`الرصيد الافتتاحي: ${money(position.opening_balance)}`}
          icon={<TrendingUp size={22} />}
          tone="blue"
        />
        <StatCard
          label="إجمالي المصروفات المدفوعة"
          value={money(position.total_paid_expenses)}
          hint="المبالغ المصروفة فعلياً فقط"
          icon={<TrendingDown size={22} />}
          tone="slate"
        />
        <StatCard
          label="الصافي المتاح للصرف الجديد"
          value={money(position.net_available)}
          hint={`بعد خصم الملتزمات: ${money(position.committed_pending)}`}
          icon={<Coins size={22} />}
          tone="gold"
        />
        <StatCard
          label="إجمالي متأخرات الاشتراكات"
          value={money(arrears.total_arrears)}
          hint={`${formatNumber(arrears.members_in_arrears)} عضواً — ${formatNumber(arrears.open_months)} شهر مفتوح`}
          icon={<CalendarClock size={22} />}
          tone="amber"
          onClick={() => navigate('/reports?tab=arrears')}
        />
        <StatCard
          label="طلبات الصرف المعلقة للاعتماد"
          value={formatNumber(pending.count)}
          hint={`بقيمة ${money(pending.total)}`}
          icon={<ShieldCheck size={22} />}
          tone="red"
          onClick={() => navigate('/expenses?status=pending')}
        />
      </section>

      <section className="quick-actions-card">
        <CardHeader title="إجراءات سريعة" subtitle="العمليات اليومية الأكثر استخداماً في الصندوق" />
        <div className="quick-actions">
          {capabilities?.addReceipts && (
            <button type="button" className="quick-action" onClick={() => navigate('/subscriptions?pay=1')}>
              <span className="quick-icon quick-emerald"><Banknote size={21} /></span>
              <span><strong>تحصيل اشتراك</strong><small>سداد كامل الشهر فقط</small></span>
            </button>
          )}
          {capabilities?.addReceipts && (
            <button type="button" className="quick-action" onClick={() => navigate('/receipts?new=1')}>
              <span className="quick-icon quick-gold"><ReceiptText size={21} /></span>
              <span><strong>تسجيل تبرع</strong><small>سند قبض رسمي</small></span>
            </button>
          )}
          {capabilities?.viewMembers && (
            <button type="button" className="quick-action" onClick={() => navigate('/subscriptions?generate=1')}>
              <span className="quick-icon quick-blue"><CalendarPlus size={21} /></span>
              <span><strong>استحقاقات فترة</strong><small>للفترات السابقة أو الجماعية</small></span>
            </button>
          )}
          {capabilities?.addExpenses && (
            <button type="button" className="quick-action" onClick={() => navigate('/expenses?new=1')}>
              <span className="quick-icon quick-red"><HandCoins size={21} /></span>
              <span><strong>طلب صرف جديد</strong><small>مساعدات أو تشغيل</small></span>
            </button>
          )}
        </div>
      </section>

      <div className="dashboard-grid">
        <Card className="revenue-card">
          <CardHeader
            title="تفصيل الإيرادات"
            subtitle="توزيع المقبوضات الفعلية حسب المصدر"
            icon={<Landmark size={19} />}
          />
          <div className="revenue-body">
            <div
              className="donut"
              style={{
                background: revenueTotal > 0
                  ? `conic-gradient(${gradient})`
                  : 'conic-gradient(#e2e8f0 0% 100%)',
              }}
            >
              <div className="donut-center">
                <span>إجمالي</span>
                <strong>{formatNumber(revenueTotal)}</strong>
                <small>ر.ي</small>
              </div>
            </div>
            <ul className="legend-list">
              {slices.map((slice) => (
                <li key={slice.label}>
                  <span className="legend-dot" style={{ background: slice.color }} />
                  <span className="legend-label">{slice.label}</span>
                  <span className="legend-value">{money(slice.value)}</span>
                  <span className="legend-percent">
                    {revenueTotal > 0 ? Math.round((slice.value / revenueTotal) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="المصروفات حسب الفئة"
            subtitle="المصروفات المدفوعة فعلياً"
            icon={<HandCoins size={19} />}
            action={<Badge tone="neutral">{formatNumber(dashboard.expenses_by_category.length)} فئات</Badge>}
          />
          {dashboard.expenses_by_category.length === 0 ? (
            <EmptyState title="لا توجد مصروفات مدفوعة" description="ستظهر هنا توزيعات الصرف بعد تنفيذ أول عملية." icon={<HandCoins size={26} />} />
          ) : (
            <ul className="category-bars">
              {dashboard.expenses_by_category.map((row) => (
                <li key={row.category}>
                  <div className="category-bar-head">
                    <span>{row.label}</span>
                    <strong>{money(row.total)}</strong>
                  </div>
                  <div className="bar-track">
                    <span style={{ width: `${expenseTotal > 0 ? (row.total / expenseTotal) * 100 : 0}%` }} />
                  </div>
                  <small>{formatNumber(row.count)} عملية صرف</small>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="trend-card">
          <CardHeader
            title="حركة الإيرادات والمصروفات"
            subtitle="آخر ستة أشهر"
            icon={<TrendingUp size={19} />}
            action={
              <div className="chart-legend">
                <span><i className="dot-emerald" /> إيرادات</span>
                <span><i className="dot-gold" /> مصروفات</span>
              </div>
            }
          />
          <div className="trend-chart">
            {dashboard.trend.map((row) => (
              <div key={row.month} className="trend-col">
                <div className="trend-bars">
                  <div
                    className="trend-bar bar-in"
                    style={{ height: `${Math.max(3, (row.receipts / maxTrend) * 100)}%` }}
                    title={`إيرادات ${money(row.receipts)}`}
                  />
                  <div
                    className="trend-bar bar-out"
                    style={{ height: `${Math.max(3, (row.expenses / maxTrend) * 100)}%` }}
                    title={`مصروفات ${money(row.expenses)}`}
                  />
                </div>
                <div className="trend-values">
                  <span>{formatNumber(row.receipts)}</span>
                  <span>{formatNumber(row.expenses)}</span>
                </div>
                <span className="trend-month">{monthLabel(row.month).split(' ')[0]}</span>
              </div>
            ))}
          </div>
          <div className="collection-strip">
            <div>
              <span>نسبة تحصيل الاستحقاقات</span>
              <strong>{Math.round(collectionRate)}%</strong>
            </div>
            <Progress value={arrears.total_collected} max={arrears.total_accrued} />
            <small>
              محصل {money(arrears.total_collected)} من أصل {money(arrears.total_accrued)}
            </small>
          </div>
        </Card>

        <Card className="pending-card">
          <CardHeader
            title="طلبات بانتظار الاعتماد"
            subtitle="تتطلب اعتماد شخصين مختلفين"
            icon={<ShieldCheck size={19} />}
            action={
              <Link to="/expenses?status=pending" className="link-more">
                عرض الكل <ArrowLeft size={15} />
              </Link>
            }
          />
          {dashboard.pending_requests.length === 0 ? (
            <EmptyState
              title="لا توجد طلبات معلقة"
              description="جميع طلبات الصرف تمت معالجتها."
              icon={<BadgeCheck size={26} />}
            />
          ) : (
            <ul className="approval-mini-list">
              {dashboard.pending_requests.map((request) => (
                <li key={request.id}>
                  <div className="approval-mini-main">
                    <span className="approval-mini-icon"><HandCoins size={18} /></span>
                    <div>
                      <strong>{request.beneficiary_name}</strong>
                      <small>{EXPENSE_CATEGORY_LABELS[request.category]} â€” {refExpense(request.request_no)}</small>
                    </div>
                  </div>
                  <div className="approval-mini-side">
                    <strong>{money(request.amount)}</strong>
                    <div className="approval-dots">
                      <span className={request.approval_count >= 1 ? 'filled' : ''} />
                      <span className={request.approval_count >= 2 ? 'filled' : ''} />
                      <small>{request.approval_count}/2</small>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="dashboard-grid two">
        <Card className="recent-card">
          <CardHeader
            title="أحدث سندات القبض"
            subtitle="آخر الإيرادات المسجلة في الصندوق"
            icon={<ReceiptText size={19} />}
            action={<Link to="/receipts" className="link-more">عرض الكل <ArrowLeft size={15} /></Link>}
          />
          {dashboard.recent_receipts.length === 0 ? (
            <EmptyState title="لا توجد سندات قبض" description="ابدأ بتسجيل أول تبرع أو تحصيل اشتراك." icon={<ReceiptText size={26} />} />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>السند</th>
                    <th>الطرف</th>
                    <th>النوع</th>
                    <th>المبلغ</th>
                    <th>التاريخ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recent_receipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td className="mono">{refReceipt(receipt.receipt_no)}</td>
                      <td>{receipt.party}</td>
                      <td>
                        <Badge tone={receipt.receipt_type === 'subscription' ? 'info' : 'gold'}>
                          {receipt.receipt_type === 'subscription' ? 'اشتراك' : receipt.receipt_type === 'donation' ? 'تبرع' : 'أخرى'}
                        </Badge>
                      </td>
                      <td className="amount-cell">{money(receipt.amount)}</td>
                      <td className="muted">{formatDate(receipt.receipt_date)}</td>
                      <td>
                        <button type="button" className="icon-btn" title="طباعة السند" onClick={() => openReceipt(receipt.id)}>
                          <FileText size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="معتمد بانتظار الصرف"
            subtitle="طلبات مكتملة الاعتماد ولم تُصرف بعد"
            icon={<Coins size={19} />}
            action={<Link to="/expenses?status=approved" className="link-more">إدارة الصرف <ArrowLeft size={15} /></Link>}
          />
          {dashboard.approved_requests.length === 0 ? (
            <EmptyState title="لا توجد مبالغ معلقة" description="كل الطلبات المعتمدة تم صرفها." icon={<Coins size={26} />} />
          ) : (
            <ul className="approved-list">
              {dashboard.approved_requests.map((request) => (
                <li key={request.id}>
                  <div>
                    <strong>{request.beneficiary_name}</strong>
                    <small>{refExpense(request.request_no)} â€” {EXPENSE_CATEGORY_LABELS[request.category]}</small>
                  </div>
                  <span>{money(request.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="members-summary">
            <div>
              <Users size={18} />
              <span>الأعضاء النشطون</span>
              <strong>{formatNumber(dashboard.members.active)}</strong>
            </div>
            <div>
              <HeartHandshake size={18} />
              <span>تبرعات مخصصة</span>
              <strong>{money(revenue.restricted_donations)}</strong>
            </div>
          </div>
        </Card>
      </div>

      {printReceipt && <ReceiptVoucher receipt={printReceipt} onClose={() => setPrintReceipt(null)} />}
    </div>
  );
}

function MemberHome({ data, onStatement }: { data: MemberDashboard; onStatement: () => void }) {
  const member = data.member;
  if (!member) {
    return (
      <div className="page-stack">
        <PageHeader title="بوابة العضو" subtitle="مرحباً بك في صندوق بنان الخير للبنيان" />
        <Card>
          <EmptyState
            title="لم يتم ربط حسابك بعضوية بعد"
            description={data.message ?? 'يرجى التواصل مع إدارة الصندوق لربط حسابك بسجلك كعضو.'}
            icon={<Users size={28} />}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`أهلاً، ${member.full_name}`}
        subtitle={`رقم العضوية ${member.member_no} — ${member.active ? 'عضوية نشطة' : 'عضوية موقوفة'}`}
        actions={<Button variant="secondary" onClick={onStatement}>كشف حسابي</Button>}
      />
      <section className="member-hero">
        <div>
          <span>متأخراتك المستحقة</span>
          <strong>{money(member.arrears)}</strong>
          <p>هذه المبالغ مستحقة عليك ولم تُسدد بعد، وتُسجل بشكل منفصل عن رصيد الصندوق.</p>
        </div>
        <div className="member-hero-side">
          <div><span>إجمالي المستحق</span><strong>{money(member.total_accrued)}</strong></div>
          <div><span>إجمالي المسدد</span><strong>{money(member.total_paid)}</strong></div>
          <div><span>الاشتراك الشهري</span><strong>{money(member.monthly_fee)}</strong></div>
        </div>
      </section>

      <div className="dashboard-grid two">
        <Card>
          <CardHeader title="آخر الاستحقاقات" subtitle="سجل الاشتراكات الشهرية الخاصة بك" icon={<CalendarClock size={19} />} />
          {(data.subscriptions?.length ?? 0) === 0 ? (
            <EmptyState title="لا توجد استحقاقات" description="لم تُسجل عليك استحقاقات شهرية بعد." icon={<CalendarClock size={26} />} />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>الشهر</th><th>المستحق</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th></tr></thead>
                <tbody>
                  {data.subscriptions?.map((row) => {
                    const status = subscriptionStatus(row.status);
                    return (
                      <tr key={row.id}>
                        <td>{monthLabel(row.due_month)}</td>
                        <td>{money(row.amount, false)}</td>
                        <td>{money(row.paid_amount, false)}</td>
                        <td>{money(row.amount - row.paid_amount, false)}</td>
                        <td><Badge tone={status.tone}>{status.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="آخر سندات القبض" subtitle="مدفوعاتك المسجلة لدى الصندوق" icon={<ReceiptText size={19} />} />
          {(data.receipts?.length ?? 0) === 0 ? (
            <EmptyState title="لا توجد سندات" description="لم تُسجل مدفوعات باسمك بعد." icon={<ReceiptText size={26} />} />
          ) : (
            <ul className="approved-list">
              {data.receipts?.map((receipt) => (
                <li key={receipt.id}>
                  <div>
                    <strong>{refReceipt(receipt.receipt_no)}</strong>
                    <small>{formatDate(receipt.receipt_date)} — {receipt.receipt_type === 'subscription' ? 'اشتراك شهري' : 'تبرع'}</small>
                  </div>
                  <span>{money(receipt.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
