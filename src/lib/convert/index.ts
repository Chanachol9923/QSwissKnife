/* Universal converter: routes a detected file + target to the right engine. */
import { zipSync } from 'fflate';
import { canvasToBlob, canEncode } from '../image';
import { readMediaInfo, runFFmpeg } from '../ffmpeg';
import { FastPathUnsupported, fastConvert, fastPathAvailable, type FastContainer } from '../fastvideo';
import { baseName } from '../utils';
import type { Detected } from './detect';
import type { Target } from './targets';
import * as docs from './docs';
import * as tables from './tables';
import * as misc from './misc';

export interface ConvertOptions {
  /** lossy image quality 0.1–1 */
  quality: number;
  audioKbps: number;
  videoLevel: 'high' | 'medium' | 'low';
}

export interface ConvertCtx {
  signal: AbortSignal;
  progress: (ratio: number) => void;
  stage: (text: string) => void;
}

export interface ConvertResult {
  blob: Blob;
  name: string;
  engine: 'browser' | 'fast' | 'ffmpeg';
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon',
  tiff: 'image/tiff', tga: 'image/x-tga', qoi: 'image/qoi', ppm: 'image/x-portable-pixmap', svg: 'image/svg+xml', pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg', flv: 'video/x-flv', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', aiff: 'audio/aiff', wma: 'audio/x-ms-wma', ac3: 'audio/ac3',
  html: 'text/html', md: 'text/markdown', txt: 'text/plain', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
};

const aborted = (ctx: ConvertCtx) => {
  if (ctx.signal.aborted) throw new DOMException('Canceled', 'AbortError');
};

async function readText(file: Blob): Promise<string> {
  const b = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(await file.arrayBuffer());
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(await file.arrayBuffer());
  return (await file.text()).replace(/^﻿/, '');
}

const ff = (input: File, args: (i: string) => string[], out: string, ctx: ConvertCtx, duration?: number) =>
  runFFmpeg({ input, args, output: out, mime: MIME[out.split('.').pop()!] ?? 'application/octet-stream', signal: ctx.signal, onProgress: ctx.progress, duration });

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

const BROWSER_DECODE = ['png', 'jpg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur'];

async function decodeImage(file: File, d: Detected, ctx: ConvertCtx): Promise<HTMLCanvasElement> {
  let src: Blob = file;
  if (d.format === 'heic') {
    ctx.stage('Decoding HEIC…');
    const heic2any = (await import('heic2any')).default;
    const out = await heic2any({ blob: file, toType: 'image/png' });
    src = Array.isArray(out) ? out[0] : out;
  } else if (d.format === 'svg') {
    return rasterizeSvg(file);
  } else if (!BROWSER_DECODE.includes(d.format)) {
    ctx.stage(`Decoding ${d.format.toUpperCase()} with FFmpeg…`);
    src = await ff(file, (i) => ['-i', i, '-frames:v', '1', '-pix_fmt', 'rgba', 'frame.png'], 'frame.png', ctx);
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
  } catch {
    if (src !== file) throw new Error('This image couldn’t be decoded.');
    // browser can't (e.g. unusual BMP/ICO variants): let FFmpeg try
    ctx.stage('Decoding with FFmpeg…');
    bmp = await createImageBitmap(await ff(file, (i) => ['-i', i, '-frames:v', '1', 'frame.png'], 'frame.png', ctx));
  }
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

async function rasterizeSvg(file: Blob): Promise<HTMLCanvasElement> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  let w = parseFloat(svg.getAttribute('width') ?? '') || vb[2] || 1024;
  let h = parseFloat(svg.getAttribute('height') ?? '') || vb[3] || 1024;
  // vector art: render at least 1024 px on the long side so it stays crisp
  const scale = Math.max(1, 1024 / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeBmp(c: HTMLCanvasElement): Blob {
  const { width: w, height: h } = c;
  const px = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42;
  buf[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true);
  for (let y = 0; y < h; y++) {
    const o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = px[i + 3] / 255; // flatten onto white
      buf[o + x * 3] = Math.round(px[i + 2] * a + 255 * (1 - a));
      buf[o + x * 3 + 1] = Math.round(px[i + 1] * a + 255 * (1 - a));
      buf[o + x * 3 + 2] = Math.round(px[i] * a + 255 * (1 - a));
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/** Multi-size ICO with PNG-compressed entries (Windows Vista+). */
async function encodeIco(c: HTMLCanvasElement): Promise<Blob> {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs: Uint8Array[] = [];
  for (const s of sizes) {
    const t = document.createElement('canvas');
    t.width = t.height = s;
    const g = t.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    const k = Math.min(s / c.width, s / c.height);
    g.drawImage(c, (s - c.width * k) / 2, (s - c.height * k) / 2, c.width * k, c.height * k);
    pngs.push(new Uint8Array(await (await canvasToBlob(t, 'image/png')).arrayBuffer()));
  }
  const head = 6 + sizes.length * 16;
  const out = new Uint8Array(head + pngs.reduce((s, p) => s + p.length, 0));
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, sizes.length, true);
  let off = head;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    out[e] = s >= 256 ? 0 : s;
    out[e + 1] = s >= 256 ? 0 : s;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, pngs[i].length, true);
    dv.setUint32(e + 12, off, true);
    out.set(pngs[i], off);
    off += pngs[i].length;
  });
  return new Blob([out], { type: 'image/x-icon' });
}

