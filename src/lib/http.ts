import { createReadStream } from 'fs';
import { NextResponse } from 'next/server';

/** 以流式方式返回本地文件，避免大文件整块读入内存。 */
export function fileResponse(path: string, headers: Record<string, string>): NextResponse {
  const stream = createReadStream(path);
  const webStream = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(new Uint8Array(Buffer.from(chunk))));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
  return new NextResponse(webStream, { headers });
}
