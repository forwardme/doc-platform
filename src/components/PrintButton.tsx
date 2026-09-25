'use client';

import { Printer } from 'lucide-react';

export default function PrintButton({
  className,
  withLabel = false,
}: {
  className?: string;
  withLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title="打印"
      aria-label="打印"
      className={
        className ??
        'rounded-md bg-gray-50 p-1.5 text-gray-600 hover:bg-gray-100'
      }
    >
      {withLabel ? (
        <span className="inline-flex items-center gap-1.5 px-1 text-sm">
          <Printer size={16} />
          打印
        </span>
      ) : (
        <Printer size={16} />
      )}
    </button>
  );
}
