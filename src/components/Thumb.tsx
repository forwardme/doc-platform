'use client';

import { useState } from 'react';
import { File, FileSpreadsheet, FileText, FileType } from 'lucide-react';

interface ExtMeta {
  icon: typeof File;
  bg: string;
  fg: string;
}

const EXT_META: Record<string, ExtMeta> = {
  pdf: { icon: FileText, bg: '#fee2e2', fg: '#dc2626' },
  md: { icon: FileText, bg: '#dbeafe', fg: '#2563eb' },
  docx: { icon: FileText, bg: '#dbeafe', fg: '#1d4ed8' },
  doc: { icon: FileText, bg: '#dbeafe', fg: '#1d4ed8' },
  pptx: { icon: FileType, bg: '#ffedd5', fg: '#ea580c' },
  ppt: { icon: FileType, bg: '#ffedd5', fg: '#ea580c' },
  xlsx: { icon: FileSpreadsheet, bg: '#d1fae5', fg: '#059669' },
  xls: { icon: FileSpreadsheet, bg: '#d1fae5', fg: '#059669' },
  odt: { icon: FileText, bg: '#dbeafe', fg: '#1d4ed8' },
  odp: { icon: FileType, bg: '#ffedd5', fg: '#ea580c' },
  ods: { icon: FileSpreadsheet, bg: '#d1fae5', fg: '#059669' },
};

const DEFAULT_META: ExtMeta = { icon: File, bg: '#f3f4f6', fg: '#6b7280' };

/** 卡片缩略图：PDF 显示首屏截图（失败回退图标块），其余格式显示「类型图标 + 颜色」占位块。 */
export default function Thumb({ docId, extension }: { docId: number; extension: string }) {
  const [failed, setFailed] = useState(false);
  const meta = EXT_META[extension] ?? DEFAULT_META;
  const Icon = meta.icon;

  if (extension === 'pdf' && !failed) {
    return (
      <div className="flex h-28 w-full items-center justify-center overflow-hidden bg-gray-100">
        <img
          src={`/api/documents/${docId}/thumbnail`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      </div>
    );
  }

  return (
    <div className="flex h-28 w-full items-center justify-center" style={{ backgroundColor: meta.bg }}>
      <Icon className="h-9 w-9" style={{ color: meta.fg }} />
    </div>
  );
}
