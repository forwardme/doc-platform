import fs from 'fs';
import path from 'path';
import { getDocument, getPreviewFile, getOriginalFile } from './documents';
import { getDataDir, ensureDir } from './storage';

const THUMB_DIR = 'thumb';

// pdfjs 在 Node 下渲染需要这几个全局对象（@napi-rs/canvas 提供）；unpdf 不会自动注入，
// 首次渲染前手动补一次即可。
let globalsReady = false;
async function ensureGlobals(): Promise<void> {
  if (globalsReady) return;
  const canvas = await import('@napi-rs/canvas');
  (globalThis as unknown as Record<string, unknown>).DOMMatrix = canvas.DOMMatrix;
  (globalThis as unknown as Record<string, unknown>).ImageData = canvas.ImageData;
  (globalThis as unknown as Record<string, unknown>).Path2D = canvas.Path2D;
  globalsReady = true;
}

function thumbPath(docId: number): string {
  return path.join(ensureDir(path.join(getDataDir(), THUMB_DIR)), `${docId}.png`);
}

/** 为 PDF 文档生成首屏缩略图（PNG）并缓存到 data/thumb；非 PDF 或失败返回 null。 */
export async function ensureThumbnail(docId: number): Promise<string | null> {
  const doc = getDocument(docId);
  if (!doc || doc.extension !== 'pdf') return null;

  const out = thumbPath(docId);
  if (fs.existsSync(out)) return out;

  // PDF 字节来源：优先预览文件（kind=pdf），否则原始文件。
  const preview = getPreviewFile(docId);
  const source = preview?.kind === 'pdf' ? preview.path : getOriginalFile(docId)?.path;
  if (!source) return null;

  try {
    await ensureGlobals();
    const { renderPageAsImage } = await import('unpdf');
    const bytes = new Uint8Array(fs.readFileSync(source));
    const png = await renderPageAsImage(bytes, 1, {
      scale: 0.3,
      canvas: () => import('@napi-rs/canvas'),
    });
    fs.writeFileSync(out, Buffer.from(png));
    return out;
  } catch (err) {
    console.error('[thumbnail] render failed:', (err as Error).message);
    return null;
  }
}
