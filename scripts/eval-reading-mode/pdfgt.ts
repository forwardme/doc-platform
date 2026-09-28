// PDF ground truth：每页文本（块→页归属用）+ 每页渲染 JPEG（LLM 对照 + 报告用）。
//
// 直接用项目自带的 pdfjs-dist legacy build + @napi-rs/canvas 渲染。
// 不用 unpdf 的 renderPageAsImage：其 serverless pdf.js 在 fake worker 下通过 structuredClone
// 回传 napi-canvas 对象会抛 DataCloneError（Node 直跑环境下）；legacy build 无此问题。
// 文本提取格式与 unpdf 的 extractText 保持一致（str + hasEOL?换行，不去空白），
// 与 attribute.ts 的归一化匹配兼容。

import type { PageGt } from './types';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, DOMMatrix, ImageData, Path2D, loadImage } from '@napi-rs/canvas';

// pdf.js 在 Node 下渲染需要这几个全局对象（@napi-rs/canvas 提供）。
// legacy build 在 Node 下内置 NodeCanvasFactory（自动用 @napi-rs/canvas），无需再传 canvasFactory。
(globalThis as unknown as Record<string, unknown>).DOMMatrix = DOMMatrix;
(globalThis as unknown as Record<string, unknown>).ImageData = ImageData;
(globalThis as unknown as Record<string, unknown>).Path2D = Path2D;

type PdfPage = Awaited<ReturnType<import('pdfjs-dist/types/src/display/api').PDFDocumentProxy['getPage']>>;

async function getPageText(page: PdfPage): Promise<string> {
  const content = await page.getTextContent();
  return content.items
    .filter((item) => (item as { str?: string }).str != null)
    .map((item) => {
      const { str, hasEOL } = item as { str: string; hasEOL?: boolean };
      return str + (hasEOL ? '\n' : '');
    })
    .join('');
}

export interface PdfGtResult {
  pages: PageGt[];
  numPages: number;
}

export interface PdfGtOptions {
  /** 正文起始页（默认 1） */
  startPage?: number;
  /** 最多评测多少页（快速迭代用） */
  maxPages?: number;
  /** 页面 JPEG 最大宽度，默认 1600 */
  renderWidth?: number;
  /** 渲染缩放，默认 2（约 1224px 宽，够 LLM 看清单栏文字） */
  renderScale?: number;
}

export async function buildPdfGroundTruth(
  pdfBytes: Uint8Array,
  opts: PdfGtOptions = {},
): Promise<PdfGtResult> {
  const doc = await pdfjs.getDocument({
    data: pdfBytes,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const numPages = doc.numPages;

  const start = Math.max(1, Math.min(opts.startPage ?? 1, numPages));
  const end = Math.min(numPages, opts.maxPages != null ? start + opts.maxPages - 1 : numPages);
  const renderWidth = opts.renderWidth ?? 1600;
  const renderScale = opts.renderScale ?? 2;

  const pages: PageGt[] = [];
  for (let p = start; p <= end; p++) {
    const page = await doc.getPage(p);
    const text = await getPageText(page);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;

    // 降采样到 renderWidth（宽超限才缩放）
    let out = canvas;
    if (canvas.width > renderWidth) {
      const h = Math.max(1, Math.round((canvas.height * renderWidth) / canvas.width));
      const scaled = createCanvas(renderWidth, h);
      const sctx = scaled.getContext('2d');
      const img = await loadImage(await canvas.encode('png'));
      sctx.drawImage(img, 0, 0, renderWidth, h);
      out = scaled;
    }
    const jpeg = await out.encode('jpeg', 85);
    pages.push({
      page: p,
      text,
      jpegBase64: jpeg.toString('base64'),
      width: viewport.width,
      height: viewport.height,
    });
    page.cleanup();
  }
  return { pages, numPages };
}
