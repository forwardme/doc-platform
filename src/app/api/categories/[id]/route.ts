import { NextResponse } from 'next/server';
import { renameCategory, recolorCategory, deleteCategory } from '@/lib/categories';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  let category = null;
  if (typeof body.name === 'string' && body.name.trim()) {
    category = renameCategory(Number(id), body.name);
  }
  if (typeof body.color === 'string') {
    category = recolorCategory(Number(id), body.color);
  }
  if (!category) return NextResponse.json({ error: '未找到分类' }, { status: 404 });
  return NextResponse.json({ category });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteCategory(Number(id))) {
    return NextResponse.json({ error: '未找到分类' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
