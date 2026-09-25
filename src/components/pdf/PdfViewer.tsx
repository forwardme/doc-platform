'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import PdfPage from './PdfPage';
import SelectedPanel from './SelectedPanel';
import SelectionToolbar from './SelectionToolbar';
import type { Annotation, TextSelection, Tool, Tag } from './types';
import {
  Eraser,
  GripHorizontal,
  Highlighter,
  MoveHorizontal,
  MoveVertical,
  MousePointer2,
  Pen,
  StickyNote,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import IconButton from '@/components/ui/IconButton';
import { useLocalStorage } from '@/lib/useLocalStorage';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

const TOOLS: { key: Tool; label: string; desc: string; icon: LucideIcon }[] = [
  { key: 'select', label: '选择', desc: '选中 / 移动批注', icon: MousePointer2 },
  { key: 'ink', label: '手写', desc: '自由绘制笔迹', icon: Pen },
  { key: 'text', label: '文本', desc: '选中文字加高亮 / 下划线', icon: Highlighter },
  { key: 'note', label: '便签', desc: '点击页面添加便签', icon: StickyNote },
  { key: 'eraser', label: '橡皮', desc: '擦除批注', icon: Eraser },
];

const PRESET_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#111827'];
const NEW_TAG_COLOR = '#3b82f6';
const clampZoom = (z: number) => Math.min(4, Math.max(0.25, z));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  documentId: number;
  initialAnnotations: Annotation[];
}

