import { getDb } from './db';
import type { Tag } from './annotations';

const TAG_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

export function listTags(): Tag[] {
  return getDb().prepare(`SELECT id, name, color FROM tags ORDER BY name ASC`).all() as unknown as Tag[];
}

export interface TagWithCount extends Tag {
  count: number;
}

/** 列出所有标签及各自关联的批注数量（供侧边栏「标签管理」）。 */
export function listTagsWithCounts(): TagWithCount[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.name, t.color, COUNT(at.annotation_id) AS count
       FROM tags t LEFT JOIN annotation_tags at ON at.tag_id = t.id
       GROUP BY t.id ORDER BY t.name ASC`,
    )
    .all() as unknown as { id: number; name: string; color: string; count: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, count: r.count }));
}

export function renameTag(id: number, name: string): TagWithCount | null {
  const normalized = name.trim();
  if (!normalized) return null;
  const res = getDb().prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(normalized, id);
  if (res.changes === 0) return null;
  return listTagsWithCounts().find((t) => t.id === id) ?? null;
}

export function recolorTag(id: number, color: string): TagWithCount | null {
  const res = getDb().prepare(`UPDATE tags SET color = ? WHERE id = ?`).run(color, id);
  if (res.changes === 0) return null;
  return listTagsWithCounts().find((t) => t.id === id) ?? null;
}

export function deleteTag(id: number): boolean {
  const res = getDb().prepare(`DELETE FROM tags WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function findOrCreateTag(name: string, color?: string): Tag {
  const db = getDb();
  const normalized = name.trim();
  const existing = db
    .prepare(`SELECT id, name, color FROM tags WHERE name = ?`)
    .get(normalized) as unknown as Tag | undefined;
  if (existing) return existing;

  const chosenColor = color || TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
  const info = db
    .prepare(`INSERT INTO tags (name, color) VALUES (?, ?)`)
    .run(normalized, chosenColor);
  return { id: Number(info.lastInsertRowid), name: normalized, color: chosenColor };
}

export function addTagToAnnotation(annotationId: string, tagName: string, color?: string): Tag {
  const db = getDb();
  const ann = db.prepare(`SELECT id FROM annotations WHERE id = ?`).get(annotationId);
  if (!ann) throw new Error('批注不存在');
  const tag = findOrCreateTag(tagName, color);
  db.prepare(
    `INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) VALUES (?, ?)`,
  ).run(annotationId, tag.id);
  return tag;
}

export function removeTagFromAnnotation(annotationId: string, tagId: number): boolean {
  const res = getDb()
    .prepare(`DELETE FROM annotation_tags WHERE annotation_id = ? AND tag_id = ?`)
    .run(annotationId, tagId);
  return res.changes > 0;
}

export interface TaggedAnnotation {
  id: string;
  documentId: number;
  documentTitle: string;
  documentExtension: string;
  page: number;
  type: string;
  text: string;
  color: string;
}

export interface TagGroup {
  tag: Tag;
  annotations: TaggedAnnotation[];
}

/** 标签索引：跨文档聚合所有打了标签的批注。 */
export function tagIndex(): TagGroup[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.id AS tag_id, t.name AS tag_name, t.color AS tag_color,
              a.id AS annotation_id, a.document_id, a.page, a.type, a.text, a.color,
              d.title AS document_title, d.extension AS document_extension
       FROM annotation_tags at
       JOIN tags t ON t.id = at.tag_id
       JOIN annotations a ON a.id = at.annotation_id
       JOIN documents d ON d.id = a.document_id
       ORDER BY t.name ASC, a.created_at ASC, a.id ASC`,
    )
    .all() as any[];

  const map = new Map<number, TagGroup>();
  for (const r of rows) {
    let group = map.get(r.tag_id);
    if (!group) {
      group = { tag: { id: r.tag_id, name: r.tag_name, color: r.tag_color }, annotations: [] };
      map.set(r.tag_id, group);
    }
    group.annotations.push({
      id: r.annotation_id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      documentExtension: r.document_extension,
      page: r.page,
      type: r.type,
      text: r.text || '',
      color: r.color,
    });
  }
  return Array.from(map.values());
}
