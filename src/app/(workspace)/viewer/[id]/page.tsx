import Link from 'next/link';
import { notFound } from 'next/navigation';
import fs from 'fs';
import { getDocument, getPreviewFile } from '@/lib/documents';
import { listAnnotations } from '@/lib/annotations';
import { MarkdownViewer } from '@/components/MarkdownViewer';
import PdfViewer from '@/components/pdf/PdfViewer';
import ExcelViewer from '@/components/office/ExcelViewer';
import WordViewer from '@/components/office/WordViewer';
import PrintButton from '@/components/PrintButton';
import RecordOpen from '@/components/RecordOpen';
import RenameButton from '@/components/RenameButton';

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  if (!doc) notFound();

  const preview = getPreviewFile(Number(id));
  const annotations = listAnnotations(Number(id));

  return (
    <div>
      <RecordOpen id={doc.id} />
      <div className="print:hidden mb-4 flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
          ← 返回
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold" title={doc.title}>
          {doc.title}
        </h1>
        <RenameButton id={doc.id} title={doc.title} />
        <span className="text-xs text-gray-400">
          {doc.extension.toUpperCase()} · {formatSize(doc.size)}
        </span>
        <a
          href={`/api/documents/${doc.id}/file`}
          className="rounded-md bg-gray-50 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
        >
          下载原文件
        </a>
        <PrintButton />
        {preview?.kind === 'pdf' && (
          <a
            href={`/api/documents/${doc.id}/export`}
            className="rounded-md bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100"
          >
            下载标注版
          </a>
        )}
      </div>

      {doc.extension === 'xlsx' || doc.extension === 'xls' ? (
        <ExcelViewer documentId={doc.id} />
      ) : doc.extension === 'docx' ? (
        <WordViewer documentId={doc.id} />
      ) : preview?.kind === 'md' ? (
        <MarkdownViewer content={fs.readFileSync(preview.path, 'utf8')} />
      ) : preview?.kind === 'pdf' ? (
        <PdfViewer documentId={doc.id} initialAnnotations={annotations} />
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 py-20 text-center text-sm text-gray-400">
          该文档暂无可预览内容。
          {doc.status === 'no_preview' && (
            <>
              <br />
              Office 文档预览需要服务器安装 LibreOffice（本地可用{' '}
              <code className="rounded bg-gray-100 px-1">brew install --cask libreoffice</code>）。
            </>
          )}
          <br />
          <span className="mt-2 inline-block">
            仍可{' '}
            <a href={`/api/documents/${doc.id}/file`} className="text-blue-600 underline">
              下载原文件
            </a>
            。
          </span>
        </div>
      )}
    </div>
  );
}
