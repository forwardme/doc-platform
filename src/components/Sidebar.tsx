'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Files, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Tags, X } from 'lucide-react';
import { useLocalStorage } from '@/lib/useLocalStorage';

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

const NAV = [
  { href: '/', label: '文档', icon: Files },
  { href: '/tags', label: '标签索引', icon: Tags },
];

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

function Section({ title, collapsed, children }: { title: string; collapsed?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className={`mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400 ${collapsed ? 'md:hidden' : ''}`}>
        {title}
      </div>
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
  const [collapsed, setCollapsed] = useLocalStorage('sidebar-collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const rail = collapsed;

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

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const navActive = (href: string) =>
    (href === '/' && pathname === '/') || (href !== '/' && pathname.startsWith(href));

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          className="print:hidden fixed left-3 top-3 z-40 rounded-md border border-gray-200 bg-white p-2 text-gray-600 shadow-sm md:hidden"
          title="打开菜单"
        >
          <Menu size={18} />
        </button>
      )}

      <aside
        className={`print:hidden fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-gray-200 bg-white transition-all md:sticky md:top-0 md:h-screen md:shrink-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 ${rail ? 'md:w-16' : 'md:w-60'}`}
      >
        <div className={`flex items-center gap-2 border-b border-gray-100 py-3 ${rail ? 'md:justify-center md:px-0' : 'px-4'}`}>
          <Link href="/" className="flex items-center gap-2">
            <BookOpen size={18} className="shrink-0 text-blue-600" />
            <span className={`text-lg font-semibold tracking-tight ${rail ? 'md:hidden' : ''}`}>文档工作台</span>
          </Link>
          <button
            onClick={() => setCollapsed(true)}
            className={`ml-auto hidden rounded-md p-1 text-gray-400 hover:bg-gray-100 md:block ${rail ? 'md:hidden' : ''}`}
            title="收起侧边栏"
          >
            <PanelLeftClose size={16} />
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-100 md:hidden"
            title="关闭菜单"
          >
            <X size={18} />
          </button>
        </div>

        <nav className={`flex gap-1 border-b border-gray-100 p-2 text-sm ${rail ? 'md:flex-col' : ''}`}>
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-1.5 ${
                navActive(href) ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={label}
            >
              <Icon size={16} className="shrink-0" />
              <span className={rail ? 'md:hidden' : ''}>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-2">
          <Section title="最近打开" collapsed={rail}>
            {data.recent.length === 0 ? (
              <p className={`px-2 text-xs text-gray-400 ${rail ? 'md:hidden' : ''}`}>暂无记录</p>
            ) : (
              <ul className="space-y-0.5">
                {data.recent.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/viewer/${d.id}`}
                      className={`flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-50 ${rail ? 'md:justify-center md:px-0' : ''}`}
                      title={d.title}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TYPE_DOT[d.extension] ?? '#9ca3af' }} />
                      <span className={`min-w-0 flex-1 truncate text-sm text-gray-700 ${rail ? 'md:hidden' : ''}`}>{d.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className={rail ? 'md:hidden' : ''}>
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
        </div>

        <div className={`flex items-center gap-2 border-t border-gray-100 py-3 ${rail ? 'md:flex-col md:px-0' : 'px-4'}`}>
          <span className={`min-w-0 flex-1 truncate text-sm text-gray-500 ${rail ? 'md:hidden' : ''}`}>{username}</span>
          <button
            onClick={logout}
            className={`rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 ${rail ? 'md:hidden' : ''}`}
          >
            退出
          </button>
          {rail && (
            <div className="hidden flex-col items-center gap-2 md:flex">
              <button onClick={logout} title="退出登录" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100">
                <LogOut size={16} />
              </button>
              <button onClick={() => setCollapsed(false)} title="展开侧边栏" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100">
                <PanelLeftOpen size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
