// 调试表格检测：逐页打印 baseline 带及其「单元格」数（2em 切段），看表格的网格结构。
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';

interface Item { str: string; left: number; baseline: number; width: number; fontHeight: number; }

async function main() {
  const bytes = new Uint8Array(readFileSync('/Users/gaoyuan/workplace/doc-platform/data/original/1_uloouovb.pdf'));
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  const target = Number(process.argv[2] ?? 2);
  const page = await doc.getPage(target);
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
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  const bands: Item[][] = [];
  for (const it of sorted) {
    const band = bands[bands.length - 1];
    if (band && Math.abs(it.baseline - band[0].baseline) <= Math.max(it.fontHeight, band[0].fontHeight) * 0.5) band.push(it);
    else bands.push([it]);
  }
  console.log(`\n=== 第 ${target} 页，共 ${bands.length} 个带 ===`);
  for (const band of bands) {
    const seg = [...band].sort((a, b) => a.left - b.left);
    const cells: { x0: number; x1: number; text: string }[] = [];
    let cur: Item[] = [seg[0]];
    for (let i = 1; i < seg.length; i++) {
      const prev = cur[cur.length - 1];
      if (seg[i].left - (prev.left + prev.width) > prev.fontHeight * 2) {
        cells.push({ x0: cur[0].left, x1: Math.max(...cur.map((c) => c.left + c.width)), text: cur.map((c) => c.str).join(' ') });
        cur = [seg[i]];
      } else cur.push(seg[i]);
    }
    cells.push({ x0: cur[0].left, x1: Math.max(...cur.map((c) => c.left + c.width)), text: cur.map((c) => c.str).join(' ') });
    const y = band[0].baseline.toFixed(0);
    const cellsTxt = cells.map((c) => `[${c.x0.toFixed(0)}]${c.text.slice(0, 22)}`).join(' | ');
    console.log(`  y=${y} 格=${cells.length}  ${cellsTxt}`);
  }
  page.cleanup();
}
main().catch((e) => { console.error(e); process.exit(1); });
