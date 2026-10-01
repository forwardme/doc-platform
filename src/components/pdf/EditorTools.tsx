'use client';

import { useState } from 'react';
import type { Tag } from './types';

export const PRESET_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#111827'];

interface Props {
  color: string;
  tags: Tag[];
  onChangeColor: (color: string) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
}

/** 批注编辑共用的「颜色 + 标签」工具条，便签卡与文本批注编辑框统一使用。 */
export default function EditorTools({ color, tags, onChangeColor, onAddTag, onRemoveTag }: Props) {
  const [tagInput, setTagInput] = useState('');

  function submitTag() {
    const name = tagInput.trim();
    if (!name) return;
    onAddTag(name);
    setTagInput('');
  }

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-gray-100 px-2 py-1">
      <div className="flex items-center gap-1">
        <span className="text-gray-400" style={{ fontSize: 10 }}>
          颜色
        </span>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChangeColor(c)}
            className="h-3 w-3 rounded-full border border-gray-300"
            style={{ backgroundColor: c, outline: color === c ? '1.5px solid #2563eb' : 'none', outlineOffset: 1 }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => onChangeColor(e.target.value)}
          title="自定义颜色"
          className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((t) => (
          <span
            key={t.name}
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
            style={{ backgroundColor: t.color + '22', color: t.color, fontSize: 10 }}
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
  );
}
