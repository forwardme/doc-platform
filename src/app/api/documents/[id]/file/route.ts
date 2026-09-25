import { NextResponse } from 'next/server';
import { getOriginalFile } from '@/lib/documents';
import { fileResponse } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const f = getOriginalFile(Number(id));
  if (!f) return NextResponse.json({ error: '文件不存在' }, { status: 404 });

  const encodedName = encodeURIComponent(f.name);
  return fileResponse(f.path, {
    'Content-Type': f.mime_type || 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
  });
}
