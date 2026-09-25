/** @type {import('next').NextConfig} */
const nextConfig = {
  // Node 专属 / 含原生 worker 的模块需在运行时按需加载，不打包。
  serverExternalPackages: ['pdfjs-dist', 'unpdf', '@napi-rs/canvas'],
};

export default nextConfig;
