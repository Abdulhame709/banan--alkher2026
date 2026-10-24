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
    return <LoadingState label="ط¬ط§ط±ظچ طھط­ظ…ظٹظ„ ظ„ظˆط­ط© ط§ظ„طھط­ظƒظ…â€¦" />;
  }

  if (error || !data) {
    return (
      <div className="page-stack">
        <div className="error-panel">
          <AlertCircle size={28} />
          <h2>طھط¹ط°ط± طھط­ظ…ظٹظ„ ظ„ظˆط­ط© ط§ظ„طھط­ظƒظ…</h2>
          <p>{error || 'ط­ط¯ط« ط®ط·ط£ ط؛ظٹط± ظ…طھظˆظ‚ط¹'}</p>
          <Button onClick={load}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Button>
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
    { label: 'ط§ط´طھط±ط§ظƒط§طھ ط§ظ„ط£ط¹ط¶ط§ط،', value: revenue.subscriptions, color: '#065f46' },
    { label: 'طھط¨ط±ط¹ط§طھ ط¹ط§ظ…ط©', value: revenue.general_donations, color: '#d97706' },
    { label: 'طھط¨ط±ط¹ط§طھ ظ…ط®طµطµط©', value: revenue.restricted_donations, color: '#0d9488' },
    { label: 'ط¥ظٹط±ط§ط¯ط§طھ ط£ط®ط±ظ‰', value: revenue.other, color: '#94a3b8' },
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
        eyebrow={`ط§ظ„ظٹظˆظ…: ${formatDate(todayISO())}`}
        title={`ط§ظ„ط³ظ„ط§ظ… ط¹ظ„ظٹظƒظ…طŒ ${user?.full_name ?? ''}`}
        subtitle="ظ†ط¸ط±ط© ظ…ط§ظ„ظٹط© ط´ط§ظ…ظ„ط© ط¹ظ„ظ‰ ط£ط±طµط¯ط© ط§ظ„طµظ†ط¯ظˆظ‚طŒ ط§ظ„طھط­طµظٹظ„ط§طھطŒ ظˆط§ظ„ط§ط¹طھظ…ط§ط¯ط§طھ ط§ظ„ظ…ط¹ظ„ظ‚ط©."
        actions={
          capabilities?.addReceipts ? (
            <Button icon={<Plus size={17} />} onClick={() => navigate('/receipts?new=1')}>
              طھط³ط¬ظٹظ„ ط¥ظٹط±ط§ط¯
            </Button>
          ) : null
        }
      />

      <section className="dashboard-banner">
        <div className="banner-emblem">
          <FundLogo size={64} />
        </div>
        <div className="banner-content">
          <span className="banner-kicker">ط§ظ„ط±طµظٹط¯ ط§ظ„ظ†ظ‚ط¯ظٹ ط§ظ„ظپط¹ظ„ظٹ ط§ظ„ظ…طھط§ط­</span>
          <div className="banner-value">
            {money(position.cash_balance)}
          </div>
          <p>
            ظٹط´ظ…ظ„ ط§ظ„ط±طµظٹط¯ ط§ظ„ط§ظپطھطھط§ط­ظٹ ظˆط§ظ„ظ…ظ‚ط¨ظˆط¶ط§طھ ط§ظ„ظپط¹ظ„ظٹط© ظ†ط§ظ‚طµ ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„ظ…ط¯ظپظˆط¹ط©طŒ ظˆظ„ط§ ظٹط´ظ…ظ„
            ط§ظ„ظ…طھط£ط®ط±ط§طھ ط¹ظ„ظ‰ ط§ظ„ط£ط¹ط¶ط§ط،.
          </p>
        </div>
        <div className="banner-side">
          <div>
            <span>ط§ظ„طµط§ظپظٹ ط§ظ„ظ…طھط§ط­ ظ„ظ„طµط±ظپ ط§ظ„ط¬ط¯ظٹط¯</span>
            <strong>{money(position.net_available)}</strong>
          </div>
          <div>
            <span>ظ…ط¹طھظ…ط¯ ط¨ط§ظ†طھط¸ط§ط± ط§ظ„طµط±ظپ</span>
            <strong className="text-gold">{money(position.committed_pending)}</strong>
          </div>
        </div>
        <div className="banner-pattern" aria-hidden="true" />
      </section>

      <section className="stats-grid">
        <StatCard
          label="ط§ظ„ط±طµظٹط¯ ط§ظ„ظ†ظ‚ط¯ظٹ ط§ظ„ظپط¹ظ„ظٹ"
          value={money(position.cash_balance)}
          hint="ط§ظپطھطھط§ط­ظٹ + ظ…ظ‚ط¨ظˆط¶ط§طھ âˆ’ ظ…طµط±ظˆظپط§طھ ظ…ط¯ظپظˆط¹ط©"
          icon={<Wallet size={22} />}
          tone="emerald"
        />
        <StatCard
          label="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„ظ…ط­طµظ„ط©"
          value={money(position.total_receipts)}
          hint={`ط§ظ„ط±طµظٹط¯ ط§ظ„ط§ظپطھطھط§ط­ظٹ: ${money(position.opening_balance)}`}
          icon={<TrendingUp size={22} />}
          tone="blue"
        />
        <StatCard
          label="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„ظ…ط¯ظپظˆط¹ط©"
          value={money(position.total_paid_expenses)}
          hint="ط§ظ„ظ…ط¨ط§ظ„ط؛ ط§ظ„ظ…طµط±ظˆظپط© ظپط¹ظ„ظٹط§ظ‹ ظپظ‚ط·"
          icon={<TrendingDown size={22} />}
          tone="slate"
        />
        <StatCard
          label="ط§ظ„طµط§ظپظٹ ط§ظ„ظ…طھط§ط­ ظ„ظ„طµط±ظپ ط§ظ„ط¬ط¯ظٹط¯"
          value={money(position.net_available)}
          hint={`ط¨ط¹ط¯ ط®طµظ… ط§ظ„ظ…ظ„طھط²ظ…ط§طھ: ${money(position.committed_pending)}`}
          icon={<Coins size={22} />}
          tone="gold"
        />
        <StatCard
          label="ط¥ط¬ظ…ط§ظ„ظٹ ظ…طھط£ط®ط±ط§طھ ط§ظ„ط§ط´طھط±ط§ظƒط§طھ"
          value={money(arrears.total_arrears)}
          hint={`${formatNumber(arrears.members_in_arrears)} ط¹ط¶ظˆط§ظ‹ â€” ${formatNumber(arrears.open_months)} ط´ظ‡ط± ظ…ظپطھظˆط­`}
          icon={<CalendarClock size={22} />}
          tone="amber"
          onClick={() => navigate('/reports?tab=arrears')}
        />
        <StatCard
          label="ط·ظ„ط¨ط§طھ ط§ظ„طµط±ظپ ط§ظ„ظ…ط¹ظ„ظ‚ط© ظ„ظ„ط§ط¹طھظ…ط§ط¯"
          value={formatNumber(pending.count)}
          hint={`ط¨ظ‚ظٹظ…ط© ${money(pending.total)}`}
          icon={<ShieldCheck size={22} />}
          tone="red"
          onClick={() => navigate('/expenses?status=pending')}
        />
      </section>

      <section className="quick-actions-card">
        <CardHeader title="ط¥ط¬ط±ط§ط،ط§طھ ط³ط±ظٹط¹ط©" subtitle="ط§ظ„ط¹ظ…ظ„ظٹط§طھ ط§ظ„ظٹظˆظ…ظٹط© ط§ظ„ط£ظƒط«ط± ط§ط³طھط®ط¯ط§ظ…ط§ظ‹ ظپظٹ ط§ظ„طµظ†ط¯ظˆظ‚" />
        <div className="quick-actions">
          {capabilities?.addReceipts && (
            <button type="button" className="quick-action" onClick={() => navigate('/subscriptions?pay=1')}>
              <span className="quick-icon quick-emerald"><Banknote size={21} /></span>
              <span><strong>طھط­طµظٹظ„ ط§ط´طھط±ط§ظƒ</strong><small>ط³ط¯ط§ط¯ ظƒظ„ظٹ ط£ظˆ ط¬ط²ط¦ظٹ</small></span>
            </button>
          )}
          {capabilities?.addReceipts && (
            <button type="button" className="quick-action" onClick={() => navigate('/receipts?new=1')}>
              <span className="quick-icon quick-gold"><ReceiptText size={21} /></span>
              <span><strong>طھط³ط¬ظٹظ„ طھط¨ط±ط¹</strong><small>ط³ظ†ط¯ ظ‚ط¨ط¶ ط±ط³ظ…ظٹ</small></span>
            </button>
          )}
          {capabilities?.viewMembers && (
            <button type="button" className="quick-action" onClick={() => navigate('/subscriptions?generate=1')}>
              <span className="quick-icon quick-blue"><CalendarPlus size={21} /></span>
              <span><strong>طھظˆظ„ظٹط¯ ط§ط³طھط­ظ‚ط§ظ‚ط§طھ ط§ظ„ط´ظ‡ط±</strong><small>ظ„ط¬ظ…ظٹط¹ ط§ظ„ط£ط¹ط¶ط§ط، ط§ظ„ظ†ط´ط·ظٹظ†</small></span>
            </button>
          )}
          {capabilities?.addExpenses && (
            <button type="button" className="quick-action" onClick={() => navigate('/expenses?new=1')}>
              <span className="quick-icon quick-red"><HandCoins size={21} /></span>
              <span><strong>ط·ظ„ط¨ طµط±ظپ ط¬ط¯ظٹط¯</strong><small>ظ…ط³ط§ط¹ط¯ط§طھ ط£ظˆ طھط´ط؛ظٹظ„</small></span>
            </button>
          )}
        </div>
      </section>

      <div className="dashboard-grid">
        <Card className="revenue-card">
          <CardHeader
            title="طھظپطµظٹظ„ ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ"
            subtitle="طھظˆط²ظٹط¹ ط§ظ„ظ…ظ‚ط¨ظˆط¶ط§طھ ط§ظ„ظپط¹ظ„ظٹط© ط­ط³ط¨ ط§ظ„ظ…طµط¯ط±"
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
                <span>ط¥ط¬ظ…ط§ظ„ظٹ</span>
                <strong>{formatNumber(revenueTotal)}</strong>
                <small>ط±.ظٹ</small>
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
            title="ط§ظ„ظ…طµط±ظˆظپط§طھ ط­ط³ط¨ ط§ظ„ظپط¦ط©"
            subtitle="ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„ظ…ط¯ظپظˆط¹ط© ظپط¹ظ„ظٹط§ظ‹"
            icon={<HandCoins size={19} />}
            action={<Badge tone="neutral">{formatNumber(dashboard.expenses_by_category.length)} ظپط¦ط§طھ</Badge>}
          />
          {dashboard.expenses_by_category.length === 0 ? (
            <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ظ…طµط±ظˆظپط§طھ ظ…ط¯ظپظˆط¹ط©" description="ط³طھط¸ظ‡ط± ظ‡ظ†ط§ طھظˆط²ظٹط¹ط§طھ ط§ظ„طµط±ظپ ط¨ط¹ط¯ طھظ†ظپظٹط° ط£ظˆظ„ ط¹ظ…ظ„ظٹط©." icon={<HandCoins size={26} />} />
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
                  <small>{formatNumber(row.count)} ط¹ظ…ظ„ظٹط© طµط±ظپ</small>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="trend-card">
          <CardHeader
            title="ط­ط±ظƒط© ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ ظˆط§ظ„ظ…طµط±ظˆظپط§طھ"
            subtitle="ط¢ط®ط± ط³طھط© ط£ط´ظ‡ط±"
            icon={<TrendingUp size={19} />}
            action={
              <div className="chart-legend">
                <span><i className="dot-emerald" /> ط¥ظٹط±ط§ط¯ط§طھ</span>
                <span><i className="dot-gold" /> ظ…طµط±ظˆظپط§طھ</span>
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
                    title={`ط¥ظٹط±ط§ط¯ط§طھ ${money(row.receipts)}`}
                  />
                  <div
                    className="trend-bar bar-out"
                    style={{ height: `${Math.max(3, (row.expenses / maxTrend) * 100)}%` }}
                    title={`ظ…طµط±ظˆظپط§طھ ${money(row.expenses)}`}
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
              <span>ظ†ط³ط¨ط© طھط­طµظٹظ„ ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ط§طھ</span>
              <strong>{Math.round(collectionRate)}%</strong>
            </div>
            <Progress value={arrears.total_collected} max={arrears.total_accrued} />
            <small>
              ظ…ط­طµظ„ {money(arrears.total_collected)} ظ…ظ† ط£طµظ„ {money(arrears.total_accrued)}
            </small>
          </div>
        </Card>

        <Card className="pending-card">
          <CardHeader
            title="ط·ظ„ط¨ط§طھ ط¨ط§ظ†طھط¸ط§ط± ط§ظ„ط§ط¹طھظ…ط§ط¯"
            subtitle="طھطھط·ظ„ط¨ ط§ط¹طھظ…ط§ط¯ ط´ط®طµظٹظ† ظ…ط®طھظ„ظپظٹظ†"
            icon={<ShieldCheck size={19} />}
            action={
              <Link to="/expenses?status=pending" className="link-more">
                ط¹ط±ط¶ ط§ظ„ظƒظ„ <ArrowLeft size={15} />
              </Link>
            }
          />
          {dashboard.pending_requests.length === 0 ? (
            <EmptyState
              title="ظ„ط§ طھظˆط¬ط¯ ط·ظ„ط¨ط§طھ ظ…ط¹ظ„ظ‚ط©"
              description="ط¬ظ…ظٹط¹ ط·ظ„ط¨ط§طھ ط§ظ„طµط±ظپ طھظ…طھ ظ…ط¹ط§ظ„ط¬طھظ‡ط§."
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
            title="ط£ط­ط¯ط« ط³ظ†ط¯ط§طھ ط§ظ„ظ‚ط¨ط¶"
            subtitle="ط¢ط®ط± ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„ظ…ط³ط¬ظ„ط© ظپظٹ ط§ظ„طµظ†ط¯ظˆظ‚"
            icon={<ReceiptText size={19} />}
            action={<Link to="/receipts" className="link-more">ط¹ط±ط¶ ط§ظ„ظƒظ„ <ArrowLeft size={15} /></Link>}
          />
          {dashboard.recent_receipts.length === 0 ? (
            <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ط³ظ†ط¯ط§طھ ظ‚ط¨ط¶" description="ط§ط¨ط¯ط£ ط¨طھط³ط¬ظٹظ„ ط£ظˆظ„ طھط¨ط±ط¹ ط£ظˆ طھط­طµظٹظ„ ط§ط´طھط±ط§ظƒ." icon={<ReceiptText size={26} />} />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>ط§ظ„ط³ظ†ط¯</th>
                    <th>ط§ظ„ط·ط±ظپ</th>
                    <th>ط§ظ„ظ†ظˆط¹</th>
                    <th>ط§ظ„ظ…ط¨ظ„ط؛</th>
                    <th>ط§ظ„طھط§ط±ظٹط®</th>
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
                          {receipt.receipt_type === 'subscription' ? 'ط§ط´طھط±ط§ظƒ' : receipt.receipt_type === 'donation' ? 'طھط¨ط±ط¹' : 'ط£ط®ط±ظ‰'}
                        </Badge>
                      </td>
                      <td className="amount-cell">{money(receipt.amount)}</td>
                      <td className="muted">{formatDate(receipt.receipt_date)}</td>
                      <td>
                        <button type="button" className="icon-btn" title="ط·ط¨ط§ط¹ط© ط§ظ„ط³ظ†ط¯" onClick={() => openReceipt(receipt.id)}>
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
            title="ظ…ط¹طھظ…ط¯ ط¨ط§ظ†طھط¸ط§ط± ط§ظ„طµط±ظپ"
            subtitle="ط·ظ„ط¨ط§طھ ظ…ظƒطھظ…ظ„ط© ط§ظ„ط§ط¹طھظ…ط§ط¯ ظˆظ„ظ… طھظڈطµط±ظپ ط¨ط¹ط¯"
            icon={<Coins size={19} />}
            action={<Link to="/expenses?status=approved" className="link-more">ط¥ط¯ط§ط±ط© ط§ظ„طµط±ظپ <ArrowLeft size={15} /></Link>}
          />
          {dashboard.approved_requests.length === 0 ? (
            <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ظ…ط¨ط§ظ„ط؛ ظ…ط¹ظ„ظ‚ط©" description="ظƒظ„ ط§ظ„ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط¹طھظ…ط¯ط© طھظ… طµط±ظپظ‡ط§." icon={<Coins size={26} />} />
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
              <span>ط§ظ„ط£ط¹ط¶ط§ط، ط§ظ„ظ†ط´ط·ظˆظ†</span>
              <strong>{formatNumber(dashboard.members.active)}</strong>
            </div>
            <div>
              <HeartHandshake size={18} />
              <span>طھط¨ط±ط¹ط§طھ ظ…ط®طµطµط©</span>
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
        <PageHeader title="ط¨ظˆط§ط¨ط© ط§ظ„ط¹ط¶ظˆ" subtitle="ظ…ط±ط­ط¨ط§ظ‹ ط¨ظƒ ظپظٹ طµظ†ط¯ظˆظ‚ ط¨ظ†ط§ظ† ط§ظ„ط®ظٹط± ظ„ظ„ط¨ظ†ظٹط§ظ†" />
        <Card>
          <EmptyState
            title="ظ„ظ… ظٹطھظ… ط±ط¨ط· ط­ط³ط§ط¨ظƒ ط¨ط¹ط¶ظˆظٹط© ط¨ط¹ط¯"
            description={data.message ?? 'ظٹط±ط¬ظ‰ ط§ظ„طھظˆط§طµظ„ ظ…ط¹ ط¥ط¯ط§ط±ط© ط§ظ„طµظ†ط¯ظˆظ‚ ظ„ط±ط¨ط· ط­ط³ط§ط¨ظƒ ط¨ط³ط¬ظ„ظƒ ظƒط¹ط¶ظˆ.'}
            icon={<Users size={28} />}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`ط£ظ‡ظ„ط§ظ‹طŒ ${member.full_name}`}
        subtitle={`ط±ظ‚ظ… ط§ظ„ط¹ط¶ظˆظٹط© ${member.member_no} â€” ${member.active ? 'ط¹ط¶ظˆظٹط© ظ†ط´ط·ط©' : 'ط¹ط¶ظˆظٹط© ظ…ظˆظ‚ظˆظپط©'}`}
        actions={<Button variant="secondary" onClick={onStatement}>ظƒط´ظپ ط­ط³ط§ط¨ظٹ</Button>}
      />
      <section className="member-hero">
        <div>
          <span>ظ…طھط£ط®ط±ط§طھظƒ ط§ظ„ظ…ط³طھط­ظ‚ط©</span>
          <strong>{money(member.arrears)}</strong>
          <p>ظ‡ط°ظ‡ ط§ظ„ظ…ط¨ط§ظ„ط؛ ظ…ط³طھط­ظ‚ط© ط¹ظ„ظٹظƒ ظˆظ„ظ… طھظڈط³ط¯ط¯ ط¨ط¹ط¯طŒ ظˆطھظڈط³ط¬ظ„ ط¨ط´ظƒظ„ ظ…ظ†ظپطµظ„ ط¹ظ† ط±طµظٹط¯ ط§ظ„طµظ†ط¯ظˆظ‚.</p>
        </div>
        <div className="member-hero-side">
          <div><span>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط³طھط­ظ‚</span><strong>{money(member.total_accrued)}</strong></div>
          <div><span>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط³ط¯ط¯</span><strong>{money(member.total_paid)}</strong></div>
          <div><span>ط§ظ„ط§ط´طھط±ط§ظƒ ط§ظ„ط´ظ‡ط±ظٹ</span><strong>{money(member.monthly_fee)}</strong></div>
        </div>
      </section>

      <div className="dashboard-grid two">
        <Card>
          <CardHeader title="ط¢ط®ط± ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ط§طھ" subtitle="ط³ط¬ظ„ ط§ظ„ط§ط´طھط±ط§ظƒط§طھ ط§ظ„ط´ظ‡ط±ظٹط© ط§ظ„ط®ط§طµط© ط¨ظƒ" icon={<CalendarClock size={19} />} />
          {(data.subscriptions?.length ?? 0) === 0 ? (
            <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ط§ط³طھط­ظ‚ط§ظ‚ط§طھ" description="ظ„ظ… طھظڈط³ط¬ظ„ ط¹ظ„ظٹظƒ ط§ط³طھط­ظ‚ط§ظ‚ط§طھ ط´ظ‡ط±ظٹط© ط¨ط¹ط¯." icon={<CalendarClock size={26} />} />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>ط§ظ„ط´ظ‡ط±</th><th>ط§ظ„ظ…ط³طھط­ظ‚</th><th>ط§ظ„ظ…ط³ط¯ط¯</th><th>ط§ظ„ظ…طھط¨ظ‚ظٹ</th><th>ط§ظ„ط­ط§ظ„ط©</th></tr></thead>
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
          <CardHeader title="ط¢ط®ط± ط³ظ†ط¯ط§طھ ط§ظ„ظ‚ط¨ط¶" subtitle="ظ…ط¯ظپظˆط¹ط§طھظƒ ط§ظ„ظ…ط³ط¬ظ„ط© ظ„ط¯ظ‰ ط§ظ„طµظ†ط¯ظˆظ‚" icon={<ReceiptText size={19} />} />
          {(data.receipts?.length ?? 0) === 0 ? (
            <EmptyState title="ظ„ط§ طھظˆط¬ط¯ ط³ظ†ط¯ط§طھ" description="ظ„ظ… طھظڈط³ط¬ظ„ ظ…ط¯ظپظˆط¹ط§طھ ط¨ط§ط³ظ…ظƒ ط¨ط¹ط¯." icon={<ReceiptText size={26} />} />
          ) : (
            <ul className="approved-list">
              {data.receipts?.map((receipt) => (
                <li key={receipt.id}>
                  <div>
                    <strong>{refReceipt(receipt.receipt_no)}</strong>
                    <small>{formatDate(receipt.receipt_date)} â€” {receipt.receipt_type === 'subscription' ? 'ط§ط´طھط±ط§ظƒ ط´ظ‡ط±ظٹ' : 'طھط¨ط±ط¹'}</small>
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
