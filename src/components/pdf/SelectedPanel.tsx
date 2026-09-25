'use client';

import { useState } from 'react';
import type { Annotation } from './types';

const TYPE_LABEL: Record<Annotation['type'], string> = {
  ink: '✍️ 手写',
  highlight: '🖍 高亮',
  underline: '＿ 下划线',
  note: '📝 便签',
};

interface Props {
  annotation: Annotation | null;
  onClose: () => void;
  onChangeText: (text: string) => void;
  onChangeColor: (color: string) => void;
  onDelete: () => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
}

export default function SelectedPanel(props: Props) {
  const { annotation, onClose, onChangeText, onChangeColor, onDelete, onAddTag, onRemoveTag } = props;
  const [tagInput, setTagInput] = useState('');

  if (!annotation) return null;

  function submitTag() {
    const name = tagInput.trim();
    if (!name) return;
    onAddTag(name);
    setTagInput('');
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(92vw,640px)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">{TYPE_LABEL[annotation.type]}</span>
        <span className="text-xs text-gray-400">第 {annotation.page} 页</span>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>

      <label className="mb-1 block text-xs text-gray-500">
        {annotation.type === 'note' ? '便签内容' : '说明文字（可选）'}
      </label>
      <input
        value={annotation.text}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder={annotation.type === 'note' ? '输入笔记内容…' : '为这条批注添加说明…'}
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />

      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-gray-500">颜色</span>
        <input
          type="color"
          value={annotation.color}
          onChange={(e) => onChangeColor(e.target.value)}
          className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0"
        />
        <button onClick={onDelete} className="ml-auto rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
          删除批注
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500">标签</span>
        {annotation.tags.map((t) => (
          <span
            key={t.name}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
            style={{ backgroundColor: t.color + '22', color: t.color }}
          >
            {t.name}
            <button onClick={() => onRemoveTag(t.name)} className="hover:opacity-70">
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
          placeholder="+ 新标签"
          className="w-24 rounded-full border border-gray-200 px-2.5 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
        />
        {tagInput.trim() && (
          <button onClick={submitTag} className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs text-white hover:bg-blue-700">
            添加
          </button>
        )}
      </div>
    </div>
  );
}
