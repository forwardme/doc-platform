import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { getDataDir, ensureDir } from './storage';

// 开发模式下 Next 会热重载模块，用 globalThis 缓存连接，避免重复打开。
const globalForDb = globalThis as unknown as { __pdfsiteDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__pdfsiteDb) return globalForDb.__pdfsiteDb;

  const db = new DatabaseSync(path.join(ensureDir(getDataDir()), 'doc-platform.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  globalForDb.__pdfsiteDb = db;
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type     TEXT,
      extension     TEXT NOT NULL,
      size          INTEGER NOT NULL DEFAULT 0,
      content       TEXT NOT NULL DEFAULT '',     -- 抽取出的正文（供 LIKE 子串检索，含中文）
      status        TEXT NOT NULL DEFAULT 'ready', -- ready | no_preview | failed
      category_id   INTEGER,                      -- 所属分类（可空）
      last_opened_at TEXT,                        -- 最近打开时间
      body_start_page INTEGER NOT NULL DEFAULT 1, -- 图书正文起始页（PDF 页，正文从 1 重排，之前为目录）
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_files (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,           -- original | pdf | md
      path        TEXT NOT NULL,
      mime_type   TEXT,
      PRIMARY KEY (document_id, kind)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6366f1'
    );

    -- FTS5 全文检索：title + content（content 为抽取出的正文文本）
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      id UNINDEXED,
      title,
      content
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id          TEXT PRIMARY KEY,        -- 客户端生成的稳定 UUID
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page        INTEGER NOT NULL,
      type        TEXT NOT NULL,           -- ink | highlight | underline | note
      data        TEXT NOT NULL DEFAULT '{}', -- JSON：坐标/颜色/文字等
      text        TEXT NOT NULL DEFAULT '',
      color       TEXT NOT NULL DEFAULT '#f59e0b',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(document_id);

    CREATE TABLE IF NOT EXISTS tags (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3b82f6'
    );

    CREATE TABLE IF NOT EXISTS annotation_tags (
      annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
      tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (annotation_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS document_tags (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (document_id, tag_id)
    );
  `);

  // 对旧库补齐新增列（新库已含这些列，此处 try/catch 忽略「列已存在」错误）
  for (const ddl of [
    `ALTER TABLE documents ADD COLUMN category_id INTEGER`,
    `ALTER TABLE documents ADD COLUMN last_opened_at TEXT`,
    `ALTER TABLE documents ADD COLUMN body_start_page INTEGER NOT NULL DEFAULT 1`,
  ]) {
    try {
      db.exec(ddl);
    } catch {
      /* 列已存在 */
    }
  }
}
