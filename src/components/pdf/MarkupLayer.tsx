'use client';

import { Check, Trash2 } from 'lucide-react';
import type { Annotation, Tool } from './types';
import EditorTools from './EditorTools';

const CARD_W = 224;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const TYPE_LABEL: Record<string, string> = {
  highlight: '🖍 高亮',
  underline: '＿ 下划线',
};

interface Props {
  annotation: Annotation | null;
  zoom: number;
  pageWidth: number;
  pageHeight: number;
  tool: Tool;
  onClose: () => void;
  onChangeText: (id: string, text: string) => void;
  onChangeColor: (id: string, color: string) => void;
  onAddTag: (id: string, name: string) => void;
  onRemoveTag: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 文本批注（高亮/下划线）行内编辑层：替代原来的底部 SelectedPanel。
 * 与便签层同款做法——absolute + transform: scale(zoom)，坐标用 PDF 点，
 * 编辑框挂在选中批注的选择框上方（靠页顶时翻到下方），随缩放/滚动自适应，
 * 不会超出页面边框或被侧栏遮挡。颜色/标签 UI 与便签卡共用 EditorTools。
 */
export default function MarkupLayer(props: Props) {
  const {
    annotation,
    zoom,
    pageWidth,
    pageHeight,
    tool,
    onClose,
    onChangeText,
    onChangeColor,
    onAddTag,
    onRemoveTag,
    onDelete,
  } = props;

  if (!annotation) return null;
  // 文本选择与橡皮模式下隐藏编辑框：让位给文本选取 / 删除交互
  if (tool === 'text' || tool === 'eraser') return null;

  const rects =
    Array.isArray(annotation.data.rects) && annotation.data.rects.length > 0
      ? annotation.data.rects
      : annotation.data.rect
        ? [annotation.data.rect]
        : [];
  const first = rects[0] ?? { x: 0, y: 0, w: 0, h: 0 };
  const left = clamp(first.x, 0, pageWidth - CARD_W);
  const above = first.y >= 120; // 上方空间足够时挂上方，否则翻到批注下方

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 origin-top-left"
      style={{ width: pageWidth, height: pageHeight, transform: `scale(${zoom})` }}
    >
      <div
        className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-md bg-white shadow-lg"
        style={{ left, width: CARD_W, ...(above ? { bottom: pageHeight - first.y + 6 } : { top: first.y + first.h + 6 }) }}
      >
        {/* 头部：类型标识 + 删除 / 完成 */}
        <div className="flex shrink-0 items-center gap-1 px-2 py-0.5" style={{ backgroundColor: annotation.color + '22' }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: annotation.color }} />
          <span className="flex-1 truncate text-gray-500" style={{ fontSize: 10 }}>
            {TYPE_LABEL[annotation.type] ?? annotation.type}
          </span>
          <button title="删除批注" onClick={() => onDelete(annotation.id)} className="rounded p-0.5 text-gray-500 hover:bg-black/10">
            <Trash2 size={11} />
          </button>
          <button title="完成" onClick={onClose} className="rounded p-0.5 text-gray-500 hover:bg-black/10">
            <Check size={11} />
          </button>
        </div>

        {/* 说明文字（选中文本，可继续编辑） */}
        <textarea
          value={annotation.text}
          onChange={(e) => onChangeText(annotation.id, e.target.value)}
          placeholder="为这条批注添加说明…"
          rows={2}
          className="w-full resize-none border-0 bg-transparent p-2 text-gray-800 focus:outline-none"
          style={{ fontSize: 12, lineHeight: 1.4, cursor: 'text' }}
        />

        {/* 颜色 + 标签（与便签卡统一） */}
        <EditorTools
          color={annotation.color}
          tags={annotation.tags}
          onChangeColor={(c) => onChangeColor(annotation.id, c)}
          onAddTag={(n) => onAddTag(annotation.id, n)}
          onRemoveTag={(n) => onRemoveTag(annotation.id, n)}
        />
      </div>
    </div>
  );
}
