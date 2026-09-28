// 阅读模式评测脚本共享类型。

/** 阅读模式抓取到的文本块（对应 article 下的 h1/h2/p） */
export interface CapturedTextBlock {
  kind: 'h1' | 'h2' | 'p';
  text: string;
}

/** 阅读模式抓取到的图片块（对应 article 下的 figure） */
export interface CapturedFigureBlock {
  kind: 'figure';
  /** ≤900px 宽 JPEG（浏览器内降采样后）的 base64；解码失败为空串 */
  jpegBase64: string;
  /** figcaption 原文，可为空 */
  caption: string;
}

export type CapturedBlock = CapturedTextBlock | CapturedFigureBlock;

/** 无头浏览器从应用里抓到的完整结果 */
export interface CaptureResult {
  blocks: CapturedBlock[];
  docTitle: string;
  bodyStartPage: number;
  pdfBytes: Uint8Array;
  /** 阅读模式显示"该文档没有可提取的文字"（扫描件/提取失败） */
  emptyState: boolean;
}

/** PDF 侧 ground truth：每页文本 + 渲染图 */
export interface PageGt {
  /** 1-based 页码 */
  page: number;
  /** unpdf extractText 的当页文本（仅用于块→页归属，不参与评分） */
  text: string;
  /** 页面渲染图（≤1600px 宽 JPEG）base64 */
  jpegBase64: string;
  width: number;
  height: number;
}

/** 完成页归属的块 */
export interface AttributedBlock {
  /** 在阅读模式输出中的原始顺序（0-based） */
  index: number;
  block: CapturedBlock;
  /** 1-based 页码；null = 未能定位 */
  page: number | null;
  spansPages: boolean;
  method: 'exact' | 'fuzzy' | 'neighbor' | 'unknown';
}

/** LLM 对一张提取图的评价 */
export interface FigureVerdict {
  name: string;
  /** correct | split | missed | spurious | wrong_crop */
  status: string;
  comment: string;
}

/** LLM 对一个表格的评价 */
export interface TableVerdict {
  name: string;
  /** captured | mixed_into_text | partial | missed */
  status: string;
  comment: string;
}

/** LLM 对一页的完整评价（schema 见 llm.ts 的 prompt） */
export interface PageVerdict {
  page: number;
  text: {
    completeness: number;
    reading_order_ok: boolean;
    issues: string[];
    missing: string[];
    extraneous: string[];
  };
  figures: FigureVerdict[];
  tables: TableVerdict[];
  overall: number;
  summary: string;
  /** JSON 解析失败时保留原始回复 */
  rawText?: string;
  parseError?: string;
}

/** 文档级汇总（脚本聚合，非 LLM 输出） */
export interface RunSummary {
  docId: number;
  docTitle: string;
  model: string;
  baseUrl: string;
  timestamp: string;
  bodyStartPage: number;
  pageCount: number;
  judgedPages: number;
  avgCompleteness: number;
  avgOverall: number;
  pagesOrderOk: number;
  figureStatusCounts: Record<string, number>;
  tableStatusCounts: Record<string, number>;
}
