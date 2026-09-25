import { NextResponse } from 'next/server';
import { getDocument, deleteDocument, renameDocument, setBodyStartPage, setDocumentCategory } from '@/lib/documents';

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

  // 重新分类：category_id 为 null 表示移出分类；分类不存在返回 400
  if ('category_id' in body) {
    const cid = body.category_id;
    if (cid === null) {
      doc = setDocumentCategory(docId, null) ?? doc;
    } else {
      const n = Number(cid);
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json({ error: '无效的分类' }, { status: 400 });
      }
      const next = setDocumentCategory(docId, n);
      if (!next) return NextResponse.json({ error: '分类不存在' }, { status: 400 });
      doc = next;
    }
  }

  return NextResponse.json({ document: doc });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = deleteDocument(Number(id));
  if (!ok) return NextResponse.json({ error: '未找到文档' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
