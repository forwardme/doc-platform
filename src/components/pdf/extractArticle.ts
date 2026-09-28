import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  analyzePageGraphics,
  clipFromCanvas,
  getGraphicsOpsInfo,
  rectsOverlap,
  renderPageCanvas,
  unionRects,
} from './extractFigures';
import type { PageRect } from './extractFigures';

// —— 语义化正文提取 ——
// 把各页零碎的 textItem 聚成行、段、标题，输出流式正文（供阅读模式 / Safari 阅读器）。
// 与 PdfPage 的透明层互不相关：那边追求逐字对齐版面，这里追求阅读顺序与段落结构。
// 图片检测为图像驱动：渲染页面 → 抹掉文字 → 连通域分割出图形区域 → 关联图注；
// 图注烘焙在图里/无图注的大图也保留（无 figcaption）。

export type ArticleBlock =
  | {
      type: 'h1' | 'h2' | 'p';
      text: string;
      /** 起始页码（1 起），便于后续做「定位到 PDF 页」 */
      page: number;
    }
  | {
      type: 'figure';
      /** PNG dataURL（从页面渲染裁剪） */
      src: string;
      /** 图注文本（无文本图注时缺省），渲染在图片下方 */
      caption?: string;
      page: number;
      /** 宽 / 高，用于布局占位 */
      aspect: number;
    };

interface Item {
  str: string;
  left: number;
  baseline: number;
  width: number;
  fontHeight: number;
}

interface Line {
  text: string;
  page: number;
  baseline: number;
  /** baseline / pageHeight，用于页眉页脚判定 */
  relY: number;
  fontHeight: number;
  left: number;
  right: number;
  /** 栏位：-1 = 通栏/跨栏行，0..N-1 = 第 N 栏 */
  col: number;
  /** 通栏/跨栏行（横跨多栏），按自身 baseline 参与阅读流，不重复归栏 */
  spanning: boolean;
  /** 块起点（栏变化/通栏切换），供段落组装断段 */
  blockStart: boolean;
}

interface PageInfo {
  w: number;
  h: number;
  /** 每栏的文本 x 范围 */
  colRanges: Map<number, { x0: number; x1: number }>;
}

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
// 页码样式：12、第 12 页、Page 12、- 12 -、Page 12 of 10、12 of 10、12 / 10
// （removeBoilerplate 用去空白后的 key 测试）
const PAGE_NUM = /^-?(?:第|page)?\d{1,4}页?(?:of\d{1,4}|[-/]\d{1,4})?页?-?$/i;
// 图注起始：图1、图 2-3、表 4、Figure 1、Fig. 2、Table III
const CAPTION_RE = /^\s*(图|表|figure|fig\.?|table)\s*[\dⅠ-Ⅻivx]+/i;
const TABLE_CAPTION_RE = /^\s*(表|table)/i;
// 参考文献标题与条目头（[1] / 1.）
const REFS_HEADING = /^(references|bibliography|references\s*cited|literature\s*cited|参考文献)\b/i;
const REF_ENTRY = /^\s*(\[\d{1,3}\]|\d{1,3}\.)(?:\s|$)/;

const RENDER_SCALE = 2;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 行内拼接：相邻 item 间隙 > 0.25em 时补空格（CJK 通常零间隙，不会引入多余空格） */
function joinSegment(seg: Item[], pageNum: number, pageHeight: number): Line {
  let text = '';
  let prev: Item | null = null;
  let maxFont = 0;
  let baselineSum = 0;
  let right = 0;
  for (const it of seg) {
    if (prev) {
      const gap = it.left - (prev.left + prev.width);
      if (gap > prev.fontHeight * 0.25) text += ' ';
    }
    text += it.str;
    prev = it;
    baselineSum += it.baseline;
    if (it.fontHeight > maxFont) maxFont = it.fontHeight;
    right = Math.max(right, it.left + it.width);
  }
  const baseline = baselineSum / seg.length;
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    page: pageNum,
    baseline,
    relY: pageHeight > 0 ? baseline / pageHeight : 0,
    fontHeight: maxFont,
    left: seg[0].left,
    right,
    col: 0,
    spanning: false,
    blockStart: false,
  };
}

/**
 * 栏检测：只用「窄行」（整行 right-left < 0.55 页宽）做 x 水平覆盖投影，找零覆盖、
 * 宽 > 1.5em 的竖向栏沟切栏。通栏标题/跨栏段落是「宽行」不参与投影，避免把栏沟抹掉。
 * 返回各栏的 x 范围（含完整页宽兜底单栏）。
 */
function detectColumns(
  bounds: Array<{ left: number; right: number }>,
  pageWidth: number,
  fontMedian: number,
): Array<{ x0: number; x1: number }> {
  const gapMin = fontMedian * 0.75;
  const narrow = bounds
    .filter((l) => l.right - l.left > 0 && l.right - l.left < pageWidth * 0.55)
    .map((l) => ({ x0: l.left, x1: l.right }))
    .sort((a, b) => a.x0 - b.x0);
  if (narrow.length < 2) return [{ x0: 0, x1: pageWidth }];
  const ranges: Array<{ x0: number; x1: number }> = [];
  let cur = { x0: narrow[0].x0, x1: narrow[0].x1 };
  for (let i = 1; i < narrow.length; i++) {
    const it = narrow[i];
    if (it.x0 - cur.x1 > gapMin) {
      ranges.push(cur);
      cur = { x0: it.x0, x1: it.x1 };
    } else {
      cur.x1 = Math.max(cur.x1, it.x1);
    }
  }
  ranges.push(cur);
  // 过滤过窄的伪栏（表格单元格/索引竖排易误判），保留真正的正文栏
  const kept = ranges.length <= 1 ? ranges : ranges.filter((r) => r.x1 - r.x0 > pageWidth * 0.15);
  return kept.length > 0 ? kept : [{ x0: 0, x1: pageWidth }];
}

