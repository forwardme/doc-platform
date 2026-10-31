import { NextResponse } from 'next/server';
import fs from 'fs';
import { getDocument, getPreviewFile, getOriginalFile, commitEditedContent } from '@/lib/documents';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  const preview = getPreviewFile(Number(id));
  if (!doc || !preview || preview.kind !== 'md') {
    return NextResponse.json({ error: '非 Markdown 文档' }, { status: 404 });
  }

  const body = (await req.json()) as { content?: string };
  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: '缺少 content' }, { status: 400 });
  }

  try {
    // 预览正文与原始文件保持同步（下载所见即所改）
    fs.writeFileSync(preview.path, body.content, 'utf8');
    const original = getOriginalFile(doc.id);
    if (original) fs.writeFileSync(original.path, body.content, 'utf8');
    commitEditedContent(doc.id, body.content, Buffer.byteLength(body.content, 'utf8'));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || '保存失败' }, { status: 500 });
  }
}
