import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Eraser, PenLine } from 'lucide-react';
import { Alert, Button, Field, Modal, TextInput } from './ui';

export function SignatureModal({
  title = 'التوقيع الإلكتروني',
  subtitle,
  defaultName,
  saving = false,
  onSave,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  defaultName: string;
  saving?: boolean;
  onSave: (data: { signed_by_name: string; signature_data: string }) => Promise<void> | void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [name, setName] = useState(defaultName);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = '#0f172a';
    context.lineWidth = 2.3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }, []);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    lastPoint.current = point(event);
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    const next = point(event);
    const previous = lastPoint.current ?? next;
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPoint.current = next;
    setHasInk(true);
  }

  function end() {
    drawing.current = false;
    lastPoint.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    setHasInk(false);
  }

  async function submit() {
    setError('');
    if (name.trim().length < 3) {
      setError('اكتب اسم الموقّع (3 أحرف على الأقل)');
      return;
    }
    if (!hasInk) {
      setError('ارسم التوقيع داخل المربع أولاً');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signature = canvas.toDataURL('image/png');
    await onSave({ signed_by_name: name.trim(), signature_data: signature });
  }

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      icon={<PenLine size={20} />}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>إلغاء</Button>
          <Button onClick={submit} loading={saving} icon={<Check size={16} />}>حفظ التوقيع</Button>
        </>
      }
    >
      <div className="form-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="اسم الموقّع" required>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <div>
          <div className="signature-pad-head">
            <span className="field-label">ارسم التوقيع هنا</span>
            <button type="button" className="text-button" onClick={clear}>
              <Eraser size={14} /> مسح
            </button>
          </div>
          <canvas
            ref={canvasRef}
            className="signature-pad"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onPointerLeave={end}
          />
          <p className="form-hint">التوقيع يُحفظ كصورة داخل المستند، ويظهر في نسخة الطباعة وPDF.</p>
        </div>
        <Alert tone="info">
          التوقيع الإلكتروني مرتبط بحسابك ووقت التوقيع، ويُسجل في سجل التدقيق.
        </Alert>
      </div>
    </Modal>
  );
}