/**
 * 一页的 item → 行：
 * 1. 按 baseline 聚行带（容差 0.5em）；
 * 2. 行带内按 left 排序，水平间隙 > 1.2em 切段——词间隙约 0.6em、行内间隙（作者行/图注
 *    编号）可达 1.15em，表格单元格间隙 ≥1.3em；1.2em 恰好让词与行内保持一行、把表格
 *    单元格切开。栏沟（1.1~1.45em）此处可能被漏切，交给结构分栏按栏沟位置补切；
 * 3. 结构分栏：用窄行投影定位栏沟，把「横跨栏沟」的行在栏沟处切成左右两半；
 * 4. 交给 reflowLines 做栏检测 + 阅读顺序重排。
 */
function buildLines(items: Item[], pageNum: number, pageWidth: number, pageHeight: number): Line[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  const bands: Item[][] = [];
  for (const it of sorted) {
    const band = bands[bands.length - 1];
    if (band && Math.abs(it.baseline - band[0].baseline) <= Math.max(it.fontHeight, band[0].fontHeight) * 0.5) {
      band.push(it);
    } else {
      bands.push([it]);
    }
  }

  // 先聚行（banding + 间隙切段），暂存为「item 组」，供结构分栏按栏沟补切
  let segs: Item[][] = [];
  for (const band of bands) {
    const seg = [...band].sort((a, b) => a.left - b.left);
    let cur: Item[] = [seg[0]];
    for (let i = 1; i < seg.length; i++) {
      const prev = cur[cur.length - 1];
      const gap = seg[i].left - (prev.left + prev.width);
      if (gap > prev.fontHeight * 1.2) {
        segs.push(cur);
        cur = [seg[i]];
      } else {
        cur.push(seg[i]);
      }
    }
    segs.push(cur);
  }

  // 结构分栏：用「窄段」投影定位栏沟，把横跨栏沟的段在栏沟处切成左右两半。
  // 纯间隙阈值无法兼顾行内间隙（≤1.15em）与窄栏沟（1.1~1.45em），此处按结构补切。
  // 关键：仅在栏沟处确有「空隙」（≥1em）才切分——并栏的左右两半在栏沟有 ~1.1em 空隙，
  // 而通栏图注/标题文字连续跨过栏沟（词横跨中点、词间隙 ≤0.5em），不能误切，
  // 否则左半会因词横跨中点而越过栏沟、把两栏投影连成一片，导致分栏退化为单栏。
  const fontMedian = median(items.map((i) => i.fontHeight));
  const segBounds = segs.map((s) => ({
    left: s[0].left,
    right: s.reduce((m, it) => Math.max(m, it.left + it.width), 0),
  }));
  const columns = detectColumns(segBounds, pageWidth, fontMedian);
  if (columns.length >= 2) {
    const out: Item[][] = [];
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      const b = segBounds[si];
      let splitAt = -1;
      for (let ci = 0; ci < columns.length - 1; ci++) {
        const mid = (columns[ci].x1 + columns[ci + 1].x0) / 2;
        if (b.left >= mid - 4 || b.right <= mid + 4) continue; // 不横跨该栏沟
        // 找横跨栏沟中点的相邻 item 空隙，空隙足够大才切分
        for (let k = 0; k < s.length - 1; k++) {
          const r = s[k].left + s[k].width;
          const nl = s[k + 1].left;
          if (r <= mid && nl >= mid) {
            if (nl - r >= s[k].fontHeight * 1.0) splitAt = nl;
            break;
          }
        }
        if (splitAt > 0) break;
      }
      if (splitAt < 0) {
        out.push(s);
        continue;
      }
      const leftItems = s.filter((it) => it.left < splitAt);
      const rightItems = s.filter((it) => it.left >= splitAt);
      if (leftItems.length) out.push(leftItems);
      if (rightItems.length) out.push(rightItems);
    }
    segs = out;
  }

  const lines = segs.map((s) => joinSegment(s, pageNum, pageHeight)).filter((l) => l.text);
  return reflowLines(lines, pageWidth);
}

/**
 * 栏检测 + 阅读顺序重排：对一页的 lines 重新检测栏、归栏、按「通栏分隔带 + 栏内自上而下」
 * 排序、标记块起点。buildLines 用它产出初始顺序；表格文字摘除后再用它重排，避免表格
 * 单元格/表注把栏沟投影抹掉导致分栏退化为单栏。
 */
