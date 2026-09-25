'use client';

import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import AnnotationLayer from './AnnotationLayer';
import { useInView } from './useInView';
import type { Annotation, TextSelection, Tool } from './types';

const MAX_RENDER_SCALE = 4; // canvas 最高渲染倍率，兼顾清晰度与内存
const PLACEHOLDER_HEIGHT = 1100; // 页面尺寸未加载前的占位高度

interface TextItem {
  str: string;
  left: number;
  top: number;
  fontHeight: number;
  angle: number;
}

interface Props {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  annotations: Annotation[];
  tool: Tool;
  color: string;
  strokeSize: number;
  eraserSize: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (ann: Omit<Annotation, 'tags'>) => void;
  onErase: (id: string) => void;
  onEraseInk: (id: string, paths: [number, number][][]) => void;
  onEraseEnd: () => void;
  onSelectText: (sel: TextSelection | null) => void;
  onPageSize?: (size: { w: number; h: number }) => void;
  findRects?: { x: number; y: number; w: number; h: number }[];
  findCurrent?: { x: number; y: number; w: number; h: number }[];
}

/** 把选区产生的零碎 rect 按行合并为行矩形。 */
function mergeLineRects(rects: { x: number; y: number; w: number; h: number }[]) {
  if (rects.length === 0) return [];
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { x: number; y: number; w: number; h: number }[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const curCenter = cur.y + cur.h / 2;
    const rCenter = r.y + r.h / 2;
    if (Math.abs(rCenter - curCenter) <= Math.max(cur.h, r.h) * 0.6) {
      const right = Math.max(cur.x + cur.w, r.x + r.w);
      const bottom = Math.max(cur.y + cur.h, r.y + r.h);
      cur.x = Math.min(cur.x, r.x);
      cur.y = Math.min(cur.y, r.y);
      cur.w = right - cur.x;
      cur.h = bottom - cur.y;
    } else {
      lines.push(cur);
      cur = { ...r };
    }
  }
  lines.push(cur);
  return lines.filter((l) => l.w > 0.5 && l.h > 0.5);
}

