import { getDb } from './db';

export interface Category {
  id: number;
  name: string;
  color: string;
  count: number;
}

const CATEGORY_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

/** 列出全部分类，附带每个分类下的文档数量（按名称排序）。 */
export function listCategories(): Category[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.color,
              (SELECT COUNT(*) FROM documents d WHERE d.category_id = c.id) AS count
       FROM categories c
       ORDER BY c.name ASC`,
    )
    .all() as unknown as { id: number; name: string; color: string; count: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, count: r.count }));
}

export function getCategory(id: number): { id: number; name: string; color: string } | null {
  const r = getDb().prepare(`SELECT id, name, color FROM categories WHERE id = ?`).get(id) as unknown as
    | { id: number; name: string; color: string }
    | undefined;
  return r ?? null;
}

export function createCategory(name: string, color?: string): Category {
  const db = getDb();
  const normalized = name.trim();
  if (!normalized) throw new Error('分类名不能为空');
  const chosen = color || CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)];
  const info = db.prepare(`INSERT INTO categories (name, color) VALUES (?, ?)`).run(normalized, chosen);
  return { id: Number(info.lastInsertRowid), name: normalized, color: chosen, count: 0 };
}

export function renameCategory(id: number, name: string): Category | null {
  const db = getDb();
  const normalized = name.trim();
  if (!normalized) return null;
  const res = db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(normalized, id);
  if (res.changes === 0) return null;
  const c = getCategory(id)!;
  return { ...c, count: countDocsInCategory(id) };
}

export function recolorCategory(id: number, color: string): Category | null {
  const db = getDb();
  const res = db.prepare(`UPDATE categories SET color = ? WHERE id = ?`).run(color, id);
  if (res.changes === 0) return null;
  const c = getCategory(id)!;
  return { ...c, count: countDocsInCategory(id) };
}

/** 删除分类：先将其下的文档置为「未分类」，再删除分类本身。 */
export function deleteCategory(id: number): boolean {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE documents SET category_id = NULL WHERE category_id = ?`).run(id);
    const res = db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
    db.exec('COMMIT');
    return res.changes > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function countDocsInCategory(id: number): number {
  const r = getDb().prepare(`SELECT COUNT(*) AS n FROM documents WHERE category_id = ?`).get(id) as unknown as { n: number };
  return r.n;
}