export default function PdfViewer({ documentId, initialAnnotations }: Props) {
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#f59e0b');
  const [strokeSize, setStrokeSize] = useState(3);
  const [zoom, setZoom] = useState(1.25);
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [eraserSize, setEraserSize] = useState(12);
  const [selection, setSelection] = useState<TextSelection | null>(null);

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [tpos, setTpos] = useLocalStorage<{ x: number; y: number; scale: number; inited: boolean }>(
    'pdf-toolbar',
    { x: 0, y: 0, scale: 1, inited: false },
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // 加载 PDF
  useEffect(() => {
    let cancelled = false;
    pdfjs
      .getDocument({ url: `/api/documents/${documentId}/content` })
      .promise.then((doc) => {
        if (!cancelled) {
          setPdfDoc(doc);
          setPageCount(doc.numPages);
        }
      })
      .catch((e) => setError('加载 PDF 失败：' + ((e as Error)?.message || String(e))));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // 清理定时器
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // 从标签索引跳转（?ann=id）：选中并滚动到对应页面
  useEffect(() => {
    const annId = new URLSearchParams(window.location.search).get('ann');
    if (!annId) return;
    const ann = annotationsRef.current.find((a) => a.id === annId);
    if (!ann) return;
    setSelectedId(annId);
    const t = setTimeout(() => {
      document
        .querySelector(`[data-page="${ann.page}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const commit = useCallback(
    (next: Annotation[], immediate: boolean) => {
      annotationsRef.current = next;
      setAnnotations(next);
      setSaving('saving');
      const payload = next.map((a) => ({
        id: a.id,
        page: a.page,
        type: a.type,
        data: a.data,
        text: a.text,
        color: a.color,
        tags: a.tags.map((t) => ({ name: t.name, color: t.color })),
      }));
      const doPut = () =>
        fetch(`/api/documents/${documentId}/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotations: payload }),
        })
          .then(() => setSaving('saved'))
          .catch(() => setSaving('idle'));
      if (immediate) {
        void doPut();
      } else {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(doPut, 700);
      }
    },
    [documentId],
  );

  const addAnnotation = useCallback(
    (ann: Omit<Annotation, 'tags'>) => {
      commit([...annotationsRef.current, { ...ann, tags: [] }], true);
    },
    [commit],
  );

  const deleteAnnotation = useCallback(
    (id: string) => {
      if (selectedId === id) setSelectedId(null);
      commit(
        annotationsRef.current.filter((a) => a.id !== id),
        true,
      );
    },
    [commit, selectedId],
  );

  const undo = useCallback(() => {
    const list = annotationsRef.current;
    if (list.length === 0) return;
    commit(list.slice(0, -1), true);
  }, [commit]);

  const changeText = useCallback(
    (id: string, text: string) => {
      commit(
        annotationsRef.current.map((a) => (a.id === id ? { ...a, text } : a)),
        false,
      );
    },
    [commit],
  );

  const changeColor = useCallback(
    (id: string, c: string) => {
      commit(
        annotationsRef.current.map((a) => (a.id === id ? { ...a, color: c } : a)),
        true,
      );
    },
    [commit],
  );

  const addTag = useCallback(
    (id: string, name: string) => {
      commit(
        annotationsRef.current.map((a) => {
          if (a.id !== id) return a;
          if (a.tags.some((t) => t.name === name)) return a;
          const tag: Tag = { id: -1, name, color: NEW_TAG_COLOR };
          return { ...a, tags: [...a.tags, tag] };
        }),
        true,
      );
    },
    [commit],
  );

  const removeTag = useCallback(
    (id: string, name: string) => {
      commit(
        annotationsRef.current.map((a) =>
          a.id === id ? { ...a, tags: a.tags.filter((t) => t.name !== name) } : a,
        ),
        true,
      );
    },
    [commit],
  );

  // —— 橡皮擦：部分擦除手写（本地实时更新，pointerup 时统一提交）——
  const applyEraseInk = useCallback((id: string, paths: [number, number][][]) => {
    const next: Annotation[] = [];
    for (const a of annotationsRef.current) {
      if (a.id !== id) {
        next.push(a);
        continue;
      }
      if (paths.length === 0) continue; // 全部擦除 → 删除
      next.push({ ...a, data: { ...a.data, paths } });
    }
    annotationsRef.current = next;
    setAnnotations(next);
  }, []);

  const finishErase = useCallback(() => {
    commit(annotationsRef.current, true);
  }, [commit]);

  // —— 文本选区标注 ——
  const clearSelection = useCallback(() => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const onSelectText = useCallback((sel: TextSelection | null) => {
    setSelection(sel);
  }, []);

  // —— 适配宽度 / 适配页面 ——
  const onPageSize = useCallback((s: { w: number; h: number }) => {
    pageSizeRef.current = s;
  }, []);

  const fitWidth = useCallback(() => {
    const w = viewerRef.current?.clientWidth;
    const pw = pageSizeRef.current?.w;
    if (w && pw) setZoom(clampZoom(w / pw));
  }, []);

  const fitPage = useCallback(() => {
    const h = pageSizeRef.current?.h;
    if (h) setZoom(clampZoom((window.innerHeight - 140) / h));
  }, []);

  const applyTextAnnotation = useCallback(
    (type: 'highlight' | 'underline') => {
      if (!selection) return;
      const ann: Omit<Annotation, 'tags'> = {
        id: crypto.randomUUID(),
        page: selection.page,
        type,
        data: { rects: selection.rects },
        text: selection.text,
        color,
      };
      addAnnotation(ann);
      clearSelection();
    },
    [selection, color, addAnnotation, clearSelection],
  );

  // —— 浮动工具栏：首次居中（移动端贴底）、拖动、吸附边框 ——
  useEffect(() => {
    if (tpos.inited || !pdfDoc) return;
    const panel = panelRef.current;
    if (!panel) return;
    const w = panel.offsetWidth || 340;
    const h = panel.offsetHeight || 48;
    const isMobile = window.innerWidth < 768;
    const x = Math.max(8, Math.round((window.innerWidth - w) / 2));
    const y = isMobile ? Math.max(8, window.innerHeight - h - 8) : 8;
    setTpos({ x, y, scale: 1, inited: true });
  }, [tpos.inited, pdfDoc, setTpos]);

  function onGripDown(e: React.PointerEvent) {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: tpos.x, oy: tpos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onGripMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setTpos({ ...tpos, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  }

  function onGripUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const M = 8;
    const distTop = rect.top;
    const distBottom = window.innerHeight - rect.bottom;
    const distLeft = rect.left;
    const distRight = window.innerWidth - rect.right;
    const min = Math.min(distTop, distBottom, distLeft, distRight);
    const nx = clamp(rect.left, M, window.innerWidth - rect.width - M);
    const ny = clamp(rect.top, M, window.innerHeight - rect.height - M);
    if (min === distTop) setTpos({ ...tpos, x: nx, y: M });
    else if (min === distBottom) setTpos({ ...tpos, x: nx, y: window.innerHeight - rect.height - M });
    else if (min === distLeft) setTpos({ ...tpos, x: M, y: ny });
    else setTpos({ ...tpos, x: window.innerWidth - rect.width - M, y: ny });
  }

  // 切换工具时清除选区
  useEffect(() => {
    if (tool !== 'text') clearSelection();
  }, [tool, clearSelection]);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  if (error) {
    return <div className="rounded-lg bg-red-50 p-8 text-center text-red-600">{error}</div>;
  }
  if (!pdfDoc) {
    return <div className="py-20 text-center text-sm text-gray-400">正在加载 PDF…</div>;
  }

  return (
    <div ref={viewerRef}>
      {/* 浮动工具栏（可拖动、吸附边框、缩放） */}
      <div
        ref={panelRef}
        className="print:hidden fixed z-40"
        style={{ left: tpos.x, top: tpos.y, zoom: tpos.scale }}
      >
        <div className="flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
          <button
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            title="拖动工具栏"
            aria-label="拖动工具栏"
            className="shrink-0 cursor-grab touch-none rounded p-1.5 text-gray-400 hover:bg-gray-100 active:cursor-grabbing"
          >
            <GripHorizontal size={16} />
          </button>

          {TOOLS.map((t) => (
            <IconButton
              key={t.key}
              icon={t.icon}
              label={t.label}
              description={t.desc}
              active={tool === t.key}
              onClick={() => setTool(t.key)}
            />
          ))}

          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          <div className="flex shrink-0 items-center gap-0.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                className="h-6 w-6 rounded-full border border-gray-300"
                style={{ backgroundColor: c, outline: color === c ? '2px solid #2563eb' : 'none', outlineOffset: 1 }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="自定义颜色"
              className="ml-1 h-7 w-8 shrink-0 cursor-pointer border-0 bg-transparent p-0"
            />
          </div>

          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          <div className="flex shrink-0 items-center gap-1">
            <input
              type="range"
              min={1}
              max={8}
              value={strokeSize}
              onChange={(e) => setStrokeSize(Number(e.target.value))}
              title={`线宽 ${strokeSize}`}
              className="w-16"
            />
          </div>

          {tool === 'eraser' && (
            <>
              <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
              <div className="flex shrink-0 items-center gap-1">
                <input
                  type="range"
                  min={6}
                  max={32}
                  value={eraserSize}
                  onChange={(e) => setEraserSize(Number(e.target.value))}
                  title={`橡皮大小 ${eraserSize}`}
                  className="w-16"
                />
              </div>
            </>
          )}

          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton icon={ZoomOut} label="缩小" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} />
            <span className="w-11 text-center text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
            <IconButton icon={ZoomIn} label="放大" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} />
          </div>

          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton icon={MoveHorizontal} label="适配宽度" description="按页面宽度缩放" onClick={fitWidth} />
            <IconButton icon={MoveVertical} label="适配页面" description="按页面高度缩放" onClick={fitPage} />
          </div>

          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton icon={Undo2} label="撤销" description="撤销上一个批注" onClick={undo} />
            <span
              className={`h-2 w-2 rounded-full ${saving === 'saving' ? 'bg-amber-400' : 'bg-green-500'}`}
              title={saving === 'saving' ? '保存中…' : '已保存'}
            />
          </div>

          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          <div className="flex shrink-0 items-center gap-1">
            <input
              type="range"
              min={0.8}
              max={1.5}
              step={0.1}
              value={tpos.scale}
              onChange={(e) => setTpos({ ...tpos, scale: Number(e.target.value) })}
              title={`工具栏大小 ${Math.round(tpos.scale * 100)}%`}
              className="w-14"
            />
          </div>
        </div>
      </div>

      {/* 页面 */}
      <div className="space-y-4">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <div key={n} data-page={n} className="flex justify-center">
            <PdfPage
              pdfDoc={pdfDoc}
              pageNumber={n}
              zoom={zoom}
              annotations={annotations.filter((a) => a.page === n)}
              tool={tool}
              color={color}
              strokeSize={strokeSize}
              eraserSize={eraserSize}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAdd={addAnnotation}
              onErase={deleteAnnotation}
              onEraseInk={applyEraseInk}
              onEraseEnd={finishErase}
              onSelectText={onSelectText}
              onPageSize={onPageSize}
            />
          </div>
        ))}
      </div>

      <SelectedPanel
        annotation={selected}
        onClose={() => setSelectedId(null)}
        onChangeText={(t) => selected && changeText(selected.id, t)}
        onChangeColor={(c) => selected && changeColor(selected.id, c)}
        onDelete={() => selected && deleteAnnotation(selected.id)}
        onAddTag={(name) => selected && addTag(selected.id, name)}
        onRemoveTag={(name) => selected && removeTag(selected.id, name)}
      />

      {selection && (
        <SelectionToolbar
          selection={selection}
          color={color}
          onApply={applyTextAnnotation}
          onCancel={clearSelection}
        />
      )}
    </div>
  );
}
