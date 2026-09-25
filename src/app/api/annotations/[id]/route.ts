import { NextResponse } from 'next/server';
import { updateAnnotation, deleteAnnotation } from '@/lib/annotations';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = updateAnnotation(id, {
    text: typeof body.text === 'string' ? body.text : undefined,
    color: typeof body.color === 'string' ? body.color : undefined,
    data: body.data,
  });
  if (!updated) return NextResponse.json({ error: '批注不存在' }, { status: 404 });
  return NextResponse.json({ annotation: updated });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteAnnotation(id)) {
    return NextResponse.json({ error: '批注不存在' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
