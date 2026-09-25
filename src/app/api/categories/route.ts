import { NextResponse } from 'next/server';
import { listCategories, createCategory } from '@/lib/categories';

export async function GET() {
  return NextResponse.json({ categories: listCategories() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: '分类名不能为空' }, { status: 400 });
  try {
    const category = createCategory(name, typeof body.color === 'string' ? body.color : undefined);
    return NextResponse.json({ category }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || '创建失败' }, { status: 400 });
  }
}
