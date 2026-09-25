import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import {
  getExtension,
  OFFICE_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  mimeTypeForExt,
  extractTextFromPdf,
  convertToPdf,
} from './extract';
import { originalDir, pdfDir, mdDir, tmpDir, originalFileName } from './storage';

export interface DocumentRow {
  id: number;
  title: string;
  original_name: string;
  extension: string;
  mime_type: string;
  size: number;
  status: string;
  category_id: number | null;
  body_start_page: number;
  created_at: string;
  updated_at: string;
}

const DOC_COLS =
  'id, title, original_name, extension, mime_type, size, status, category_id, body_start_page, created_at, updated_at';

function rowToDocument(r: any): DocumentRow {
  return {
    id: r.id,
    title: r.title,
    original_name: r.original_name,
    extension: r.extension,
    mime_type: r.mime_type,
    size: r.size,
    status: r.status,
    category_id: r.category_id ?? null,
    body_start_page: r.body_start_page ?? 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function listDocuments(categoryId?: number): DocumentRow[] {
  const db = getDb();
  const rows =
    categoryId != null
      ? db
          .prepare(`SELECT ${DOC_COLS} FROM documents WHERE category_id = ? ORDER BY updated_at DESC, id DESC`)
          .all(categoryId)
      : db.prepare(`SELECT ${DOC_COLS} FROM documents ORDER BY updated_at DESC, id DESC`).all();
  return rows.map(rowToDocument);
}

export function listRecent(limit = 8): DocumentRow[] {
  return getDb()
    .prepare(
      `SELECT ${DOC_COLS} FROM documents WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC, id DESC LIMIT ?`,
    )
    .all(limit)
    .map(rowToDocument);
}

export function getDocument(id: number): DocumentRow | null {
  const r = getDb().prepare(`SELECT ${DOC_COLS} FROM documents WHERE id = ?`).get(id);
  return r ? rowToDocument(r) : null;
}

/** 重命名文档：同步更新 documents 表与 FTS 索引标题。 */
export function renameDocument(id: number, title: string): DocumentRow | null {
  const db = getDb();
  const normalized = title.trim();
  if (!normalized) return null;
  const res = db
    .prepare(`UPDATE documents SET title = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(normalized, id);
  if (res.changes === 0) return null;
  db.prepare(`UPDATE documents_fts SET title = ? WHERE id = ?`).run(normalized, id);
  return getDocument(id);
}

/** 记录「最近打开」时间戳。 */
export function touchDocument(id: number): void {
  getDb().prepare(`UPDATE documents SET last_opened_at = datetime('now') WHERE id = ?`).run(id);
}

/** 设置文档所属分类（null 表示移出分类）；分类不存在时返回 null。 */
export function setDocumentCategory(id: number, categoryId: number | null): DocumentRow | null {
  const db = getDb();
  if (categoryId != null) {
    const exists = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(categoryId);
    if (!exists) return null;
  }
  const res = db
    .prepare(`UPDATE documents SET category_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(categoryId, id);
  if (res.changes === 0) return null;
  return getDocument(id);
}

/** 设置图书正文起始页（PDF 页，正文从 1 重排）。 */
export function setBodyStartPage(id: number, bodyStartPage: number): DocumentRow | null {
  const n = Math.max(1, Math.floor(bodyStartPage));
  const res = getDb()
    .prepare(`UPDATE documents SET body_start_page = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(n, id);
  if (res.changes === 0) return null;
  return getDocument(id);
}

/** 获取文档的预览文件（PDF 或 MD）信息。 */
export function getPreviewFile(
  id: number,
): { kind: 'pdf' | 'md'; path: string; mime_type: string } | null {
  const row = getDb()
    .prepare(`SELECT kind, path, mime_type FROM document_files WHERE document_id = ? AND kind IN ('pdf','md')`)
    .get(id) as { kind: 'pdf' | 'md'; path: string; mime_type: string } | undefined;
  if (!row || !fs.existsSync(row.path)) return null;
  return row;
}

export function getOriginalFile(
  id: number,
): { path: string; mime_type: string; name: string } | null {
  const doc = getDocument(id);
  const f = getDb()
    .prepare(`SELECT path, mime_type FROM document_files WHERE document_id = ? AND kind = 'original'`)
    .get(id) as { path: string; mime_type: string } | undefined;
  if (!doc || !f || !fs.existsSync(f.path)) return null;
  return { path: f.path, mime_type: f.mime_type, name: doc.original_name };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeSnippet(content: string, term: string, radius = 40): string {
  const idx = content.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return content.slice(0, 80);
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + term.length + radius);
  let s = (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
  s = s.replace(new RegExp(escapeRegExp(term), 'gi'), '<mark>$&</mark>');
  return s;
}

function toFtsQuery(q: string): string {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}

export interface SearchResult extends DocumentRow {
  snippet: string;
}

export function searchDocuments(q: string): SearchResult[] {
  const db = getDb();
  const term = q.trim();
  if (!term) return listDocuments().map((d) => ({ ...d, snippet: '' }));

  const results = new Map<number, SearchResult>();

  // 1) FTS5 分词检索（英文/空格分词 + 排名 + 摘要）
  try {
    const ftsRows = db
      .prepare(
        `SELECT d.id, d.title, d.original_name, d.extension, d.mime_type, d.size, d.status,
                d.created_at, d.updated_at, d.content,
                snippet(documents_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet
         FROM documents_fts f JOIN documents d ON d.id = f.id
         WHERE documents_fts MATCH ?
         ORDER BY rank LIMIT 100`,
      )
      .all(toFtsQuery(term)) as any[];
    for (const r of ftsRows) {
      results.set(r.id, { ...rowToDocument(r), snippet: r.snippet || '' });
    }
  } catch (err) {
    console.error('[search] FTS query failed:', (err as Error).message);
  }

  // 2) LIKE 子串回退（对中文/无空格文本更友好）
  const likeTerm = `%${term}%`;
  const likeRows = db
    .prepare(
      `SELECT ${DOC_COLS}, content FROM documents
       WHERE title LIKE ? OR content LIKE ? LIMIT 100`,
    )
    .all(likeTerm, likeTerm) as any[];
  for (const r of likeRows) {
    if (!results.has(r.id)) {
      results.set(r.id, { ...rowToDocument(r), snippet: makeSnippet(r.content || '', term) });
    }
  }

  return Array.from(results.values());
}

/** 上传入口：tmpPath 是已落盘的原始文件。返回文档 id。 */
export async function ingestUploadedFile(input: {
  originalName: string;
  mimeType: string;
  tmpPath: string;
  size: number;
  categoryId?: number | null;
}): Promise<number> {
  const db = getDb();
  const ext = getExtension(input.originalName) || 'bin';
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的文件类型：.${ext}`);
  }
  const title = input.originalName.replace(/\.[^.]+$/, '') || input.originalName;
  const categoryId =
    input.categoryId != null && Number.isFinite(input.categoryId) ? input.categoryId : null;

  const info = db
    .prepare(
      `INSERT INTO documents (title, original_name, mime_type, extension, size, status, category_id)
       VALUES (?, ?, ?, ?, ?, 'processing', ?)`,
    )
    .run(title, input.originalName, input.mimeType || mimeTypeForExt(ext), ext, input.size, categoryId);
  const docId = Number(info.lastInsertRowid);

  // 移动原始文件到存储目录
  const destOriginal = path.join(originalDir(), originalFileName(docId, ext));
  fs.renameSync(input.tmpPath, destOriginal);
  db.prepare(
    `INSERT INTO document_files (document_id, kind, path, mime_type) VALUES (?, 'original', ?, ?)`,
  ).run(docId, destOriginal, input.mimeType || mimeTypeForExt(ext));

  let content = '';
  let status: 'ready' | 'no_preview' | 'failed' = 'no_preview';

  try {
    if (ext === 'md') {
      // Markdown：直接作为预览 + 正文
      content = fs.readFileSync(destOriginal, 'utf8');
      const destMd = path.join(mdDir(), `${docId}.md`);
      fs.copyFileSync(destOriginal, destMd);
      db.prepare(
        `INSERT INTO document_files (document_id, kind, path, mime_type) VALUES (?, 'md', ?, 'text/markdown')`,
      ).run(docId, destMd);
      status = 'ready';
    } else if (ext === 'pdf') {
      // PDF：原文件即预览
      db.prepare(
        `INSERT INTO document_files (document_id, kind, path, mime_type) VALUES (?, 'pdf', ?, 'application/pdf')`,
      ).run(docId, destOriginal);
      content = await extractTextFromPdf(destOriginal);
      status = 'ready';
    } else if (OFFICE_EXTENSIONS.has(ext)) {
      // Office：LibreOffice 转 PDF，转换成功才有预览 + 正文
      const pdfPath = await convertToPdf(destOriginal, tmpDir());
      if (pdfPath) {
        const destPdf = path.join(pdfDir(), `${docId}.pdf`);
        fs.renameSync(pdfPath, destPdf);
        db.prepare(
          `INSERT INTO document_files (document_id, kind, path, mime_type) VALUES (?, 'pdf', ?, 'application/pdf')`,
        ).run(docId, destPdf);
        content = await extractTextFromPdf(destPdf);
        status = 'ready';
      } else {
        status = 'no_preview';
      }
    }
  } catch (err) {
    console.error('[documents] ingest error:', (err as Error).message);
    status = 'no_preview';
  }

  // 写入正文 + FTS 索引
  db.prepare(`UPDATE documents SET content = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    content,
    status,
    docId,
  );
  db.prepare(`DELETE FROM documents_fts WHERE id = ?`).run(docId);
  db.prepare(`INSERT INTO documents_fts (id, title, content) VALUES (?, ?, ?)`).run(
    docId,
    title,
    content,
  );

  return docId;
}

/** 编辑 Office 文件后提交：更新正文/大小/时间，刷新 FTS，删除过期的 PDF 预览。 */
export function commitEditedContent(docId: number, content: string, size: number): DocumentRow | null {
  const db = getDb();
  const res = db
    .prepare(`UPDATE documents SET content = ?, size = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(content, size, docId);
  if (res.changes === 0) return null;

  const doc = getDocument(docId);
  if (doc) {
    db.prepare(`DELETE FROM documents_fts WHERE id = ?`).run(docId);
    db.prepare(`INSERT INTO documents_fts (id, title, content) VALUES (?, ?, ?)`).run(
      docId,
      doc.title,
      content,
    );
  }

  // 编辑后旧 PDF 预览已过期：删除记录与磁盘文件（查看器已改走原生 Word/Excel 视图）
  const pdfRow = db
    .prepare(`SELECT path FROM document_files WHERE document_id = ? AND kind = 'pdf'`)
    .get(docId) as { path: string } | undefined;
  if (pdfRow) {
    db.prepare(`DELETE FROM document_files WHERE document_id = ? AND kind = 'pdf'`).run(docId);
    try {
      fs.rmSync(pdfRow.path, { force: true });
    } catch {
      /* ignore */
    }
  }

  return getDocument(docId);
}

export function deleteDocument(id: number): boolean {
  const db = getDb();
  const files = db
    .prepare(`SELECT path FROM document_files WHERE document_id = ?`)
    .all(id) as { path: string }[];
  db.prepare(`DELETE FROM documents_fts WHERE id = ?`).run(id);
  const res = db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
  for (const f of files) {
    try {
      fs.rmSync(f.path, { force: true });
    } catch {
      /* ignore */
    }
  }
  return res.changes > 0;
}
