export type Tool = 'select' | 'ink' | 'text' | 'note' | 'eraser';

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnnotationData {
  points?: [number, number][]; // 兼容旧单段 ink
  paths?: [number, number][][]; // ink 多段（部分擦除后切分）
  size?: number;
  rect?: Rect; // 兼容旧单矩形高亮
  rects?: Rect[]; // 文本选区多行矩形（高亮 / 下划线）
  x?: number;
  y?: number;
}

export type AnnotationType = 'ink' | 'highlight' | 'underline' | 'note';

export interface Annotation {
  id: string;
  page: number;
  type: AnnotationType;
  data: AnnotationData;
  text: string;
  color: string;
  tags: Tag[];
}

/** 文本选区：PDF 点坐标的矩形列表 + 选中文字 + 浮动工具条锚点（屏幕像素）。 */
export interface TextSelection {
  page: number;
  text: string;
  rects: Rect[];
  clientX: number;
  clientY: number;
}
