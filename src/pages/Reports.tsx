import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CalendarClock,
  Download,
  FileSpreadsheet,
  Printer,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wallet,
} from 'lucide-react';
import { api, apiErrorMessage, downloadCsv } from '../lib/api';
import { useRealtimeVersion } from '../lib/realtime';
import { useToast } from '../lib/toast';
import {
  EXPENSE_CATEGORY_LABELS,
  formatDate,
  formatNumber,
  money,
  monthLabel,
  PAYMENT_METHOD_LABELS,
  RECEIPT_TYPE_LABELS,
  refReceipt,
  todayISO,
} from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  Select,
  StatCard,
  Tabs,
} from '../components/ui';
import { HijriDateInput } from '../components/HijriInputs';
import { currentHijriYear, fromHijri } from '../lib/hijri';
import { ReportPrint } from '../components/PrintSheet';
import type { CashLedger, Member } from '../types';

type Tab = 'cash' | 'arrears' | 'donations' | 'disbursements' | 'member';

interface ReportsSummary {
  from: string;
  to: string;
  position: {
    cash_balance: number;
    total_receipts: number;
    total_paid_expenses: number;
    net_available: number;
    committed_pending: number;
    opening_balance: number;
  };
  arrears: { total_arrears: number; open_months: number; total_accrued: number; total_collected: number };
  period: { receipts: number; paid_expenses: number; net: number };
  counts: { receipts_count: number; expenses_count: number; active_members: number; total_members?: number };
  trend?: Array<{ month: string; receipts: number; expenses: number }>;
  income_breakdown?: Array<{ receipt_type: string; label: string; count: number; total: number }>;
  expense_breakdown?: Array<{ category: string; label: string; count: number; total: number }>;
  top_donors?: Array<{ donor_name: string; count: number; total: number }>;
  aging?: { current: number; days_1_90: number; days_91_180: number; over_180: number };
  collection_rate?: number;
  members_with_arrears?: number;
}

interface MemberMovement {
  id: string;
  date: string;
  kind: 'due' | 'payment';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  status: string;
}

interface MemberStatement {
  member: Member;
  from: string;
  to: string;
  opening_balance: number;
  movements: MemberMovement[];
  totals: { dues: number; paid: number; closing_balance: number; arrears: number; arrears_months: number };
  arrears: Array<{ id: string; label: string; remaining: number; due_month: string }>;
}

interface ArrearsRow {
  id: string;
  member_no: string;
  full_name: string;
  phone: string | null;
  active: boolean;
  accrued: number;
  paid: number;
  arrears: number;
  open_months: number;
  oldest_due: string | null;
}

interface DonationRow {
  id: string;
  receipt_no: number;
  receipt_date: string;
  amount: number;
  payment_method: string;
  is_restricted: number;
  restricted_purpose: string | null;
  notes: string | null;
  donor_name: string;
  member_no: string | null;
  created_by_name: string | null;
}

interface DisbursementRow {
  id: string;
  request_no: number;
  payment_voucher_no: string | null;
  category: string;
  category_label: string;
  beneficiary_name: string;
  beneficiary_phone: string | null;
  description: string;
  amount: number;
  disbursed_at: string;
  approvers: string | null;
  disbursed_by_name: string | null;
  disbursed_date: string;
}

const firstOfYear = () =>
  fromHijri(currentHijriYear(), 1, 1) ?? `${todayISO().slice(0, 4)}-01-01`;

