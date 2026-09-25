'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Tag {
  id: number;
  name: string;
  color: string;
}
interface TaggedAnnotation {
  id: string;
  documentId: number;
  documentTitle: string;
  documentExtension: string;
  page: number;
  type: string;
  text: string;
  color: string;
}
interface TagGroup {
  tag: Tag;
  annotations: TaggedAnnotation[];
}

const TYPE_LABEL: Record<string, string> = { ink: '✍️ 手写', highlight: '🖍 高亮', note: '📝 便签' };

export default function TagIndex() {
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tags')
      .then((r) => r.json())
      .then((d) => setGroups(d.groups ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="py-20 text-center text-sm text-gray-400">加载中…</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 py-20 text-center text-sm text-gray-400">
        还没有标签。打开一个文档，选中批注后给它打上标签，就会汇总到这里。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">标签索引</h1>
        <p className="text-sm text-gray-500">跨文档汇总所有被标注并打标签的内容</p>
      </div>

      {groups.map((g) => (
        <div key={g.tag.id} className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: g.tag.color }} />
            <span className="font-medium">{g.tag.name}</span>
            <span className="text-xs text-gray-400">({g.annotations.length})</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {g.annotations.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/viewer/${a.documentId}?ann=${a.id}`}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50"
                >
                  <span className="mt-0.5 shrink-0">{TYPE_LABEL[a.type] ?? a.type}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-800">
                      {a.text || <span className="italic text-gray-400">（无文字）</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-400">
                      {a.documentTitle} · 第 {a.page} 页
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
