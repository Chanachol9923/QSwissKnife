export type ImageFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif';

export const IMAGE_FORMATS: { value: ImageFormat; label: string; ext: string; lossy: boolean }[] = [
  { value: 'image/jpeg', label: 'JPG', ext: 'jpg', lossy: true },
  { value: 'image/png', label: 'PNG', ext: 'png', lossy: false },
  { value: 'image/webp', label: 'WebP', ext: 'webp', lossy: true },
  { value: 'image/avif', label: 'AVIF', ext: 'avif', lossy: true },
];

export const formatInfo = (f: ImageFormat) => IMAGE_FORMATS.find((x) => x.value === f)!;

export function formatFromMime(mime: string): ImageFormat | null {
  return IMAGE_FORMATS.find((f) => f.value === mime)?.value ?? null;
}

const support = new Map<string, boolean>();
export async function canEncode(fmt: ImageFormat): Promise<boolean> {
  if (support.has(fmt)) return support.get(fmt)!;
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, fmt, 0.8));
  const ok = !!blob && blob.type === fmt;
  support.set(fmt, ok);
  return ok;
}

export function loadBitmap(src: Blob): Promise<ImageBitmap> {
  return createImageBitmap(src, { imageOrientation: 'from-image' });
}

export function canvasToBlob(canvas: HTMLCanvasElement, fmt: ImageFormat, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), fmt, quality),
  );
}

export type ResizeSpec =
  | { mode: 'none' }
  | { mode: 'percent'; percent: number }
  | { mode: 'fit'; maxW: number; maxH: number }
  | { mode: 'exact'; width: number; height: number };

export function targetSize(w: number, h: number, spec: ResizeSpec): [number, number] {
  switch (spec.mode) {
    case 'none':
      return [w, h];
    case 'percent':
      return [Math.max(1, Math.round((w * spec.percent) / 100)), Math.max(1, Math.round((h * spec.percent) / 100))];
    case 'fit': {
      const s = Math.min(1, (spec.maxW || Infinity) / w, (spec.maxH || Infinity) / h);
      return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
    }
    case 'exact':
      return [Math.max(1, Math.round(spec.width)), Math.max(1, Math.round(spec.height))];
  }
}

export interface ProcessOptions {
  format: ImageFormat;
  quality: number; // 0..1
  resize?: ResizeSpec;
  background?: string; // fill for formats without alpha
}

export async function processImage(file: Blob, opts: ProcessOptions) {
  const bmp = await loadBitmap(file);
  const [w, h] = targetSize(bmp.width, bmp.height, opts.resize ?? { mode: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (opts.format === 'image/jpeg') {
    ctx.fillStyle = opts.background ?? '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const source = { width: bmp.width, height: bmp.height };
  bmp.close();
  const blob = await canvasToBlob(canvas, opts.format, opts.quality);
  return { blob, width: w, height: h, source };
}