export function ReportsPage() {
  const toast = useToast();
  const realtimeVersion = useRealtimeVersion();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'cash';
  const [tab, setTab] = useState<Tab>(['cash', 'arrears', 'donations', 'disbursements', 'member'].includes(initialTab) ? initialTab : 'cash');
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(todayISO());
  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [cash, setCash] = useState<CashLedger | null>(null);
  const [arrears, setArrears] = useState<{ rows: ArrearsRow[]; totals: { accrued: number; paid: number; arrears: number; members: number } } | null>(null);
  const [donations, setDonations] = useState<{ rows: DonationRow[]; totals: { count: number; total: number; general: number; restricted: number } } | null>(null);
  const [disbursements, setDisbursements] = useState<{ rows: DisbursementRow[]; totals: { count: number; total: number; by_category: Record<string, { label: string; total: number; count: number }> } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberStatement, setMemberStatement] = useState<MemberStatement | null>(null);

  useEffect(() => {
    if (searchParams.get('tab')) {
      const requested = searchParams.get('tab') as Tab;
      if (['cash', 'arrears', 'donations', 'disbursements', 'member'].includes(requested)) setTab(requested);
      setSearchParams({}, { replace: true });
    }
    api.get<{ members: Member[] }>('/members?status=active')
      .then((payload) => {
        setMembers(payload.members);
        if (payload.members.length && !selectedMemberId) setSelectedMemberId(payload.members[0].id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const range = `from=${from}&to=${to}`;
        const summaryPromise = api.get<ReportsSummary>(`/reports/summary?${range}`);
        const tabPromise =
          tab === 'arrears'
            ? api.get<typeof arrears>('/reports/arrears')
            : tab === 'donations'
              ? api.get<typeof donations>(`/reports/donations?${range}`)
              : tab === 'disbursements'
                ? api.get<typeof disbursements>(`/reports/disbursements?${range}`)
                : tab === 'member'
                  ? (selectedMemberId
                    ? api.get<MemberStatement>(`/reports/member-movements?member_id=${selectedMemberId}&${range}`)
                    : Promise.resolve(null))
                  : api.get<CashLedger>(`/reports/cash-ledger?${range}`);
        const [summaryPayload, payload] = await Promise.all([summaryPromise, tabPromise]);
        if (!active) return;
        setSummary(summaryPayload);
        if (tab === 'arrears') setArrears(payload as typeof arrears);
        else if (tab === 'donations') setDonations(payload as typeof donations);
        else if (tab === 'disbursements') setDisbursements(payload as typeof disbursements);
        else if (tab === 'member') setMemberStatement(payload as MemberStatement | null);
        else setCash(payload as CashLedger);
      } catch (loadError) {
        if (active) setError(apiErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [tab, from, to, refreshKey, realtimeVersion, selectedMemberId]);

  const rangeLabel = `${formatDate(from)} — ${formatDate(to)}`;

  async function exportReport(type: string) {
    try {
      const memberParam = type === 'member' && selectedMemberId ? `&member_id=${selectedMemberId}` : '';
      await downloadCsv(`/reports/export?type=${type}&from=${from}&to=${to}${memberParam}`, `تقرير-${type}.csv`);
      toast.success('تم تصدير التقرير بصيغة CSV متوافقة مع Excel');
    } catch (exportError) {
      toast.error(apiErrorMessage(exportError));
    }
  }

  const printMetrics = useMemo(() => {
    if (tab === 'cash' && cash) {
      return [
        { label: 'رصيد افتتاحي', value: money(cash.opening_balance) },
        { label: 'إجمالي الوارد', value: money(cash.total_in) },
        { label: 'إجمالي الصادر', value: money(cash.total_out) },
        { label: 'الرصيد الختامي', value: money(cash.closing_balance) },
      ];
    }
    if (tab === 'arrears' && arrears) {
      return [
        { label: 'عدد الأعضاء المتأخرين', value: formatNumber(arrears.totals.members) },
        { label: 'إجمالي المستحق', value: money(arrears.totals.accrued) },
        { label: 'إجمالي المسدد', value: money(arrears.totals.paid) },
        { label: 'إجمالي المتأخرات', value: money(arrears.totals.arrears) },
      ];
    }
    if (tab === 'donations' && donations) {
      return [
        { label: 'عدد التبرعات', value: formatNumber(donations.totals.count) },
        { label: 'تبرعات عامة', value: money(donations.totals.general) },
        { label: 'تبرعات مخصصة', value: money(donations.totals.restricted) },
        { label: 'الإجمالي', value: money(donations.totals.total) },
      ];
    }
    if (tab === 'disbursements' && disbursements) {
      return [
        { label: 'عدد المصروفات', value: formatNumber(disbursements.totals.count) },
        { label: 'إجمالي المصروف', value: money(disbursements.totals.total) },
      ];
    }
    if (tab === 'member' && memberStatement) {
      return [
        { label: 'العضو', value: memberStatement.member.full_name },
        { label: 'رصيد افتتاحي', value: money(memberStatement.opening_balance) },
        { label: 'استحقاقات الفترة', value: money(memberStatement.totals.dues) },
        { label: 'المسدد', value: money(memberStatement.totals.paid) },
        { label: 'إجمالي المتأخرات', value: money(memberStatement.totals.arrears) },
      ];
    }
    return [];
  }, [tab, cash, arrears, donations, disbursements, memberStatement]);

  return (
    <div className="page-stack">
      <PageHeader
        title="التقارير المالية وكشف الصندوق"
        subtitle="كشف حركة نقدية برصيد جارٍ، تقرير المتأخرات، التبرعات، والمصروفات — مع تصدير CSV وطباعة رسمية."
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw size={17} />} onClick={() => setRefreshKey((key) => key + 1)}>تحديث</Button>
            <Button variant="secondary" icon={<Download size={17} />} onClick={() => exportReport(tab)}>
              تصدير CSV
            </Button>
            <Button icon={<Printer size={17} />} onClick={() => setPrinting(true)}>طباعة التقرير</Button>
          </>
        }
      />

      {summary && (
        <section className="stats-grid four">
          <StatCard label="الرصيد النقدي الفعلي" value={money(summary.position.cash_balance)} hint="رصيد حالي" icon={<Wallet size={21} />} tone="emerald" />
          <StatCard label="مقبوضات الفترة" value={money(summary.period.receipts)} hint={`${formatNumber(summary.counts.receipts_count)} سند قبض`} icon={<TrendingUp size={21} />} tone="blue" />
          <StatCard label="مصروفات الفترة" value={money(summary.period.paid_expenses)} hint={`${formatNumber(summary.counts.expenses_count)} سند صرف`} icon={<TrendingDown size={21} />} tone="gold" />
          <StatCard label="إجمالي المتأخرات" value={money(summary.arrears.total_arrears)} hint="خارج الرصيد النقدي" icon={<CalendarClock size={21} />} tone="amber" />
        </section>
      )}

      {summary && (
        <section className="erp-overview">
          <div className="erp-kpi-row">
            <div className="erp-kpi"><span>نسبة التحصيل</span><strong>{formatNumber(summary.collection_rate ?? 0)}%</strong><small>من إجمالي الاستحقاقات</small></div>
            <div className="erp-kpi"><span>الصافي المتاح</span><strong>{money(summary.position.net_available)}</strong><small>بعد خصم الالتزامات المعتمدة</small></div>
            <div className="erp-kpi"><span>التزامات معتمدة</span><strong>{money(summary.position.committed_pending)}</strong><small>طلبات معتمدة بانتظار الصرف</small></div>
            <div className="erp-kpi"><span>أعضاء متأخرون</span><strong>{formatNumber(summary.members_with_arrears ?? 0)}</strong><small>من أصل {formatNumber(summary.counts.active_members)} عضو نشط</small></div>
          </div>

          <div className="erp-grid">
            <Card className="erp-panel erp-panel-wide">
              <div className="erp-panel-head">
                <div><h3><BarChart3 size={17} /> حركة آخر 12 شهراً</h3><p>المقبوضات مقابل المصروفات المدفوعة</p></div>
                <div className="erp-legend"><span><i className="dot-emerald" /> وارد</span><span><i className="dot-gold" /> صادر</span></div>
              </div>
              <div className="trend-chart">
                {(summary.trend ?? []).map((point) => {
                  const max = Math.max(1, ...(summary.trend ?? []).map((row) => Math.max(row.receipts, row.expenses)));
                  return (
                    <div key={point.month} className="trend-col" title={`${monthLabel(point.month)} — وارد ${money(point.receipts)} / صادر ${money(point.expenses)}`}>
                      <div className="trend-bars">
                        <span className="trend-bar in" style={{ height: `${Math.max(3, (point.receipts / max) * 100)}%` }} />
                        <span className="trend-bar out" style={{ height: `${Math.max(3, (point.expenses / max) * 100)}%` }} />
                      </div>
                      <small>{monthLabel(point.month).split(' ')[0]}</small>
                    </div>
                  );
                })}
                {!(summary.trend ?? []).length && <p className="muted">لا توجد بيانات كافية للرسم.</p>}
              </div>
            </Card>

            <Card className="erp-panel">
              <div className="erp-panel-head"><div><h3><TrendingUp size={17} /> مصادر الإيراد</h3><p>حسب نوع السند</p></div></div>
              <div className="breakdown-list">
                {(summary.income_breakdown ?? []).map((row) => {
                  const max = Math.max(1, ...(summary.income_breakdown ?? []).map((item) => item.total));
                  return (
                    <div key={row.receipt_type} className="breakdown-row">
                      <div><span>{row.label}</span><strong>{money(row.total)}</strong></div>
                      <div className="breakdown-bar"><i className="emerald" style={{ width: `${(row.total / max) * 100}%` }} /></div>
                      <small>{formatNumber(row.count)} سند</small>
                    </div>
                  );
                })}
                {!(summary.income_breakdown ?? []).length && <p className="muted">لا توجد إيرادات في الفترة.</p>}
              </div>
            </Card>

            <Card className="erp-panel">
              <div className="erp-panel-head"><div><h3><TrendingDown size={17} /> توزيع المصروفات</h3><p>حسب فئة الصرف</p></div></div>
              <div className="breakdown-list">
                {(summary.expense_breakdown ?? []).map((row) => {
                  const max = Math.max(1, ...(summary.expense_breakdown ?? []).map((item) => item.total));
                  return (
                    <div key={row.category} className="breakdown-row">
                      <div><span>{row.label}</span><strong>{money(row.total)}</strong></div>
                      <div className="breakdown-bar"><i className="gold" style={{ width: `${(row.total / max) * 100}%` }} /></div>
                      <small>{formatNumber(row.count)} عملية</small>
                    </div>
                  );
                })}
                {!(summary.expense_breakdown ?? []).length && <p className="muted">لا توجد مصروفات في الفترة.</p>}
              </div>
            </Card>

            <Card className="erp-panel">
              <div className="erp-panel-head"><div><h3><AlertTriangle size={17} /> أعمار المتأخرات</h3><p>حسب مدة التأخر</p></div></div>
              <div className="aging-grid">
                <div><span>أقل من 30 يوماً</span><strong>{money(summary.aging?.current ?? 0)}</strong></div>
                <div><span>31 – 90 يوماً</span><strong>{money(summary.aging?.days_1_90 ?? 0)}</strong></div>
                <div><span>91 – 180 يوماً</span><strong>{money(summary.aging?.days_91_180 ?? 0)}</strong></div>
                <div className="danger"><span>أكثر من 180 يوماً</span><strong>{money(summary.aging?.over_180 ?? 0)}</strong></div>
              </div>
            </Card>

            <Card className="erp-panel">
              <div className="erp-panel-head"><div><h3><Award size={17} /> أكبر المتبرعين</h3><p>خلال الفترة المحددة</p></div></div>
              <div className="top-donors">
                {(summary.top_donors ?? []).map((row, index) => (
                  <div key={`${row.donor_name}-${index}`} className="top-donor-row">
                    <span className="rank">{index + 1}</span>
                    <div><strong>{row.donor_name}</strong><small>{formatNumber(row.count)} تبرع</small></div>
                    <b>{money(row.total)}</b>
                  </div>
                ))}
                {!(summary.top_donors ?? []).length && <p className="muted">لا توجد تبرعات مسجلة في الفترة.</p>}
              </div>
            </Card>
          </div>
        </section>
      )}

      <Card className="reports-filter">
        <div className="reports-filter-row">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { value: 'cash', label: 'حركة الصندوق النقدي' },
              { value: 'arrears', label: 'تقرير المتأخرات' },
              { value: 'donations', label: 'تقرير التبرعات' },
              { value: 'disbursements', label: 'تقرير المصروفات' },
              { value: 'member', label: 'كشف حركة عضو' },
            ]}
          />
          {tab === 'member' && (
            <Select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
              <option value="">اختر العضو…</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.member_no} — {member.full_name}</option>
              ))}
            </Select>
          )}
          {tab !== 'arrears' && (
            <div className="date-range">
              <label>من (هجري) <HijriDateInput value={from} onChange={setFrom} /></label>
              <label>إلى (هجري) <HijriDateInput value={to} onChange={setTo} /></label>
            </div>
          )}
        </div>
        <span className="reports-range-label">{tab === 'arrears' ? 'جميع الفترات — حتى تاريخ اليوم' : `الفترة: ${rangeLabel}`}</span>
      </Card>

      {loading ? (
        <LoadingState label="جارٍ تحميل التقرير…" />
      ) : error ? (
        <Card><Alert tone="danger" title="تعذر تحميل التقرير">{error}</Alert></Card>
      ) : (
        <>
          {tab === 'cash' && cash && (
            <Card padding={false} className="table-card">
              <div className="report-head">
                <div>
                  <h3>كشف حركة الصندوق النقدي</h3>
                  <p>يشمل المقبوضات والمصروفات المدفوعة فقط — بدون المتأخرات غير المحصلة.</p>
                </div>
                <div className="report-head-metrics">
                  <div><span>رصيد افتتاحي</span><strong>{money(cash.opening_balance)}</strong></div>
                  <div><span>وارد</span><strong className="text-emerald">{money(cash.total_in)}</strong></div>
                  <div><span>صادر</span><strong className="text-gold">{money(cash.total_out)}</strong></div>
                  <div><span>رصيد ختامي</span><strong>{money(cash.closing_balance)}</strong></div>
                </div>
              </div>
              {cash.movements.length === 0 ? (
                <EmptyState title="لا توجد حركات في الفترة المحددة" description="جرّب توسيع نطاق التاريخ." icon={<BarChart3 size={28} />} />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>المستند</th>
                        <th>البيان</th>
                        <th>الطرف</th>
                        <th>وارد</th>
                        <th>صادر</th>
                        <th>الرصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="opening-row">
                        <td>{formatDate(cash.from)}</td>
                        <td>—</td>
                        <td>رصيد افتتاحي مرحّل</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td className="amount-cell">{money(cash.opening_balance)}</td>
                      </tr>
                      {cash.movements.map((movement) => (
                        <tr key={`${movement.kind}-${movement.id}`}>
                          <td className="muted">{formatDate(movement.date)}</td>
                          <td className="mono">{movement.reference}</td>
                          <td>
                            <span className="movement-type">
                              <i className={movement.kind === 'receipt' ? 'dot-emerald' : 'dot-gold'} />
                              {movement.description}
                            </span>
                          </td>
                          <td>{movement.party}</td>
                          <td className="text-emerald">{movement.credit ? money(movement.credit) : '—'}</td>
                          <td className="text-gold">{movement.debit ? money(movement.debit) : '—'}</td>
                          <td className="amount-cell">{money(movement.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>الإجمالي</td>
                        <td>{money(cash.total_in)}</td>
                        <td>{money(cash.total_out)}</td>
                        <td>{money(cash.closing_balance)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'arrears' && arrears && (
            <Card padding={false} className="table-card">
              <div className="report-head">
                <div>
                  <h3>تقرير متأخرات الأعضاء</h3>
                  <p>المتأخرات هي استحقاقات لم تُحصل، ولا تُضاف إلى الرصيد النقدي الفعلي للصندوق.</p>
                </div>
                <div className="report-head-metrics">
                  <div><span>أعضاء متأخرون</span><strong>{formatNumber(arrears.totals.members)}</strong></div>
                  <div><span>إجمالي المتأخرات</span><strong className="text-danger">{money(arrears.totals.arrears)}</strong></div>
                </div>
              </div>
              {arrears.rows.length === 0 ? (
                <EmptyState title="لا توجد متأخرات" description="جميع استحقاقات الأعضاء مسددة." icon={<CalendarClock size={28} />} />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>رقم العضوية</th>
                        <th>العضو</th>
                        <th>الهاتف</th>
                        <th>إجمالي المستحق</th>
                        <th>المسدد</th>
                        <th>المتأخرات</th>
                        <th>أشهر مفتوحة</th>
                        <th>أقدم استحقاق</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arrears.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="mono">{row.member_no}</td>
                          <td><strong>{row.full_name}</strong></td>
                          <td className="mono" dir="ltr">{row.phone ?? '—'}</td>
                          <td>{money(row.accrued)}</td>
                          <td className="text-emerald">{money(row.paid)}</td>
                          <td className="amount-cell danger-text">{money(row.arrears)}</td>
                          <td>{formatNumber(row.open_months)}</td>
                          <td>{row.oldest_due ? monthLabel(row.oldest_due) : '—'}</td>
                          <td><Badge tone={row.active ? 'success' : 'neutral'} dot>{row.active ? 'نشط' : 'موقوف'}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}>الإجمالي</td>
                        <td>{money(arrears.totals.accrued)}</td>
                        <td>{money(arrears.totals.paid)}</td>
                        <td>{money(arrears.totals.arrears)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'donations' && donations && (
            <Card padding={false} className="table-card">
              <div className="report-head">
                <div>
                  <h3>تقرير التبرعات</h3>
                  <p>التبرعات العامة والمخصصة المسجلة خلال الفترة، مع توضيح الغرض المخصص.</p>
                </div>
                <div className="report-head-metrics">
                  <div><span>عدد التبرعات</span><strong>{formatNumber(donations.totals.count)}</strong></div>
                  <div><span>تبرعات عامة</span><strong>{money(donations.totals.general)}</strong></div>
                  <div><span>تبرعات مخصصة</span><strong className="text-gold">{money(donations.totals.restricted)}</strong></div>
                  <div><span>الإجمالي</span><strong>{money(donations.totals.total)}</strong></div>
                </div>
              </div>
              {donations.rows.length === 0 ? (
                <EmptyState title="لا توجد تبرعات في الفترة" description="جرّب تعديل نطاق التاريخ." icon={<ReceiptText size={28} />} />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>السند</th>
                        <th>التاريخ</th>
                        <th>المتبرع</th>
                        <th>المبلغ</th>
                        <th>الصفة</th>
                        <th>الغرض</th>
                        <th>طريقة الدفع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donations.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="mono">{refReceipt(row.receipt_no)}</td>
                          <td className="muted">{formatDate(row.receipt_date)}</td>
                          <td>{row.donor_name}</td>
                          <td className="amount-cell">{money(row.amount)}</td>
                          <td><Badge tone={row.is_restricted ? 'gold' : 'neutral'}>{row.is_restricted ? 'مخصص' : 'عام'}</Badge></td>
                          <td>{row.restricted_purpose ?? '—'}</td>
                          <td>{PAYMENT_METHOD_LABELS[row.payment_method]}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}>الإجمالي</td>
                        <td>{money(donations.totals.total)}</td>
                        <td colSpan={3}>العام: {money(donations.totals.general)} — المخصص: {money(donations.totals.restricted)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'disbursements' && disbursements && (
            <Card padding={false} className="table-card">
              <div className="report-head">
                <div>
                  <h3>تقرير المصروفات والمساعدات</h3>
                  <p>الطلبات المصروفة فعلياً، مع أسماء المعتمدين لكل عملية صرف.</p>
                </div>
                <div className="report-head-metrics">
                  <div><span>عدد المصروفات</span><strong>{formatNumber(disbursements.totals.count)}</strong></div>
                  <div><span>إجمالي المصروف</span><strong className="text-gold">{money(disbursements.totals.total)}</strong></div>
                </div>
              </div>
              {disbursements.rows.length === 0 ? (
                <EmptyState title="لا توجد مصروفات في الفترة" description="جرّب تعديل نطاق التاريخ." icon={<FileSpreadsheet size={28} />} />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>تاريخ الصرف</th>
                        <th>سند الصرف</th>
                        <th>الفئة</th>
                        <th>المستفيد</th>
                        <th>المبلغ</th>
                        <th>المعتمدان</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disbursements.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="muted">{formatDate(row.disbursed_date)}</td>
                          <td className="mono">{row.payment_voucher_no}</td>
                          <td><Badge tone="info">{EXPENSE_CATEGORY_LABELS[row.category] ?? row.category_label}</Badge></td>
                          <td>{row.beneficiary_name}</td>
                          <td className="amount-cell">{money(row.amount)}</td>
                          <td className="muted small-text">{row.approvers ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>الإجمالي</td>
                        <td>{money(disbursements.totals.total)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'member' && (
            !selectedMemberId ? (
              <Card><EmptyState title="اختر عضواً" description="اختر العضو لعرض كشف حركته التفصيلي والمتأخرات." icon={<UserRound size={28} />} /></Card>
            ) : !memberStatement ? (
              <Card><LoadingState label="جارٍ تحميل كشف العضو…" /></Card>
            ) : (
              <Card padding={false} className="table-card member-statement-card">
                <div className="report-head">
                  <div>
                    <h3>كشف حركة العضو: {memberStatement.member.full_name}</h3>
                    <p>رقم العضوية {memberStatement.member.member_no} — الفترة {formatDate(memberStatement.from)} إلى {formatDate(memberStatement.to)}</p>
                  </div>
                  <div className="report-head-metrics">
                    <div><span>رصيد افتتاحي</span><strong>{money(memberStatement.opening_balance)}</strong></div>
                    <div><span>استحقاقات الفترة</span><strong>{money(memberStatement.totals.dues)}</strong></div>
                    <div><span>المسدد</span><strong className="text-emerald">{money(memberStatement.totals.paid)}</strong></div>
                    <div><span>إجمالي المتأخرات</span><strong className="danger-text">{money(memberStatement.totals.arrears)}</strong></div>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th>مدين (استحقاق)</th><th>دائن (سداد)</th><th>الرصيد</th></tr>
                    </thead>
                    <tbody>
                      <tr className="opening-row">
                        <td>{formatDate(memberStatement.from)}</td><td>—</td><td>رصيد افتتاحي مرحّل</td><td>—</td><td>—</td><td className="amount-cell">{money(memberStatement.opening_balance)}</td>
                      </tr>
                      {memberStatement.movements.map((movement) => (
                        <tr key={movement.id}>
                          <td className="muted">{formatDate(movement.date)}</td>
                          <td className="mono">{movement.reference || '—'}</td>
                          <td>{movement.description}</td>
                          <td className="text-gold">{movement.debit ? money(movement.debit) : '—'}</td>
                          <td className="text-emerald">{movement.credit ? money(movement.credit) : '—'}</td>
                          <td className="amount-cell">{money(movement.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td colSpan={3}>الإجمالي</td><td>{money(memberStatement.totals.dues)}</td><td>{money(memberStatement.totals.paid)}</td><td>{money(memberStatement.totals.closing_balance)}</td></tr>
                    </tfoot>
                  </table>
                </div>

                {memberStatement.arrears.length > 0 && (
                  <div className="member-arrears">
                    <h4><AlertTriangle size={16} /> تفصيل المتأخرات ({formatNumber(memberStatement.totals.arrears_months)} شهر)</h4>
                    <div className="arrears-chips">
                      {memberStatement.arrears.map((row) => (
                        <span key={row.id} className="arrears-chip"><b>{row.label}</b><em>{money(row.remaining)}</em></span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )
          )}
        </>
      )}

      {printing && tab === 'cash' && cash && (
        <ReportPrint
          title="كشف حركة الصندوق النقدي"
          subtitle={`الفترة: ${rangeLabel}`}
          metrics={printMetrics}
          onClose={() => setPrinting(false)}
        >
          <table className="print-table compact">
            <thead>
              <tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th>الطرف</th><th>وارد</th><th>صادر</th><th>الرصيد</th></tr>
            </thead>
            <tbody>
              <tr><td>{formatDate(cash.from)}</td><td>—</td><td>رصيد افتتاحي</td><td>—</td><td>—</td><td>—</td><td>{money(cash.opening_balance, false)}</td></tr>
              {cash.movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.date)}</td>
                  <td>{movement.reference}</td>
                  <td>{movement.description}</td>
                  <td>{movement.party}</td>
                  <td>{movement.credit ? money(movement.credit, false) : '—'}</td>
                  <td>{movement.debit ? money(movement.debit, false) : '—'}</td>
                  <td>{money(movement.balance, false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={4}>الإجمالي</th><th>{money(cash.total_in, false)}</th><th>{money(cash.total_out, false)}</th><th>{money(cash.closing_balance, false)}</th></tr>
            </tfoot>
          </table>
        </ReportPrint>
      )}

      {printing && tab === 'arrears' && arrears && (
        <ReportPrint title="تقرير متأخرات الأعضاء" subtitle="جميع الفترات" metrics={printMetrics} onClose={() => setPrinting(false)}>
          <table className="print-table compact">
            <thead>
              <tr><th>رقم العضوية</th><th>العضو</th><th>الهاتف</th><th>مستحق</th><th>مسدد</th><th>متأخرات</th><th>أشهر</th><th>أقدم استحقاق</th></tr>
            </thead>
            <tbody>
              {arrears.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.member_no}</td><td>{row.full_name}</td><td>{row.phone ?? '—'}</td>
                  <td>{money(row.accrued, false)}</td><td>{money(row.paid, false)}</td><td>{money(row.arrears, false)}</td>
                  <td>{row.open_months}</td><td>{row.oldest_due ? monthLabel(row.oldest_due) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={3}>الإجمالي</th><th>{money(arrears.totals.accrued, false)}</th><th>{money(arrears.totals.paid, false)}</th><th>{money(arrears.totals.arrears, false)}</th><th colSpan={2} /></tr>
            </tfoot>
          </table>
        </ReportPrint>
      )}

      {printing && tab === 'donations' && donations && (
        <ReportPrint title="تقرير التبرعات" subtitle={`الفترة: ${rangeLabel}`} metrics={printMetrics} onClose={() => setPrinting(false)}>
          <table className="print-table compact">
            <thead>
              <tr><th>السند</th><th>التاريخ</th><th>المتبرع</th><th>المبلغ</th><th>الصفة</th><th>الغرض</th><th>الدفع</th></tr>
            </thead>
            <tbody>
              {donations.rows.map((row) => (
                <tr key={row.id}>
                  <td>{refReceipt(row.receipt_no)}</td><td>{formatDate(row.receipt_date)}</td>
                  <td>{row.donor_name}</td><td>{money(row.amount, false)}</td>
                  <td>{row.is_restricted ? 'مخصص' : 'عام'}</td><td>{row.restricted_purpose ?? '—'}</td>
                  <td>{PAYMENT_METHOD_LABELS[row.payment_method]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={3}>الإجمالي</th><th>{money(donations.totals.total, false)}</th><th colSpan={3}>عام: {money(donations.totals.general, false)} — مخصص: {money(donations.totals.restricted, false)}</th></tr>
            </tfoot>
          </table>
        </ReportPrint>
      )}

      {printing && tab === 'disbursements' && disbursements && (
        <ReportPrint title="تقرير المصروفات والمساعدات" subtitle={`الفترة: ${rangeLabel}`} metrics={printMetrics} onClose={() => setPrinting(false)}>
          <table className="print-table compact">
            <thead>
              <tr><th>تاريخ الصرف</th><th>السند</th><th>الفئة</th><th>المستفيد</th><th>المبلغ</th><th>المعتمدان</th></tr>
            </thead>
            <tbody>
              {disbursements.rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.disbursed_date)}</td><td>{row.payment_voucher_no}</td>
                  <td>{EXPENSE_CATEGORY_LABELS[row.category] ?? row.category_label}</td>
                  <td>{row.beneficiary_name}</td><td>{money(row.amount, false)}</td>
                  <td>{row.approvers ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={4}>الإجمالي</th><th>{money(disbursements.totals.total, false)}</th><th /></tr>
            </tfoot>
          </table>
        </ReportPrint>
      )}

      {printing && tab === 'member' && memberStatement && (
        <ReportPrint
          title={`كشف حركة العضو: ${memberStatement.member.full_name}`}
          subtitle={`رقم العضوية ${memberStatement.member.member_no} — الفترة ${rangeLabel}`}
          metrics={printMetrics}
          onClose={() => setPrinting(false)}
        >
          <table className="print-table compact">
            <thead>
              <tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr>
            </thead>
            <tbody>
              <tr><td>{formatDate(memberStatement.from)}</td><td>—</td><td>رصيد افتتاحي</td><td>—</td><td>—</td><td>{money(memberStatement.opening_balance, false)}</td></tr>
              {memberStatement.movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.date)}</td><td>{movement.reference || '—'}</td><td>{movement.description}</td>
                  <td>{movement.debit ? money(movement.debit, false) : '—'}</td>
                  <td>{movement.credit ? money(movement.credit, false) : '—'}</td>
                  <td>{money(movement.balance, false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={3}>الإجمالي</th><th>{money(memberStatement.totals.dues, false)}</th><th>{money(memberStatement.totals.paid, false)}</th><th>{money(memberStatement.totals.closing_balance, false)}</th></tr>
            </tfoot>
          </table>
          {memberStatement.arrears.length > 0 && (
            <div className="print-arrears">
              <h4>تفصيل المتأخرات</h4>
              <table className="print-table compact">
                <thead><tr><th>الشهر</th><th>المتبقي</th></tr></thead>
                <tbody>
                  {memberStatement.arrears.map((row) => (
                    <tr key={row.id}><td>{row.label}</td><td>{money(row.remaining, false)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportPrint>
      )}
    </div>
  );
}
