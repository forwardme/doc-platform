import fs from 'fs';
import { NextResponse } from 'next/server';
import { getDocument } from '@/lib/documents';
import { ensureThumbnail } from '@/lib/thumbnail';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const docId = Number(id);
  const doc = getDocument(docId);
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const thumb = await ensureThumbnail(docId);
  if (!thumb) return new NextResponse('No thumbnail', { status: 404 });

  const buf = fs.readFileSync(thumb);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