function reflowLines(lines: Line[], pageWidth: number): Line[] {
  if (lines.length === 0) return lines;
  const fontMedian = median(lines.map((l) => l.fontHeight));
  const columns = detectColumns(lines, pageWidth, fontMedian);

  // 归栏：中心 x 落入哪个栏；通栏/跨栏（横跨整页或横跨栏沟）标 spanning
  const colOf = (l: Line): number => {
    const center = (l.left + l.right) / 2;
    for (let ci = 0; ci < columns.length; ci++) {
      if (center >= columns[ci].x0 && center <= columns[ci].x1) return ci;
    }
    let best = 0;
    let bestD = Infinity;
    for (let ci = 0; ci < columns.length; ci++) {
      const c = (columns[ci].x0 + columns[ci].x1) / 2;
      const d = Math.abs(center - c);
      if (d < bestD) {
        bestD = d;
        best = ci;
      }
    }
    return best;
  };
  for (const l of lines) {
    const wide = l.right - l.left > pageWidth * 0.55;
    const crossed = columns.some((c) => l.left < c.x0 - 4 && l.right > c.x1 + 4);
    if (wide || crossed) {
      l.spanning = true;
      l.col = -1;
    } else {
      l.spanning = false;
      l.col = colOf(l);
    }
  }

  // 阅读顺序：通栏行按 baseline 作「分隔带」；非通栏行归入「上方通栏行数」所决定的带，
  // 带内按 (栏, baseline) 自上而下。通栏标题/图注落在其真实 y 位置，不再整体前移。
  const spanning = lines.filter((l) => l.spanning).sort((a, b) => a.baseline - b.baseline);
  const spanIdx = new Map<Line, number>();
  spanning.forEach((s, i) => spanIdx.set(s, i));
  const zoneOf = (y: number): number => {
    let z = 0;
    for (const s of spanning) {
      if (s.baseline < y) z++;
      else break;
    }
    return z;
  };
  const keyed = lines.map((l) => {
    const k = l.spanning ? [spanIdx.get(l)!, 1, -1, 0] : [zoneOf(l.baseline), 0, l.col, l.baseline];
    return { l, k };
  });
  keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3]);

  // 标记块起点：栏变化/通栏切换处断段，供段落组装
  let prev: Line | null = null;
  for (const { l } of keyed) {
    l.blockStart = !prev || l.col !== prev.col || l.spanning !== prev.spanning;
    prev = l;
  }
  return keyed.map((x) => x.l);
}

/**
 * 表格检测（行级、栏内）：分栏后，在每页每栏内找「同一 baseline 上 ≥3 行（单元格）」的表格行，
 * 允许中间夹杂 ≤2 行单元格折行（如 "(sd)"、"loon Pumping"），连续 ≥3 个表格行聚成表格区域。
 * 通栏行（col=-1）不参与。返回各页表格区域包围盒（scale 1），供正文摘除 + 图片化。
 */
function detectTableRegions(
  lines: Line[],
  pageSizes: Map<number, { w: number; h: number }>,
): Map<number, PageRect[]> {
  const byPageCol = new Map<string, Line[]>();
  for (const l of lines) {
    if (l.col < 0) continue; // 通栏行不参与
    const key = `${l.page}:${l.col}`;
    let arr = byPageCol.get(key);
    if (!arr) byPageCol.set(key, (arr = []));
    arr.push(l);
  }
  const out = new Map<number, PageRect[]>();
  for (const group of byPageCol.values()) {
    const pageNum = group[0].page;
    group.sort((a, b) => a.baseline - b.baseline);
    // 同一 baseline 的行带（= 表格的一行单元格）
    const rows: Line[][] = [];
    for (const l of group) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(l.baseline - row[0].baseline) <= row[0].fontHeight * 0.5) row.push(l);
      else rows.push([l]);
    }
    let run: Line[][] = [];
    let tableRows = 0;
    let sinceTable = 0;
    const flush = () => {
      if (tableRows >= 3) {
        // 表格行（≥3 格）决定表格的 x 范围；折行/单格行只在其 x 范围内才算入，
        // 排除表格下方通栏脚注（如 "SOFA Deviation was defined…"）把区域撑宽导致 width 校验失败。
        const tCells = run.filter((r) => r.length >= 3).flat();
        const minL = Math.min(...tCells.map((l) => l.left));
        const maxR = Math.max(...tCells.map((l) => l.right));
        const kept = run.flat().filter((l) => l.left >= minL - 2 && l.right <= maxR + 2);
        const x0 = Math.min(...kept.map((l) => l.left));
        const x1 = Math.max(...kept.map((l) => l.right));
        const y0 = Math.min(...kept.map((l) => l.baseline - l.fontHeight));
        const y1 = Math.max(...kept.map((l) => l.baseline));
        const r = { x: x0 - 2, y: y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 };
        const size = pageSizes.get(pageNum);
        if (r.w > 0 && r.h > 0 && (!size || r.w < size.w * 0.9)) {
          let arr = out.get(pageNum);
          if (!arr) out.set(pageNum, (arr = []));
          arr.push(r);
        }
      }
      run = [];
      tableRows = 0;
      sinceTable = 0;
    };
    for (const row of rows) {
      if (row.length >= 3) {
        run.push(row);
        tableRows++;
        sinceTable = 0;
      } else if (run.length > 0 && sinceTable < 2) {
        run.push(row);
        sinceTable++;
      } else {
        flush();
      }
    }
    flush();
  }
  // 区域上延展：吸收表头上方紧邻的窄短行（如 "category"、列组标题 "SOFA-2 Matching"），
  // 补齐「≥3 格才算表格行」遗漏的表头；图注行（CAPTION_RE）不吸收，避免把标题烘焙进图。
  for (const [pageNum, regions] of out) {
    const size = pageSizes.get(pageNum);
    if (!size) continue;
    const pageLines = lines.filter((l) => l.page === pageNum);
    for (const r of regions) {
      let grown = true;
      while (grown) {
        grown = false;
        for (const l of pageLines) {
          if (CAPTION_RE.test(l.text)) continue;
          if (l.text.length > 60) continue; // 长句是正文，非表头标签
          if (l.right - l.left > (size?.w ?? Infinity) * 0.55) continue;
          const cx = (l.left + l.right) / 2;
          if (cx < r.x - 2 || cx > r.x + r.w + 2) continue;
          const top = l.baseline - l.fontHeight;
          const bottom = l.baseline;
          const regionBottom = r.y + r.h;
          const gapAbove = r.y - bottom;
          if (gapAbove >= 0 && gapAbove <= l.fontHeight * 2) {
            r.x = Math.min(r.x, l.left);
            r.w = Math.max(r.x + r.w, l.right) - Math.min(r.x, l.left);
            r.y = top;
            r.h = regionBottom - top;
            grown = true;
          }
        }
      }
    }
  }
  return out;
}

