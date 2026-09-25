'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  /** 文本基线的 y 坐标（scale-1），用于按字体 ascent 校准盒子上沿 */
  baseline: number;
  /** PDF 字体宽度表给出的精确前进宽度（scale-1 单位），用于校准 span 渲染宽度 */
  width: number;
  fontHeight: number;
  angle: number;
}

// —— 字体 ascent 测量（与 pdf.js 文本层同一思路）——
// span 渲染用的是浏览器替代字体，其 ascent 比例决定盒子上沿应距基线多远。
// 用 actualBoundingBoxAscent 量真实字形高度，按 fontFamily 缓存。
const ascentRatioCache = new Map<string, number>();
let ascentMeasureCtx: CanvasRenderingContext2D | null = null;

function getAscentRatio(fontFamily: string): number {
  const cached = ascentRatioCache.get(fontFamily);
  if (cached != null) return cached;
  let ratio = 0.8; // 典型拉丁字体经验值，作为测量失败时的回退
  try {
    ascentMeasureCtx ??= document.createElement('canvas').getContext('2d');
    if (ascentMeasureCtx) {
      ascentMeasureCtx.font = `100px ${fontFamily}`;
      const m = ascentMeasureCtx.measureText('国gÉ');
      if (m.actualBoundingBoxAscent) {
        ratio = Math.min(1.2, Math.max(0.5, m.actualBoundingBoxAscent / 100));
      }
    }
  } catch {
    /* 测量失败用回退值 */
  }
  ascentRatioCache.set(fontFamily, ratio);
  return ratio;
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

export default memo(function PdfPage(props: Props) {
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
      // 基准页：封面（第 1 页）常与正文尺寸不同，多页文档以第 2 页为准
      const refPage = pdfDoc.numPages > 1 ? 2 : 1;
      if (pageNumber === refPage) onPageSize?.({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
      pageRef.current?.cleanup();
      pageRef.current = null;
    };
  }, [pdfDoc, pageNumber, onPageSize]);

  // 加载文本层（PDF 点坐标，供「文本标注」工具选中）：
  // 惰性——进入视口才提取，避免打开文档时对全部页跑 getTextContent
  useEffect(() => {
    if (!size || !inView) return;
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
            baseline: tx[5],
            width: item.width,
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
  }, [size, pageNumber, inView]);

  // 字体对齐校准：浏览器用替代字体渲染 span，字形宽度与 PDF 字体不同，
  // 偏差在 span 内逐字符累积（行尾偏得最多）。这里按 item.width（PDF 字体
  // 宽度表的真值宽度）把每个 span 拉伸/压缩到精确宽度——起点钉死在 left，
  // 终点钉死在 left+width，span 内部用什么字体都不影响对齐。
  useLayoutEffect(() => {
    const container = textLayerRef.current;
    if (!container || textItems.length === 0) return;
    const spans = container.children;
    const n = Math.min(textItems.length, spans.length);
    // 先清掉上次写入的 scaleX：getBoundingClientRect 会包含已有 transform，
    // 不清除会在 zoom 变化重测时把旧校准值重复计入
    for (let i = 0; i < n; i++) {
      (spans[i] as HTMLElement).style.transform = '';
    }
    // 集中读再集中写，避免读写交错造成布局抖动
    const scales: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = textItems[i];
      // 旋转文本的 getBoundingClientRect 是包围盒而非行进方向长度，跳过
      if (t.width <= 0 || Math.abs(t.angle) > 1e-6) {
        scales.push(1);
        continue;
      }
      const measured = (spans[i] as HTMLElement).getBoundingClientRect().width / zoom;
      scales.push(measured > 0 ? t.width / measured : 1);
    }
    for (let i = 0; i < n; i++) {
      const s = scales[i];
      if (Math.abs(s - 1) <= 0.005) continue;
      (spans[i] as HTMLElement).style.transform = `scaleX(${s.toFixed(4)})`;
    }
    // 竖向校准：span 初始 top = 基线 − fontHeight，比真实字形顶部高出
    // (1−ascent)×fontHeight（典型 ~0.2em），导致选区矩形偏高、底边压在基线上，
    // 下划线因此横穿文字底部。按实际字体的 ascent 比例把盒子上沿降到
    // 「基线 − ascent」，盒子下沿随之变为「基线 + (1−ascent)」，正好包裹字形。
    const first = spans[0] as HTMLElement | undefined;
    if (first) {
      const ratio = getAscentRatio(getComputedStyle(first).fontFamily);
      for (let i = 0; i < n; i++) {
        const t = textItems[i];
        if (Math.abs(t.angle) > 1e-6) continue;
        (spans[i] as HTMLElement).style.top = `${t.baseline - t.fontHeight * ratio}px`;
      }
    }
  }, [textItems, zoom]);

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
          {inView && textItems.length > 0 && (
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
                    // 用独立 rotate 属性：它先于 transform 应用，
                    // 校准 effect 写入的 scaleX 因此始终沿文本本地方向
                    rotate: t.angle !== 0 ? `${t.angle}rad` : undefined,
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
});
