// Excel / Word 的读取与写回。全部用动态 import 引入，避免重型依赖进入客户端 bundle。

import fs from 'fs';

export type CellValue = string | number | boolean;

export interface SheetData {
  name: string;
  rows: CellValue[][];
}

/** 解析 A1:B2 形式的范围引用，返回 0 基的行列区间。 */
function decodeRange(ref: string): { r0: number; r1: number; c0: number; c1: number } {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return { r0: 0, r1: 0, c0: 0, c1: 0 };
  const colToIdx = (s: string) =>
    s.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return {
    c0: colToIdx(m[1]),
    r0: Number(m[2]) - 1,
    c1: colToIdx(m[3]),
    r1: Number(m[4]) - 1,
  };
}

function cellToValue(cell: any): CellValue {
  if (!cell) return '';
  if (cell.t === 'b') return cell.v === true;
  if (cell.t === 'n') return cell.v; // 数字（含日期序列号，格式化为有损）
  if (cell.v == null) return '';
  return String(cell.v);
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  let n = name.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let base = n;
  let i = 2;
  while (used.has(n)) {
    n = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
    i++;
  }
  used.add(n);
  return n;
}

/** 读取 xlsx/xls 的全部工作表为二维数组（按实际使用范围裁剪）。 */
export async function readWorkbook(path: string): Promise<{ sheets: SheetData[] }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(path), { type: 'buffer', cellDates: false });
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const ref = ws['!ref'];
    const rows: CellValue[][] = [];
    if (ref) {
      const { r0, r1, c0, c1 } = decodeRange(ref);
      for (let r = r0; r <= r1; r++) {
        const row: CellValue[] = [];
        for (let c = c0; c <= c1; c++) {
          row.push(cellToValue(ws[XLSX.utils.encode_cell({ r, c })]));
        }
        rows.push(row);
      }
    }
    sheets.push({ name, rows });
  }
  return { sheets };
}

/** 把工作表写回 xlsx/xls 并返回 Buffer（调用方负责覆盖落盘）。 */
export async function writeWorkbook(ext: string, sheets: SheetData[]): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of sheets) {
    const aoa = s.rows.map((row) => row.map((v) => (v == null ? '' : v)));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sanitizeSheetName(s.name, used));
  }
  const bookType = ext === 'xls' ? 'xls' : 'xlsx';
  return XLSX.write(wb, { bookType, type: 'buffer' }) as Buffer;
}

/** 读取 docx 为 HTML（mammoth 返回完整文档，这里只取 body 内层内容）。 */
export async function readDocxHtml(path: string): Promise<string> {
  const mammoth = await import('mammoth');
  const convertToHtml = mammoth.convertToHtml ?? (mammoth as any).default?.convertToHtml;
  const result = await convertToHtml({ path });
  return bodyInnerHtml(result.value);
}

/** 把编辑后的 HTML 片段写回 docx 并返回 Buffer。 */
export async function writeDocxFromHtml(html: string): Promise<Buffer> {
  const mod = await import('html-to-docx');
  const toDocx = (mod as any).default ?? mod;
  const full = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  return (await toDocx(full, null, {})) as Buffer;
}

function bodyInnerHtml(full: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(full);
  return m ? m[1] : full;
}

/** 抽取工作表所有单元格文本，供全文检索。 */
export function sheetText(sheets: SheetData[]): string {
  const parts: string[] = [];
  for (const s of sheets) {
    for (const row of s.rows) {
      for (const v of row) {
        if (v != null && v !== '') parts.push(String(v));
      }
    }
  }
  return parts.join(' ');
}

/** 剥掉 HTML 标签得到纯文本，供全文检索。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}
