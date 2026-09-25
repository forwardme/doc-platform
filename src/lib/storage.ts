import path from 'path';
import fs from 'fs';

/** 数据根目录：文件 + SQLite 都放在这里，云部署时挂载为持久化卷即可。 */
export function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function originalDir(): string {
  return ensureDir(path.join(getDataDir(), 'original'));
}

export function pdfDir(): string {
  return ensureDir(path.join(getDataDir(), 'pdf'));
}

export function mdDir(): string {
  return ensureDir(path.join(getDataDir(), 'md'));
}

export function tmpDir(): string {
  return ensureDir(path.join(getDataDir(), 'tmp'));
}

/** 生成安全的落盘文件名：docId + 随机后缀 + 原扩展名。 */
export function originalFileName(docId: number, ext: string): string {
  return `${docId}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
}
