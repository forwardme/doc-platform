import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 单页文本 + 每个字符的 PDF 点坐标矩形（近似，按 item.width 均分）。 */
export interface PageText {
  page: number;
  text: string;
  chars: Rect[];
}

export interface FindMatch {
  page: number;
  rects: Rect[];
}

/**
 * 提取单页文本与逐字符矩形（PDF 点坐标）。
 * 字符宽度按 item.width 均分（忽略字距，仅用于高亮定位，够用）。
 */
export async function loadPageText(page: PDFPageProxy, pageNumber: number): Promise<PageText> {
  const tc = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  let text = '';
  const chars: Rect[] = [];
  for (const item of tc.items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (fontHeight <= 0) continue;
    const left = tx[4];
    const top = tx[5] - fontHeight;
    const width = item.width > 0 ? item.width : fontHeight;
    const charW = width / str.length;
    for (let i = 0; i < str.length; i++) {
      text += str[i];
      chars.push({ x: left + i * charW, y: top, w: charW, h: fontHeight });
    }
  }
  return { page: pageNumber, text, chars };
}

/** 把同行的相邻字符矩形合并为行矩形（供高亮整段匹配）。 */
export function mergeCharRects(chars: Rect[]): Rect[] {
  const rects: Rect[] = [];
  let cur: Rect | null = null;
  for (const c of chars) {
    if (c.w <= 0.5) continue;
    if (!cur) {
      cur = { ...c };
      continue;
    }
    const sameLine = Math.abs(c.y - cur.y) <= Math.max(c.h, cur.h) * 0.5;
    const adjacent = c.x <= cur.x + cur.w + 2;
    if (sameLine && adjacent) {
      const right = Math.max(cur.x + cur.w, c.x + c.w);
      const bottom = Math.max(cur.y + cur.h, c.y + c.h);
      cur.x = Math.min(cur.x, c.x);
      cur.y = Math.min(cur.y, c.y);
      cur.w = right - cur.x;
      cur.h = bottom - cur.y;
    } else {
      rects.push(cur);
      cur = { ...c };
    }
  }
  if (cur) rects.push(cur);
  return rects;
}
