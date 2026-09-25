'use client';

import type { TextSelection } from './types';

interface Props {
  selection: TextSelection;
  color: string;
  onApply: (type: 'highlight' | 'underline') => void;
  onCancel: () => void;
}

/** 选区浮动工具条：在选中文本旁显示「重点 / 下划线 / 取消」。 */
export default function SelectionToolbar({ selection, color, onApply, onCancel }: Props) {
  return (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
      style={{ left: selection.clientX, top: Math.max(8, selection.clientY - 48) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        onClick={() => onApply('highlight')}
        className="rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        title="标注重点（高亮）"
      >
        <span className="mr-1">🖍</span>重点
      </button>
      <button
        onClick={() => onApply('underline')}
        className="rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        title="添加下划线"
      >
        <span className="mr-1">＿</span>下划线
      </button>
      <span className="mx-0.5 h-5 w-px bg-gray-200" />
      <button onClick={onCancel} className="rounded-md px-2.5 py-1.5 text-sm text-gray-500 hover:bg-gray-100" title="取消">
        ✕
      </button>
      <span
        className="mx-1 inline-block h-4 w-4 rounded-full border border-gray-300"
        style={{ backgroundColor: color }}
        title="当前颜色"
      />
    </div>
  );
}
