import { NextResponse } from 'next/server';
import { getDocument, deleteDocument, renameDocument } from '@/lib/documents';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  if (!doc) return NextResponse.json({ error: '未找到文档' }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title : '';
  const doc = renameDocument(Number(id), title);
  if (!doc) return NextResponse.json({ error: '未找到文档或标题为空' }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = deleteDocument(Number(id));
  if (!ok) return NextResponse.json({ error: '未找到文档' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
