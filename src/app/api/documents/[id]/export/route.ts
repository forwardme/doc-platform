import { NextResponse } from 'next/server';
import { buildAnnotatedPdf } from '@/lib/exportPdf';
import { getDocument } from '@/lib/documents';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const result = await buildAnnotatedPdf(Number(id));
  if (!result) return NextResponse.json({ error: '无可用 PDF' }, { status: 404 });

  const doc = getDocument(Number(id));
  const filename = `${doc?.title || 'document'}.pdf`;
  return new NextResponse(result.bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Last-Modified': result.updatedAt.toUTCString(),
    },
  });
}
