import { Suspense } from 'react';
import DocumentList from '@/components/DocumentList';

export default function HomePage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-gray-400">加载中…</div>}>
      <DocumentList />
    </Suspense>
  );
}
