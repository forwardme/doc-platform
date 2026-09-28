// 调试：逐页复现 item → 行 → 栏检测，打印每页检测出的栏数与栏 x 范围。
// 用 pdfjs legacy build 提取 item（与 extractArticleBlocks 相同），不含 canvas。
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';

interface Item { str: string; left: number; baseline: number; width: number; fontHeight: number; }

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface Line { text: string; left: number; right: number; baseline: number; fontHeight: number; col: number; spanning: boolean; }

function joinSegment(seg: Item[]): Line {
  let text = '';
  let prev: Item | null = null;
  let maxFont = 0;
  let right = 0;
  for (const it of seg) {
    if (prev) {
      const gap = it.left - (prev.left + prev.width);
      if (gap > prev.fontHeight * 0.25) text += ' ';
    }
    text += it.str;
    prev = it;
    if (it.fontHeight > maxFont) maxFont = it.fontHeight;
    right = Math.max(right, it.left + it.width);
  }
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    left: seg[0].left,
    right,
    baseline: seg.reduce((s, x) => s + x.baseline, 0) / seg.length,
    fontHeight: maxFont,
    col: 0,
    spanning: false,
  };
}

function detectColumns(lines: Line[], pageWidth: number, fontMedian: number) {
  const gapMin = fontMedian * 1.5;
  const narrow = lines
    .filter((l) => l.right - l.left > 0 && l.right - l.left < pageWidth * 0.55)
    .map((l) => ({ x0: l.left, x1: l.right }))
    .sort((a, b) => a.x0 - b.x0);
  const ranges: Array<{ x0: number; x1: number }> = [];
  if (narrow.length >= 2) {
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
  }
  const kept = ranges.length <= 1 ? ranges : ranges.filter((r) => r.x1 - r.x0 > pageWidth * 0.15);
  return { narrow: narrow.length, kept: kept.length > 0 ? kept : [{ x0: 0, x1: pageWidth }], fontMedian, gapMin };
}

async function main() {
  const bytes = new Uint8Array(readFileSync('/Users/gaoyuan/workplace/doc-platform/data/original/1_uloouovb.pdf'));
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  const maxPage = Number(process.argv[2] ?? 4);
  for (let n = 1; n <= Math.min(maxPage, doc.numPages); n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const str = it.str;
      if (!str || !str.trim()) continue;
      const tx = pdfjs.Util.transform(viewport.transform, it.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      if (fontHeight <= 0) continue;
      if (Math.abs(Math.atan2(tx[1], tx[0])) > 1e-6) continue;
      items.push({ str, left: tx[4], baseline: tx[5], width: it.width, fontHeight });
    }
    // banding + gap-split（复现 buildLines 前两步）
    const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.left - b.left);
    const bands: Item[][] = [];
    for (const it of sorted) {
      const band = bands[bands.length - 1];
      if (band && Math.abs(it.baseline - band[0].baseline) <= Math.max(it.fontHeight, band[0].fontHeight) * 0.5) band.push(it);
      else bands.push([it]);
    }
    const lines: Line[] = [];
    for (const band of bands) {
      const seg = [...band].sort((a, b) => a.left - b.left);
      let cur: Item[] = [seg[0]];
      for (let i = 1; i < seg.length; i++) {
        const prev = cur[cur.length - 1];
        if (seg[i].left - (prev.left + prev.width) > prev.fontHeight * 1.2) {
          lines.push(joinSegment(cur));
          cur = [seg[i]];
        } else cur.push(seg[i]);
      }
      lines.push(joinSegment(cur));
    }
    const fontMedian = median(items.map((i) => i.fontHeight));
    const res = detectColumns(lines.filter((l) => l.text), viewport.width, fontMedian);
    console.log(
      `P${n} w=${viewport.width.toFixed(0)} 行数=${lines.length} 窄行=${res.narrow} fontMedian=${res.fontMedian.toFixed(1)} 栏=${res.kept.length} ` +
        res.kept.map((c) => `[${c.x0.toFixed(0)},${c.x1.toFixed(0)}]`).join(' '),
    );
    // 段间隙直方图（band 内相邻 item 的间隙，以 em 计）
    const gapsEm: number[] = [];
    for (const band of bands) {
      const seg = [...band].sort((a, b) => a.left - b.left);
      for (let i = 1; i < seg.length; i++) {
        const prev = seg[i - 1];
        const gap = seg[i].left - (prev.left + prev.width);
        if (gap > 0) gapsEm.push(gap / Math.max(prev.fontHeight, 1));
      }
    }
    gapsEm.sort((a, b) => a - b);
    const pct = (p: number) => gapsEm[Math.min(gapsEm.length - 1, Math.floor((gapsEm.length * p) / 100))];
    console.log(`   间隙(em) p50=${pct(50).toFixed(2)} p90=${pct(90).toFixed(2)} p98=${pct(98).toFixed(2)} max=${gapsEm[gapsEm.length - 1].toFixed(2)} 样本=${gapsEm.length}`);
    const wide = lines.filter((l) => l.right - l.left > viewport.width * 0.55).slice(0, 2);
    for (const w of wide) console.log(`   宽行[${w.left.toFixed(0)},${w.right.toFixed(0)}] "${w.text.slice(0, 60)}"`);
    page.cleanup();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
