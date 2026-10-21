import type { Id } from '@/model/types';

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'json';

export interface ExportOptions {
  /** Default 'white'. */
  background?: 'white' | 'transparent';
  /** World-unit margin around the content (>= 2). Default 24. */
  padding?: number;
  /** PNG pixel ratio. Default 2. Clamped (see `clampPngScale`). */
  scale?: number;
  /** Export only these diagram nodes and the edges between them. */
  selectionNodeIds?: Id[];
  /** PDF page: content-sized ('fit', default) or A4 / Letter. */
  pageSize?: 'fit' | 'a4' | 'letter';
  /** PDF orientation for a4/letter. Default 'auto' (landscape when the content is wider than tall). */
  orientation?: 'auto' | 'portrait' | 'landscape';
  /** PDF margin in pt. Default 0 for 'fit', 36 for A4/Letter. */
  margin?: number;
  /** PDF document title / SVG <title>. Default `<project> - <diagram>`. */
  title?: string;
  /** Default false: exports always use the light palette. */
  darkPalette?: boolean;
}

export interface ExportInfo {
  /** svg: viewBox width in px; png: pixel width; pdf: page width in pt. */
  width: number;
  /** See `width`. */
  height: number;
  /** png (and the image-PDF fallback): the pixel ratio actually used. */
  scaleUsed?: number;
  /** true for SVG and text-based PDF, false for PNG and the image-PDF fallback. */
  vector: boolean;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mime: string;
  warnings: string[];
  info: ExportInfo;
}
