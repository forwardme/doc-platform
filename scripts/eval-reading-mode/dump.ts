// 快速 dump 阅读模式提取输出（不跑 LLM / GT），用于迭代验证提取顺序与表格/图片检测。
// 用法：npx tsx scripts/eval-reading-mode/dump.ts [--doc 1] [--full]
//   --full  打印完整文本（默认截断每块前 90 字符）

import { spawn } from 'node:child_process';
import { captureReadingMode } from './capture';

const get = (name: string, argv: string[]): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};

async function serverReady(appUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${appUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      redirect: 'manual',
    });
    return res.status === 401;
  } catch {
    return false;
  }
}

async function ensureServer(appUrl: string): Promise<{ kill?: () => void }> {
  if (await serverReady(appUrl)) return {};
  console.log('▶ 本地服务未运行，自动启动 npm run dev …');
  const child = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await serverReady(appUrl)) return { kill: () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch {} } };
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('dev server 启动超时');
}

async function main() {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* ignore */
  }
  const argv = process.argv.slice(2);
  const doc = Number(get('doc', argv) ?? 1);
  const full = argv.includes('--full');
  const appUrl = (get('app-url', argv) ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  const server = await ensureServer(appUrl);
  try {
    const capture = await captureReadingMode({
      appUrl,
      docId: doc,
      username: process.env.ADMIN_USERNAME ?? 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'admin123',
    });
    console.log(`\n===== 文档《${capture.docTitle}》正文起始页 ${capture.bodyStartPage}，共 ${capture.blocks.length} 块 =====\n`);
    capture.blocks.forEach((b, i) => {
      const tag = `[${String(i).padStart(3, '0')}]`;
      if (b.kind === 'figure') {
        const cap = b.caption ? ` | 图注: ${b.caption.slice(0, 80)}` : '';
        console.log(`${tag} FIGURE${cap}${b.jpegBase64 ? '' : ' (无图片数据)'}`);
      } else {
        const txt = full ? b.text : b.text.slice(0, 90) + (b.text.length > 90 ? '…' : '');
        console.log(`${tag} ${b.kind.toUpperCase().padEnd(2)} ${txt}`);
      }
    });
    if (capture.emptyState) console.log('\n⚠ 阅读模式显示"没有可提取的文字"。');
  } finally {
    server.kill?.();
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
