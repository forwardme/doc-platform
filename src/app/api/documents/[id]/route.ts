import { NextResponse } from 'next/server';
import { getDocument, deleteDocument, renameDocument, setBodyStartPage } from '@/lib/documents';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  if (!doc) return NextResponse.json({ error: '未找到文档' }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const docId = Number(id);
  const body = await req.json().catch(() => ({}));

  let doc = getDocument(docId);
  if (!doc) return NextResponse.json({ error: '未找到文档' }, { status: 404 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title) doc = renameDocument(docId, title) ?? doc;

  if (body.body_start_page != null && body.body_start_page !== '') {
    const n = Number(body.body_start_page);
    if (Number.isInteger(n) && n >= 1) doc = setBodyStartPage(docId, n) ?? doc;
  }

  return NextResponse.json({ document: doc });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = deleteDocument(Number(id));
  if (!ok) return NextResponse.json({ error: '未找到文档' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
