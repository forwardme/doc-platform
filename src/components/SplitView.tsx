'use client';

import { useRef, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { useLocalStorage } from '@/lib/useLocalStorage';

function PaneHeader({ title, id }: { title: string; id: number }) {
  return (
    <div className="mb-1 flex items-center gap-2 px-1">
      <span className="min-w-0 truncate text-sm font-medium text-gray-700" title={title}>
        {title}
      </span>
      <Link href={`/viewer/${id}`} className="shrink-0 text-xs text-blue-600 hover:underline" title="单独打开">
        单独打开
      </Link>
    </div>
  );
}

export default function SplitView({
  left,
  right,
  leftTitle,
  rightTitle,
  leftId,
  rightId,
}: {
  left: ReactNode;
  right: ReactNode;
  leftTitle: string;
  rightTitle: string;
  leftId: number;
  rightId: number;
}) {
  const [leftWidth, setLeftWidth] = useLocalStorage('split-left-width', '50%');
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function onMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault();
    draggingRef.current = true;
    const move = (ev: globalThis.MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(`${Math.min(80, Math.max(20, pct))}%`);
    };
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <div ref={containerRef} className="flex h-[calc(100vh-9rem)] items-stretch gap-1">
      <div style={{ width: leftWidth }} className="flex min-w-0 flex-col">
        <PaneHeader title={leftTitle} id={leftId} />
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">{left}</div>
      </div>
      <div
        onMouseDown={onMouseDown}
        className="w-1 shrink-0 cursor-col-resize rounded bg-gray-200 hover:bg-blue-400"
        title="拖拽调整分屏宽度"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <PaneHeader title={rightTitle} id={rightId} />
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">{right}</div>
      </div>
    </div>
  );
}
