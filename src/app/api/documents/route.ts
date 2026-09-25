import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { searchDocuments, listDocuments, ingestUploadedFile } from '@/lib/documents';
import { tmpDir } from '@/lib/storage';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const categoryRaw = url.searchParams.get('category');
  const documents =
    categoryRaw != null && categoryRaw !== ''
      ? listDocuments(Number(categoryRaw))
      : searchDocuments(q);
  return NextResponse.json({ documents });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少上传文件' }, { status: 400 });
  }
  const categoryIdRaw = form.get('categoryId');
  const categoryId = categoryIdRaw != null && categoryIdRaw !== '' ? Number(categoryIdRaw) : null;

  const tmpPath = path.join(tmpDir(), `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.promises.writeFile(tmpPath, buf);
    const id = await ingestUploadedFile({
      originalName: file.name,
      mimeType: file.type,
      tmpPath,
      size: file.size,
      categoryId,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: (err as Error).message || '上传失败' }, { status: 400 });
  }
}
