'use client';

import { useRef, useState } from 'react';
import { Check, Pin, StickyNote, Trash2 } from 'lucide-react';
import type { Annotation, AnnotationData, Tool } from './types';

const DEFAULT_W = 180;
const DEFAULT_H = 110;
const MIN_W = 80;
const MIN_H = 48;
// 缩放手柄的屏幕像素尺寸：反除 zoom，使手柄在任意缩放下保持恒定大小
const HANDLE = 14;
// 收缩后的符号标记直径（PDF 点），与旧便签圆点一致
const MARKER = 14;

const PRESET_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#111827'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  notes: Annotation[];
  selectedId: string | null;
  zoom: number;
  pageWidth: number;
  pageHeight: number;
  tool: Tool;
  onSelect: (id: string | null) => void;
  onChangeText: (id: string, text: string) => void;
  onChangeData: (id: string, data: AnnotationData) => void;
  onChangeColor: (id: string, color: string) => void;
  onAddTag: (id: string, name: string) => void;
  onRemoveTag: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 便签层：在 PDF 页面上以 HTML 卡片渲染便签。
 * 容器沿用文本层做法——absolute + transform: scale(zoom)，内部坐标均为 PDF 点，
 * 因此便签随缩放/页面大小自适应，且天然约束在页面矩形内、不会被侧栏遮挡。
 * 便签三种形态：编辑卡（选中，可输入/改色/打标签/删除/移动/缩放）、
 * 固定展开卡（pinned 且未选中，只读显示）、收缩符号标记（未固定且未选中）。
 */
