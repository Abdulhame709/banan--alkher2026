import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { DatabaseBackup, Download, Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { formatDateTime } from '../lib/format';
import { Alert, Button, Card, CardHeader, EmptyState, LoadingState } from './ui';

interface BackupRow {
  id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  counts: Record<string, number>;
  created_at: string;
}

function formatBytes(value: number) {
  if (!value) return '—';
  if (value < 1024) return `${value} بايت`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} ك.ب`;
  return `${(value / (1024 * 1024)).toFixed(1)} م.ب`;
}

function countsSummary(counts: Record<string, number> = {}) {
  const members = counts.fund_members ?? 0;
  const receipts = counts.fund_receipts ?? 0;
  const expenses = counts.fund_expense_requests ?? 0;
  const subscriptions = counts.fund_subscriptions ?? 0;
  return `${members} عضو • ${subscriptions} استحقاق • ${receipts} سند • ${expenses} طلب صرف`;
}

async function saveOrOpenBackup(url: string, filename: string) {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  // Android WebView has no download manager, so save the JSON to the app cache
  // and hand it to the system share sheet instead.
  const response = await fetch(url);
  if (!response.ok) throw new Error('تعذر تنزيل النسخة الاحتياطية');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '-');
  const saved = await Filesystem.writeFile({
    path: safeName,
    data: btoa(binary),
    directory: Directory.Cache,
  });
  await Share.share({
    title: safeName,
    url: saved.uri,
    dialogTitle: 'مشاركة النسخة الاحتياطية',
  });
}

export function BackupCard() {
  const toast = useToast();
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ backups: BackupRow[]; retention: number }>('/backups');
      setBackups(data.backups);
      setRetention(data.retention ?? 30);
      setError('');
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createBackup() {
    setCreating(true);
    setError('');
    try {
      const result = await api.post<{ backup: BackupRow; url: string }>('/backup');
      toast.success('تم إنشاء النسخة الاحتياطية بنجاح');
      await saveOrOpenBackup(result.url, result.backup.filename);
      await load();
    } catch (createError) {
      setError(apiErrorMessage(createError));
      toast.error(apiErrorMessage(createError));
    } finally {
      setCreating(false);
    }
  }

  async function downloadBackup(id: string) {
    setBusyId(id);
    setError('');
    try {
      const result = await api.get<{ url: string; backup: BackupRow }>(`/backups/${id}`);
      await saveOrOpenBackup(result.url, result.backup.filename);
    } catch (downloadError) {
      setError(apiErrorMessage(downloadError));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBackup(id: string) {
    if (!window.confirm('هل تريد حذف هذه النسخة الاحتياطية نهائياً؟')) return;
    setBusyId(id);
    setError('');
    try {
      await api.del(`/backups/${id}`);
      toast.success('تم حذف النسخة الاحتياطية');
      await load();
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError));
      toast.error(apiErrorMessage(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="النسخ الاحتياطية"
        subtitle={`نسخة كاملة من بيانات الصندوق تُحفظ في تخزين Supabase الخاص. يُحتفظ بآخر ${retention} نسخة تلقائياً.`}
        icon={<DatabaseBackup size={19} />}
        action={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            loading={creating}
            onClick={createBackup}
          >
            إنشاء نسخة الآن
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <LoadingState label="جارٍ تحميل النسخ الاحتياطية…" />
      ) : backups.length === 0 ? (
        <EmptyState
          icon={<DatabaseBackup size={30} />}
          title="لا توجد نسخ احتياطية بعد"
          description="أنشئ نسخة كاملة الآن لتنزيلها والاحتفاظ بها خارج النظام."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>الملف</th>
                <th>التاريخ</th>
                <th>الحجم</th>
                <th>المحتوى</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <td>
                    <strong className="mono">{backup.filename}</strong>
                  </td>
                  <td className="muted">{formatDateTime(backup.created_at)}</td>
                  <td className="muted">{formatBytes(backup.size_bytes)}</td>
                  <td className="muted small-text">{countsSummary(backup.counts)}</td>
                  <td>
                    <div className="row-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Download size={15} />}
                        loading={busyId === backup.id}
                        onClick={() => void downloadBackup(backup.id)}
                      >
                        تنزيل
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={15} />}
                        onClick={() => void deleteBackup(backup.id)}
                      >
                        حذف
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Alert tone="info">
        النسخة تشمل الإعدادات والأعضاء والاشتراكات وسندات القبض وطلبات الصرف والاعتمادات وسجل
        التدقيق. لا تشمل كلمات المرور. للاستعادة راجع دليل المستخدم أو تواصل مع المسؤول التقني.
      </Alert>
    </Card>
  );
}
