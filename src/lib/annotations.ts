import { getDb } from './db';
import { findOrCreateTag } from './tags';

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export type AnnotationType = 'ink' | 'highlight' | 'underline' | 'note';

export interface Annotation {
  id: string;
  documentId: number;
  page: number;
  type: AnnotationType;
  data: Record<string, unknown>;
  text: string;
  color: string;
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationInput {
  id: string;
  page: number;
  type: AnnotationType;
  data: Record<string, unknown>;
  text: string;
  color: string;
  tags?: { name: string; color?: string }[];
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function listAnnotations(documentId: number): Annotation[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM annotations WHERE document_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(documentId) as any[];

  const tagRows = db
    .prepare(
      `SELECT at.annotation_id, t.id, t.name, t.color
       FROM annotation_tags at
       JOIN tags t ON t.id = at.tag_id
       JOIN annotations a ON a.id = at.annotation_id
       WHERE a.document_id = ?`,
    )
    .all(documentId) as any[];

  const tagMap = new Map<string, Tag[]>();
  for (const tr of tagRows) {
    const list = tagMap.get(tr.annotation_id) ?? [];
    list.push({ id: tr.id, name: tr.name, color: tr.color });
    tagMap.set(tr.annotation_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    page: r.page,
    type: r.type as AnnotationType,
    data: safeJson(r.data),
    text: r.text || '',
    color: r.color || '#f59e0b',
    tags: tagMap.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getAnnotation(id: string): Annotation | null {
  const db = getDb();
  const r = db.prepare(`SELECT document_id FROM annotations WHERE id = ?`).get(id) as any;
  if (!r) return null;
  return listAnnotations(r.document_id).find((a) => a.id === id) ?? null;
}

/** 全量保存某文档的批注：按 id 对账（新增/更新/删除缺失），保留稳定 id 以便标签引用。 */
export function saveAnnotations(
  documentId: number,
  anns: AnnotationInput[],
): Annotation[] {
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM annotations WHERE document_id = ?`)
    .all(documentId) as { id: string }[];
  const incoming = new Set(anns.map((a) => a.id));

  const upsert = db.prepare(`
    INSERT INTO annotations (id, document_id, page, type, data, text, color, updated_at)
    VALUES (@id, @documentId, @page, @type, @data, @text, @color, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      page = excluded.page,
      type = excluded.type,
      data = excluded.data,
      text = excluded.text,
      color = excluded.color,
      updated_at = datetime('now')
  `);
  const del = db.prepare(`DELETE FROM annotations WHERE id = ?`);

  const delTagLink = db.prepare(`DELETE FROM annotation_tags WHERE annotation_id = ?`);
  const addTagLink = db.prepare(
    `INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) VALUES (?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (const e of existing) {
      if (!incoming.has(e.id)) del.run(e.id);
    }
    for (const a of anns) {
      upsert.run({
        id: a.id,
        documentId,
        page: a.page,
        type: a.type,
        data: JSON.stringify(a.data ?? {}),
        text: a.text ?? '',
        color: a.color ?? '#f59e0b',
      });
      // 对账标签：标签名全局唯一，按名 find-or-create，再重建关联
      delTagLink.run(a.id);
      for (const t of a.tags ?? []) {
        if (!t.name) continue;
        const tag = findOrCreateTag(t.name, t.color);
        addTagLink.run(a.id, tag.id);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return listAnnotations(documentId);
}

export function deleteAnnotation(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM annotations WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function updateAnnotation(
  id: string,
  patch: { text?: string; color?: string; data?: Record<string, unknown> },
): Annotation | null {
  const db = getDb();
  const current = db.prepare(`SELECT * FROM annotations WHERE id = ?`).get(id) as any;
  if (!current) return null;
  const data = patch.data ? JSON.stringify(patch.data) : current.data;
  const text = patch.text !== undefined ? patch.text : current.text;
  const color = patch.color !== undefined ? patch.color : current.color;
  db.prepare(
    `UPDATE annotations SET data = ?, text = ?, color = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(data, text, color, id);
  return getAnnotation(id);
}
