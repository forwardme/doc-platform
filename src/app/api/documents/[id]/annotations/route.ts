import { NextResponse } from 'next/server';
import { getDocument } from '@/lib/documents';
import { listAnnotations, saveAnnotations, type AnnotationInput } from '@/lib/annotations';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  if (!doc) return NextResponse.json({ error: '未找到文档' }, { status: 404 });
  return NextResponse.json({ annotations: listAnnotations(Number(id)) });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const documentId = Number(id);
  const doc = getDocument(documentId);
  if (!doc) return NextResponse.json({ error: '未找到文档' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body.annotations) ? body.annotations : [];
  const anns: AnnotationInput[] = raw.map((a: any) => ({
    id: String(a.id),
    page: Number(a.page) || 1,
    type: ['ink', 'highlight', 'underline', 'note'].includes(a.type) ? a.type : 'note',
    data: a.data ?? {},
    text: typeof a.text === 'string' ? a.text : '',
    color: typeof a.color === 'string' ? a.color : '#f59e0b',
    tags: Array.isArray(a.tags)
      ? a.tags
          .filter((t: any) => t && typeof t.name === 'string')
          .map((t: any) => ({ name: t.name, color: typeof t.color === 'string' ? t.color : undefined }))
      : undefined,
  }));

  const saved = saveAnnotations(documentId, anns);
  return NextResponse.json({ annotations: saved });
}
