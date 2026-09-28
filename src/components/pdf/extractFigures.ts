import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist';

// —— 图形提取 ——
// 检测方向：图像驱动。渲染页面 → 抹掉文字 → 非白像素即图形 → 连通域分割，
// 位图 / 矢量图表 / 烘焙图注的插图统一检出，边界像素级精确。
// 位图矩形（operator list）仅作 fallback。

export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAINT_OPS = new Set([
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintImageMaskXObjectGroup,
  pdfjs.OPS.paintInlineImageXObjectGroup,
]);

export interface GraphicsOpsInfo {
  rects: PageRect[];
  /** constructPath 操作数，矢量图（图表/表格线）存在的廉价信号 */
  pathOps: number;
}

/** 把单位方块 (0,0,1,1) 经矩阵映射为包围盒 */
function unitRect(m: number[]): PageRect {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 一页的图形操作信息：位图绘制矩形（跟踪 CTM 栈定位 paintImage* 落点）
 * 与 constructPath 计数（决定是否值得渲染分析）。
 */
export async function getGraphicsOpsInfo(
  page: PDFPageProxy,
  viewport: PageViewport,
): Promise<GraphicsOpsInfo> {
  const opList = await page.getOperatorList();
  const rects: PageRect[] = [];
  let pathOps = 0;
  let ctm: number[] = viewport.transform.slice();
  const stack: number[][] = [];
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm.slice());
    } else if (fn === pdfjs.OPS.restore) {
      if (stack.length > 0) ctm = stack.pop()!;
    } else if (fn === pdfjs.OPS.transform) {
      ctm = pdfjs.Util.transform(ctm, argsArray[i] as number[]);
    } else if (fn === pdfjs.OPS.constructPath) {
      pathOps++;
    } else if (PAINT_OPS.has(fn)) {
      const r = unitRect(ctm);
      if (r.w >= 8 && r.h >= 8) rects.push(r);
    }
  }
  return { rects, pathOps };
}

export function unionRects(rects: PageRect[]): PageRect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectsOverlap(a: PageRect, b: PageRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 离屏渲染一页，返回 canvas（调用方负责在使用后释放引用） */
export async function renderPageCanvas(
  pdfDoc: PDFDocumentProxy,
  pageNum: number,
  scale = 2,
): Promise<HTMLCanvasElement | null> {
  try {
    const page = await pdfDoc.getPage(pageNum);
    try {
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // 补白底，避免透明区域在截图/掩码里出错
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return canvas;
    } finally {
      page.cleanup();
    }
  } catch {
    return null;
  }
}

const ANALYZE_WIDTH = 400; // 掩码分析的低分辨率宽度
const DILATE = 3; // 膨胀半径（低分辨率像素），合并同一图内部的缝隙

/**
 * 把「同一图被白缝切开」的相邻连通域并回：
 * 图上的文字（轴标签、烘焙图注）被涂白后会形成横/竖白缝，膨胀桥接不住。
 * 要求强对齐（一个方向重叠 ≥ 较小边的 50%）且缝隙 ≤12pt 才并，
 * 避免把「两个独立图 + 中间一行图注」（缝隙通常 >13pt）错误合并。
 *
 * 两处放宽，针对多面板图 / 图例被白缝切开：
 * 1. 等尺寸网格面板（Sankey 等 2×n 面板图）——宽高都接近、强对齐、缝隙适中，
 *    用并查集按原始组件传递聚簇（合并后尺寸会变，逐对判断会中断链式合并）。
 * 2. 同带近邻（紧贴的图例 / 色标条）——缝隙上限从 12pt 放宽到 18pt。
 */
function mergeAligned(rects: PageRect[]): PageRect[] {
  const BAND_GAP = 18;
  let rs = rects.map((r) => ({ ...r }));

  // —— 预聚类：等尺寸网格面板 ——
  const n = rs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = rs[i];
      const b = rs[j];
      const sameSize =
        Math.min(a.w, b.w) / Math.max(a.w, b.w) >= 0.85 &&
        Math.min(a.h, b.h) / Math.max(a.h, b.h) >= 0.85;
      if (!sameSize) continue;
      const xOv = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOv = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const xGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const yGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      const gridGap = Math.min(a.w, a.h, b.w, b.h) * 0.6;
      // 上下同列（x 强重叠 + y 缝隙适中）或左右同行（y 强重叠 + x 缝隙适中）
      if (xOv >= Math.min(a.w, b.w) * 0.5 && yGap <= gridGap) union(i, j);
      if (yOv >= Math.min(a.h, b.h) * 0.5 && xGap <= gridGap) union(i, j);
    }
  }
  const clusters = new Map<number, PageRect[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let arr = clusters.get(root);
    if (!arr) clusters.set(root, (arr = []));
    arr.push(rs[i]);
  }
  rs = [...clusters.values()].map((c) => (c.length === 1 ? c[0] : unionRects(c)));

  // —— 常规合并（重叠 / 对齐近邻 / 同带近邻）——
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        const xOv = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const yOv = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (xOv > 0 && yOv > 0) {
          rs[i] = unionRects([a, b]);
        } else {
          const xGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
          const yGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
          const xAligned = xOv >= Math.min(a.w, b.w) * 0.5;
          const yAligned = yOv >= Math.min(a.h, b.h) * 0.5;
          if (!((xAligned && yGap <= BAND_GAP) || (yAligned && xGap <= BAND_GAP))) continue;
          rs[i] = unionRects([a, b]);
        }
        rs.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return rs;
}

