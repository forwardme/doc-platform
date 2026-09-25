import { NextResponse } from 'next/server';
import fs from 'fs';
import { getDocument, getOriginalFile, commitEditedContent } from '@/lib/documents';
import { readWorkbook, writeWorkbook, sheetText, type SheetData } from '@/lib/office';

type Ctx = { params: Promise<{ id: string }> };

function isExcel(ext: string): boolean {
  return ext === 'xlsx' || ext === 'xls';
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  const f = getOriginalFile(Number(id));
  if (!doc || !f || !isExcel(doc.extension)) {
    return NextResponse.json({ error: '非 Excel 文档' }, { status: 404 });
  }
  try {
    const { sheets } = await readWorkbook(f.path);
    return NextResponse.json({ sheets });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || '读取失败' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  const f = getOriginalFile(Number(id));
  if (!doc || !f || !isExcel(doc.extension)) {
    return NextResponse.json({ error: '非 Excel 文档' }, { status: 404 });
  }
  const body = (await req.json()) as { sheets?: SheetData[] };
  if (!Array.isArray(body.sheets) || body.sheets.length === 0) {
    return NextResponse.json({ error: '缺少 sheets' }, { status: 400 });
  }
  try {
    const buf = await writeWorkbook(doc.extension, body.sheets);
    fs.writeFileSync(f.path, buf);
    commitEditedContent(doc.id, sheetText(body.sheets), fs.statSync(f.path).size);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || '保存失败' }, { status: 500 });
  }
}
