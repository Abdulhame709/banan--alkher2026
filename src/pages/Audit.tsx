import { useEffect, useState } from 'react';
import {
  FileClock,
  Filter,
  Lock,
  RotateCcw,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { ENTITY_LABELS, formatDateTime, formatNumber } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
} from '../components/ui';
import type { AuditLog } from '../types';

export function AuditPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set('search', search.trim());
      if (entityType) params.set('entity_type', entityType);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const payload = await api.get<{
        logs: AuditLog[];
        total: number;
        page: number;
        pageSize: number;
        entity_types: string[];
      }>(`/audit?${params.toString()}`);
      setLogs(payload.logs);
      setTotal(payload.total);
      setEntityTypes(payload.entity_types);
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [search, entityType, from, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(false), 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, entityType, from, to]);

  function resetFilters() {
    setSearch('');
    setEntityType('');
    setFrom('');
    setTo('');
    setPage(1);
    toast.info('تمت إعادة تعيين فلاتر سجل التدقيق');
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="سجل الرقابة والتدقيق"
        subtitle="سجل زمني ثابت لجميع العمليات المالية والإدارية — لا يمكن تعديله أو حذفه."
        actions={
          <Badge tone="gold">
            <Lock size={13} /> سجل غير قابل للتغيير
          </Badge>
        }
      />

      <Alert tone="success" title="مرجعية رقابية">
        يُسجل النظام تلقائياً كل عملية اعتماد وصرف وتحصيل وتعديل إعدادات أو صلاحيات، مع هوية المنفذ
        والتاريخ والوقت والتفاصيل. السجل محمي على مستوى قاعدة البيانات من التعديل والحذف.
      </Alert>

      <Card padding={false} className="table-card">
        <div className="table-toolbar filters-toolbar">
          <div className="toolbar-group">
            <SearchInput value={search} onChange={setSearch} placeholder="ابحث في الإجراءات والتفاصيل والمنفذ…" />
            <Select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
              <option value="">جميع الكيانات</option>
              {entityTypes.map((type) => (
                <option key={type} value={type}>{ENTITY_LABELS[type] ?? type}</option>
              ))}
            </Select>
          </div>
          <div className="toolbar-group date-range">
            <label>من <input type="date" className="input" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>إلى <input type="date" className="input" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <button type="button" className="icon-btn" onClick={resetFilters} title="إعادة تعيين">
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        <div className="audit-meta-bar">
          <span><FileClock size={15} /> إجمالي السجلات: {formatNumber(total)}</span>
          <span><Filter size={15} /> الصفحة {page}</span>
        </div>

        {loading ? (
          <LoadingState label="جارٍ تحميل سجل التدقيق…" />
        ) : error ? (
          <div className="table-message"><Alert tone="danger" title="تعذر تحميل السجل">{error}</Alert></div>
        ) : logs.length === 0 ? (
          <EmptyState
            title="لا توجد سجلات مطابقة"
            description="جرّب تعديل الفلاتر أو الفترة الزمنية."
            icon={<ScrollText size={28} />}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table audit-table">
                <thead>
                  <tr>
                    <th>التاريخ والوقت</th>
                    <th>الإجراء</th>
                    <th>التفاصيل</th>
                    <th>المنفذ</th>
                    <th>الكيان</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="audit-time">{formatDateTime(log.created_at)}</td>
                      <td>
                        <span className="audit-action">
                          <ShieldCheck size={15} />
                          {log.action}
                        </span>
                      </td>
                      <td className="audit-details">{log.details || '—'}</td>
                      <td>
                        <strong>{log.actor_name || 'النظام'}</strong>
                        {log.actor_id && <small className="cell-sub mono">{log.actor_id.slice(0, 8)}</small>}
                      </td>
                      <td>
                        <Badge tone="neutral">{ENTITY_LABELS[log.entity_type] ?? log.entity_type}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          </>
        )}
      </Card>

      <p className="immutability-note">
        <Lock size={14} />
        محاولات تعديل أو حذف سجلات التدقيق تُرفض تلقائياً من محرك قاعدة البيانات.
      </p>
    </div>
  );
}
