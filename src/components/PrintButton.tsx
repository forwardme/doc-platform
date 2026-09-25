'use client';

export default function PrintButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={
        className ??
        'rounded-md bg-gray-50 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100'
      }
    >
      🖨 打印
    </button>
  );
}
