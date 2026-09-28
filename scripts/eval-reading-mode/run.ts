// 阅读模式提取准确度评测 —— 入口。
//
// 用法：
//   npm run eval:reading                    # 评测文档 1（SOFA/SOFA-2 论文）
//   npm run eval:reading -- --doc 13        # 评测其他文档
//   npm run eval:reading -- --max-pages 3   # 只评测前 3 页（快速迭代）
//   npm run eval:reading -- --model NAME    # 覆盖裁判模型（默认 kimi-k3）
//   npm run eval:reading -- --no-open       # 不自动打开报告
//
// 配置来自 .env.local：KIMI_BASE_URL / KIMI_API_KEY（Moonshot Anthropic 协议兼容端点，模型 kimi-k3）、
// ADMIN_USERNAME / ADMIN_PASSWORD（应用登录）；也可用 EVAL_LLM_MODEL 指定默认模型。

import path from 'node:path';
import { spawn } from 'node:child_process';
import { captureReadingMode } from './capture';
import { attributeBlocks } from './attribute';
import { buildPdfGroundTruth } from './pdfgt';
import { judgePage, makeJudgeClient, probeVision, summarizeAll, type PageJudgeInput } from './llm';
import { computeSummary, openReport, writeReport } from './report';
import type { AttributedBlock, PageVerdict } from './types';

interface Args {
  doc: number;
  appUrl: string;
  baseUrl?: string;
  model?: string;
  maxPages?: number;
  noOpen: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    const prefix = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const doc = Number(get('doc') ?? 1);
  if (!Number.isInteger(doc) || doc < 1) {
    throw new Error(`无效的文档 ID：${get('doc')}`);
  }
  const maxPages = get('max-pages') != null ? Number(get('max-pages')) : undefined;
  if (maxPages != null && (!Number.isInteger(maxPages) || maxPages < 1)) {
    throw new Error(`无效的 --max-pages：${get('max-pages')}`);
  }
  return {
    doc,
    appUrl: (get('app-url') ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    baseUrl: get('base-url'),
    model: get('model'),
    maxPages,
    noOpen: argv.includes('--no-open'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 就绪信号：POST 空 body 到登录路由。路由未编译返回 404，编译完成后返回 401（空凭据） */
async function serverReady(appUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${appUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      redirect: 'manual',
    });
    return res.status === 401;
  } catch {
    return false;
  }
}

/** 确保应用在跑：没在跑就自动 `npm run dev`（退出时只杀自己启动的进程） */
async function ensureServer(appUrl: string): Promise<{ kill?: () => void }> {
  if (await serverReady(appUrl)) return {};
  console.log('▶ 本地服务未运行，自动启动 npm run dev …');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await serverReady(appUrl)) {
      return {
        kill: () => {
          try {
            process.kill(-child.pid!, 'SIGTERM');
          } catch {
            /* 已退出 */
          }
        },
      };
    }
    await sleep(2000);
  }
  throw new Error(`dev server 在 ${appUrl} 启动超时`);
}

