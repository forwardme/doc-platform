'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  id: number;
  title: string;
  onRenamed?: (title: string) => void;
  className?: string;
}

/** 行内重命名按钮：点击变输入框，回车/失焦保存。 */
export default function RenameButton({ id, title, onRenamed, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(title);
  const router = useRouter();

  async function save() {
    const t = val.trim();
    if (t && t !== title) {
      await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      onRenamed?.(t);
      window.dispatchEvent(new Event('pdfsite:changed'));
      router.refresh();
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={className ?? 'w-full rounded border border-blue-400 px-1 py-0.5 text-sm'}
      />
    );
  }

  return (
    <button
      onClick={() => {
        setEditing(true);
        setVal(title);
      }}
      className={className ?? 'rounded-md px-2.5 py-1 text-gray-500 hover:bg-gray-100'}
      title="重命名"
    >
      ✎
    </button>
  );
}
