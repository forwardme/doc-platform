'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import PdfPage from './PdfPage';
import SelectedPanel from './SelectedPanel';
import SelectionToolbar from './SelectionToolbar';
import type { Annotation, TextSelection, Tool, Tag } from './types';
import {
  ChevronDown,
  ChevronUp,
  Eraser,
  Highlighter,
  MoveHorizontal,
  MoveVertical,
  MousePointer2,
  Pen,
  Search,
  StickyNote,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import IconButton from '@/components/ui/IconButton';
import { useLocalStorage } from '@/lib/useLocalStorage';
import { loadPageText, mergeCharRects } from './findText';
import type { FindMatch, PageText, Rect } from './findText';
import PageBadge from './PageBadge';

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

// 模块级空数组：保持 props 引用稳定，避免 PdfPage memo 失效
const EMPTY_ANNS: Annotation[] = [];
const EMPTY_RECTS: Rect[] = [];

interface Props {
  documentId: number;
  initialAnnotations: Annotation[];
  bodyStartPage: number;
}

export default function PdfViewer({ documentId, initialAnnotations, bodyStartPage }: Props) {
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
  const [currentPage, setCurrentPage] = useState(1);

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  // 工具栏：阅读时的不透明度（透明度 = 1 - opacity），鼠标悬浮时恢复不透明
  const [tbOpacity, setTbOpacity] = useLocalStorage('pdf-toolbar-opacity', 0.4);
  const [tbHover, setTbHover] = useState(false);

  // —— 查找：按页缓存文本，搜索匹配并定位/高亮 ——
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const [findBusy, setFindBusy] = useState(false);
  const findPagesRef = useRef<Map<number, PageText>>(new Map());
  const findTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const findReqRef = useRef(0);

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

  // 跟踪当前可见页（供页码浮标）：IntersectionObserver 维护可见页集合，取最小页号；
  // 避免滚动时逐帧 O(n) 查询布局（页数多时掉帧）
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    const visible = new Set<number>();
    let cur = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.page) || 0;
          if (!p) continue;
          if (e.isIntersecting) visible.add(p);
          else visible.delete(p);
        }
        if (visible.size === 0) return; // 快速滚动瞬间无可见页，保持上次值
        const first = Math.min(...visible);
        if (first !== cur) {
          cur = first;
          setCurrentPage(first);
        }
      },
      // 顶部收缩 25%：页底部越过视口 1/4 线才算可见，与原判断线一致
      { rootMargin: '-25% 0px 0px 0px' },
    );
    document.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pdfDoc, pageCount]);

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
    setPageSize(s);
  }, []);

  // 缩放时保持阅读位置：记录当前页相对视口顶部的位置，重排后补偿滚动差值
  const zoomAnchorRef = useRef<{ page: number; top: number } | null>(null);

  function changeZoom(next: (z: number) => number) {
    const el = document.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
    if (el) zoomAnchorRef.current = { page: currentPage, top: el.getBoundingClientRect().top };
    setZoom(next);
  }

  useLayoutEffect(() => {
    const a = zoomAnchorRef.current;
    if (!a) return;
    zoomAnchorRef.current = null;
    const el = document.querySelector<HTMLElement>(`[data-page="${a.page}"]`);
    if (!el) return;
    const dy = el.getBoundingClientRect().top - a.top;
    if (Math.abs(dy) > 1) window.scrollBy(0, dy);
  }, [zoom]);

  function fitWidth() {
    const w = viewerRef.current?.clientWidth;
    const pw = pageSizeRef.current?.w;
    if (w && pw) changeZoom(() => clampZoom(w / pw));
  }

  function fitPage() {
    const h = pageSizeRef.current?.h;
    if (h) changeZoom(() => clampZoom((window.innerHeight - 140) / h));
  }

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

  // —— 查找：搜索所有页文本（逐页缓存），返回匹配（页号 + 高亮矩形）——
  const runFind = useCallback(
    async (raw: string) => {
      if (!pdfDoc) return;
      const q = raw.trim();
      const req = ++findReqRef.current;
      if (!q) {
        setFindMatches([]);
        setFindIndex(0);
        setFindBusy(false);
        return;
      }
      setFindBusy(true);
      const matches: FindMatch[] = [];
      const lower = q.toLowerCase();
      for (let n = 1; n <= pageCount; n++) {
        let pt = findPagesRef.current.get(n);
        if (!pt) {
          try {
            const page = await pdfDoc.getPage(n);
            pt = await loadPageText(page, n);
            findPagesRef.current.set(n, pt);
          } catch {
            continue;
          }
        }
        const lowerText = pt.text.toLowerCase();
        let idx = lowerText.indexOf(lower);
        while (idx !== -1) {
          if (req !== findReqRef.current) return;
          matches.push({ page: n, rects: mergeCharRects(pt.chars.slice(idx, idx + q.length)) });
          idx = lowerText.indexOf(lower, idx + 1);
        }
      }
      if (req !== findReqRef.current) return;
      setFindMatches(matches);
      setFindIndex(0);
      setFindBusy(false);
    },
    [pdfDoc, pageCount],
  );

  // 输入防抖后执行查找
  useEffect(() => {
    if (!findOpen) return;
    if (findTimerRef.current) clearTimeout(findTimerRef.current);
    const q = findQuery;
    if (!q.trim()) {
      findReqRef.current++;
      setFindMatches([]);
      setFindIndex(0);
      setFindBusy(false);
      return;
    }
    setFindBusy(true);
    findTimerRef.current = setTimeout(() => {
      void runFind(q);
    }, 200);
    return () => {
      if (findTimerRef.current) clearTimeout(findTimerRef.current);
    };
  }, [findQuery, findOpen, runFind]);

  function gotoMatch(i: number) {
    if (findMatches.length === 0) return;
    const idx = ((i % findMatches.length) + findMatches.length) % findMatches.length;
    setFindIndex(idx);
    const m = findMatches[idx];
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-page="${m.page}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  const findPrev = () => gotoMatch(findIndex - 1);
  const findNext = () => gotoMatch(findIndex + 1);

  // 切换工具时清除选区
  useEffect(() => {
    if (tool !== 'text') clearSelection();
  }, [tool, clearSelection]);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  // 批注/查找结果按页分组（useMemo 保持引用稳定，配合 PdfPage 的 React.memo）
  const annotationsByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const arr = m.get(a.page);
      if (arr) arr.push(a);
      else m.set(a.page, [a]);
    }
    return m;
  }, [annotations]);

  const findRectsByPage = useMemo(() => {
    const m = new Map<number, Rect[]>();
    for (const match of findMatches) {
      const arr = m.get(match.page) ?? [];
      arr.push(...match.rects);
      m.set(match.page, arr);
    }
    return m;
  }, [findMatches]);

  const currentFind = findMatches[findIndex] ?? null;

  if (error) {
    return <div className="rounded-lg bg-red-50 p-8 text-center text-red-600">{error}</div>;
  }
  if (!pdfDoc) {
    return <div className="py-20 text-center text-sm text-gray-400">正在加载 PDF…</div>;
  }

  return (
    <div ref={viewerRef}>
      {/* 顶部工具栏：与 PDF 页面等宽，随滚动吸附视口顶部，阅读时半透明，悬浮时不透明 */}
      <div
        className="print:hidden sticky top-2 z-40 mx-auto transition-opacity duration-200"
        style={{
          width: pageSize ? Math.round(pageSize.w * zoom) : undefined,
          maxWidth: '100%',
          opacity: tbHover ? 1 : tbOpacity,
        }}
        onMouseEnter={() => setTbHover(true)}
        onMouseLeave={() => setTbHover(false)}
      >
        <div className="flex flex-wrap items-center justify-center gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
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
            <IconButton icon={ZoomOut} label="缩小" onClick={() => changeZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} />
            <span className="w-11 text-center text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
            <IconButton icon={ZoomIn} label="放大" onClick={() => changeZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} />
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
          <IconButton
            icon={Search}
            label="查找"
            description="在文档中查找文字"
            active={findOpen}
            onClick={() => setFindOpen((v) => !v)}
          />

          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          <div className="flex shrink-0 items-center gap-1">
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={tbOpacity}
              onChange={(e) => setTbOpacity(Number(e.target.value))}
              title={`工具栏透明度 ${Math.round((1 - tbOpacity) * 100)}%（悬浮时不透明）`}
              className="w-14"
            />
          </div>
        </div>
      </div>

      {/* 查找面板 */}
      {findOpen && (
        <div className="print:hidden fixed right-3 top-16 z-40 flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
          <input
            autoFocus
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) findPrev();
                else findNext();
              } else if (e.key === 'Escape') {
                setFindOpen(false);
              }
            }}
            placeholder="查找…"
            className="w-40 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none sm:w-48"
          />
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-gray-500">
            {findBusy ? '…' : findMatches.length > 0 ? `${findIndex + 1}/${findMatches.length}` : findQuery.trim() ? '0/0' : ''}
          </span>
          <IconButton icon={ChevronUp} label="上一个" onClick={findPrev} />
          <IconButton icon={ChevronDown} label="下一个" onClick={findNext} />
          <IconButton icon={X} label="关闭查找" onClick={() => setFindOpen(false)} />
        </div>
      )}

      {/* 页面 */}
      <div className="space-y-4 pt-4">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <div key={n} data-page={n} className="flex justify-center">
            <PdfPage
              pdfDoc={pdfDoc}
              pageNumber={n}
              zoom={zoom}
              annotations={annotationsByPage.get(n) ?? EMPTY_ANNS}
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
              findRects={findRectsByPage.get(n) ?? EMPTY_RECTS}
              findCurrent={currentFind?.page === n ? currentFind.rects : EMPTY_RECTS}
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

      <PageBadge
        documentId={documentId}
        currentPage={currentPage}
        pageCount={pageCount}
        bodyStart={bodyStartPage}
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
