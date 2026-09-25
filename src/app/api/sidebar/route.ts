import { NextResponse } from 'next/server';
import { listRecent } from '@/lib/documents';
import { listCategories } from '@/lib/categories';
import { listTagsWithCounts } from '@/lib/tags';

export async function GET() {
  return NextResponse.json({
    recent: listRecent(8),
    categories: listCategories(),
    tags: listTagsWithCounts(),
  });
}
