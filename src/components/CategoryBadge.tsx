'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface CategoryLite {
  id: number;
  name: string;
  color: string;
}

interface Props {
  docId: number;
  categoryId: number | null;
  categories: CategoryLite[];
  onChanged: (categoryId: number | null) => void;
}

const MENU_W = 176; // w-44

/** 文档分类徽章：显示当前分类，点击弹出菜单重新分类（或移出分类）。 */
export default function CategoryBadge({ docId, categoryId, categories, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cat = categories.find((c) => c.id === categoryId) ?? null;

  // 打开时按按钮视口坐标定位（菜单 portal 到 body，避免被卡片/表格的 overflow 裁剪）；
  // 靠近视口底部时向上弹出
  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const estH = Math.min(categories.length + 1, 7) * 32 + 8;
      const below = r.bottom + 4 + estH <= window.innerHeight;
      setAnchor({
        x: Math.min(r.left, window.innerWidth - MENU_W - 8),
        y: below ? r.bottom + 4 : Math.max(8, r.top - 4 - estH),
      });
    }
    setOpen((v) => !v);
  }

  // 点击菜单外部、页面滚动、窗口缩放时收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, { passive: true, capture: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [open]);

  async function move(id: number | null) {
    setOpen(false);
    if (busy || id === categoryId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: id }),
      });
      if (res.ok) {
        onChanged(id);
        window.dispatchEvent(new Event('pdfsite:changed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        title="更改分类"
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
      >
        {cat ? (
          <>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color }} />
            {cat.name}
          </>
        ) : (
          <span className="text-gray-300">未分类</span>
        )}
        <ChevronDown size={10} className="text-gray-300" />
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            style={{ left: anchor.x, top: anchor.y, width: MENU_W }}
            className="fixed z-50 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              onClick={() => move(null)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                categoryId == null ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              暂不分类
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => move(c.id)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                  categoryId === c.id ? 'text-blue-600' : 'text-gray-700'
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            {categories.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-gray-400">还没有分类，可在左侧边栏新建</div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
