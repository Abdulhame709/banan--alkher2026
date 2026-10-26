import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { api, apiErrorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { Alert, Button, Field, Modal, TextInput } from './ui';

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (next.length < 8) {
      setError('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.');
      return;
    }
    if (next !== confirm) {
      setError('تأكيد كلمة المرور غير مطابق.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        current_password: current,
        new_password: next,
      });
      toast.success('تم تغيير كلمة المرور بنجاح');
      onClose();
    } catch (submitError) {
      setError(apiErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="تغيير كلمة المرور"
      subtitle="اختر كلمة مرور قوية لا تقل عن 8 أحرف، ولا تشاركها مع أحد."
      icon={<KeyRound size={20} />}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            type="submit"
            form="change-password-form"
            loading={saving}
            icon={<KeyRound size={16} />}
          >
            حفظ كلمة المرور
          </Button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={submit} className="form-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="كلمة المرور الحالية" required>
          <TextInput
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="كلمة المرور الجديدة" required hint="8 أحرف على الأقل">
          <TextInput
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة" required>
          <TextInput
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
      </form>
    </Modal>
  );
}
