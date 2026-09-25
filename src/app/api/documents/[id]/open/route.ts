import { NextResponse } from 'next/server';
import { getDocument, touchDocument } from '@/lib/documents';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  if (!doc) return NextResponse.json({ error: '未找到文档' }, { status: 404 });
  touchDocument(Number(id));
  return NextResponse.json({ ok: true });
}
