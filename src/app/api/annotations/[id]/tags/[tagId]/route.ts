import { NextResponse } from 'next/server';
import { removeTagFromAnnotation } from '@/lib/tags';

type Ctx = { params: Promise<{ id: string; tagId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, tagId } = await params;
  const ok = removeTagFromAnnotation(id, Number(tagId));
  if (!ok) return NextResponse.json({ error: '标签不存在' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
