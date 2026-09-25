import { SignJWT, jwtVerify } from 'jose';

/**
 * 会话工具。此文件只依赖 jose（Edge 安全），可被 middleware 引入，
 * 不能 import better-sqlite3 / fs 等 Node 专属模块。
 */
export const AUTH_COOKIE = 'pdfsite_session';

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'dev-only-insecure-secret',
);

export async function signSession(username: string): Promise<string> {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET);
}

export async function verifySession(
  token: string | undefined,
): Promise<{ username: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.username === 'string') {
      return { username: payload.username };
    }
    return null;
  } catch {
    return null;
  }
}
