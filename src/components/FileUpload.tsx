import { useRef, useState, type DragEvent } from 'react';
import { FileText, Image as ImageIcon, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { apiErrorMessage, fileUrl, uploadFile } from '../lib/api';
import { useToast } from '../lib/toast';

export function FileUpload({
  value,
  onChange,
  kind = 'document',
  label = 'إرفاق مستند',
  hint = 'صورة أو PDF — الحد الأقصى 8 ميجابايت',
}: {
  value: string | null;
  onChange: (filename: string | null) => void;
  kind?: 'document' | 'logo';
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState('');
  const toast = useToast();

  const accept = kind === 'logo' ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,application/pdf';

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('حجم الملف أكبر من الحد المسموح (8 ميجابايت)');
      return;
    }
    setUploading(true);
    try {
      const result = await uploadFile(file, kind);
      onChange(result.file);
      setName(result.name);
      toast.success('تم رفع الملف بنجاح');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  }

  const isImage = value && /\.(png|jpe?g|webp)$/i.test(value);
  const link = value ? (value.startsWith('http') ? value : fileUrl(value)) : null;

  return (
    <div className="file-upload">
      <span className="field-label">{label}</span>
      {value ? (
        <div className="file-preview">
          <span className="file-preview-icon">
            {isImage ? <ImageIcon size={20} /> : <FileText size={20} />}
          </span>
          <div className="file-preview-info">
            <a href={link ?? '#'} target="_blank" rel="noreferrer">
              {name || 'عرض الملف المرفق'}
            </a>
            <small>تم الرفع بنجاح</small>
          </div>
          <button type="button" className="icon-btn icon-btn-danger" onClick={() => { onChange(null); setName(''); }} aria-label="حذف المرفق">
            <Trash2 size={17} />
          </button>
        </div>
      ) : (
        <div
          className={`upload-drop ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="visually-hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button type="button" className="upload-trigger" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={22} className="spin" /> : <UploadCloud size={22} />}
            <span>{uploading ? 'جارٍ الرفع…' : 'اختيار ملف أو سحبه هنا'}</span>
          </button>
          <small>{hint}</small>
        </div>
      )}
    </div>
  );
}
