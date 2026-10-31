import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/contrib/mhchem';
import { normalizeDisplayMath } from '@/lib/normalizeMath';

// 补齐 KaTeX 缺省的常用物理命令（physics 包常见子集，可继续扩展）。
const katexOptions = {
  macros: {
    '\\dv': '\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}',
    '\\pdv': '\\frac{\\partial #1}{\\partial #2}',
    '\\bra': '\\left\\langle #1 \\right|',
    '\\ket': '\\left| #1 \\right\\rangle',
    '\\braket': '\\left\\langle #1 \\vert #2 \\right\\rangle',
    '\\abs': '\\left\\lvert #1 \\right\\rvert',
    '\\norm': '\\left\\lVert #1 \\right\\rVert',
  },
};

/** Markdown 渲染：GFM + LaTeX 数学公式（KaTeX）。服务端/客户端通用。 */
export function MarkdownPreview({ content }: { content: string }) {
  const normalized = normalizeDisplayMath(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, katexOptions]]}
    >
      {normalized}
    </ReactMarkdown>
  );
}
