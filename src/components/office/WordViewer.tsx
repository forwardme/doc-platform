'use client';

import { useEffect, useRef, useState } from 'react';
import PrintButton from '../PrintButton';
import { Edit, Loader2, Save, X } from 'lucide-react';

export default function WordViewer({ documentId }: { documentId: number }) {
  const [html, setHtml] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/documents/${documentId}/word`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        setHtml(d.html ?? '');
        setLoading(false);
      })
      .catch(() => {
        setError('无法加载 Word 内容');
        setLoading(false);
      });
  }, [documentId]);

  // 进入编辑态时，把已加载的 HTML 灌入 contentEditable
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.innerHTML = html;
      editorRef.current.focus();
    }
  }, [editing, html]);

  function exec(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
  }

  async function save() {
    const content = editorRef.current?.innerHTML ?? '';
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/documents/${documentId}/word`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: content }),
      });
      if (!res.ok) throw new Error();
      setHtml(content);
      setEditing(false);
      setSaved(true);
      window.dispatchEvent(new Event('pdfsite:changed'));
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-20 text-center text-sm text-gray-400">正在加载文档…</div>;
  if (error && !html)
    return <div className="rounded-lg bg-red-50 p-8 text-center text-red-600">{error}</div>;

  return (
    <div>
      <div className="print:hidden sticky top-14 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        {!editing ? (
          <>
            <button
              onClick={() => setEditing(true)}
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
            <span className="text-xs text-gray-400">格式</span>
            <button onClick={() => exec('bold')} className="rounded px-2 py-1 text-sm font-bold hover:bg-gray-100" title="加粗">B</button>
            <button onClick={() => exec('italic')} className="rounded px-2 py-1 text-sm italic hover:bg-gray-100" title="斜体">I</button>
            <button onClick={() => exec('underline')} className="rounded px-2 py-1 text-sm underline hover:bg-gray-100" title="下划线">U</button>
            <button onClick={() => exec('strikeThrough')} className="rounded px-2 py-1 text-sm line-through hover:bg-gray-100" title="删除线">S</button>
            <span className="mx-1 h-5 w-px bg-gray-200" />
            <button onClick={() => exec('formatBlock', 'h1')} className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="标题1">H1</button>
            <button onClick={() => exec('formatBlock', 'h2')} className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="标题2">H2</button>
            <button onClick={() => exec('formatBlock', 'h3')} className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="标题3">H3</button>
            <button onClick={() => exec('formatBlock', 'p')} className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="正文">¶</button>
            <span className="mx-1 h-5 w-px bg-gray-200" />
            <button onClick={() => exec('insertUnorderedList')} className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="无序列表">• 列表</button>
            <button onClick={() => exec('insertOrderedList')} className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="有序列表">1. 列表</button>
            <button onClick={() => exec('removeFormat')} className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="清除格式">清除格式</button>

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
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="markdown-body min-h-[60vh] rounded-lg border border-gray-200 bg-white p-8 shadow-sm outline-none focus:ring-2 focus:ring-blue-200"
        />
      ) : (
        <div
          className="markdown-body rounded-lg border border-gray-200 bg-white p-8 shadow-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