export default function PdfPage(props: Props) {
  const {
    pdfDoc,
    pageNumber,
    zoom,
    annotations,
    tool,
    color,
    strokeSize,
    eraserSize,
    selectedId,
    onSelect,
    onAdd,
    onErase,
    onEraseInk,
    onEraseEnd,
    onSelectText,
    onPageSize,
    findRects = [],
    findCurrent = [],
  } = props;

  const [holderRef, inView] = useInView<HTMLDivElement>('1000px');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const renderedScaleRef = useRef<number | null>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [textItems, setTextItems] = useState<TextItem[]>([]);

  // 加载页面代理，获取 PDF 点尺寸
  useEffect(() => {
    let cancelled = false;
    pdfDoc.getPage(pageNumber).then((p) => {
      if (cancelled) {
        p.cleanup();
        return;
      }
      const vp = p.getViewport({ scale: 1 });
      pageRef.current = p;
      setSize({ w: vp.width, h: vp.height });
      if (pageNumber === 1) onPageSize?.({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
      pageRef.current?.cleanup();
      pageRef.current = null;
    };
  }, [pdfDoc, pageNumber, onPageSize]);

  // 加载文本层（PDF 点坐标，供「文本标注」工具选中）
  useEffect(() => {
    if (!size) return;
    const page = pageRef.current;
    if (!page) return;
    let cancelled = false;
    page
      .getTextContent()
      .then((tc) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        const items: TextItem[] = [];
        for (const item of tc.items) {
          if (!('str' in item)) continue;
          const str = item.str;
          if (!str || !str.trim()) continue;
          const tx = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          if (fontHeight <= 0) continue;
          items.push({
            str,
            left: tx[4],
            top: tx[5] - fontHeight,
            fontHeight,
            angle: Math.atan2(tx[1], tx[0]),
          });
        }
        setTextItems(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [size, pageNumber]);

  // 进入视口后渲染 canvas；缩放变化时按 zoom × devicePixelRatio 重渲染以保证清晰
  useEffect(() => {
    if (!inView || !size) return;
    const canvas = canvasRef.current;
    const page = pageRef.current;
    if (!canvas || !page) return;

    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(MAX_RENDER_SCALE, Math.max(1, zoom * dpr));
    if (renderedScaleRef.current === scale) return;

    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    taskRef.current?.cancel();
    renderedScaleRef.current = scale;
    const task = page.render({ canvasContext: ctx, viewport: vp });
    taskRef.current = task;
    task.promise.catch(() => {});
    return () => {
      task.cancel();
    };
  }, [inView, size, pageNumber, zoom]);

  // 远离视口后释放 canvas 内存
  useEffect(() => {
    if (inView || renderedScaleRef.current == null) return;
    taskRef.current?.cancel();
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    renderedScaleRef.current = null;
  }, [inView]);

  function onTextLayerMouseUp() {
    if (tool !== 'text') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      onSelectText(null);
      return;
    }
    const text = sel.toString();
    if (!text.trim()) {
      onSelectText(null);
      return;
    }
    const container = textLayerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const clientRects = Array.from(sel.getRangeAt(0).getClientRects());
    if (clientRects.length === 0) return;
    const rects = clientRects.map((r) => ({
      x: (r.left - cRect.left) / zoom,
      y: (r.top - cRect.top) / zoom,
      w: r.width / zoom,
      h: r.height / zoom,
    }));
    const merged = mergeLineRects(rects);
    if (merged.length === 0) {
      onSelectText(null);
      return;
    }
    const first = clientRects[0];
    onSelectText({
      page: pageNumber,
      text,
      rects: merged,
      clientX: first.left,
      clientY: first.top,
    });
  }

  const displayWidth = size ? size.w * zoom : undefined;
  const displayHeight = size ? size.h * zoom : undefined;

  return (
    <div
      ref={holderRef}
      className="relative mx-auto bg-white shadow"
      style={{ width: displayWidth, height: displayHeight ?? PLACEHOLDER_HEIGHT }}
    >
      {size ? (
        <>
          <canvas
            ref={canvasRef}
            className="block"
            style={{ width: displayWidth, height: displayHeight }}
          />
          {textItems.length > 0 && (
            <div
              ref={textLayerRef}
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: size.w,
                height: size.h,
                transform: `scale(${zoom})`,
                userSelect: tool === 'text' ? 'text' : 'none',
                pointerEvents: tool === 'text' ? 'auto' : 'none',
                cursor: tool === 'text' ? 'text' : undefined,
              }}
              onMouseUp={onTextLayerMouseUp}
            >
              {textItems.map((t, i) => (
                <span
                  key={i}
                  style={{
                    position: 'absolute',
                    left: t.left,
                    top: t.top,
                    fontSize: t.fontHeight,
                    lineHeight: 1,
                    whiteSpace: 'pre',
                    color: 'transparent',
                    transformOrigin: '0 0',
                    transform: t.angle !== 0 ? `rotate(${t.angle}rad)` : undefined,
                  }}
                >
                  {t.str}
                </span>
              ))}
            </div>
          )}
          {(findRects.length > 0 || findCurrent.length > 0) && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${size.w} ${size.h}`}
              preserveAspectRatio="none"
            >
              {findRects.map((r, i) => (
                <rect key={`f${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#fbbf24" opacity={0.35} />
              ))}
              {findCurrent.map((r, i) => (
                <rect
                  key={`c${i}`}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill="#f97316"
                  opacity={0.55}
                  stroke="#ea580c"
                  strokeWidth={1}
                />
              ))}
            </svg>
          )}
          <AnnotationLayer
            pageNumber={pageNumber}
            pageWidth={size.w}
            pageHeight={size.h}
            annotations={annotations}
            tool={tool}
            color={color}
            strokeSize={strokeSize}
            eraserSize={eraserSize}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAdd}
            onErase={onErase}
            onEraseInk={onEraseInk}
            onEraseEnd={onEraseEnd}
          />
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          加载第 {pageNumber} 页…
        </div>
      )}
    </div>
  );
}
