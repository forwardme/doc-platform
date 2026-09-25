'use client';

import { useRef, useState } from 'react';
import { getStroke } from 'perfect-freehand';
import { getSvgPathFromStroke } from './getSvgPathFromStroke';
import type { Annotation, Tool } from './types';

interface Props {
  pageNumber: number;
  pageWidth: number; // PDF 点（1pt = 1/72 inch）
  pageHeight: number;
  annotations: Annotation[];
  tool: Tool;
  color: string;
  strokeSize: number;
  eraserSize: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (ann: Omit<Annotation, 'tags'>) => void;
  onErase: (id: string) => void; // 整条删除（高亮/下划线/便签）
  onEraseInk: (id: string, paths: [number, number][][]) => void; // 部分擦除（手写）
  onEraseEnd: () => void; // 擦除拖动结束，提交
}

function inkPath(points: [number, number][], size: number): string {
  const stroke = getStroke(points, {
    size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
  });
  return getSvgPathFromStroke(stroke);
}

function inkPaths(a: Annotation): [number, number][][] {
  const p = a.data.paths;
  if (Array.isArray(p) && p.length > 0) return p as [number, number][][];
  const pts = a.data.points;
  return pts && pts.length > 0 ? [pts as [number, number][]] : [];
}

function rectsOf(a: Annotation): { x: number; y: number; w: number; h: number }[] {
  const r = a.data.rects;
  if (Array.isArray(r) && r.length > 0) return r as { x: number; y: number; w: number; h: number }[];
  return a.data.rect ? [a.data.rect as { x: number; y: number; w: number; h: number }] : [];
}

/** 移除落在方形擦除区内的点，并将剩余点按「连续段」切分为多段。 */
function erasePoints(paths: [number, number][][], cx: number, cy: number, half: number): [number, number][][] {
  const result: [number, number][][] = [];
  for (const path of paths) {
    let current: [number, number][] = [];
    for (const p of path) {
      const inside = Math.abs(p[0] - cx) <= half && Math.abs(p[1] - cy) <= half;
      if (inside) {
        if (current.length >= 2) result.push(current);
        current = [];
      } else {
        current.push(p);
      }
    }
    if (current.length >= 2) result.push(current);
  }
  return result;
}

type Draft = { kind: 'ink'; points: [number, number][] };

