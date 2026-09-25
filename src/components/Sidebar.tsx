'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from './LogoutButton';

interface RecentDoc {
  id: number;
  title: string;
  extension: string;
}
interface Category {
  id: number;
  name: string;
  color: string;
  count: number;
}
interface Tag {
  id: number;
  name: string;
  color: string;
  count: number;
}

const TYPE_DOT: Record<string, string> = {
  pdf: '#ef4444',
  md: '#3b82f6',
  docx: '#2563eb',
  doc: '#2563eb',
  pptx: '#f97316',
  ppt: '#f97316',
  xlsx: '#10b981',
  xls: '#10b981',
};

function notifyChanged() {
  window.dispatchEvent(new Event('pdfsite:changed'));
}

/** 分类 / 标签共用管理列表：新建、改名、换色、删除。 */
function ManageList(props: {
  api: string;
  createLabel: string;
  items: { id: number; name: string; color: string; count: number }[];
  hrefFor?: (id: number) => string | null;
}) {
  const { api, createLabel, items, hrefFor } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [val, setVal] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  async function saveRename(id: number) {
    const name = val.trim();
    if (name) {
      await fetch(`${api}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      notifyChanged();
    }
    setEditingId(null);
  }

  async function recolor(id: number, color: string) {
    await fetch(`${api}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
    });
    notifyChanged();
  }

  async function remove(id: number, name: string) {
    if (!window.confirm(`确认删除「${name}」？`)) return;
    await fetch(`${api}/${id}`, { method: 'DELETE' });
    notifyChanged();
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setNewName('');
    setCreating(false);
    notifyChanged();
  }

  return (
    <ul className="space-y-0.5">
      {items.map((it) => {
        const href = hrefFor ? hrefFor(it.id) : null;
        const body = (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: it.color }} />
            {editingId === it.id ? (
              <input
                autoFocus
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onBlur={() => saveRename(it.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename(it.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-full min-w-0 flex-1 rounded border border-blue-400 px-1 py-0.5 text-xs"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{it.name}</span>
            )}
            <span className="shrink-0 text-xs text-gray-400">{it.count}</span>
          </>
        );
        return (
          <li key={it.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-50">
            {href ? (
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-2" onClick={(e) => { if (editingId === it.id) e.preventDefault(); }}>
                {body}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>
            )}
            {editingId !== it.id && (
              <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
                <button
                  title="重命名"
                  onClick={() => {
                    setEditingId(it.id);
                    setVal(it.name);
                  }}
                  className="text-gray-400 hover:text-gray-700"
                >
                  ✎
                </button>
                <label title="换色" className="relative h-4 w-4 cursor-pointer overflow-hidden rounded-full border border-gray-200" style={{ backgroundColor: it.color }}>
                  <input
                    type="color"
                    value={it.color}
                    onChange={(e) => recolor(it.id, e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
                <button title="删除" onClick={() => remove(it.id, it.name)} className="text-gray-400 hover:text-red-500">
                  ×
                </button>
              </span>
            )}
          </li>
        );
      })}

      {creating ? (
        <li className="flex items-center gap-2 px-2 py-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={create}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder="名称后回车"
            className="w-full rounded border border-blue-400 px-2 py-1 text-xs"
          />
        </li>
      ) : (
        <li>
          <button onClick={() => setCreating(true)} className="w-full rounded-md px-2 py-1 text-left text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-600">
            ＋ {createLabel}
          </button>
        </li>
      )}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      {children}
    </div>
  );
}

export default function Sidebar({ username }: { username: string }) {
  const [data, setData] = useState<{ recent: RecentDoc[]; categories: Category[]; tags: Tag[] }>({
    recent: [],
    categories: [],
    tags: [],
  });
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sidebar');
      const d = await res.json();
      setData({ recent: d.recent ?? [], categories: d.categories ?? [], tags: d.tags ?? [] });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, pathname]);

  useEffect(() => {
    window.addEventListener('pdfsite:changed', load);
    return () => window.removeEventListener('pdfsite:changed', load);
  }, [load]);

  const navActive = (href: string) =>
    (href === '/' && pathname === '/') || (href !== '/' && pathname.startsWith(href));

  return (
    <aside className="print:hidden sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          📚 文档工作台
        </Link>
      </div>

      <nav className="flex gap-1 border-b border-gray-100 p-2 text-sm">
        <Link
          href="/"
          className={`flex-1 rounded-md px-3 py-1.5 text-center ${navActive('/') ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          文档
        </Link>
        <Link
          href="/tags"
          className={`flex-1 rounded-md px-3 py-1.5 text-center ${navActive('/tags') ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          标签索引
        </Link>
      </nav>

      <div className="flex-1 overflow-y-auto p-2">
        <Section title="最近打开">
          {data.recent.length === 0 ? (
            <p className="px-2 text-xs text-gray-400">暂无记录</p>
          ) : (
            <ul className="space-y-0.5">
              {data.recent.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/viewer/${d.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-50"
                    title={d.title}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TYPE_DOT[d.extension] ?? '#9ca3af' }} />
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{d.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="文档分类">
          <ManageList
            api="/api/categories"
            createLabel="新建分类"
            items={data.categories}
            hrefFor={(id) => `/?category=${id}`}
          />
        </Section>

        <Section title="标签管理">
          <ManageList api="/api/tags" createLabel="新建标签" items={data.tags} />
        </Section>
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm text-gray-500">{username}</span>
        <LogoutButton />
      </div>
    </aside>
  );
}