/** 剔除页眉页脚：页面上/下 8% 区域内、在 ≥60% 页面重复出现的行，以及页边距处的页码 */
function removeBoilerplate(lines: Line[]): Line[] {
  const inMargin = (l: Line) => l.relY <= 0.08 || l.relY >= 0.92;
  const pageTotal = new Set(lines.map((l) => l.page)).size;
  const counts = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!inMargin(l)) continue;
    const key = l.text.replace(/\s+/g, '');
    if (!key) continue;
    let set = counts.get(key);
    if (!set) counts.set(key, (set = new Set()));
    set.add(l.page);
  }
  return lines.filter((l) => {
    if (!inMargin(l)) return true;
    const key = l.text.replace(/\s+/g, '');
    if (PAGE_NUM.test(key)) return false;
    const pages = counts.get(key);
    if (pages && pageTotal >= 3 && pages.size / pageTotal >= 0.6) return false;
    return true;
  });
}

/** 段内跨行拼接：西文断词去连字符，CJK 相邻直接连，其余补空格 */
function joinParagraph(lines: Line[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) {
      out = l.text;
      continue;
    }
    if (out.endsWith('-') && /^[a-z0-9]/.test(l.text)) {
      out = out.slice(0, -1) + l.text;
    } else if (CJK.test(out[out.length - 1]) || CJK.test(l.text[0])) {
      out += l.text;
    } else {
      out += ' ' + l.text;
    }
  }
  return fixUrlSpaces(out);
}

/**
 * 修复 URL/DOI 被 pdf 文本提取插入的空格：URL/DOI 常因字符间距放大被 joinSegment 误插空格，
 * 形态如 "h t tp s : // d oi .o rg / 1 0 . 1 0 0 1"、"https:/ /doi.org/10.11 86/s 40560"。
 * 归一化协议/域名前缀后，把其后 URL/DOI 主体段内的单空格去掉；主体只匹配小写字母/数字/URL 标点，
 * 在「空格 + 数字. 空格」（下一条目编号）或「空格 + 大写」（下一句/作者名）处停止，避免吞掉正文。
 */
function fixUrlSpaces(text: string): string {
  // 前缀归一化（大小写不敏感）
  text = text
    .replace(/h\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\/\s*/gi, 'https://')
    .replace(/d\s*o\s*i\s*\.?\s*o\s*r\s*g\s*\/\s*/gi, 'doi.org/')
    .replace(/w\s*w\s*w\s*\.\s*/gi, 'www.');
  // 主体去空格（大小写敏感：大写字母即视为正文边界）
  return text.replace(
    /(https?:\/\/|doi\.org\/|www\.|10\.\d{3,5}\/)\s*([a-z0-9./:_~\-?=&%#]+(?:\s+(?!\d{1,3}\.\s)[a-z0-9./:_~\-?=&%#]+)*)/g,
    (_m, prefix: string, body: string) => prefix + body.replace(/\s+/g, ''),
  );
}

function padRect(r: PageRect, p: number): PageRect {
  return { x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 };
}

interface PendingFigure {
  page: number;
  caption?: string;
  region: PageRect;
}

interface CaptionGroup {
  /** 起始行在 lines 中的下标 */
  start: number;
  /** 结束行下标（不含） */
  end: number;
  capLines: Line[];
}

/** 识别图注候选组（含续行：同页同栏、行距 ≤1.4×中位行距，至多 6 行） */
function findCaptionGroups(lines: Line[], gapMedian: number): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const capMatch = l.text.match(CAPTION_RE);
    if (!capMatch) {
      i++;
      continue;
    }
    // 排除文中引用：编号后紧跟 ")"（"Fig. 6)"）或子图字母+逗号/括号（"Fig. 8C, D)"）
    // 是句中引用而非图注，避免把正文句误判为图注并关联到错误图形区域。
    const afterNum = l.text.slice(capMatch[0].length);
    if (/^\s*(?:\)|\]|[A-H]\s*[),;:])/.test(afterNum)) {
      i++;
      continue;
    }
    const capLines = [l];
    let j = i + 1;
    while (j < lines.length && capLines.length < 6) {
      const cont = lines[j];
      if (cont.page !== l.page) break;
      if (CAPTION_RE.test(cont.text)) break;
      // 通栏图注（spanning）的最后一行常是短行（落单栏 col=0），不能按栏位卡断；
      // 栏内图注（col>=0）的续行仍须同栏，避免吸入另一栏正文。
      if (l.col >= 0 && cont.col !== l.col) break;
      const prevCap = capLines[capLines.length - 1];
      if (cont.baseline - prevCap.baseline > gapMedian * 1.4) break;
      capLines.push(cont);
      j++;
    }
    groups.push({ start: i, end: j, capLines });
    i = j;
  }
  return groups;
}

