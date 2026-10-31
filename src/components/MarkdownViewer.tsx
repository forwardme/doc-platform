'use client';

import { useState } from 'react';
import PrintButton from './PrintButton';
import { Columns2, Edit, Loader2, Rows2, Save, X } from 'lucide-react';
import { MarkdownPreview } from './MarkdownPreview';

export function MarkdownViewer({
  documentId,
  initialContent,
}: {
  documentId: number;
  initialContent: string;
}) {
  const [content, setContent] = useState(initialContent);
  const [draft, setDraft] = useState(initialContent);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<'horizontal' | 'vertical'>('horizontal');

  function startEdit() {
    setDraft(content);
    setError('');
    setSaved(false);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const res = await fetch(`/api/documents/${documentId}/markdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error();
      setContent(draft);
      setEditing(false);
      setSaved(true);
      window.dispatchEvent(new Event('pdfsite:changed'));
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  }

  const textarea = (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      spellCheck={false}
      className="min-h-[60vh] w-full resize-y rounded-lg border border-gray-200 bg-white p-4 font-mono text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-200"
    />
  );
  const preview = (
    <div className="markdown-body min-h-[60vh] rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <MarkdownPreview content={draft} />
    </div>
  );

  return (
    <div>
      <div className="print:hidden sticky top-14 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        {!editing ? (
          <>
            <button
              onClick={startEdit}
              title="编辑"
              className="rounded-md bg-blue-600 p-1.5 text-white hover:bg-blue-700"
            >
              <Edit size={16} />
            </button>
            <PrintButton />
            <span className="ml-auto text-xs text-gray-400">只读查看</span>
          </>
        ) : (
          <>
            <button
              onClick={() => setLayout('horizontal')}
              title="左右分栏"
              className={`rounded p-1.5 ${layout === 'horizontal' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <Columns2 size={16} />
            </button>
            <button
              onClick={() => setLayout('vertical')}
              title="上下分栏"
              className={`rounded p-1.5 ${layout === 'vertical' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <Rows2 size={16} />
            </button>
            <div className="ml-auto flex items-center gap-2">
              {error && <span className="text-xs text-red-500">{error}</span>}
              {saved && <span className="text-xs text-green-600">已保存</span>}
              <button
                onClick={() => setEditing(false)}
                title="取消编辑"
                className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100"
              >
                <X size={16} />
              </button>
              <button
                onClick={save}
                disabled={saving}
                title="保存"
                className="rounded-md bg-green-600 p-1.5 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              </button>
            </div>
          </>
        )}
      </div>

      {editing ? (
        layout === 'horizontal' ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {textarea}
            {preview}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {preview}
            {textarea}
          </div>
        )
      ) : (
        <div className="markdown-body rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <MarkdownPreview content={content} />
        </div>
      )}
    </div>
  );
}
