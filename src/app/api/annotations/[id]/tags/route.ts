import { NextResponse } from 'next/server';
import { addTagToAnnotation } from '@/lib/tags';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: '缺少标签名' }, { status: 400 });

  try {
    const tag = addTagToAnnotation(id, name, typeof body.color === 'string' ? body.color : undefined);
    return NextResponse.json({ tag }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '批注不存在' }, { status: 404 });
  }
}
