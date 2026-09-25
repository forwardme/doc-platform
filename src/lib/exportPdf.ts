import fs from 'fs';
import { PDFDocument, rgb, LineCapStyle } from 'pdf-lib';
import { getPreviewFile, getDocument } from './documents';
import { listAnnotations, type Annotation } from './annotations';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 0.98, g: 0.6, b: 0.04 }; // #f59e0b 兜底
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function inkPaths(a: Annotation): [number, number][][] {
  const d = a.data as { paths?: [number, number][][]; points?: [number, number][] };
  if (Array.isArray(d.paths) && d.paths.length > 0) return d.paths;
  return d.points && d.points.length > 0 ? [d.points] : [];
}

function rectsOf(a: Annotation): Rect[] {
  const d = a.data as { rects?: Rect[]; rect?: Rect };
  if (Array.isArray(d.rects) && d.rects.length > 0) return d.rects;
  return d.rect ? [d.rect] : [];
}

function parseSqliteDate(s: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  if (!m) return null;
  return new Date(`${m[1]}T${m[2]}Z`);
}

function isAsciiSafe(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7e) return false;
  return true;
}

/** 生成带标注的 PDF：把数据库中的批注按坐标画到预览 PDF 上，并写入最后修改时间。 */
export async function buildAnnotatedPdf(
  docId: number,
): Promise<{ bytes: Uint8Array; updatedAt: Date } | null> {
  const preview = getPreviewFile(docId);
  if (!preview || preview.kind !== 'pdf') return null;

  const pdfDoc = await PDFDocument.load(new Uint8Array(fs.readFileSync(preview.path)), {
    ignoreEncryption: true,
  });
  const annotations = listAnnotations(docId);

  for (const a of annotations) {
    const page = pdfDoc.getPage(a.page - 1);
    if (!page) continue;
    const { height: H } = page.getSize();
    const { r, g, b } = hexToRgb(a.color);
    const col = rgb(r, g, b);

    if (a.type === 'highlight') {
      for (const rect of rectsOf(a)) {
        page.drawRectangle({
          x: rect.x,
          y: H - rect.y - rect.h,
          width: rect.w,
          height: rect.h,
          color: col,
          opacity: 0.32,
        });
      }
    } else if (a.type === 'underline') {
      for (const rect of rectsOf(a)) {
        page.drawRectangle({
          x: rect.x,
          y: H - (rect.y + rect.h),
          width: rect.w,
          height: 2,
          color: col,
        });
      }
    } else if (a.type === 'ink') {
      const size = (a.data as { size?: number }).size || 3;
      for (const path of inkPaths(a)) {
        for (let i = 0; i + 1 < path.length; i++) {
          page.drawLine({
            start: { x: path[i][0], y: H - path[i][1] },
            end: { x: path[i + 1][0], y: H - path[i + 1][1] },
            thickness: size,
            color: col,
            lineCap: LineCapStyle.Round,
          });
        }
      }
    } else if (a.type === 'note') {
      const d = a.data as { x?: number; y?: number };
      const x = d.x ?? 0;
      const y = d.y ?? 0;
      page.drawEllipse({
        x,
        y: H - y,
        xScale: 7,
        yScale: 7,
        color: col,
        borderColor: rgb(1, 1, 1),
        borderWidth: 1.5,
      });
      if (a.text && isAsciiSafe(a.text)) {
        page.drawText(a.text.slice(0, 40), {
          x: x + 12,
          y: H - y - 14,
          size: 11,
          color: rgb(0.12, 0.16, 0.22),
        });
      }
    }
  }

  // 修改时间：取最新批注更新时间，回退到文档 updated_at
  let latest = '';
  for (const a of annotations) if (a.updatedAt > latest) latest = a.updatedAt;
  const doc = getDocument(docId);
  const updatedAt = parseSqliteDate(latest || doc?.updated_at || '') ?? new Date();

  pdfDoc.setModificationDate(updatedAt);
  const bytes = await pdfDoc.save();
  return { bytes, updatedAt };
}
