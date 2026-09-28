// 评测报告：单文件自包含 HTML（图片内嵌 base64，可直接分享）+ result.json。
// 顶部汇总记分卡 + LLM 总体诊断；逐页卡片为「原始页面 | 阅读模式提取内容」左右对照，
// 下方附该页 LLM 结论（分数、问题、每图/每表状态）。

import fs from 'node:fs';
import path from 'node:path';
import type { AttributedBlock, PageGt, PageVerdict, RunSummary } from './types';

export interface ReportData {
  summary: RunSummary;
  pages: PageGt[];
  attributed: AttributedBlock[];
  verdicts: PageVerdict[];
  diagnosis: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 极简 markdown → HTML（标题/加粗/列表/段落），仅用于 LLM 诊断文本 */
function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const inline = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^#{1,6}\s+/.test(line)) {
      closeList();
      out.push(`<h3>${inline.replace(/^#{1,6}\s+/, '')}</h3>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline.replace(/^[-*]\s+/, '')}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

const STATUS_LABEL: Record<string, string> = {
  correct: '✓ 正确',
  captured: '✓ 已保留',
  split: '✗ 被拆分',
  missed: '✗ 漏提',
  spurious: '? 幻影图',
  wrong_crop: '△ 裁剪错误',
  mixed_into_text: '✗ 混入正文',
  partial: '△ 部分保留',
};

function statusBadge(status: string): string {
  const known = status in STATUS_LABEL;
  const cls = ['split', 'missed', 'mixed_into_text'].includes(status)
    ? 'bad'
    : ['partial', 'wrong_crop', 'spurious'].includes(status)
      ? 'warn'
      : 'good';
  const label = known ? STATUS_LABEL[status] : status;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function scoreBadge(v: PageVerdict): string {
  const cls = v.overall >= 85 ? 'good' : v.overall >= 60 ? 'warn' : 'bad';
  return `<span class="badge ${cls}">${v.overall} 分</span>`;
}

function extractedHtml(blocks: AttributedBlock[]): string {
  const out: string[] = [];
  let figNo = 0;
  for (const a of blocks) {
    const span = a.spansPages ? ' <span class="badge warn">跨页</span>' : '';
    if (a.block.kind === 'figure') {
      figNo += 1;
      const img = a.block.jpegBase64
        ? `<img src="data:image/jpeg;base64,${a.block.jpegBase64}" alt="提取图#${figNo}">`
        : '<div class="missing-img">（图片数据缺失）</div>';
      out.push(
        `<figure class="ext-figure">${img}<figcaption><b>提取图#${figNo}</b>${span} caption=${esc(a.block.caption || '(无)')}</figcaption></figure>`,
      );
    } else if (a.block.kind === 'h1' || a.block.kind === 'h2') {
      out.push(
        `<div class="ext-block ext-heading"><span class="tag">${a.block.kind === 'h1' ? '一级标题' : '二级标题'}</span>${span}<div class="ext-${a.block.kind}">${esc(a.block.text)}</div></div>`,
      );
    } else {
      out.push(`<div class="ext-block"><span class="tag">段落</span>${span}<p>${esc(a.block.text)}</p></div>`);
    }
  }
  if (out.length === 0) out.push('<p class="muted">（本页没有归属到任何提取内容）</p>');
  return out.join('\n');
}

