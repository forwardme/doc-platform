import bcrypt from 'bcryptjs';

/**
 * 管理员凭据校验。此文件依赖 bcryptjs，仅服务端使用（勿在 middleware 引入）。
 */
let cachedHash: string | null = null;

function getPasswordHash(): string {
  if (cachedHash) return cachedHash;
  if (process.env.ADMIN_PASSWORD_HASH) {
    cachedHash = process.env.ADMIN_PASSWORD_HASH;
  } else {
    const plain = process.env.ADMIN_PASSWORD || 'admin123';
    cachedHash = bcrypt.hashSync(plain, 10);
  }
  return cachedHash;
}

export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME || 'admin';
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  if (username !== getAdminUsername()) return false;
  return bcrypt.compare(password, getPasswordHash());
}
