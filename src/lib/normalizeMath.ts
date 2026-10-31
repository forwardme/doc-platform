/**
 * 将 Markdown 源码里常见的 `$$...$$` 显示公式改写为独占行的 fence，使其能被
 * `remark-math@6` 识别为块级（display）公式。
 *
 * remark-math@6 要求块级公式的 `$$` 必须独占一行；用户常写成单行 `$$...$$`，
 * 或让 `$$` 与公式首/末行同行，此时会被解析为行内公式（`math-inline`），导致
 * `align*`/`align`/`\tag` 等仅支持 display 模式的环境渲染失败。这里在解析前做
 * 归一化，对读取视图与编辑预览统一生效。
 */
export function normalizeDisplayMath(md: string): string {
  const placeholders: string[] = [];
  let out = md;

  // 1. 保护 fenced code block（``` 或 ~~~）中的 `$`，避免误改代码。
  out = out.replace(
    /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm,
    (m) => stash(placeholders, m),
  );

  // 2. 保护行内代码 `...` 中的 `$`。
  out = out.replace(/`[^`\n]+`/g, (m) => stash(placeholders, m));

  // 3. `$$...$$`（`$$` 不被 `\` 转义、不紧邻 `$`、内容非空且不含 `$`）→ 独占行 fence。
  out = out.replace(
    /(?<![\\$])\$\$(?!\$)([^$]+?)\$\$(?!\$)/g,
    (_m, body: string) => `$$\n${body.trim()}\n$$`,
  );

  // 4. 还原被保护的代码段。
  return out.replace(/\u0000MATHCODE(\d+)\u0000/g, (_m, i: string) => placeholders[Number(i)]);
}

function stash(placeholders: string[], text: string): string {
  const key = `\u0000MATHCODE${placeholders.length}\u0000`;
  placeholders.push(text);
  return key;
}