async function encodeImage(c: HTMLCanvasElement, target: string, opts: ConvertOptions, ctx: ConvertCtx, title: string, sourceJpeg: boolean): Promise<Blob> {
  switch (target) {
    case 'png': return canvasToBlob(c, 'image/png');
    case 'webp': return canvasToBlob(c, 'image/webp', opts.quality);
    case 'avif':
      if (!(await canEncode('image/avif'))) throw new Error('This browser can’t create AVIF images.');
      return canvasToBlob(c, 'image/avif', opts.quality);
    case 'jpg': {
      const flat = document.createElement('canvas');
      flat.width = c.width;
      flat.height = c.height;
      const g = flat.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(c, 0, 0);
      return canvasToBlob(flat, 'image/jpeg', opts.quality);
    }
    case 'bmp': return encodeBmp(c);
    case 'ico': return encodeIco(c);
    case 'svg': {
      const png = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
      let bin = '';
      for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000));
      return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><title>${title.replace(/[<&]/g, '')}</title><image width="${c.width}" height="${c.height}" href="data:image/png;base64,${btoa(bin)}"/></svg>\n`], { type: 'image/svg+xml' });
    }
    case 'pdf': {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const bytes = new Uint8Array(await (await encodeImage(c, sourceJpeg ? 'jpg' : 'png', opts, ctx, title, sourceJpeg)).arrayBuffer());
      const img = sourceJpeg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      const w = c.width * 0.75;
      const h = c.height * 0.75;
      pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
      return new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' });
    }
    case 'gif':
    case 'tiff':
    case 'tga':
    case 'qoi':
    case 'ppm': {
      ctx.stage(`Encoding ${target.toUpperCase()}…`);
      const png = new File([await canvasToBlob(c, 'image/png')], 'in.png', { type: 'image/png' });
      const out = `out.${target}`;
      const extra =
        target === 'gif' ? ['-filter_complex', 'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse'] :
        target === 'tiff' ? ['-compression_algo', 'deflate'] :
        target === 'ppm' ? ['-pix_fmt', 'rgb24'] : [];
      return ff(png, (i) => ['-i', i, ...extra, out], out, ctx);
    }
  }
  throw new Error(`Can’t create ${target}`);
}

/* ------------------------------------------------------------------ */
/* Video & audio                                                       */
/* ------------------------------------------------------------------ */

const CRF = { high: 20, medium: 25, low: 30 };
const FAST: Record<string, FastContainer> = { mp4: 'mp4', webm: 'webm', mov: 'mov', mkv: 'mkv' };

function audioArgs(target: string, kbps: number): string[] {
  const b = ['-b:a', `${kbps}k`];
  switch (target) {
    case 'mp3': return ['-c:a', 'libmp3lame', ...b];
    case 'wav': return ['-c:a', 'pcm_s16le'];
    case 'm4a': return ['-c:a', 'aac', ...b, '-f', 'ipod'];
    case 'aac': return ['-c:a', 'aac', ...b, '-f', 'adts'];
    case 'ogg': return ['-c:a', 'libvorbis', ...b];
    case 'opus': return ['-c:a', 'libopus', ...b, '-f', 'ogg'];
    case 'flac': return ['-c:a', 'flac'];
    case 'aiff': return ['-c:a', 'pcm_s16be', '-f', 'aiff'];
    case 'wma': return ['-c:a', 'wmav2', ...b, '-f', 'asf'];
    case 'ac3': return ['-c:a', 'ac3', '-b:a', `${Math.max(kbps, 192)}k`];
  }
  throw new Error(`Can’t create ${target}`);
}

function videoArgs(target: string, opts: ConvertOptions): string[] {
  const crf = String(CRF[opts.videoLevel]);
  const even = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  const x264 = [...even, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p'];
  switch (target) {
    case 'mp4': return [...x264, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
    case 'mov': return [...x264, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
    case 'mkv': return [...x264, '-c:a', 'aac', '-b:a', '160k'];
    case 'flv': return [...x264, '-c:a', 'aac', '-b:a', '128k', '-f', 'flv'];
    case 'webm': return ['-c:v', 'libvpx', '-b:v', '0', '-crf', String(CRF[opts.videoLevel] - 10), '-qmin', '4', '-qmax', '48', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '128k'];
    case 'avi': return ['-c:v', 'mpeg4', '-q:v', opts.videoLevel === 'high' ? '3' : opts.videoLevel === 'medium' ? '5' : '8', '-c:a', 'libmp3lame', '-b:a', '192k'];
    case 'wmv': return [...even, '-c:v', 'wmv2', '-q:v', opts.videoLevel === 'high' ? '3' : '6', '-c:a', 'wmav2', '-b:a', '160k', '-f', 'asf'];
    case 'mpeg': return [...even, '-c:v', 'mpeg2video', '-q:v', opts.videoLevel === 'high' ? '3' : '6', '-c:a', 'mp2', '-b:a', '192k', '-f', 'mpeg'];
    case 'ogv': return ['-c:v', 'libtheora', '-q:v', opts.videoLevel === 'high' ? '8' : '6', '-c:a', 'libvorbis', '-q:a', '5'];
    case 'gif': return ['-filter_complex', "fps=12,scale='min(480,iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", '-loop', '0'];
  }
  throw new Error(`Can’t create ${target}`);
}

async function convertMedia(file: File, d: Detected, target: Target, opts: ConvertOptions, ctx: ConvertCtx): Promise<Omit<ConvertResult, 'name'> & { ext: string }> {
  ctx.stage('Reading file…');
  const info = await readMediaInfo(file, d.kind === 'video' || d.kind === 'image').catch(() => null);
  const duration = info?.duration || undefined;
  const audioOnly = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'aiff', 'wma', 'ac3'].includes(target.id);

  if (target.id === 'frame-jpg' || target.id === 'frame-png') {
    ctx.stage('Grabbing a representative frame…');
    const out = target.id === 'frame-jpg' ? 'frame.jpg' : 'frame.png';
    return { blob: await ff(file, (i) => ['-i', i, '-vf', 'thumbnail=60', '-frames:v', '1', ...(out.endsWith('jpg') ? ['-q:v', '2'] : []), out], out, ctx), ext: target.ext, engine: 'ffmpeg' };
  }

  if (!audioOnly && FAST[target.id] && fastPathAvailable() && d.kind === 'video') {
    try {
      ctx.stage('Hardware encoding…');
      const blob = await fastConvert({ input: file, container: FAST[target.id], video: { level: opts.videoLevel === 'medium' ? 'medium' : opts.videoLevel }, signal: ctx.signal, onProgress: ctx.progress });
      return { blob, ext: target.ext, engine: 'fast' };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (!(e instanceof FastPathUnsupported)) console.warn('fast path failed, using FFmpeg', e);
    }
  }
  ctx.stage('Converting with FFmpeg…');
  const out = `out.${target.ext}`;
  const args = audioOnly ? ['-vn', ...audioArgs(target.id, opts.audioKbps)] : videoArgs(target.id, opts);
  return { blob: await ff(file, (i) => ['-i', i, ...args, out], out, ctx, duration), ext: target.ext, engine: 'ffmpeg' };
}

/* ------------------------------------------------------------------ */
/* PDF pages → images                                                  */
/* ------------------------------------------------------------------ */

async function pdfToImages(file: File, target: string, opts: ConvertOptions, ctx: ConvertCtx, base: string): Promise<{ blob: Blob; ext: string }> {
  const pdfjs = await docs.loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const files: Record<string, Uint8Array> = {};
  let single: Blob | null = null;
  for (let n = 1; n <= pdf.numPages; n++) {
    aborted(ctx);
    ctx.stage(`Rendering page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 2 }); // ~144 dpi
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    // 'print' intent renders without requestAnimationFrame, so it keeps going while the window is hidden/minimised
    await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
    const blob = await canvasToBlob(c, target === 'jpg' ? 'image/jpeg' : 'image/png', opts.quality);
    if (pdf.numPages === 1) single = blob;
    else files[`${base}-page-${String(n).padStart(String(pdf.numPages).length, '0')}.${target}`] = new Uint8Array(await blob.arrayBuffer());
    ctx.progress(n / pdf.numPages);
  }
  if (single) return { blob: single, ext: target };
  return { blob: new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), ext: 'zip' };
}

