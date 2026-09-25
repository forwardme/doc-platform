import { NextResponse } from 'next/server';
import { signSession, AUTH_COOKIE } from '@/lib/auth';
import { verifyAdminCredentials, getAdminUsername } from '@/lib/admin';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const ok = await verifyAdminCredentials(username, password);
  if (!ok) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
  }

  const token = await signSession(getAdminUsername());
  const res = NextResponse.json({ ok: true, username: getAdminUsername() });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
