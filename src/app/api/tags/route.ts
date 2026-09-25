import { NextResponse } from 'next/server';
import { tagIndex, findOrCreateTag } from '@/lib/tags';

export async function GET() {
  return NextResponse.json({ groups: tagIndex() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: '标签名不能为空' }, { status: 400 });
  const tag = findOrCreateTag(name, typeof body.color === 'string' ? body.color : undefined);
  return NextResponse.json({ tag }, { status: 201 });
}