/**
 * 视觉分割：从页面渲染中检出图形区域。
 * 低分辨率掩码 → 文本行涂白 → 膨胀 → 连通域 → 过滤 → 对齐合并，返回 scale-1 页面坐标的区域。
 * @param textRects 该页所有文本行矩形（scale-1），这些区域不参与图形判定
 */
export function analyzePageGraphics(
  canvas: HTMLCanvasElement,
  textRects: PageRect[],
  pageW: number,
  pageH: number,
): PageRect[] {
  const lw = ANALYZE_WIDTH;
  const lh = Math.max(1, Math.round((canvas.height / canvas.width) * lw));
  const small = document.createElement('canvas');
  small.width = lw;
  small.height = lh;
  const sctx = small.getContext('2d');
  if (!sctx) return [];
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, lw, lh);
  sctx.drawImage(canvas, 0, 0, lw, lh);

  // 文本行涂白（略外扩，盖住抗锯齿残边）
  const k = lw / pageW; // 低分辨率像素 / 页面 pt
  sctx.fillStyle = '#ffffff';
  for (const r of textRects) {
    sctx.fillRect(r.x * k - 1, r.y * k - 1, r.w * k + 2, r.h * k + 2);
  }

  const data = sctx.getImageData(0, 0, lw, lh).data;
  const n = lw * lh;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o] < 245 || data[o + 1] < 245 || data[o + 2] < 245) mask[i] = 1;
  }

  // 膨胀（Chebyshev 半径 DILATE）
  const dil = new Uint8Array(n);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      if (!mask[y * lw + x]) continue;
      const y0 = Math.max(0, y - DILATE);
      const y1 = Math.min(lh - 1, y + DILATE);
      const x0 = Math.max(0, x - DILATE);
      const x1 = Math.min(lw - 1, x + DILATE);
      for (let yy = y0; yy <= y1; yy++) dil.fill(1, yy * lw + x0, yy * lw + x1 + 1);
    }
  }

  // 连通域标记（4 邻域 BFS），记录包围盒
  const label = new Int32Array(n).fill(-1);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!dil[s] || label[s] >= 0) continue;
    const id = boxes.length;
    let x0 = s % lw;
    let x1 = x0;
    let y0 = (s / lw) | 0;
    let y1 = y0;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % lw;
      const cy = (cur / lw) | 0;
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy;
      if (cy > y1) y1 = cy;
      // 4 邻域
      if (cx > 0 && dil[cur - 1] && label[cur - 1] < 0) {
        label[cur - 1] = id;
        queue[tail++] = cur - 1;
      }
      if (cx < lw - 1 && dil[cur + 1] && label[cur + 1] < 0) {
        label[cur + 1] = id;
        queue[tail++] = cur + 1;
      }
      if (cy > 0 && dil[cur - lw] && label[cur - lw] < 0) {
        label[cur - lw] = id;
        queue[tail++] = cur - lw;
      }
      if (cy < lh - 1 && dil[cur + lw] && label[cur + lw] < 0) {
        label[cur + lw] = id;
        queue[tail++] = cur + lw;
      }
    }
    boxes.push({ x0, y0, x1, y1 });
  }

  // 包围盒还原到 scale-1 页面坐标（缩回膨胀半径）并过滤
  const out: PageRect[] = [];
  for (const b of boxes) {
    const r: PageRect = {
      x: (b.x0 + DILATE) / k,
      y: (b.y0 + DILATE) / k,
      w: (b.x1 - b.x0 + 1 - DILATE * 2) / k,
      h: (b.y1 - b.y0 + 1 - DILATE * 2) / k,
    };
    if (r.w < 30 || r.h < 20) continue; // 小图标/装饰
    if (r.w < 4 || r.h < 4) continue; // 细线（表格边框线等）
    if (r.w * r.h > pageW * pageH * 0.92) continue; // 整页扫描背景
    out.push(r);
  }
  return mergeAligned(out);
}

/** 从已渲染的页面 canvas 裁剪单个区域 → PNG dataURL */
export function clipFromCanvas(
  canvas: HTMLCanvasElement,
  rect: PageRect,
  scale: number,
): string | null {
  try {
    const sx = Math.max(0, Math.floor(rect.x * scale));
    const sy = Math.max(0, Math.floor(rect.y * scale));
    const sw = Math.min(canvas.width - sx, Math.ceil(rect.w * scale));
    const sh = Math.min(canvas.height - sy, Math.ceil(rect.h * scale));
    if (sw <= 0 || sh <= 0) return null;
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}
