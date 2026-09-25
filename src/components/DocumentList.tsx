'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List } from 'lucide-react';
import RenameButton from './RenameButton';
import CategoryBadge from './CategoryBadge';
import Thumb from './Thumb';
import { useLocalStorage } from '@/lib/useLocalStorage';

interface Doc {
  id: number;
  title: string;
  original_name: string;
  extension: string;
  size: number;
  status: string;
  category_id: number | null;
  created_at: string;
  updated_at: string;
  snippet?: string;
}

interface Category {
  id: number;
  name: string;
  color: string;
  count: number;
}

const TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF',
  md: 'MD',
  docx: 'DOCX',
  doc: 'DOC',
  pptx: 'PPTX',
  ppt: 'PPT',
  xlsx: 'XLSX',
  xls: 'XLS',
  odt: 'ODT',
  odp: 'ODP',
  ods: 'ODS',
};

type SortKey = 'title' | 'category' | 'size' | 'updated_at';
type SortDir = 'asc' | 'desc';

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(s: string): string {
  const d = new Date(s.endsWith('Z') ? s : s + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function SortHeader(props: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onToggle: (k: SortKey) => void;
}) {
  const { label, k, sortKey, sortDir, onToggle } = props;
  const active = sortKey === k;
  return (
    <th className="px-3 py-2 text-left">
      <button
        onClick={() => onToggle(k)}
        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
        title={`按${label}排序`}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ArrowUp size={12} />
          ) : (
            <ArrowDown size={12} />
          )
        ) : (
          <ArrowUpDown size={12} className="text-gray-300" />
        )}
      </button>
    </th>
  );
}