/** 汇总单页 LLM 评测输入 */
function pageJudgeInputFor(
  pageNum: number,
  pageImageBase64: string,
  attributed: AttributedBlock[],
): PageJudgeInput {
  const mine = attributed.filter((a) => a.page === pageNum);
  const labels: Record<string, string> = { h1: '一级标题', h2: '二级标题', p: '段落' };
  const figures = mine.flatMap((a) => (a.block.kind === 'figure' ? [a.block] : []));
  const texts = mine.flatMap((a) => (a.block.kind !== 'figure' ? [a.block] : []));
  return {
    page: pageNum,
    pageImageBase64,
    figures: figures.map((f) => ({ jpegBase64: f.jpegBase64, caption: f.caption })),
    textBlocks: texts.map((b) => ({ label: labels[b.kind] ?? '段落', text: b.text })),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* 没有 .env.local 时用进程环境变量 */
  }

  const baseUrl = args.baseUrl ?? process.env.KIMI_BASE_URL;
  const apiKey = process.env.KIMI_API_KEY;
  const model = args.model ?? process.env.EVAL_LLM_MODEL ?? 'kimi-k3';
  if (!baseUrl || !apiKey) {
    throw new Error('缺少 KIMI_BASE_URL / KIMI_API_KEY（请配置在 .env.local，或用 --base-url 指定端点）');
  }

  const server = await ensureServer(args.appUrl);
  try {
    // —— 1. LLM 视觉探活 ——
    console.log(`▶ 裁判模型 ${model} @ ${baseUrl} 视觉探活 …`);
    const client = makeJudgeClient(baseUrl, apiKey);
    const probe = await probeVision(client, model);
    console.log(`  探活通过，模型回复：${probe}`);

    // —— 2. 抓取阅读模式输出 ——
    console.log(`▶ 抓取文档 ${args.doc} 的阅读模式输出 …`);
    const capture = await captureReadingMode({
      appUrl: args.appUrl,
      docId: args.doc,
      username: process.env.ADMIN_USERNAME ?? 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'admin123',
    });
    if (capture.emptyState) {
      console.log('  阅读模式显示"没有可提取的文字"（扫描件或提取失败），评测中止。');
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      const outDir = path.resolve(process.cwd(), 'scripts', 'eval-reading-mode', 'report', `run-${stamp}`);
      const summary = computeSummary({
        docId: args.doc,
        docTitle: capture.docTitle,
        model,
        baseUrl,
        bodyStartPage: capture.bodyStartPage,
        pageCount: 0,
        verdicts: [],
      });
      writeReport(
        {
          summary,
          pages: [],
          attributed: [],
          verdicts: [],
          diagnosis: '阅读模式显示"该文档没有可提取的文字（可能是扫描件）"，没有可评测的提取内容。',
        },
        outDir,
      );
      console.log(`✔ 已生成说明报告：${outDir}/index.html`);
      return;
    }
    console.log(`  文档：《${capture.docTitle}》，提取到 ${capture.blocks.length} 个块`);

    // —— 3. PDF ground truth ——
    console.log(`▶ 渲染 PDF 页面（正文起始页 ${capture.bodyStartPage}${args.maxPages ? `，限 ${args.maxPages} 页` : ''}）…`);
    const gt = await buildPdfGroundTruth(capture.pdfBytes, {
      startPage: capture.bodyStartPage,
      maxPages: args.maxPages,
    });
    console.log(`  共 ${gt.numPages} 页，评测 ${gt.pages.length} 页`);

    // —— 4. 块→页归属 ——
    const attributed = attributeBlocks(capture.blocks, gt.pages);
    const located = attributed.filter((a) => a.page !== null).length;
    console.log(`▶ 块→页归属：${located}/${attributed.length} 已定位`);

    // —— 5. 逐页 LLM 评测 ——
    console.log('▶ LLM 逐页对照评测 …');
    const verdicts: PageVerdict[] = [];
    for (const p of gt.pages) {
      process.stdout.write(`  第 ${p.page} 页 … `);
      const v = await judgePage(client, model, pageJudgeInputFor(p.page, p.jpegBase64, attributed));
      verdicts.push(v);
      console.log(v.parseError ? '解析失败（见报告原文）' : `总分 ${v.overall}（完整度 ${v.text.completeness}，顺序${v.text.reading_order_ok ? '✓' : '✗'}）`);
    }

    // —— 6. 汇总诊断 ——
    console.log('▶ 生成总体诊断 …');
    const unattributed = attributed.filter((a) => a.page === null);
    const diagnosis = await summarizeAll(client, model, capture.docTitle, verdicts, unattributed);

    // —— 7. 报告 ——
    const summary = computeSummary({
      docId: args.doc,
      docTitle: capture.docTitle,
      model,
      baseUrl,
      bodyStartPage: capture.bodyStartPage,
      pageCount: gt.numPages,
      verdicts,
    });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const outDir = path.resolve(process.cwd(), 'scripts', 'eval-reading-mode', 'report', `run-${stamp}`);
    const written = writeReport({ summary, pages: gt.pages, attributed, verdicts, diagnosis }, outDir);
    console.log(`✔ 评测完成：${written.htmlPath}`);
    console.log(`  均分：文本完整度 ${summary.avgCompleteness.toFixed(1)} ｜ 综合 ${summary.avgOverall.toFixed(1)} ｜ 阅读顺序正常 ${summary.pagesOrderOk}/${summary.judgedPages} 页`);
    if (!args.noOpen) openReport(written.htmlPath);
  } finally {
    server.kill?.();
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
