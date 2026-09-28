// LLM 裁判：把「原始 PDF 页面截图 + 当页阅读模式提取内容」成对交给多模态 LLM 对照评价。
// 端点为 Anthropic Messages 协议兼容服务（Kimi），用官方 @anthropic-ai/sdk + baseURL 覆盖，
// 只发基础参数（model / max_tokens / messages / temperature），不发 Claude 专属参数。

import Anthropic from '@anthropic-ai/sdk';
import type { AttributedBlock, PageVerdict } from './types';

export type JudgeClient = Anthropic;

export function makeJudgeClient(baseUrl: string, apiKey: string): JudgeClient {
  // 注意：Moonshot 的 Anthropic 兼容端点只接受 `Authorization: Bearer`（authToken），
  // 用 `apiKey`（X-Api-Key）会被 401 拒绝。这里把密钥当作 authToken 传入。
  return new Anthropic({ baseURL: baseUrl, authToken: apiKey, maxRetries: 3 });
}

/** 视觉探活：发一张纯色小图，确认模型支持图片输入 */
export async function probeVision(client: JudgeClient, model: string): Promise<string> {
  const napi = await import('@napi-rs/canvas');
  const c = napi.createCanvas(24, 24);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d0021b';
  ctx.fillRect(0, 0, 24, 24);
  const jpeg = (await c.encode('jpeg', 85)).toString('base64');
  const res = await client.messages.create({
    model,
    max_tokens: 2048,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } },
          { type: 'text', text: '这张图片是什么颜色？只回答颜色名。' },
        ],
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text || '(空回复)';
}

export interface PageJudgeInput {
  page: number;
  /** 原始页面渲染 JPEG base64 */
  pageImageBase64: string;
  /** 当页提取出的图片（按输出顺序） */
  figures: Array<{ jpegBase64: string; caption: string }>;
  /** 当页提取出的文本块（按输出顺序） */
  textBlocks: Array<{ label: string; text: string }>;
}

const SCHEMA_HINT = `{"page": 页码, "text": {"completeness": 0-100整数, "reading_order_ok": true或false, "issues": ["..."], "missing": ["..."], "extraneous": ["..."]}, "figures": [{"name": "原图编号", "status": "correct|split|missed|spurious|wrong_crop", "comment": "..."}], "tables": [{"name": "表格编号", "status": "captured|mixed_into_text|partial|missed", "comment": "..."}], "overall": 0-100整数, "summary": "一句话结论"}`;

function pagePrompt(input: PageJudgeInput): string {
  const lines: string[] = [];
  lines.push(`你是 PDF 阅读模式提取质量评测员。某文档应用把 PDF 重排为流式正文（标题、段落、图片），现在对照原始页面检查提取质量。`);
  lines.push('');
  lines.push(`本页为第 ${input.page} 页。输入：`);
  lines.push(`- 图片#0：原始 PDF 页面截图。`);
  if (input.figures.length > 0) {
    lines.push(`- 其后 ${input.figures.length} 张图片：阅读模式提取出的图片，依次为 提取图#1..#${input.figures.length}（按输出顺序）。`);
  } else {
    lines.push(`- 阅读模式没有从本页提取出任何图片。`);
  }
  lines.push(`- 下方"提取内容"：归属到本页的标题与段落原文，按输出顺序。`);
  lines.push('');
  lines.push(`评价维度：`);
  lines.push(`1. text.completeness：正文文字完整度 0-100。页眉、页脚、页码、期刊眉注的缺失不算问题（提取器有意去除）。`);
  lines.push(`2. text.reading_order_ok：本页若有分栏/通栏混排，提取顺序是否正确。不同栏文字交错混排、或分栏文字插进通栏段落，都算 false；无混排且顺序自然为 true。`);
  lines.push(`3. text.issues / missing / extraneous：具体问题、明显缺失的文字片段、多余或重复的文字。`);
  lines.push(`4. figures：按原始页面上出现的每张图逐个评价。status 含义：correct=正确提取；split=原图被拆成多张提取图；missed=原图未提取；spurious=提取图在原页不存在；wrong_crop=裁剪错位或包含无关内容。name 填原图编号（如 "Figure 1"、"图2"）。原页没有图则 figures=[]。`);
  lines.push(`5. tables：按原始页面上出现的每个表格逐个评价。status 含义：captured=表格被作为图片完整保留；mixed_into_text=表格行文字混入正文段落；partial=部分保留或裁剪不全；missed=完全丢失。name 填表格编号（如 "Table 1"）。原页没有表格则 tables=[]。`);
  lines.push(`6. overall：本页提取综合质量 0-100。`);
  lines.push('');
  lines.push(`注意：提取图片的页归属是按相邻文本推断的，个别提取图可能实际来自相邻页——若某提取图与本页内容完全无关，在该图对应评价的 comment 中注明"疑似来自相邻页"。若本页提取内容为空而原页有正文/图/表，按缺失评价。`);
  lines.push('');
  lines.push(`只输出一个 JSON 对象，不要任何其他文字、不要 markdown 代码块，格式：`);
  lines.push(SCHEMA_HINT);
  lines.push('');
  lines.push('提取内容（按输出顺序）：');
  if (input.textBlocks.length === 0 && input.figures.length === 0) {
    lines.push('（本页没有归属到任何提取内容）');
  }
  for (const tb of input.textBlocks) {
    lines.push(`【${tb.label}】${tb.text}`);
  }
  input.figures.forEach((f, i) => {
    lines.push(`【提取图#${i + 1}】caption=${f.caption || '(无)'}${f.jpegBase64 ? '' : '（图片数据缺失）'}`);
  });
  return lines.join('\n');
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function score(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 把 LLM 回复文本解析并校正为 PageVerdict；无法解析返回 null */
function coerceVerdict(rawText: string, page: number): PageVerdict | null {
  let t = rawText.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const lo = t.indexOf('{');
  const hi = t.lastIndexOf('}');
  if (lo < 0 || hi <= lo) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(t.slice(lo, hi + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const text = (obj.text ?? {}) as Record<string, unknown>;
  const completeness = score(text.completeness);
  const overall = score(obj.overall);
  if (completeness == null || overall == null) return null;
  const figures = Array.isArray(obj.figures) ? obj.figures : [];
  const tables = Array.isArray(obj.tables) ? obj.tables : [];
  return {
    page,
    text: {
      completeness,
      reading_order_ok: text.reading_order_ok !== false,
      issues: strArray(text.issues),
      missing: strArray(text.missing),
      extraneous: strArray(text.extraneous),
    },
    figures: figures.map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      return { name: String(o.name ?? ''), status: String(o.status ?? ''), comment: String(o.comment ?? '') };
    }),
    tables: tables.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { name: String(o.name ?? ''), status: String(o.status ?? ''), comment: String(o.comment ?? '') };
    }),
    overall,
    summary: String(obj.summary ?? ''),
  };
}