function verdictHtml(v: PageVerdict): string {
  if (v.parseError) {
    return `<div class="verdict"><div class="parse-error">LLM 输出解析失败：${esc(v.parseError)}</div><pre>${esc(v.rawText ?? '')}</pre></div>`;
  }
  const rows: string[] = [];
  rows.push(
    `<div class="v-scores"><span class="badge ${v.text.completeness >= 85 ? 'good' : v.text.completeness >= 60 ? 'warn' : 'bad'}">文本完整度 ${v.text.completeness}</span>` +
      `<span class="badge ${v.text.reading_order_ok ? 'good' : 'bad'}">阅读顺序 ${v.text.reading_order_ok ? '✓ 正确' : '✗ 异常'}</span>` +
      `${scoreBadge(v)}</div>`,
  );
  if (v.summary) rows.push(`<p class="v-summary">${esc(v.summary)}</p>`);
  if (v.text.issues.length) {
    rows.push(`<div class="v-sec"><b>问题</b><ul>${v.text.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
  }
  if (v.text.missing.length) {
    rows.push(`<div class="v-sec"><b>缺失文字</b><ul>${v.text.missing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
  }
  if (v.text.extraneous.length) {
    rows.push(`<div class="v-sec"><b>多余/重复文字</b><ul>${v.text.extraneous.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
  }
  if (v.figures.length) {
    rows.push(
      `<div class="v-sec"><b>图片（按原图）</b><table><tr><th>原图</th><th>状态</th><th>评语</th></tr>` +
        v.figures.map((f) => `<tr><td>${esc(f.name)}</td><td>${statusBadge(f.status)}</td><td>${esc(f.comment)}</td></tr>`).join('') +
        `</table></div>`,
    );
  }
  if (v.tables.length) {
    rows.push(
      `<div class="v-sec"><b>表格（按原表）</b><table><tr><th>表格</th><th>状态</th><th>评语</th></tr>` +
        v.tables.map((t) => `<tr><td>${esc(t.name)}</td><td>${statusBadge(t.status)}</td><td>${esc(t.comment)}</td></tr>`).join('') +
        `</table></div>`,
    );
  }
  return `<div class="verdict">${rows.join('\n')}</div>`;
}

function scorecardHtml(data: ReportData): string {
  const s = data.summary;
  const rows = data.pages.map((p) => {
    const v = data.verdicts.find((x) => x.page === p.page);
    if (!v) return '';
    const figBad = v.figures.filter((f) => ['split', 'missed', 'wrong_crop', 'spurious'].includes(f.status)).length;
    const tblBad = v.tables.filter((t) => t.status !== 'captured').length;
    const hot = v.overall < 85 || figBad > 0 || tblBad > 0 || !v.text.reading_order_ok;
    return `<tr class="${hot ? 'hot' : ''}">
<td><a href="#page-${p.page}">第 ${p.page} 页</a></td>
<td>${v.text.completeness}</td>
<td>${v.text.reading_order_ok ? '✓' : '✗ 异常'}</td>
<td>${v.figures.length ? `${v.figures.length} 图${figBad ? `（${figBad} 问题）` : ''}` : '—'}</td>
<td>${v.tables.length ? v.tables.map((t) => statusBadge(t.status)).join(' ') : '—'}</td>
<td><b>${v.overall}</b></td>
<td class="sm">${esc(v.summary)}</td>
</tr>`;
  });
  return `<table class="scorecard">
<tr><th>页</th><th>文本完整度</th><th>阅读顺序</th><th>图片</th><th>表格</th><th>总分</th><th>结论</th></tr>
${rows.join('\n')}
</table>
<div class="agg">均分：文本完整度 ${s.avgCompleteness.toFixed(1)} ｜ 综合 ${s.avgOverall.toFixed(1)} ｜ 阅读顺序正常 ${s.pagesOrderOk}/${s.judgedPages} 页 ｜ 图片状态 ${Object.entries(s.figureStatusCounts).map(([k, n]) => `${k}:${n}`).join(' ') || '—'} ｜ 表格状态 ${Object.entries(s.tableStatusCounts).map(([k, n]) => `${k}:${n}`).join(' ') || '—'}</div>`;
}

function unattributedHtml(blocks: AttributedBlock[]): string {
  if (blocks.length === 0) return '';
  const items = blocks
    .map((a) =>
      a.block.kind === 'figure'
        ? `<li>[图片] caption=${esc(a.block.caption || '(无)')}${a.block.jpegBase64 ? '' : '（图片数据缺失）'}</li>`
        : `<li>[${a.block.kind}] ${esc(a.block.text.slice(0, 200))}${a.block.text.length > 200 ? '…' : ''}</li>`,
    )
    .join('');
  return `<section class="page-card"><h2>未能定位到具体页的提取内容（${blocks.length} 项）</h2><ul class="unattr">${items}</ul></section>`;
}

export function buildReportHtml(data: ReportData): string {
  const { summary: s } = data;
  const cards = data.pages
    .map((p) => {
      const blocks = data.attributed.filter((a) => a.page === p.page);
      const v = data.verdicts.find((x) => x.page === p.page);
      const header = v
        ? `<h2 id="page-${p.page}">第 ${p.page} 页 ${scoreBadge(v)}</h2>`
        : `<h2 id="page-${p.page}">第 ${p.page} 页</h2>`;
      return `<section class="page-card">
${header}
<div class="compare">
<div class="pane"><h3>原始 PDF 页面</h3><img src="data:image/jpeg;base64,${p.jpegBase64}" alt="第 ${p.page} 页"></div>
<div class="pane extracted"><h3>阅读模式提取内容（按输出顺序）</h3>${extractedHtml(blocks)}</div>
</div>
${v ? verdictHtml(v) : ''}
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>阅读模式评测 — ${esc(s.docTitle)}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1f2328; }
.wrap { max-width: 1500px; margin: 0 auto; padding: 24px; }
header h1 { font-size: 22px; margin: 0 0 6px; }
.meta { color: #57606a; font-size: 13px; margin-bottom: 16px; }
.diagnosis { background: #fff; border: 1px solid #d8dee4; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; }
.diagnosis h3 { margin: 14px 0 6px; font-size: 15px; }
.diagnosis h3:first-child { margin-top: 0; }
.diagnosis p, .diagnosis li { font-size: 14px; line-height: 1.7; }
.scorecard { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8dee4; border-radius: 10px; overflow: hidden; font-size: 13px; margin-bottom: 8px; }
.scorecard th, .scorecard td { padding: 7px 10px; border-bottom: 1px solid #eaeef2; text-align: left; vertical-align: top; }
.scorecard th { background: #f0f2f5; font-weight: 600; }
.scorecard tr.hot { background: #fff8f8; }
.scorecard tr.hot td:first-child a { color: #cf222e; font-weight: 700; }
.scorecard .sm { color: #57606a; font-size: 12px; max-width: 380px; }
.agg { font-size: 13px; color: #57606a; margin-bottom: 24px; }
.page-card { background: #fff; border: 1px solid #d8dee4; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; }
.page-card > h2 { font-size: 16px; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
.compare { display: flex; gap: 16px; align-items: flex-start; }
.pane { flex: 1 1 50%; min-width: 0; }
.pane h3 { font-size: 13px; color: #57606a; margin: 0 0 8px; font-weight: 600; }
.pane img { max-width: 100%; border: 1px solid #e3e8ee; border-radius: 6px; display: block; }
.extracted { background: #fafbfc; border: 1px solid #eaeef2; border-radius: 8px; padding: 12px; }
.ext-block { margin-bottom: 10px; }
.ext-block p { margin: 4px 0 0; font-size: 13px; line-height: 1.75; }
.ext-heading .ext-h1 { font-size: 16px; font-weight: 700; margin-top: 4px; }
.ext-heading .ext-h2 { font-size: 14px; font-weight: 600; margin-top: 4px; }
.ext-figure { margin: 10px 0; }
.ext-figure img { max-width: 100%; border: 1px solid #e3e8ee; border-radius: 6px; }
.ext-figure figcaption, .missing-img { font-size: 12px; color: #57606a; margin-top: 4px; }
.tag { display: inline-block; font-size: 11px; color: #6e7781; background: #eff2f5; border-radius: 4px; padding: 1px 6px; margin-right: 6px; }
.muted { color: #8b949e; font-size: 13px; }
.badge { display: inline-block; font-size: 12px; border-radius: 10px; padding: 2px 9px; font-weight: 500; white-space: nowrap; }
.badge.good { background: #dafbe1; color: #1a7f37; }
.badge.warn { background: #fff3cd; color: #9a6700; }
.badge.bad { background: #ffebe9; color: #cf222e; }
.verdict { border-top: 1px dashed #d8dee4; margin-top: 14px; padding-top: 12px; }
.v-scores { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.v-summary { font-size: 14px; margin: 4px 0 8px; }
.v-sec { margin: 8px 0; font-size: 13px; }
.v-sec b { color: #374151; }
.v-sec ul { margin: 4px 0 4px 18px; padding: 0; }
.v-sec li { margin: 2px 0; line-height: 1.6; }
.v-sec table { border-collapse: collapse; margin-top: 4px; }
.v-sec th, .v-sec td { border: 1px solid #e3e8ee; padding: 4px 8px; font-size: 12.5px; text-align: left; }
.v-sec th { background: #f6f8fa; }
.parse-error { color: #cf222e; font-weight: 600; margin-bottom: 6px; }
.verdict pre { background: #f6f8fa; padding: 10px; border-radius: 6px; font-size: 12px; overflow: auto; white-space: pre-wrap; }
.unattr li { font-size: 13px; line-height: 1.7; }
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>阅读模式提取质量评测 — ${esc(s.docTitle)}</h1>
<div class="meta">文档 ID ${s.docId} ｜ ${s.pageCount} 页（正文起始第 ${s.bodyStartPage} 页，评测 ${s.judgedPages} 页）｜ 裁判模型 ${esc(s.model)} @ ${esc(new URL(s.baseUrl).host)} ｜ ${esc(s.timestamp)}</div>
</header>
<div class="diagnosis">${mdToHtml(data.diagnosis)}</div>
${scorecardHtml(data)}
${cards}
${unattributedHtml(data.attributed.filter((a) => a.page === null))}
</div>
</body>
</html>`;
}

/** 聚合文档级汇总指标（解析失败的页不进均分） */
export function computeSummary(args: {
  docId: number;
  docTitle: string;
  model: string;
  baseUrl: string;
  bodyStartPage: number;
  pageCount: number;
  verdicts: PageVerdict[];
}): RunSummary {
  const ok = args.verdicts.filter((v) => !v.parseError);
  const figureStatusCounts: Record<string, number> = {};
  const tableStatusCounts: Record<string, number> = {};
  for (const v of ok) {
    for (const f of v.figures) figureStatusCounts[f.status] = (figureStatusCounts[f.status] ?? 0) + 1;
    for (const t of v.tables) tableStatusCounts[t.status] = (tableStatusCounts[t.status] ?? 0) + 1;
  }
  const n = ok.length || 1;
  return {
    docId: args.docId,
    docTitle: args.docTitle,
    model: args.model,
    baseUrl: args.baseUrl,
    timestamp: new Date().toISOString(),
    bodyStartPage: args.bodyStartPage,
    pageCount: args.pageCount,
    judgedPages: args.verdicts.length,
    avgCompleteness: ok.reduce((a, v) => a + v.text.completeness, 0) / n,
    avgOverall: ok.reduce((a, v) => a + v.overall, 0) / n,
    pagesOrderOk: ok.filter((v) => v.text.reading_order_ok).length,
    figureStatusCounts,
    tableStatusCounts,
  };
}

export interface WriteResult {
  outDir: string;
  htmlPath: string;
  jsonPath: string;
}

export function writeReport(data: ReportData, outDir: string): WriteResult {
  fs.mkdirSync(outDir, { recursive: true });
  // 页面与提取图也落一份文件，便于复用
  const pagesDir = path.join(outDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (const p of data.pages) {
    fs.writeFileSync(path.join(pagesDir, `page-${String(p.page).padStart(3, '0')}.jpg`), Buffer.from(p.jpegBase64, 'base64'));
  }
  const htmlPath = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlPath, buildReportHtml(data));
  const jsonPath = path.join(outDir, 'result.json');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        summary: data.summary,
        diagnosis: data.diagnosis,
        verdicts: data.verdicts,
        blocks: data.attributed.map((a) => ({
          index: a.index,
          kind: a.block.kind,
          page: a.page,
          spansPages: a.spansPages,
          method: a.method,
          ...(a.block.kind === 'figure'
            ? { caption: a.block.caption, imageBytes: a.block.jpegBase64.length }
            : { text: a.block.text }),
        })),
      },
      null,
      2,
    ),
  );
  return { outDir, htmlPath, jsonPath };
}

export function openReport(htmlPath: string): void {
  if (process.platform !== 'darwin') return;
  import('node:child_process')
    .then(({ exec }) => exec(`open "${htmlPath}"`))
    .catch(() => {});
}
