import { FileText, Paperclip } from 'lucide-react';
import { fileUrl } from '../lib/api';
import type { Attachment } from '../types';

export function AttachmentLinks({
  attachments,
  legacyUrl,
  compact = false,
}: {
  attachments?: Attachment[];
  legacyUrl?: string | null;
  compact?: boolean;
}) {
  const items = [
    ...(legacyUrl ? [{ id: `legacy-${legacyUrl}`, file_name: legacyUrl, original_name: 'المرفق الأساسي' }] : []),
    ...(attachments ?? []).map((attachment) => ({
      id: attachment.id,
      file_name: attachment.file_name,
      original_name: attachment.original_name ?? attachment.file_name,
    })),
  ];
  if (!items.length) return null;
  if (compact) {
    return (
      <a
        className="attachment-compact"
        href={fileUrl(items[0].file_name)}
        target="_blank"
        rel="noreferrer"
        title={`${items.length} مرفق`}
      >
        <Paperclip size={15} />
        {items.length > 1 ? <span>{items.length}</span> : null}
      </a>
    );
  }
  return (
    <div className="attachment-list">
      {items.map((item) => (
        <a className="attachment-chip" key={item.id} href={fileUrl(item.file_name)} target="_blank" rel="noreferrer">
          <FileText size={14} />
          <span>{item.original_name}</span>
        </a>
      ))}
    </div>
  );
}
