import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

export const OFFICE_EXTENSIONS = new Set([
  'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'odt', 'odp', 'ods',
]);

export const SUPPORTED_EXTENSIONS = new Set(['pdf', 'md', ...OFFICE_EXTENSIONS]);

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

export function getExtension(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return ext;
}

export function mimeTypeForExt(ext: string): string {
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/** 从 PDF 抽取纯文本（用于全文检索）。使用 unpdf 屏蔽 pdfjs 在 Node 下的 worker 细节。 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  const { extractText } = await import('unpdf');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const { text } = await extractText(data, { mergePages: true });
  return text ?? '';
}

function findSoffice(): string {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  const candidates = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
    '/usr/local/bin/soffice',
    '/usr/bin/soffice',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'soffice'; // 交由 execFile 走 PATH 查找，找不到会抛错并在调用方降级
}

/** 将 Office 文档转换为 PDF，返回输出文件路径；失败返回 null。 */
export async function convertToPdf(
  inputPath: string,
  outDir: string,
): Promise<string | null> {
  const bin = findSoffice();
  try {
    await execFileAsync(
      bin,
      ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, inputPath],
      { timeout: 180000 },
    );
  } catch (err) {
    console.error('[extract] LibreOffice conversion failed:', (err as Error).message);
    return null;
  }
  const base = path.basename(inputPath, path.extname(inputPath)) + '.pdf';
  const outPath = path.join(outDir, base);
  return fs.existsSync(outPath) ? outPath : null;
}
