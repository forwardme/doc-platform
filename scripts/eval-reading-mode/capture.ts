// 无头浏览器抓取应用阅读模式的真实输出：
// 登录 → 打开 /viewer/{id} → 点"阅读模式" → 等提取完成 → 抓取 article 下的块。
// 图片在浏览器内降采样为 ≤900px JPEG，避免传输 MB 级 dataURL。

import { chromium, type Browser } from 'playwright';
import type { CaptureResult, CapturedBlock } from './types';

export interface CaptureOptions {
  appUrl: string;
  docId: number;
  username: string;
  password: string;
  /** 等待阅读模式提取完成的超时（大 PDF 渲染慢），默认 10 分钟 */
  timeoutMs?: number;
}

export async function captureReadingMode(opts: CaptureOptions): Promise<CaptureResult> {
  let browser: Browser;
  try {
    // 优先复用系统 Chrome，省去 playwright 浏览器下载
    browser = await chromium.launch({ channel: 'chrome' });
  } catch {
    try {
      browser = await chromium.launch();
    } catch {
      throw new Error(
        '无法启动 Chromium：既没有系统 Chrome，也没有 playwright 自带浏览器。\n' +
          '请先运行 `npx playwright install chromium`，或安装 Google Chrome。',
      );
    }
  }

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('  [browser]', m.text());
    });

    // —— 登录：直接调 API（context.request 与 page 共享 cookie jar），绕开 React 受控表单的 fill 时序问题 ——
    const loginRes = await context.request.post(`${opts.appUrl}/api/auth/login`, {
      data: { username: opts.username, password: opts.password },
    });
    if (!loginRes.ok()) {
      const body = await loginRes.text().catch(() => '');
      throw new Error(`登录失败：HTTP ${loginRes.status()} ${body}（检查 ADMIN_USERNAME / ADMIN_PASSWORD 配置）`);
    }

    // —— 打开查看器，等 PDF 载入（首屏编译 + 下载可能较慢）——
    await page.goto(`${opts.appUrl}/viewer/${opts.docId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page]', { timeout: 180_000 });

    // —— 打开阅读模式，等提取完成 ——
    await page.click('button[aria-label="阅读模式"]');
    const timeout = opts.timeoutMs ?? 600_000;
    await page.waitForFunction(
      () => {
        const a = document.querySelector('article[lang="zh-CN"]');
        if (!a) return false;
        return !(a.textContent ?? '').includes('正在提取正文');
      },
      undefined,
      { timeout },
    );

    const emptyState = await page.evaluate(() => {
      const a = document.querySelector('article[lang="zh-CN"]');
      return !!a && (a.textContent ?? '').includes('该文档没有可提取的文字');
    });

    // 等 figure 图片全部解码完成（dataURL，通常即时；给个兜底超时）
    await page
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll('article[lang="zh-CN"] figure img')).every(
            (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
          ),
        undefined,
        { timeout: 60_000 },
      )
      .catch(() => {});

    // —— 抓取块（按输出顺序）——
    const rawBlocks = (await page.evaluate(() => {
      const a = document.querySelector('article[lang="zh-CN"]');
      if (!a) return [];
      const MAXW = 900;
      const out: unknown[] = [];
      for (const el of Array.from(a.children)) {
        if (el instanceof HTMLHeadingElement) {
          out.push({ kind: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim() });
        } else if (el instanceof HTMLParagraphElement) {
          out.push({ kind: 'p', text: (el.textContent ?? '').trim() });
        } else if (el instanceof HTMLElement && el.tagName === 'FIGURE') {
          const img = el.querySelector('img');
          const cap = el.querySelector('figcaption');
          let jpeg = '';
          if (img && img.complete && img.naturalWidth > 0) {
            const scale = Math.min(1, MAXW / img.naturalWidth);
            const w = Math.max(1, Math.round(img.naturalWidth * scale));
            const h = Math.max(1, Math.round(img.naturalHeight * scale));
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, w, h);
              ctx.drawImage(img, 0, 0, w, h);
              jpeg = c.toDataURL('image/jpeg', 0.85);
            }
          }
          out.push({ kind: 'figure', jpeg, caption: (cap?.textContent ?? '').trim() });
        }
      }
      return out;
    })) as Array<{ kind: string; text?: string; jpeg?: string; caption?: string }>;

    const blocks: CapturedBlock[] = emptyState
      ? []
      : rawBlocks.map((b) => {
          if (b.kind === 'figure') {
            return {
              kind: 'figure' as const,
              jpegBase64: (b.jpeg ?? '').replace(/^data:image\/\w+;base64,/, ''),
              caption: b.caption ?? '',
            };
          }
          return { kind: (b.kind === 'h1' || b.kind === 'h2' ? b.kind : 'p') as 'h1' | 'h2' | 'p', text: b.text ?? '' };
        });

    // —— 下载 PDF 字节与文档元数据（context.request 共享登录 cookie）——
    const pdfRes = await context.request.get(`${opts.appUrl}/api/documents/${opts.docId}/content`);
    if (!pdfRes.ok()) throw new Error(`下载 PDF 失败：HTTP ${pdfRes.status()}`);
    const pdfBytes = new Uint8Array(await pdfRes.body());

    const metaRes = await context.request.get(`${opts.appUrl}/api/documents/${opts.docId}`);
    const meta = metaRes.ok() ? ((await metaRes.json()) as { document?: Record<string, unknown> }) : {};
    const doc = meta.document ?? {};
    const bodyStart = Number(doc.body_start_page);

    return {
      blocks,
      docTitle: typeof doc.title === 'string' && doc.title ? doc.title : `文档 ${opts.docId}`,
      bodyStartPage: Number.isInteger(bodyStart) && bodyStart >= 1 ? bodyStart : 1,
      pdfBytes,
      emptyState,
    };
  } finally {
    await browser.close();
  }
}
