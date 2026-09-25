'use client';

import { useEffect } from 'react';

/** 打开文档时记录「最近打开」时间戳（fire-and-forget），并通知侧边栏刷新。 */
export default function RecordOpen({ id }: { id: number }) {
  useEffect(() => {
    fetch(`/api/documents/${id}/open`, { method: 'POST' }).catch(() => {});
    window.dispatchEvent(new Event('pdfsite:changed'));
  }, [id]);

  return null;
}