export default function DocumentList() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category');
  const categoryId = categoryParam != null && categoryParam !== '' ? Number(categoryParam) : null;

  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [cats, setCats] = useState<Category[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [selCat, setSelCat] = useState<number | 'none' | 'new'>('none');
  const [newCatName, setNewCatName] = useState('');

  const [view, setView] = useLocalStorage<'card' | 'list'>('doclist-view', 'card');
  const [sortKey, setSortKey] = useLocalStorage<SortKey>('doclist-sort', 'updated_at');
  const [sortDir, setSortDir] = useLocalStorage<SortDir>('doclist-sortdir', 'desc');

  const load = useCallback(async (query: string, cat: number | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (cat != null) params.set('category', String(cat));
      const res = await fetch(`/api/documents?${params.toString()}`);
      const data = await res.json();
      setDocs(data.documents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchCats = () =>
      fetch('/api/categories')
        .then((r) => r.json())
        .then((d) => setCats(d.categories ?? []))
        .catch(() => {});
    fetchCats();
    // 侧边栏新建/重命名/删除分类后同步刷新
    window.addEventListener('pdfsite:changed', fetchCats);
    return () => window.removeEventListener('pdfsite:changed', fetchCats);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q, categoryId), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, categoryId, load]);

  const catMap = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...docs].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'title') {
        cmp = a.title.localeCompare(b.title, 'zh-CN');
      } else if (sortKey === 'category') {
        const na = catMap.get(a.category_id ?? -1)?.name ?? '';
        const nb = catMap.get(b.category_id ?? -1)?.name ?? '';
        cmp = na.localeCompare(nb, 'zh-CN');
      } else if (sortKey === 'size') {
        cmp = a.size - b.size;
      } else {
        cmp = a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0;
      }
      return dir * cmp;
    });
  }, [docs, catMap, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(k);
    setSortDir(k === 'title' || k === 'category' ? 'asc' : 'desc');
  }

  async function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const res = await fetch('/api/categories');
      const d = await res.json();
      setCats(d.categories ?? []);
    } catch {
      /* ignore */
    }
    setSelCat('none');
    setNewCatName('');
    setPendingFiles(Array.from(files));
  }

  async function confirmUpload() {
    if (!pendingFiles) return;
    const files = pendingFiles;
    setPendingFiles(null);
    setUploading(true);
    setError('');

    let catId: number | null = null;
    if (selCat === 'new') {
      const name = newCatName.trim();
      if (name) {
        const r = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const d = await r.json();
        catId = d.category?.id ?? null;
      }
    } else if (typeof selCat === 'number') {
      catId = selCat;
    }

    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      if (catId != null) fd.append('categoryId', String(catId));
      const res = await fetch('/api/documents', { method: 'POST', body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `${file.name} 上传失败`);
      }
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    window.dispatchEvent(new Event('pdfsite:changed'));
    await load(q, categoryId);
  }

  async function onDelete(id: number) {
    if (!window.confirm('确认删除该文档？此操作不可恢复。')) return;
    await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    window.dispatchEvent(new Event('pdfsite:changed'));
    await load(q, categoryId);
  }

  // 重新分类后本地同步：若当前按分类过滤且文档被移出该分类，则从列表移除
  function onCategoryChanged(docId: number, newCatId: number | null) {
    setDocs((prev) =>
      categoryId != null && newCatId !== categoryId
        ? prev.filter((x) => x.id !== docId)
        : prev.map((x) => (x.id === docId ? { ...x, category_id: newCatId } : x)),
    );
  }

  const currentCategory = cats.find((c) => c.id === categoryId);

  const viewToggle = (
    <div className="flex items-center gap-0.5 rounded-md border border-gray-300 p-0.5">
      <button
        onClick={() => setView('card')}
        title="卡片视图"
        className={`rounded p-1.5 ${view === 'card' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
      >
        <LayoutGrid size={16} />
      </button>
      <button
        onClick={() => setView('list')}
        title="列表视图"
        className={`rounded p-1.5 ${view === 'list' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
      >
        <List size={16} />
      </button>
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文档标题或正文…"
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        {currentCategory && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: currentCategory.color }} />
            {currentCategory.name}
            <Link href="/" className="ml-1 text-indigo-400 hover:text-indigo-600" title="清除分类过滤">
              ×
            </Link>
          </span>
        )}
        {viewToggle}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? '上传中…' : '＋ 上传文档'}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.md,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.odt,.odp,.ods"
          className="hidden"
          onChange={(e) => onFilesChosen(e.target.files)}
        />
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">加载中…</div>
      ) : docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-20 text-center text-sm text-gray-400">
          {q || categoryId ? '没有匹配的文档' : '还没有文档，点击右上角「上传文档」开始'}
        </div>
      ) : view === 'list' ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <SortHeader label="名称" k="title" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="类别" k="category" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="大小" k="size" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="编辑时间" k="updated_at" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
                return (
                  <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="max-w-[280px] px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/viewer/${d.id}`}
                          className="truncate font-medium text-gray-900 hover:text-blue-600"
                          title={d.title}
                        >
                          {d.title}
                        </Link>
                        <RenameButton
                          id={d.id}
                          title={d.title}
                          className="shrink-0 rounded px-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          onRenamed={(t) => setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, title: t } : x)))}
                        />
                      </div>
                      <span className="text-xs text-gray-400">{TYPE_LABEL[d.extension] ?? d.extension.toUpperCase()}</span>
                    </td>
                    <td className="px-3 py-2">
                      <CategoryBadge
                        docId={d.id}
                        categoryId={d.category_id}
                        categories={cats}
                        onChanged={(cid) => onCategoryChanged(d.id, cid)}
                      />
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600">{formatSize(d.size)}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{formatDate(d.updated_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2 text-xs">
                        <Link href={`/viewer/${d.id}`} className="rounded-md bg-blue-50 px-2.5 py-1 text-blue-700 hover:bg-blue-100">
                          查看
                        </Link>
                        <a href={`/api/documents/${d.id}/file`} className="rounded-md bg-gray-50 px-2.5 py-1 text-gray-600 hover:bg-gray-100">
                          下载
                        </a>
                        <button onClick={() => onDelete(d.id)} className="rounded-md px-2.5 py-1 text-red-500 hover:bg-red-50">
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((d) => {
            return (
              <div key={d.id} className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:shadow">
                <Thumb docId={d.id} extension={d.extension} />

                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/viewer/${d.id}`}
                          className="block min-w-0 truncate text-sm font-medium text-gray-900 hover:text-blue-600"
                          title={d.title}
                        >
                          {d.title}
                        </Link>
                        <RenameButton
                          id={d.id}
                          title={d.title}
                          className="shrink-0 rounded px-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          onRenamed={(t) => setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, title: t } : x)))}
                        />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px]">
                          {TYPE_LABEL[d.extension] ?? d.extension.toUpperCase()}
                        </span>
                        <span>{formatSize(d.size)}</span>
                        <CategoryBadge
                          docId={d.id}
                          categoryId={d.category_id}
                          categories={cats}
                          onChanged={(cid) => onCategoryChanged(d.id, cid)}
                        />
                        {d.status === 'no_preview' && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700" title="缺少预览（可能未安装 LibreOffice）">
                            仅存储
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {d.snippet ? (
                    <div className="mb-3 line-clamp-2 text-xs text-gray-500" dangerouslySetInnerHTML={{ __html: d.snippet }} />
                  ) : null}

                  <div className="mt-auto flex items-center gap-2 text-xs">
                    <Link href={`/viewer/${d.id}`} className="rounded-md bg-blue-50 px-2.5 py-1 text-blue-700 hover:bg-blue-100">
                      查看
                    </Link>
                    <a href={`/api/documents/${d.id}/file`} className="rounded-md bg-gray-50 px-2.5 py-1 text-gray-600 hover:bg-gray-100">
                      下载
                    </a>
                    <span className="ml-auto text-gray-300">{formatDate(d.updated_at)}</span>
                    <button onClick={() => onDelete(d.id)} className="rounded-md px-2.5 py-1 text-red-500 hover:bg-red-50">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPendingFiles(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-base font-semibold">上传 {pendingFiles.length} 个文件</h2>
            <p className="mb-3 text-xs text-gray-500">选择这些文档所属的分类（可选）</p>
            <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50">
                <input type="radio" checked={selCat === 'none'} onChange={() => setSelCat('none')} />
                <span className="text-sm text-gray-500">暂不分类</span>
              </label>
              {cats.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50">
                  <input type="radio" checked={selCat === c.id} onChange={() => setSelCat(c.id)} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="flex-1 truncate text-sm text-gray-700">{c.name}</span>
                  <span className="text-xs text-gray-400">{c.count}</span>
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50">
                <input type="radio" checked={selCat === 'new'} onChange={() => setSelCat('new')} />
                <span className="text-sm text-gray-700">＋ 新建分类</span>
              </label>
              {selCat === 'new' && (
                <input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="输入分类名"
                  className="ml-6 w-[calc(100%-1.5rem)] rounded border border-blue-400 px-2 py-1.5 text-sm"
                />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingFiles(null)} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                取消
              </button>
              <button
                onClick={confirmUpload}
                disabled={uploading || (selCat === 'new' && !newCatName.trim())}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {uploading ? '上传中…' : '开始上传'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
