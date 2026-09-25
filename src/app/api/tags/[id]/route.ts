import { NextResponse } from 'next/server';
import { renameTag, recolorTag, deleteTag } from '@/lib/tags';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  let tag = null;
  if (typeof body.name === 'string' && body.name.trim()) {
    tag = renameTag(Number(id), body.name);
  }
  if (typeof body.color === 'string') {
    tag = recolorTag(Number(id), body.color);
  }
  if (!tag) return NextResponse.json({ error: '未找到标签' }, { status: 404 });
  return NextResponse.json({ tag });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteTag(Number(id))) {
    return NextResponse.json({ error: '未找到标签' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
