import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, AUTH_COOKIE } from '@/lib/auth';

export async function GET() {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  const session = await verifySession(token);
  return NextResponse.json({
    authenticated: !!session,
    username: session?.username ?? null,
  });
}
