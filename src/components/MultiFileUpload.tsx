import { useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import { apiErrorMessage, fileUrl, uploadFile } from '../lib/api';
import { useToast } from '../lib/toast';
import type { Attachment, UploadedAttachment } from '../types';

const MAX_FILES = 10;
const MAX_SIZE = 8 * 1024 * 1024;

export function MultiFileUpload({
  value,
  onChange,
  existing = [],
  onRemoveExisting,
  label = 'مرفقات المستند',
  hint = 'يمكن إرفاق حتى 10 ملفات (صور أو PDF) — الحد الأقصى 8 ميجابايت للملف',
}: {
  value: UploadedAttachment[];
  onChange: (value: UploadedAttachment[]) => void;
  existing?: Attachment[];
  onRemoveExisting?: (attachment: Attachment) => Promise<void> | void;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const toast = useToast();

  async function handleFiles(files: FileList | File[] | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (!selected.length) return;
    if (value.length + existing.length + selected.length > MAX_FILES) {
      toast.error(`الحد الأقصى ${MAX_FILES} مرفقات لكل مستند`);
      return;
    }
    setUploading(true);
    const added: UploadedAttachment[] = [];
    try {
      for (const file of selected) {
        if (file.size > MAX_SIZE) {
          toast.error(`الملف ${file.name} أكبر من 8 ميجابايت`);
          continue;
        }
        if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) {
          toast.error(`نوع الملف ${file.name} غير مسموح. المسموح: صور أو PDF`);
          continue;
        }
        try {
          const uploaded = await uploadFile(file);
          added.push(uploaded);
        } catch (error) {
          toast.error(`${file.name}: ${apiErrorMessage(error)}`);
        }
      }
      if (added.length) onChange([...value, ...added]);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function removeExisting(attachment: Attachment) {
    if (!onRemoveExisting) return;
    if (!window.confirm(`حذف المرفق «${attachment.original_name ?? attachment.file_name}»؟`)) return;
    try {
      await onRemoveExisting(attachment);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  }

  return (
    <div className="multi-upload">
      <div className="multi-upload-head">
        <span className="field-label">{label}</span>
        <span className="muted">{existing.length + value.length}/{MAX_FILES}</span>
      </div>
      <button
        type="button"
        className={`upload-drop ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
        disabled={uploading}
      >
        {uploading ? <Loader2 size={22} className="spin" /> : <UploadCloud size={22} />}
        <span>{uploading ? 'جارٍ رفع الملفات…' : 'اسحب الملفات هنا أو اضغط للاختيار'}</span>
        <small>{hint}</small>
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp,application/pdf"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      {existing.length > 0 && (
        <div className="attachment-list">
          {existing.map((attachment) => (
            <div className="attachment-chip" key={attachment.id}>
              <FileText size={15} />
              <a href={fileUrl(attachment.file_name)} target="_blank" rel="noreferrer">
                {attachment.original_name ?? attachment.file_name}
              </a>
              {onRemoveExisting && (
                <button type="button" className="icon-btn icon-btn-danger" onClick={() => void removeExisting(attachment)} title="حذف المرفق">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {value.length > 0 && (
        <div className="attachment-list">
          {value.map((attachment, index) => (
            <div className="attachment-chip" key={attachment.file}>
              <Paperclip size={15} />
              <a href={fileUrl(attachment.file)} target="_blank" rel="noreferrer">
                {attachment.name}
              </a>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                title="إزالة من القائمة"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
