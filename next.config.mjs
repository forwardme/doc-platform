/** @type {import('next').NextConfig} */
const nextConfig = {
  // Node 专属 / 含原生 worker 的模块需在运行时按需加载，不打包。
  serverExternalPackages: ['pdfjs-dist', 'unpdf', '@napi-rs/canvas'],
  experimental: {
    // 中间件默认只克隆前 10MB 请求体，超出后上传文件会被截断导致失败。
    // 调大以支持大文件上传（按需可再调高）。
    middlewareClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
