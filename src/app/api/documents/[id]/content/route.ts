import { NextResponse } from 'next/server';
import { getPreviewFile } from '@/lib/documents';
import { fileResponse } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const preview = getPreviewFile(Number(id));
  if (!preview) return NextResponse.json({ error: '无可用预览' }, { status: 404 });

  return fileResponse(preview.path, {
    'Content-Type': preview.mime_type || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
}
