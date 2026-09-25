import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, verifySession } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(AUTH_COOKIE)?.value);

  if (!session) {
    const { pathname } = req.nextUrl;
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|api/auth/login|api/auth/logout|api/auth/me).*)',
  ],
};
