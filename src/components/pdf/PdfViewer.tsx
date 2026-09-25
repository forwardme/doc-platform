'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import PdfPage from './PdfPage';
import SelectedPanel from './SelectedPanel';
import SelectionToolbar from './SelectionToolbar';
import type { Annotation, TextSelection, Tool, Tag } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

const TOOLS: { key: Tool; label: string; icon: string }[] = [
  { key: 'select', label: '选择', icon: '🖱' },
  { key: 'ink', label: '手写', icon: '✍️' },
  { key: 'text', label: '文本', icon: '🖍' },
  { key: 'note', label: '便签', icon: '📝' },
  { key: 'eraser', label: '橡皮', icon: '🧹' },
];

const PRESET_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#111827'];
const NEW_TAG_COLOR = '#3b82f6';
const clampZoom = (z: number) => Math.min(4, Math.max(0.25, z));

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
      {/* 工具栏 */}
      <div className="print:hidden sticky top-14 z-30 mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            title={t.label}
            className={`rounded-md px-2.5 py-1.5 text-sm ${
              tool === t.key ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}

        <span className="mx-1 h-6 w-px bg-gray-200" />
        <div className="flex items-center gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="h-6 w-6 rounded-full border border-gray-300"
              style={{ backgroundColor: c, outline: color === c ? '2px solid #2563eb' : 'none', outlineOffset: 1 }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="ml-1 h-7 w-8 cursor-pointer border-0 bg-transparent p-0"
          />
        </div>

        <span className="mx-1 h-6 w-px bg-gray-200" />
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span>线宽</span>
          <input
            type="range"
            min={1}
            max={8}
            value={strokeSize}
            onChange={(e) => setStrokeSize(Number(e.target.value))}
            className="w-20"
          />
        </div>

        {tool === 'eraser' && (
          <>
            <span className="mx-1 h-6 w-px bg-gray-200" />
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <span>橡皮大小</span>
              <input
                type="range"
                min={6}
                max={32}
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
                className="w-20"
              />
            </div>
          </>
        )}

        <span className="mx-1 h-6 w-px bg-gray-200" />
        <div className="flex items-center gap-1 text-sm">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="rounded px-2 py-1 hover:bg-gray-100">
            −
          </button>
          <span className="w-12 text-center text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} className="rounded px-2 py-1 hover:bg-gray-100">
            ＋
          </button>
        </div>

        <span className="mx-1 h-6 w-px bg-gray-200" />
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <button onClick={fitWidth} title="适配页面宽度" className="rounded px-2 py-1 hover:bg-gray-100">
            适配宽度
          </button>
          <button onClick={fitPage} title="适配页面长度" className="rounded px-2 py-1 hover:bg-gray-100">
            适配页面
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={undo} className="rounded-md px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            ↺ 撤销
          </button>
          <span className={`text-xs ${saving === 'saving' ? 'text-amber-500' : 'text-green-600'}`}>
            {saving === 'saving' ? '保存中…' : '已保存'}
          </span>
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
