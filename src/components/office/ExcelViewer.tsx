'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CellValue, SheetData } from '@/lib/office';
import PrintButton from '../PrintButton';

/** 列号 → 列字母（0 → A，25 → Z，26 → AA）。 */
function colLetter(idx: number): string {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** 编辑输入回写为 string 或 number（纯数字转 number，其余保持字符串）。 */
function coerce(raw: string): string | number {
  const t = raw.trim();
  if (t === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

export default function ExcelViewer({ documentId }: { documentId: number }) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);

  useEffect(() => {
    fetch(`/api/documents/${documentId}/sheet`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        setSheets(d.sheets ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError('无法加载 Excel 内容');
        setLoading(false);
      });
  }, [documentId]);

  const commit = useCallback(
    (r: number, c: number, raw: string) => {
      setSaved(false);
      setEdit(null);
      const val = coerce(raw);
      setSheets((prev) =>
        prev.map((s, si) => {
          if (si !== active) return s;
          const rows = s.rows.map((row, ri) =>
            ri === r ? row.map((cell, ci) => (ci === c ? val : cell)) : row,
          );
          return { ...s, rows };
        }),
      );
    },
    [active],
  );

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/documents/${documentId}/sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheets }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      window.dispatchEvent(new Event('pdfsite:changed'));
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-20 text-center text-sm text-gray-400">正在加载表格…</div>;
  if (error && sheets.length === 0)
    return <div className="rounded-lg bg-red-50 p-8 text-center text-red-600">{error}</div>;

  const current = sheets[active];
  const colCount = current ? Math.max(0, ...current.rows.map((r) => r.length)) : 0;

  return (
    <div>
      <div className="print:hidden sticky top-14 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1">
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`rounded-md px-2.5 py-1 text-sm ${
                i === active ? 'bg-green-100 text-green-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-xs text-red-500">{error}</span>}
          {saved && <span className="text-xs text-green-600">已保存</span>}
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <PrintButton />
        </div>
      </div>

      {current ? (
        <div className="overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[40px] border border-gray-200 bg-gray-100 px-2 py-1 text-center text-xs text-gray-500" />
                {Array.from({ length: colCount }, (_, c) => (
                  <th
                    key={c}
                    className="min-w-[80px] border border-gray-200 bg-gray-100 px-2 py-1 text-center text-xs font-medium text-gray-500"
                  >
                    {colLetter(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.rows.map((row, r) => (
                <tr key={r}>
                  <td className="sticky left-0 z-10 border border-gray-200 bg-gray-100 px-2 py-0.5 text-center text-xs text-gray-500">
                    {r + 1}
                  </td>
                  {Array.from({ length: colCount }, (_, c) => {
                    const v = row[c] as CellValue | undefined;
                    const isEditing = edit?.r === r && edit?.c === c;
                    return (
                      <td key={c} className="border border-gray-200 p-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            defaultValue={v == null ? '' : String(v)}
                            onBlur={(e) => commit(r, c, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commit(r, c, e.currentTarget.value);
                              else if (e.key === 'Escape') setEdit(null);
                            }}
                            className="h-8 w-full min-w-[80px] px-2 py-1 outline-none ring-2 ring-inset ring-blue-400"
                          />
                        ) : (
                          <div
                            onClick={() => setEdit({ r, c })}
                            className="h-8 w-full min-w-[80px] cursor-cell overflow-hidden whitespace-pre px-2 py-1 text-ellipsis"
                            title={v == null ? '' : String(v)}
                          >
                            {v == null ? '' : String(v)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 py-20 text-center text-sm text-gray-400">
          该表格没有内容。
        </div>
      )}
    </div>
  );
}
