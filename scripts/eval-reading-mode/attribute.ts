// 块→页归属：把阅读模式输出块对应到 PDF 页码，仅用于把"原始页面截图"与"当页提取内容"
// 配对交给 LLM 对照，不参与评分。
//
// 文本块：归一化后（小写 + 去空白/连字符）先做逐页子串精确匹配（单调向后搜索）；
// 匹配失败（应用重排顺序与 PDF 内容流顺序不一致时会发生）退化为 n-gram 包含度评分，
// 按包含度最高的页归属 —— 对页内顺序不敏感。
// 图片块：按相邻文本块的页码归属（应用把图片锚定在其下方首行之前）。

import type { AttributedBlock, CapturedBlock, PageGt } from './types';

// 需剔除的"空白/连字符类"字符：U+00AD 软连字符、U+200B 零宽空格、U+2010..U+2015 各类连字符/破折号。
// 用 fromCharCode 拼，避免源码里出现不可见字符；ASCII '-' 拼在字符组末尾表示字面连字符。
const DASH_CLASS = String.fromCharCode(0x00ad, 0x200b, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015);
const STRIP_RE = new RegExp('[\\s' + DASH_CLASS + '-]+', 'g');

/** 归一化：小写、去所有空白与各类连字符（含 GT 行尾软连字符差异） */
export function normalize(s: string): string {
  return s.toLowerCase().replace(STRIP_RE, '');
}

const GRAM = 8;
const MAX_GRAMS = 150;

/** 采样 n-gram（整串不足一个 gram 时以整串为一个 gram） */
function grams(norm: string): string[] {
  if (!norm) return [];
  if (norm.length <= GRAM) return [norm];
  const step = Math.max(1, Math.ceil((norm.length - GRAM + 1) / MAX_GRAMS));
  const out: string[] = [];
  for (let i = 0; i + GRAM <= norm.length; i += step) out.push(norm.slice(i, i + GRAM));
  return out;
}

/** 计算块的 n-gram 在某页归一化文本中的包含比例 */
function containment(norm: string, pageNorm: string): number {
  const g = grams(norm);
  if (!g.length) return 0;
  let hit = 0;
  for (const x of g) if (pageNorm.includes(x)) hit++;
  return hit / g.length;
}

export function attributeBlocks(blocks: CapturedBlock[], pages: PageGt[]): AttributedBlock[] {
  const normPages = pages.map((p) => ({ page: p.page, norm: normalize(p.text) }));
  const out: AttributedBlock[] = blocks.map((block, index) => ({
    index,
    block,
    page: null,
    spansPages: false,
    method: 'unknown',
  }));

  // —— 文本块定位 ——
  let cursor = 0; // 单调搜索起点（normPages 下标）
  for (const a of out) {
    if (a.block.kind === 'figure') continue;
    const norm = normalize(a.block.text);
    if (!norm) continue;

    // 1) 精确子串，从上一个命中页开始向后找
    let hit = -1;
    for (let pi = cursor; pi < normPages.length; pi++) {
      if (normPages[pi].norm.includes(norm)) {
        hit = pi;
        break;
      }
    }
    if (hit >= 0) {
      a.page = normPages[hit].page;
      a.method = 'exact';
      cursor = hit;
      continue;
    }

    // 2) n-gram 包含度（对页内顺序不敏感），全页评分、偏向靠后的页
    let best = { pi: -1, score: 0 };
    let second = { pi: -1, score: 0 };
    for (let pi = 0; pi < normPages.length; pi++) {
      const score = containment(norm, normPages[pi].norm);
      if (score > best.score) {
        second = best;
        best = { pi, score };
      } else if (score > second.score) {
        second = { pi, score };
      }
    }
    if (best.pi >= 0 && best.score >= 0.6) {
      a.page = normPages[best.pi].page;
      a.method = 'fuzzy';
      // 内容明显跨页：次优页是相邻页且也含相当比例内容
      a.spansPages =
        second.pi >= 0 &&
        Math.abs(second.pi - best.pi) === 1 &&
        second.score >= 0.3 &&
        best.score < 0.95;
      cursor = Math.max(cursor, best.pi);
    }
  }

  // —— 图片块：取其后第一个已定位文本块的页码，否则往前找 ——
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (a.block.kind !== 'figure') continue;
    let page: number | null = null;
    for (let j = i + 1; j < out.length && page === null; j++) {
      if (out[j].block.kind !== 'figure' && out[j].page !== null) page = out[j].page;
    }
    if (page === null) {
      for (let j = i - 1; j >= 0 && page === null; j--) {
        if (out[j].block.kind !== 'figure' && out[j].page !== null) page = out[j].page;
      }
    }
    a.page = page;
    a.method = 'neighbor';
  }

  return out;
}
