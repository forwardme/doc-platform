import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '文档工作台',
  description: '文档存储、PDF 批注与标签索引工作台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-100 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
