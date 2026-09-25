import { NextResponse } from 'next/server';
import fs from 'fs';
import { getDocument, getOriginalFile, commitEditedContent } from '@/lib/documents';
import { readDocxHtml, writeDocxFromHtml, htmlToText } from '@/lib/office';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  const f = getOriginalFile(Number(id));
  if (!doc || !f || doc.extension !== 'docx') {
    return NextResponse.json({ error: '非 Word 文档' }, { status: 404 });
  }
  try {
    const html = await readDocxHtml(f.path);
    return NextResponse.json({ html });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || '读取失败' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  const f = getOriginalFile(Number(id));
  if (!doc || !f || doc.extension !== 'docx') {
    return NextResponse.json({ error: '非 Word 文档' }, { status: 404 });
  }
  const body = (await req.json()) as { html?: string };
  if (typeof body.html !== 'string' || !body.html.trim()) {
    return NextResponse.json({ error: '缺少 html' }, { status: 400 });
  }
  try {
    const buf = await writeDocxFromHtml(body.html);
    fs.writeFileSync(f.path, buf);
    commitEditedContent(doc.id, htmlToText(body.html), fs.statSync(f.path).size);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || '保存失败' }, { status: 500 });
  }
}