/* ------------------------------------------------------------------ */
/* Documents, tables, data                                             */
/* ------------------------------------------------------------------ */

async function readBlocks(file: File, d: Detected, ctx: ConvertCtx): Promise<docs.Block[]> {
  ctx.stage('Reading document…');
  switch (d.format) {
    case 'docx': return docs.fromDocx(file);
    case 'odt': case 'odp': return docs.fromOdf(file);
    case 'pptx': return docs.fromPptx(file);
    case 'epub': return docs.fromEpub(file);
    case 'rtf': return docs.fromText(docs.rtfToText(await readText(file)));
    case 'pdf': return docs.fromPdf(file, (p) => ctx.progress(p * 0.5));
    case 'md': return docs.fromMarkdown(await readText(file));
    case 'html': return docs.fromHtml(await readText(file));
    case 'txt': return docs.fromText(await readText(file));
  }
  if (d.kind === 'spreadsheet') return tables.workbookBlocks(await tables.readWorkbook(file, d.format));
  if (d.kind === 'data') return tables.workbookBlocks(await tables.dataToWorkbook(await tables.parseData(await readText(file), d.format)));
  throw new Error(`Can’t read ${d.label}`);
}

async function writeBlocks(blocks: docs.Block[], target: string, title: string, ctx: ConvertCtx): Promise<{ blob: Blob; ext: string }> {
  if (!blocks.length) throw new Error('No text could be found in this file.');
  ctx.stage(target === 'pdf' ? 'Laying out pages…' : `Writing ${target.toUpperCase()}…`);
  switch (target) {
    case 'html': return { blob: new Blob([docs.toHtml(blocks, title)], { type: 'text/html;charset=utf-8' }), ext: 'html' };
    case 'md': return { blob: new Blob([docs.toMarkdown(blocks)], { type: 'text/markdown;charset=utf-8' }), ext: 'md' };
    case 'txt': return { blob: new Blob([docs.toText(blocks)], { type: 'text/plain;charset=utf-8' }), ext: 'txt' };
    case 'docx': return { blob: docs.toDocx(blocks), ext: 'docx' };
    case 'pdf': return { blob: await docs.toPdf(blocks, title, (p) => ctx.progress(0.5 + p * 0.5)), ext: 'pdf' };
  }
  throw new Error(`Can’t create ${target}`);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function convertFile(file: File, d: Detected, target: Target, opts: ConvertOptions, ctx: ConvertCtx): Promise<ConvertResult> {
  const base = baseName(file.name.replace(/\.tar\.gz$/i, '.tgz'));
  const done = (blob: Blob, ext: string, engine: ConvertResult['engine'] = 'browser'): ConvertResult => ({ blob, name: ext ? `${base}.${ext}` : base, engine });
  const T = target.id;

  // generic: pack anything
  if (T === 'zip' && d.format !== 'tar' && d.format !== 'tgz') {
    const blob = new Blob([zipSync({ [file.name]: new Uint8Array(await file.arrayBuffer()) }) as BlobPart], { type: 'application/zip' });
    return { blob, name: `${file.name}.zip`, engine: 'browser' };
  }
  if (T === 'gz') return { blob: new Blob([misc.gzipSync(new Uint8Array(await file.arrayBuffer())) as BlobPart], { type: 'application/gzip' }), name: `${file.name}.gz`, engine: 'browser' };
  if (T === 'gunzip') {
    const out = misc.gunzipSync(new Uint8Array(await file.arrayBuffer()));
    return { blob: new Blob([out as BlobPart]), name: file.name.replace(/\.gz$/i, '') || `${base}.bin`, engine: 'browser' };
  }

  // images
  if (d.kind === 'image') {
    if (['mp4', 'webm'].includes(T) || (T === 'gif' && d.animated)) {
      const r = await convertMedia(file, d, target, opts, ctx);
      return done(r.blob, r.ext, r.engine);
    }
    ctx.stage('Decoding…');
    const c = await decodeImage(file, d, ctx);
    aborted(ctx);
    ctx.stage(`Encoding ${target.label}…`);
    const blob = await encodeImage(c, T, opts, ctx, base, d.format === 'jpg' || d.format === 'heic');
    return done(blob, target.ext, ['gif', 'tiff', 'tga', 'qoi', 'ppm'].includes(T) || !['png', 'jpg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'svg', 'heic'].includes(d.format) ? 'ffmpeg' : 'browser');
  }

  if (d.kind === 'video' || d.kind === 'audio') {
    const r = await convertMedia(file, d, target, opts, ctx);
    return done(r.blob, r.ext, r.engine);
  }

  if (d.format === 'pdf' && (T === 'png' || T === 'jpg')) {
    const r = await pdfToImages(file, T, opts, ctx, base);
    return done(r.blob, r.ext);
  }

  if (d.kind === 'spreadsheet' && ['xlsx', 'ods', 'csv', 'tsv', 'json', 'txt'].includes(T)) {
    ctx.stage('Reading table…');
    const r = await tables.writeWorkbook(await tables.readWorkbook(file, d.format), T, base);
    return done(r.blob, r.ext);
  }

  if (d.kind === 'data' && ['json', 'yaml', 'toml', 'xml', 'csv', 'xlsx'].includes(T)) {
    ctx.stage('Parsing data…');
    const r = await tables.writeData(await tables.parseData(await readText(file), d.format), T, base);
    return done(r.blob, r.ext);
  }

  if (d.kind === 'subtitle') {
    const cues = misc.parseSubtitles(await readText(file), d.format);
    if (!cues.length) throw new Error('No subtitle lines were found.');
    return done(new Blob([misc.writeSubtitles(cues, T)], { type: 'text/plain;charset=utf-8' }), target.ext);
  }

  if (d.kind === 'font') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (T === 'woff') return done(new Blob([misc.sfntToWoff(bytes) as BlobPart], { type: 'font/woff' }), 'woff');
    if (T === 'sfnt') {
      const r = misc.woffToSfnt(bytes);
      return done(new Blob([r.data as BlobPart], { type: `font/${r.ext}` }), r.ext);
    }
  }

  if (d.kind === 'archive' && ['zip', 'tar', 'tgz'].includes(T)) {
    ctx.stage('Repacking…');
    const files = misc.readArchive(new Uint8Array(await file.arrayBuffer()), d.format);
    return done(new Blob([misc.writeArchive(files, T) as BlobPart], { type: MIME[T] ?? 'application/octet-stream' }), target.ext);
  }

  // everything document-like goes through the block model
  if (['pdf', 'docx', 'html', 'md', 'txt'].includes(T)) {
    const blocks = await readBlocks(file, d, ctx);
    aborted(ctx);
    const r = await writeBlocks(blocks, T, base, ctx);
    return done(r.blob, r.ext);
  }

  throw new Error(`Converting ${d.label} to ${target.label} isn’t supported.`);
}

/** Text preview of the first part of a text-ish file (for the detail panel). */
export async function peekText(file: File, max = 600) {
  return (await readText(file.slice(0, max * 4))).slice(0, max);
}