export default function AnnotationLayer(props: Props) {
  const {
    pageNumber,
    pageWidth,
    pageHeight,
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
  } = props;

  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [erasePos, setErasePos] = useState<[number, number] | null>(null);
  const erasingRef = useRef(false);

  const textMode = tool === 'text';
  const eraserMode = tool === 'eraser';
  const half = eraserSize / 2;

  function toPoint(e: React.PointerEvent): [number, number] {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * pageWidth,
      ((e.clientY - rect.top) / rect.height) * pageHeight,
    ];
  }

  function eraseAt(x: number, y: number) {
    for (const a of annotations) {
      if (a.type !== 'ink') continue;
      const before = inkPaths(a);
      const after = erasePoints(before, x, y, half);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        onEraseInk(a.id, after);
      }
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (textMode) return;
    const [x, y] = toPoint(e);
    if (eraserMode) {
      erasingRef.current = true;
      setErasePos([x, y]);
      svgRef.current?.setPointerCapture(e.pointerId);
      eraseAt(x, y);
      return;
    }
    if (tool === 'select') return;
    svgRef.current?.setPointerCapture(e.pointerId);
    if (tool === 'ink') {
      setDraft({ kind: 'ink', points: [[x, y]] });
    } else if (tool === 'note') {
      const id = crypto.randomUUID();
      onAdd({ id, page: pageNumber, type: 'note', data: { x, y }, text: '', color });
      onSelect(id);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (textMode) return;
    const [x, y] = toPoint(e);
    if (eraserMode) {
      setErasePos([x, y]);
      if (erasingRef.current) eraseAt(x, y);
      return;
    }
    if (!draft) return;
    if (draft.kind === 'ink') {
      setDraft({ kind: 'ink', points: [...draft.points, [x, y]] });
    }
  }

  function onPointerUp() {
    if (eraserMode) {
      erasingRef.current = false;
      setErasePos(null);
      onEraseEnd();
      return;
    }
    if (!draft) return;
    if (draft.kind === 'ink' && draft.points.length > 1) {
      onAdd({
        id: crypto.randomUUID(),
        page: pageNumber,
        type: 'ink',
        data: { paths: [draft.points], size: strokeSize },
        text: '',
        color,
      });
    }
    setDraft(null);
  }

  function handleClick(a: Annotation, e: React.MouseEvent) {
    e.stopPropagation();
    if (eraserMode) {
      if (a.type !== 'ink') onErase(a.id);
      return;
    }
    onSelect(a.id);
  }

  const hitCursor = eraserMode ? 'none' : 'pointer';

  return (
    <svg
      ref={svgRef}
      className="annotation-layer absolute inset-0 h-full w-full"
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      style={{ pointerEvents: textMode ? 'none' : 'auto', cursor: eraserMode ? 'none' : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        erasingRef.current = false;
        setErasePos(null);
        setDraft(null);
      }}
      onClick={() => {
        if (tool === 'select') onSelect(null);
      }}
    >
      {annotations.map((a) => {
        const selected = a.id === selectedId;

        if (a.type === 'ink') {
          const paths = inkPaths(a);
          const size = a.data.size || 3;
          return (
            <g key={a.id}>
              {paths.map((pts, pi) => {
                if (pts.length < 2) return null;
                const d = inkPath(pts, size);
                return (
                  <g key={pi}>
                    <path d={d} fill={a.color} stroke={a.color} strokeWidth={0.4} strokeLinejoin="round" strokeLinecap="round" />
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(size, 14)}
                      style={{ cursor: hitCursor }}
                      onClick={(e) => handleClick(a, e)}
                    />
                    {selected && (
                      <path d={d} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none" />
                    )}
                  </g>
                );
              })}
            </g>
          );
        }

        if (a.type === 'highlight') {
          const rects = rectsOf(a);
          return (
            <g key={a.id}>
              {rects.map((r, i) => (
                <g key={i}>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={a.color} opacity={0.32} />
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" style={{ cursor: hitCursor, pointerEvents: 'all' }} onClick={(e) => handleClick(a, e)} />
                  {selected && (
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none" />
                  )}
                </g>
              ))}
            </g>
          );
        }

        if (a.type === 'underline') {
          const rects = rectsOf(a);
          return (
            <g key={a.id}>
              {rects.map((r, i) => {
                const y = r.y + r.h - 2;
                return (
                  <g key={i}>
                    <rect x={r.x} y={y} width={r.w} height={2} fill={a.color} />
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" style={{ cursor: hitCursor, pointerEvents: 'all' }} onClick={(e) => handleClick(a, e)} />
                    {selected && (
                      <rect x={r.x} y={y} width={r.w} height={2} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none" />
                    )}
                  </g>
                );
              })}
            </g>
          );
        }

        // note
        const x = a.data.x ?? 0;
        const y = a.data.y ?? 0;
        return (
          <g key={a.id}>
            <circle cx={x} cy={y} r={7} fill={a.color} stroke="#fff" strokeWidth={1.5} style={{ cursor: hitCursor }} onClick={(e) => handleClick(a, e)} />
            {a.text ? (
              <text x={x + 12} y={y + 4} fontSize={11} fill="#1f2937" pointerEvents="none">
                {a.text.length > 40 ? a.text.slice(0, 40) + '…' : a.text}
              </text>
            ) : null}
            {selected && <circle cx={x} cy={y} r={11} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 4" />}
          </g>
        );
      })}

      {draft?.kind === 'ink' && draft.points.length > 1 && (
        <path
          d={inkPath(draft.points, strokeSize)}
          fill={color}
          stroke={color}
          strokeWidth={0.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      {eraserMode && erasePos && (
        <rect
          x={erasePos[0] - half}
          y={erasePos[1] - half}
          width={eraserSize}
          height={eraserSize}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
