'use client';

import { useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useLocalStorage } from '@/lib/useLocalStorage';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  documentId: number;
  currentPage: number; // 当前 PDF 实际页
  pageCount: number; // 实际 PDF 总页数
  bodyStart: number; // 正文起始 PDF 页
}

interface DragState {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  moved: boolean;
  onNum: boolean;
}

/**
 * 图书页码浮标：右下角可拖动的胶囊，左侧显示区段（目录/正文），
 * 右侧显示「正文页码 / 实际PDF页码」；点击数字可跳页，齿轮可设置正文起始页。
 */
export default function PageBadge({ documentId, currentPage, pageCount, bodyStart }: Props) {
  const [bodyStartState, setBodyStartState] = useState(bodyStart);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pos, setPos] = useLocalStorage<{ x: number; y: number } | null>('pdf-page-badge', null);

  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const bs = clamp(bodyStartState, 1, pageCount);
  const isFront = currentPage < bs;
  const num = isFront ? currentPage : currentPage - bs + 1;

  // —— 拖动（起始目标为按钮/输入框时不启动；区分点击与拖动）——
  function onDown(e: React.PointerEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('button,input')) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: pos ? pos.x : rect.left,
      oy: pos ? pos.y : rect.top,
      moved: false,
      onNum: !!t.closest('[data-num]'),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (d.moved) setPos({ x: d.ox + dx, y: d.oy + dy });
  }

  function onUp() {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (!d.moved) {
      if (d.onNum) startEdit();
      return;
    }
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: clamp(rect.left, 8, window.innerWidth - rect.width - 8),
      y: clamp(rect.top, 8, window.innerHeight - rect.height - 8),
    });
  }

  // —— 跳页：输入正文页码 ——
  function startEdit() {
    setDraft(String(num));
    setEditing(true);
  }

  function jump() {
    const n = clamp(parseInt(draft, 10) || 1, 1, pageCount - bs + 1);
    const p = bs + n - 1;
    setEditing(false);
    requestAnimationFrame(() => {
      document.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function cancelEdit() {
    setEditing(false);
  }

  // —— 设置正文起始页 ——
  function toggleSettings() {
    setDraft(String(bs));
    setOpen((v) => !v);
  }

  function saveBodyStart() {
    const n = clamp(parseInt(draft, 10) || 1, 1, pageCount);
    setBodyStartState(n);
    setOpen(false);
    void fetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_start_page: n }),
    }).catch(() => {});
  }

  return (
    <div
      className="print:hidden fixed z-30"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}
    >
      <div className="relative">
        {open && (
          <div className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
            <div className="mb-1 text-xs font-medium text-gray-700">正文起始页（PDF 第几页）</div>
            <input
              autoFocus
              type="number"
              min={1}
              max={pageCount}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveBodyStart();
                if (e.key === 'Escape') setOpen(false);
              }}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1.5 text-[11px] leading-snug text-gray-400">
              该页之前的页面按「目录」编号，正文从 1 重新计。
            </p>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={saveBodyStart}
                className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
              >
                确定
              </button>
            </div>
          </div>
        )}

        <div
          ref={ref}
          className="flex cursor-grab items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 shadow-lg active:cursor-grabbing"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <button
            type="button"
            onClick={toggleSettings}
            title="设置正文起始页"
            className="rounded px-1 text-xs text-gray-500 hover:bg-gray-100"
          >
            {isFront ? '目录' : '正文'}
          </button>

          {editing ? (
            <input
              autoFocus
              type="number"
              min={1}
              max={pageCount - bs + 1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jump();
                if (e.key === 'Escape') cancelEdit();
              }}
              onBlur={cancelEdit}
              className="w-10 rounded border border-blue-400 px-1 py-0.5 text-sm tabular-nums focus:outline-none"
            />
          ) : (
            <span
              data-num
              title="点击输入正文页码跳转"
              className="cursor-text text-sm font-medium tabular-nums"
            >
              {num}
            </span>
          )}

          {!isFront && <span className="text-xs text-gray-400 tabular-nums">/ {currentPage}</span>}

          <button
            type="button"
            onClick={toggleSettings}
            title="设置正文起始页"
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <Settings2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
