'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Columns2, X } from 'lucide-react';

interface Doc {
  id: number;
  title: string;
  extension: string;
}

export default function SplitButton({ currentId, withId }: { currentId: number; withId?: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);

  if (withId != null) {
    return (
      <button
        onClick={() => router.push(`/viewer/${currentId}`)}
        title="退出分屏"
        className="rounded-md bg-blue-50 p-2 text-blue-600 hover:bg-blue-100"
      >
        <Columns2 size={16} />
      </button>
    );
  }

  async function openPicker() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch('/api/documents');
      const d = await res.json();
      setDocs(d.documents ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={openPicker}
        title="分屏对照"
        className="rounded-md bg-gray-50 p-2 text-gray-600 hover:bg-gray-100"
      >
        <Columns2 size={16} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">选择右侧文档</h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>
            <div className="mb-4 max-h-96 space-y-1 overflow-y-auto">
              {loading ? (
                <p className="py-8 text-center text-sm text-gray-400">加载中…</p>
              ) : docs.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">暂无文档</p>
              ) : (
                docs.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => router.push(`/viewer/${currentId}?with=${d.id}`)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-gray-700">{d.title}</span>
                    <span className="shrink-0 text-xs text-gray-400">{d.extension.toUpperCase()}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
