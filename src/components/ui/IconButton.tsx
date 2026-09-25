'use client';

import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  label: string;
  description?: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  iconSize?: number;
  /** 提示气泡位置（相对按钮）。默认在按钮下方。 */
  tooltipPosition?: 'top' | 'bottom';
}

/** 纯图标按钮：悬停/聚焦时显示「名称 + 简介」气泡，同时保留原生 title（移动端长按可用）。 */
export default function IconButton({
  icon: Icon,
  label,
  description,
  active,
  onClick,
  className = '',
  iconSize = 16,
  tooltipPosition = 'bottom',
}: Props) {
  const pos =
    tooltipPosition === 'top'
      ? 'bottom-full mb-1'
      : 'top-full mt-1';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={description ? `${label} — ${description}` : label}
      className={`group relative rounded-md p-1.5 text-gray-600 transition hover:bg-gray-100 ${
        active ? 'bg-blue-100 text-blue-700' : ''
      } ${className}`}
    >
      <Icon size={iconSize} />
      <span
        className={`pointer-events-none absolute left-1/2 ${pos} z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100`}
      >
        {description ? (
          <>
            <span className="block font-medium">{label}</span>
            <span className="block text-gray-300">{description}</span>
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
}