export default function NoteLayer(props: Props) {
  const {
    notes,
    selectedId,
    zoom,
    pageWidth,
    pageHeight,
    tool,
    onSelect,
    onChangeText,
    onChangeData,
    onChangeColor,
    onAddTag,
    onRemoveTag,
    onDelete,
  } = props;
  const textMode = tool === 'text';

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 origin-top-left"
      style={{ width: pageWidth, height: pageHeight, transform: `scale(${zoom})`, pointerEvents: textMode ? 'none' : undefined }}
    >
      {notes.map((a) => (
        <NoteCard
          key={a.id}
          a={a}
          selected={a.id === selectedId}
          zoom={zoom}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          tool={tool}
          onSelect={onSelect}
          onChangeText={onChangeText}
          onChangeData={onChangeData}
          onChangeColor={onChangeColor}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

interface CardProps {
  a: Annotation;
  selected: boolean;
  zoom: number;
  pageWidth: number;
  pageHeight: number;
  tool: Tool;
  onSelect: (id: string | null) => void;
  onChangeText: (id: string, text: string) => void;
  onChangeData: (id: string, data: AnnotationData) => void;
  onChangeColor: (id: string, color: string) => void;
  onAddTag: (id: string, name: string) => void;
  onRemoveTag: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

interface Drag {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  moved: boolean;
}
interface Resize {
  sx: number;
  sy: number;
  ow: number;
  oh: number;
}

function NoteCard({
  a,
  selected,
  zoom,
  pageWidth,
  pageHeight,
  tool,
  onSelect,
  onChangeText,
  onChangeData,
  onChangeColor,
  onAddTag,
  onRemoveTag,
  onDelete,
}: CardProps) {
  const x = a.data.x ?? 0;
  const y = a.data.y ?? 0;
  const w = a.data.w ?? DEFAULT_W;
  const h = a.data.h ?? DEFAULT_H;
  const pinned = a.data.pinned === true;
  const textMode = tool === 'text';
  const eraserMode = tool === 'eraser';
  const expanded = selected || pinned;
  const dragRef = useRef<Drag | null>(null);
  const resizeRef = useRef<Resize | null>(null);
  const [tagInput, setTagInput] = useState('');

  function submitTag() {
    const name = tagInput.trim();
    if (!name) return;
    onAddTag(a.id, name);
    setTagInput('');
  }

  function onDown(e: React.PointerEvent) {
    if (textMode) return;
    if (eraserMode) {
      onDelete(a.id);
      return;
    }
    if (!expanded) {
      onSelect(a.id);
      return;
    }
    // 点击控件（按钮/输入框/缩放柄）不启动拖动
    if ((e.target as HTMLElement).closest('button, textarea, input, [data-resize]')) return;
    e.stopPropagation();
    onSelect(a.id);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (!d.moved) return;
    onChangeData(a.id, {
      ...a.data,
      x: clamp(d.ox + dx / zoom, 0, pageWidth - w),
      y: clamp(d.oy + dy / zoom, 0, pageHeight - h),
    });
  }

  function onUp() {
    dragRef.current = null;
  }

  function onResizeDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: w, oh: h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: React.PointerEvent) {
    const d = resizeRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    onChangeData(a.id, {
      ...a.data,
      w: clamp(d.ow + dx / zoom, MIN_W, pageWidth - x),
      h: clamp(d.oh + dy / zoom, MIN_H, pageHeight - y),
    });
  }

  function onResizeUp() {
    resizeRef.current = null;
  }

  // —— 收缩为符号标记 ——
  if (!expanded) {
    return (
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: x,
          top: y,
          width: MARKER,
          height: MARKER,
          pointerEvents: textMode ? 'none' : 'auto',
          cursor: eraserMode ? 'none' : 'pointer',
        }}
        onPointerDown={onDown}
      >
        <div className="flex h-full w-full items-center justify-center rounded-full border-2 border-white shadow" style={{ backgroundColor: a.color }}>
          <StickyNote size={9} color="#fff" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute"
      style={{ left: x, top: y, width: w, height: h, pointerEvents: textMode ? 'none' : 'auto', cursor: eraserMode ? 'none' : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-md bg-white shadow"
        style={{ border: selected ? '1.5px dashed #2563eb' : `1px solid ${a.color}` }}
      >
        {/* 头部：拖动柄 + 便签标识 + 固定/删除/完成 */}
        <div className="flex shrink-0 cursor-move items-center gap-1 px-2 py-0.5" style={{ backgroundColor: a.color + '22' }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
          <span className="flex-1 truncate text-gray-400" style={{ fontSize: 10 }}>
            便签
          </span>
          <button
            title={pinned ? '取消固定（自动收缩为标记）' : '固定（保持展开）'}
            onClick={() => onChangeData(a.id, { ...a.data, pinned: !pinned })}
            className="rounded p-0.5 text-gray-500 hover:bg-black/10"
            style={{ color: pinned ? '#2563eb' : undefined }}
          >
            <Pin size={11} fill={pinned ? 'currentColor' : 'none'} />
          </button>
          <button title="删除便签" onClick={() => onDelete(a.id)} className="rounded p-0.5 text-gray-500 hover:bg-black/10">
            <Trash2 size={11} />
          </button>
          <button title="完成" onClick={() => onSelect(null)} className="rounded p-0.5 text-gray-500 hover:bg-black/10">
            <Check size={11} />
          </button>
        </div>

        {/* 正文：选中时行内编辑，未选中（固定）时只读 */}
        {selected ? (
          <textarea
            autoFocus
            value={a.text}
            onChange={(e) => onChangeText(a.id, e.target.value)}
            placeholder="输入便签内容…"
            className="w-full flex-1 resize-none border-0 bg-transparent p-2 text-gray-800 focus:outline-none"
            style={{ fontSize: 12, lineHeight: 1.4, cursor: 'text' }}
          />
        ) : (
          <div className="flex-1 overflow-hidden whitespace-pre-wrap break-words p-2 text-gray-800" style={{ fontSize: 12, lineHeight: 1.4 }}>
            {a.text || <span className="text-gray-400">（无文字）</span>}
          </div>
        )}

        {/* 底部工具条：颜色 + 标签（仅编辑时显示） */}
        {selected && (
          <div className="flex shrink-0 flex-col gap-1 border-t border-gray-100 px-2 py-1">
            <div className="flex items-center gap-1">
              <span className="text-gray-400" style={{ fontSize: 10 }}>
                颜色
              </span>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onChangeColor(a.id, c)}
                  className="h-3 w-3 rounded-full border border-gray-300"
                  style={{ backgroundColor: c, outline: a.color === c ? '1.5px solid #2563eb' : 'none', outlineOffset: 1 }}
                />
              ))}
              <input
                type="color"
                value={a.color}
                onChange={(e) => onChangeColor(a.id, e.target.value)}
                title="自定义颜色"
                className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {a.tags.map((t) => (
                <span
                  key={t.name}
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
                  style={{ backgroundColor: t.color + '22', color: t.color, fontSize: 10 }}
                >
                  {t.name}
                  <button onClick={() => onRemoveTag(a.id, t.name)} className="hover:opacity-70">
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitTag();
                }}
                placeholder="+标签"
                className="w-12 rounded-full border border-gray-200 px-1.5 py-0.5 text-gray-700 focus:border-blue-500 focus:outline-none"
                style={{ fontSize: 10 }}
              />
              {tagInput.trim() && (
                <button onClick={submitTag} className="rounded-full bg-blue-600 px-1.5 py-0.5 text-white" style={{ fontSize: 10 }}>
                  添加
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {selected && !textMode && (
        <div
          data-resize
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          className="absolute rounded-sm border border-gray-400 bg-white"
          style={{
            right: -HANDLE / zoom / 2,
            bottom: -HANDLE / zoom / 2,
            width: HANDLE / zoom,
            height: HANDLE / zoom,
            cursor: 'nwse-resize',
          }}
        />
      )}
    </div>
  );
}