/**
 * band fallback：图注未关联到连通域时，退回「相邻正文行之间的空白带」逻辑。
 * 带内若有位图矩形则取并集，否则空白带本身合理时整体裁剪。
 */
function locateFigureRegion(
  capLines: Line[],
  prevLine: Line | null,
  nextLine: Line | null,
  info: PageInfo,
  imgRects: PageRect[],
): PageRect | null {
  const first = capLines[0];
  const last = capLines[capLines.length - 1];
  const range = info.colRanges.get(first.col) ?? { x0: 0, x1: info.w };
  const capTop = first.baseline - first.fontHeight;
  const capBottom = last.baseline + last.fontHeight * 0.25;
  const prevBottom = prevLine ? prevLine.baseline + prevLine.fontHeight * 0.25 : info.h * 0.08;
  const nextTop = nextLine ? nextLine.baseline - nextLine.fontHeight : info.h * 0.92;

  const bandAbove: PageRect = {
    x: range.x0,
    y: prevBottom,
    w: range.x1 - range.x0,
    h: capTop - prevBottom,
  };
  const bandBelow: PageRect = {
    x: range.x0,
    y: capBottom,
    w: range.x1 - range.x0,
    h: nextTop - capBottom,
  };

  const tryBand = (band: PageRect): PageRect | null => {
    if (band.h < 0 || band.w <= 0) return null;
    const hits = imgRects.filter((r) => rectsOverlap(r, padRect(band, 2)));
    let region = hits.length > 0 ? unionRects(hits) : band.h >= 24 ? band : null;
    if (!region) return null;
    region = padRect(region, 2);
    if (region.h < 24 || region.h > info.h * 0.9 || region.w < 40) return null;
    return region;
  };

  const tableLike = TABLE_CAPTION_RE.test(first.text);
  const first2 = tableLike ? tryBand(bandBelow) : tryBand(bandAbove);
  return first2 ?? (tableLike ? tryBand(bandAbove) : tryBand(bandBelow));
}

/**
 * 图注关联连通域：图/Figure 看上方（连通域底边贴近图注顶）、表/Table 看下方，
 * 横向与图注所在栏范围有重叠；邻接窗口内多个连通域取并集（子图并排）。
 */
function associateCaption(
  group: CaptionGroup,
  components: PageRect[],
  consumed: Set<number>,
  info: PageInfo,
): PageRect | null {
  const first = group.capLines[0];
  const last = group.capLines[group.capLines.length - 1];
  const range = info.colRanges.get(first.col) ?? { x0: 0, x1: info.w };
  const colRect = { x: range.x0 - 10, y: 0, w: range.x1 - range.x0 + 20, h: info.h };
  const capTop = first.baseline - first.fontHeight;
  const capBottom = last.baseline + last.fontHeight * 0.25;
  const font = first.fontHeight;

  const pick = (above: boolean): PageRect | null => {
    const hits: { idx: number; r: PageRect }[] = [];
    for (let idx = 0; idx < components.length; idx++) {
      if (consumed.has(idx)) continue;
      const r = components[idx];
      if (!rectsOverlap(r, colRect)) continue;
      if (above) {
        const bottom = r.y + r.h;
        if (bottom < capTop - font * 1.5 || bottom > capTop + font * 0.5) continue;
      } else {
        if (r.y > capBottom + font * 1.5 || r.y < capBottom - font * 0.5) continue;
      }
      hits.push({ idx, r });
    }
    if (hits.length === 0) return null;
    let region = unionRects(hits.map((h) => h.r));
    // 传递性吞并：同一张图被白缝切成多块时，只有部分块贴住图注；
    // 把与并集重叠（含 6pt 近邻）的未消费连通域逐轮并入，直到不再增长
    let grown = true;
    while (grown) {
      grown = false;
      for (let idx = 0; idx < components.length; idx++) {
        if (consumed.has(idx) || hits.some((h) => h.idx === idx)) continue;
        const r = components[idx];
        if (!rectsOverlap(r, padRect(region, 6))) continue;
        hits.push({ idx, r });
        region = unionRects([region, r]);
        grown = true;
      }
    }
    region = padRect(region, 2);
    if (region.h < 20 || region.h > info.h * 0.9 || region.w < 30) return null;
    for (const h of hits) consumed.add(h.idx);
    return region;
  };

  const tableLike = TABLE_CAPTION_RE.test(first.text);
  const first2 = tableLike ? pick(false) : pick(true);
  return first2 ?? (tableLike ? pick(true) : pick(false));
}

