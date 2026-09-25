import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="markdown-body rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
