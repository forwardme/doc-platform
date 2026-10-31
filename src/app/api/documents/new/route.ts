import { NextResponse } from 'next/server';
import { createMarkdownDocument } from '@/lib/documents';

export async function POST() {
  try {
    const id = createMarkdownDocument();
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || '新建失败' }, { status: 500 });
  }
}