/** 表格图注 → 表格区域：找图注下方最近、x 有重叠的表格区域（表格题在表上方） */
function matchTableRegion(capLines: Line[], regions: PageRect[]): PageRect | null {
  const first = capLines[0];
  const last = capLines[capLines.length - 1];
  const capBottom = last.baseline + last.fontHeight * 0.25;
  const capX0 = Math.min(...capLines.map((c) => c.left));
  const capX1 = Math.max(...capLines.map((c) => c.right));
  let best: PageRect | null = null;
  let bestD = Infinity;
  for (const r of regions) {
    if (r.y < capBottom - last.fontHeight) continue; // 区域在图注上方
    const overlap = Math.min(capX1, r.x + r.w) - Math.max(capX0, r.x);
    if (overlap < 0) continue; // x 无重叠
    const d = r.y - capBottom;
    if (d >= -last.fontHeight && d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best && bestD <= first.fontHeight * 3 ? best : null;
}

/** 组装阶段的内部 figure block（含裁剪区域与失败标记），出库前剥离 */
interface FigureBlockInternal {
  type: 'figure';
  src: string;
  caption?: string;
  page: number;
  aspect: number;
  region: PageRect;
  failed: boolean;
}
type TextBlock = Extract<ArticleBlock, { type: 'h1' | 'h2' | 'p' }>;
type BlockInternal = TextBlock | FigureBlockInternal;

/**
 * 提取全文语义化正文（含图片）。逐页顺序 await（避免 worker 并发洪峰）。
 * @param startPage 正文起始页（复用 bodyStartPage，跳过封面/目录）
 * @returns 空数组表示没有可提取文本（扫描件）
 */
export async function extractArticleBlocks(
  pdfDoc: PDFDocumentProxy,
  startPage = 1,
): Promise<ArticleBlock[]> {
  let lines: Line[] = [];
  const pageSizes = new Map<number, { w: number; h: number }>();
  const imgRectsByPage = new Map<number, PageRect[]>();
  const pathOpsByPage = new Map<number, number>();
  const first = Math.min(Math.max(1, startPage), pdfDoc.numPages);

  for (let n = first; n <= pdfDoc.numPages; n++) {
    try {
      const page = await pdfDoc.getPage(n);
      try {
        const viewport = page.getViewport({ scale: 1 });
        pageSizes.set(n, { w: viewport.width, h: viewport.height });
        const tc = await page.getTextContent();
        let items: Item[] = [];
        for (const it of tc.items) {
          if (!('str' in it)) continue;
          const str = it.str;
          if (!str || !str.trim()) continue;
          const tx = pdfjs.Util.transform(viewport.transform, it.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          if (fontHeight <= 0) continue;
          if (Math.abs(Math.atan2(tx[1], tx[0])) > 1e-6) continue; // 旋转文本（竖排/水印）跳过
          items.push({ str, left: tx[4], baseline: tx[5], width: it.width, fontHeight });
        }
        lines.push(...buildLines(items, n, viewport.width, viewport.height));
        const ops = await getGraphicsOpsInfo(page, viewport);
        imgRectsByPage.set(n, ops.rects);
        pathOpsByPage.set(n, ops.pathOps);
      } finally {
        page.cleanup();
      }
    } catch {
      /* 坏页跳过 */
    }
  }

  lines = removeBoilerplate(lines);
  if (lines.length === 0) return [];

  // 表格检测 + 摘除：定位表格区域，把区域内文字从正文流摘除，区域交给 figure 管线图片化
  const tableRegionsByPage = detectTableRegions(lines, pageSizes);
  if (tableRegionsByPage.size > 0) {
    lines = lines.filter((l) => {
      const regions = tableRegionsByPage.get(l.page);
      if (!regions) return true;
      return !regions.some(
        (r) =>
          l.left >= r.x &&
          l.right <= r.x + r.w &&
          l.baseline - l.fontHeight >= r.y &&
          l.baseline <= r.y + r.h,
      );
    });
  }

  // 表格摘除后按页重排：表格单元格/表注此前可能把栏沟投影抹掉，导致分栏退化为单栏；
  // 重排后基于干净正文重新检测栏与阅读顺序。
  {
    const byPage = new Map<number, Line[]>();
    for (const l of lines) {
      let arr = byPage.get(l.page);
      if (!arr) byPage.set(l.page, (arr = []));
      arr.push(l);
    }
    const reflowed: Line[] = [];
    for (const [n, pageLines] of byPage) {
      const size = pageSizes.get(n);
      reflowed.push(...(size ? reflowLines(pageLines, size.w) : pageLines));
    }
    lines = reflowed;
  }

  // 每页每栏的文本 x 范围（图形区域的横向基准）
  const pageInfos = new Map<number, PageInfo>();
  for (const l of lines) {
    const size = pageSizes.get(l.page);
    if (!size) continue;
    let info = pageInfos.get(l.page);
    if (!info) pageInfos.set(l.page, (info = { ...size, colRanges: new Map() }));
    const range = info.colRanges.get(l.col);
    if (range) {
      range.x0 = Math.min(range.x0, l.left);
      range.x1 = Math.max(range.x1, l.right);
    } else {
      info.colRanges.set(l.col, { x0: l.left, x1: l.right });
    }
  }

  const fontMedian = median(lines.map((l) => l.fontHeight));
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page !== lines[i - 1].page) continue;
    const g = lines[i].baseline - lines[i - 1].baseline;
    if (g > 0) gaps.push(g);
  }
  const gapMedian = median(gaps) || fontMedian * 1.5;

  const captionGroups = findCaptionGroups(lines, gapMedian);
  const captionPages = new Set(captionGroups.map((g) => g.capLines[0].page));

  // 视觉分割：只渲染「含图注候选 或 含位图/大量 path 操作」的页
  const linesByPage = new Map<number, Line[]>();
  for (const l of lines) {
    let arr = linesByPage.get(l.page);
    if (!arr) linesByPage.set(l.page, (arr = []));
    arr.push(l);
  }
  const canvasByPage = new Map<number, HTMLCanvasElement>();
  const componentsByPage = new Map<number, PageRect[]>();
  const pagesToRender: number[] = [];
  for (const [n] of pageSizes) {
    if (
      captionPages.has(n) ||
      (tableRegionsByPage.get(n)?.length ?? 0) > 0 ||
      (imgRectsByPage.get(n)?.length ?? 0) > 0 ||
      (pathOpsByPage.get(n) ?? 0) > 10
    ) {
      pagesToRender.push(n);
    }
  }
  for (const n of pagesToRender) {
    const size = pageSizes.get(n)!;
    const canvas = await renderPageCanvas(pdfDoc, n, RENDER_SCALE);
    if (!canvas) {
      componentsByPage.set(n, []);
      continue;
    }
    canvasByPage.set(n, canvas);
    const textRects: PageRect[] = (linesByPage.get(n) ?? []).map((l) => ({
      x: l.left,
      y: l.baseline - l.fontHeight,
      w: Math.max(l.right - l.left, 1),
      h: l.fontHeight * 1.3,
    }));
    componentsByPage.set(n, analyzePageGraphics(canvas, textRects, size.w, size.h));
  }

  // 页眉页脚重复图过滤：页边距区域内、在 ≥60% 被渲染页面同位置同尺寸出现 → logo
  {
    const inMargin = (r: PageRect, h: number) => r.y <= h * 0.08 || r.y + r.h >= h * 0.92;
    const counts = new Map<string, Set<number>>();
    for (const [n, comps] of componentsByPage) {
      const h = pageSizes.get(n)!.h;
      for (const r of comps) {
        if (!inMargin(r, h)) continue;
        const key = [r.x, r.y, r.w, r.h].map((v) => Math.round(v / 4)).join(':');
        let set = counts.get(key);
        if (!set) counts.set(key, (set = new Set()));
        set.add(n);
      }
    }
    const total = componentsByPage.size;
    if (total >= 3) {
      for (const [n, comps] of componentsByPage) {
        const h = pageSizes.get(n)!.h;
        componentsByPage.set(
          n,
          comps.filter((r) => {
            if (!inMargin(r, h)) return true;
            const key = [r.x, r.y, r.w, r.h].map((v) => Math.round(v / 4)).join(':');
            return (counts.get(key)?.size ?? 0) / total < 0.6;
          }),
        );
      }
    }
  }

  // 图注关联：命中连通域的图注组 → figure（消费连通域）；未命中走 band fallback。
  // 表格图注单独走表格区域绑定（图注在上方），不参与连通域匹配/空白带 fallback。
  const matchedGroups = new Map<number, { end: number; figure: PendingFigure }>();
  const consumedByPage = new Map<number, Set<number>>();
  const tableTakenByPage = new Map<number, PageRect[]>();
  for (const g of captionGroups) {
    const pageNum = g.capLines[0].page;
    const info = pageInfos.get(pageNum);
    if (!info) continue;
    const caption = g.capLines.map((c) => c.text).join(' ');

    if (TABLE_CAPTION_RE.test(g.capLines[0].text)) {
      const region = matchTableRegion(g.capLines, tableRegionsByPage.get(pageNum) ?? []);
      if (!region) continue; // 无表格区域，图注按普通段落保留
      matchedGroups.set(g.start, { end: g.end, figure: { page: pageNum, caption, region } });
      let taken = tableTakenByPage.get(pageNum);
      if (!taken) tableTakenByPage.set(pageNum, (taken = []));
      taken.push(region);
      continue;
    }

    let consumed = consumedByPage.get(pageNum);
    if (!consumed) consumedByPage.set(pageNum, (consumed = new Set()));
    let region = associateCaption(g, componentsByPage.get(pageNum) ?? [], consumed, info);
    if (!region) {
      // fallback：空白带 + 位图矩形
      const prevLine =
        g.start > 0 && lines[g.start - 1].page === pageNum && lines[g.start - 1].col === g.capLines[0].col
          ? lines[g.start - 1]
          : null;
      const nextLine =
        g.end < lines.length && lines[g.end].page === pageNum && lines[g.end].col === g.capLines[0].col
          ? lines[g.end]
          : null;
      region = locateFigureRegion(g.capLines, prevLine, nextLine, info, imgRectsByPage.get(pageNum) ?? []);
    }
    if (!region) continue; // 图注按普通段落保留
    matchedGroups.set(g.start, { end: g.end, figure: { page: pageNum, caption, region } });
  }

  // 构建正文行流（摘除已匹配图注行），记录图注锚定的 figure 插入位置
  const flowLines: Line[] = [];
  const figuresAt = new Map<number, PendingFigure[]>();
  const pushFigure = (fig: PendingFigure) => {
    let arr = figuresAt.get(flowLines.length);
    if (!arr) figuresAt.set(flowLines.length, (arr = []));
    arr.push(fig);
  };
  {
    let i = 0;
    while (i < lines.length) {
      const m = matchedGroups.get(i);
      if (m) {
        pushFigure(m.figure);
        i = m.end;
        continue;
      }
      flowLines.push(lines[i]);
      i++;
    }
  }

  // 无图注大图：未消费、非页边距、尺寸足够大的连通域，锚定到区域下缘之后。
  // 已被图注 figure 占用的区域（含 band fallback）不再重复出图；
  // 已接受的无图注区域也登记，碎块之间互相去重——保证任意两个 figure 区域不重叠。
  const takenByPage = new Map<number, PageRect[]>();
  for (const m of matchedGroups.values()) {
    let arr = takenByPage.get(m.figure.page);
    if (!arr) takenByPage.set(m.figure.page, (arr = []));
    arr.push(m.figure.region);
  }
  // 表格区域全部登记去重（含未绑定图注的），避免有边框表的边框连通域重复出图
  for (const [pageNum, regions] of tableRegionsByPage) {
    let arr = takenByPage.get(pageNum);
    if (!arr) takenByPage.set(pageNum, (arr = []));
    arr.push(...regions);
  }
  for (const [pageNum, comps] of componentsByPage) {
    const info = pageInfos.get(pageNum);
    const consumed = consumedByPage.get(pageNum) ?? new Set<number>();
    if (!info) continue;
    let taken = takenByPage.get(pageNum);
    if (!taken) takenByPage.set(pageNum, (taken = []));
    for (let idx = 0; idx < comps.length; idx++) {
      if (consumed.has(idx)) continue;
      const r = padRect(comps[idx], 2);
      if (r.w < 60 || r.h < 40) continue;
      if (taken.some((t) => rectsOverlap(r, t))) continue;
      const centerY = r.y + r.h / 2;
      if (centerY <= info.h * 0.08 || centerY >= info.h * 0.92) continue;
      taken.push(r);
      const bottom = r.y + r.h;
      // 插入位置 = 阅读流中该区域下缘之后的第一行
      let pos = 0;
      while (pos < flowLines.length) {
        const l = flowLines[pos];
        if (l.page > pageNum) break;
        if (l.page === pageNum && l.baseline + l.fontHeight * 0.25 > bottom) break;
        pos++;
      }
      let arr = figuresAt.get(pos);
      if (!arr) figuresAt.set(pos, (arr = []));
      arr.push({ page: pageNum, region: r });
    }
  }

  // 未绑定图注的表格区域：按无图注大图处理，图片化输出（无 figcaption）
  for (const [pageNum, regions] of tableRegionsByPage) {
    const matched = tableTakenByPage.get(pageNum) ?? [];
    for (const region of regions) {
      if (matched.some((t) => rectsOverlap(t, region))) continue;
      const r = padRect(region, 2);
      const bottom = r.y + r.h;
      let pos = 0;
      while (pos < flowLines.length) {
        const l = flowLines[pos];
        if (l.page > pageNum) break;
        if (l.page === pageNum && l.baseline + l.fontHeight * 0.25 > bottom) break;
        pos++;
      }
      let arr = figuresAt.get(pos);
      if (!arr) figuresAt.set(pos, (arr = []));
      arr.push({ page: pageNum, region: r });
    }
  }

  const isHeading = (l: Line) => l.text.length < 40 && fontMedian > 0 && l.fontHeight >= fontMedian * 1.3;

  const blocks: BlockInternal[] = [];
  let para: Line[] = [];
  let refsMode = false;
  const flush = () => {
    if (para.length === 0) return;
    blocks.push({ type: 'p', text: joinParagraph(para), page: para[0].page });
    para = [];
  };
  for (let i = 0; i <= flowLines.length; i++) {
    const figs = figuresAt.get(i);
    if (figs) {
      for (const fig of figs) {
        flush();
        blocks.push({
          type: 'figure',
          src: '',
          caption: fig.caption,
          page: fig.page,
          aspect: fig.region.w / fig.region.h,
          region: fig.region,
          failed: false,
        });
      }
    }
    if (i === flowLines.length) break;
    const l = flowLines[i];
    const refsHeading = REFS_HEADING.test(l.text);
    if (isHeading(l) || refsHeading) {
      flush();
      blocks.push({
        type: l.fontHeight >= fontMedian * 1.8 ? 'h1' : 'h2',
        text: l.text,
        page: l.page,
      });
      if (refsHeading) refsMode = true;
      continue;
    }
    if (l.page !== (flowLines[i - 1]?.page ?? l.page)) refsMode = false;
    const prev = flowLines[i - 1];
    const breakHere =
      !prev ||
      isHeading(prev) ||
      figuresAt.has(i) ||
      prev.page !== l.page ||
      l.blockStart ||
      l.baseline - prev.baseline > gapMedian * 1.4 ||
      (refsMode && REF_ENTRY.test(l.text));
    if (breakHere) flush();
    para.push(l);
  }
  flush();

  // 从缓存的页面渲染裁剪；失败：有图注的降级为段落，无图注的整块丢弃
  for (const b of blocks) {
    if (b.type !== 'figure') continue;
    const canvas = canvasByPage.get(b.page);
    const src = canvas ? clipFromCanvas(canvas, b.region, RENDER_SCALE) : null;
    if (src) b.src = src;
    else b.failed = true;
  }
  canvasByPage.clear(); // 释放渲染内存

  const out: ArticleBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'figure') {
      if (b.failed || !b.src) {
        if (b.caption) out.push({ type: 'p', text: b.caption, page: b.page });
        continue;
      }
      out.push({ type: 'figure', src: b.src, caption: b.caption, page: b.page, aspect: b.aspect });
    } else if (b.text) {
      out.push(b);
    }
  }
  return out;
}
