/** PNG rasterisation of the export SVG (browser only: Image + canvas). */

export const MAX_PNG_SIDE = 16384;
export const MAX_PNG_AREA = 16_777_216;
export const DEFAULT_PNG_SCALE = 2;

export interface PngScale {
  /** Pixel ratio actually used. */
  scale: number;
  /** Output pixel size: ceil(viewBox * scale), guaranteed within the limits. */
  width: number;
  height: number;
  /** True when `requested` had to be lowered to respect the limits. */
  clamped: boolean;
}

/** Largest scale <= `requested` such that neither side exceeds 16384 px and the area stays <= 16,777,216 px. Pure. */
export function clampPngScale(w: number, h: number, requested: number = DEFAULT_PNG_SCALE): PngScale {
  const req = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_PNG_SCALE;
  const limit = Math.min(MAX_PNG_SIDE / w, MAX_PNG_SIDE / h, Math.sqrt(MAX_PNG_AREA / (w * h)));
  let scale = Math.min(req, limit);
  const dims = (s: number) => ({ width: Math.max(1, Math.ceil(w * s - 1e-9)), height: Math.max(1, Math.ceil(h * s - 1e-9)) });
  let d = dims(scale);
  // ceil() can overshoot a limit by a pixel: shave the scale until it fits.
  while ((d.width > MAX_PNG_SIDE || d.height > MAX_PNG_SIDE || d.width * d.height > MAX_PNG_AREA) && scale > 1e-4) {
    scale = Math.floor(scale * 0.9999 * 1e6) / 1e6;
    d = dims(scale);
  }
  return { scale, ...d, clamped: scale < req };
}

/**
 * Rewrite the root element's width/height (pixels); the viewBox keeps world units so the raster stays sharp.
 * `preserveAspectRatio="none"` makes the viewBox fill the ceil()ed pixel size exactly (a <1 px stretch) so no
 * half-transparent border row/column appears at the edges.
 */
export function withPixelSize(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag
      .replace(/\swidth="[^"]*"/, ` width="${width}"`)
      .replace(/\sheight="[^"]*"/, ` height="${height}"`)
      .replace(/>$/, ' preserveAspectRatio="none">'),
  );
}

/** Draw `svg` (already sized in px via `withPixelSize`) on a canvas of exactly width x height. */
export async function rasterizeSvg(svg: string, width: number, height: number, background?: string | null): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new Error('PNG export requires a browser environment');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    img.width = width;
    img.height = height;
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The browser could not decode the diagram SVG'));
    });
    img.src = url;
    await loaded;
    if (typeof img.decode === 'function') await img.decode().catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    ctx.imageSmoothingQuality = 'high';
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The canvas could not be encoded as PNG (image too large for this browser?)'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