/** 评测一页：原始页面截图 + 当页提取内容 → 结构化评价。解析失败自动重试一次。 */
export async function judgePage(client: JudgeClient, model: string, input: PageJudgeInput): Promise<PageVerdict> {
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.pageImageBase64 } },
  ];
  for (const f of input.figures) {
    if (f.jpegBase64) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.jpegBase64 } });
    }
  }
  content.push({ type: 'text', text: pagePrompt(input) });

  let lastText = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model,
      // thinking 模型会先输出 reasoning 消耗 output tokens，给足预算保证 JSON 完整
      max_tokens: 16000,
      temperature: 0,
      messages: [{ role: 'user', content }],
    });
    lastText = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const verdict = coerceVerdict(lastText, input.page);
    if (verdict) return verdict;
    // 解析失败：换更强的约束语重试一次（每次调用无状态）
    content[content.length - 1] = {
      type: 'text',
      text: pagePrompt(input) + '\n\n（重要：请严格只输出一个 JSON 对象，从 { 开始到 } 结束，不要任何其他文字或代码围栏。）',
    };
  }
  return {
    page: input.page,
    text: { completeness: 0, reading_order_ok: false, issues: [], missing: [], extraneous: [] },
    figures: [],
    tables: [],
    overall: 0,
    summary: '',
    rawText: lastText,
    parseError: 'LLM 输出无法解析为 JSON',
  };
}

/** 汇总诊断：把逐页结论交给 LLM 生成聚焦三类典型问题的 markdown 报告 */
export async function summarizeAll(
  client: JudgeClient,
  model: string,
  docTitle: string,
  verdicts: PageVerdict[],
  unattributed: AttributedBlock[],
): Promise<string> {
  const compact = verdicts.map((v) => ({
    page: v.page,
    overall: v.overall,
    completeness: v.text.completeness,
    order_ok: v.text.reading_order_ok,
    issues: v.text.issues,
    missing: v.text.missing,
    extraneous: v.text.extraneous,
    figures: v.figures,
    tables: v.tables,
    summary: v.summary,
    parseError: v.parseError ?? undefined,
  }));
  const unattrNote =
    unattributed.length > 0
      ? '\n\n另有以下提取内容未能定位到具体页（仅列出供参考）：\n' +
        unattributed
          .map((a) =>
            a.block.kind === 'figure'
              ? `- [图片] caption=${a.block.caption || '(无)'}`
              : `- [${a.block.kind}] ${a.block.text.slice(0, 120)}`,
          )
          .join('\n')
      : '';

  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: `以下是某 PDF 文档阅读模式提取质量的逐页评测结果（LLM 逐页对照原始页面得出）。文档：《${docTitle}》。

已知该提取器存在三类典型问题，请重点诊断：
1. 表格未能作为图片保留，表格文字混入正文段落（tables.status=mixed_into_text）；
2. 大图被拆分成多张小图（figures.status=split）；
3. 复杂排版（同页分栏与通栏混排）下阅读顺序错误、不同栏文字交错（text.order_ok=false）。

请输出 markdown 格式总体诊断，包含：
## 总体结论（整体质量如何、平均分）
## 三类典型问题（每类：是否出现、出现在哪些页、具体表现）
## 其他问题（遗漏/多余文字、错误裁剪、幻觉图片等，按页列举）
## 改进优先级（按影响排序的建议清单）
${unattrNote}

逐页评测结果（JSON）：
${JSON.stringify(compact, null, 1)}`,
      },
    ],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
