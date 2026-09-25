// 无类型声明 / 无 @types 包的第三方库，这里补最小化的环境声明。

declare module 'mammoth' {
  export interface MammothInput {
    path?: string;
    buffer?: Buffer;
  }
  export interface MammothResult {
    value: string;
    messages: unknown[];
  }
  export function convertToHtml(input: MammothInput, options?: unknown): Promise<MammothResult>;
  export function extractRawText(input: MammothInput): Promise<MammothResult>;
}

declare module 'html-to-docx' {
  interface DocumentOptions {
    orientation?: 'portrait' | 'landscape';
    title?: string;
    font?: string;
    fontSize?: number;
    [key: string]: unknown;
  }
  export default function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: DocumentOptions,
    footerHTMLString?: string | null,
  ): Promise<Buffer>;
}
