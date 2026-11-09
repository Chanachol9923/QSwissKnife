/*
 * Identify a file from its content ("magic bytes"), falling back to the extension only when the
 * content has no signature (plain-text formats). A file named .jpg that is really a PNG is reported
 * as PNG, with `mismatch` set so the UI can say so.
 */
import { extOf } from '../utils';

export type Kind =
  | 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'presentation' | 'ebook'
  | 'spreadsheet' | 'data' | 'markup' | 'text' | 'subtitle' | 'font' | 'archive' | 'other';

export interface Detected {
  /** canonical format id, e.g. 'png', 'docx', 'mp4' */
  format: string;
  kind: Kind;
  /** human-friendly name, e.g. "PNG image" */
  label: string;
  /** how we know: file content (reliable) or only the name */
  by: 'content' | 'extension';
  /** extension disagrees with the content */
  mismatch: boolean;
  /** extra facts found while sniffing (e.g. animated GIF) */
  animated?: boolean;
}

interface Info {
  kind: Kind;
  label: string;
}

/** Every format we can name, with its family. */
export const FORMATS: Record<string, Info> = {
  // images
  png: { kind: 'image', label: 'PNG image' }, jpg: { kind: 'image', label: 'JPEG image' }, gif: { kind: 'image', label: 'GIF image' },
  webp: { kind: 'image', label: 'WebP image' }, avif: { kind: 'image', label: 'AVIF image' }, heic: { kind: 'image', label: 'HEIC photo (iPhone)' },
  bmp: { kind: 'image', label: 'Bitmap image' }, ico: { kind: 'image', label: 'Windows icon' }, cur: { kind: 'image', label: 'Windows cursor' },
  tiff: { kind: 'image', label: 'TIFF image' }, svg: { kind: 'image', label: 'SVG vector image' }, psd: { kind: 'image', label: 'Photoshop document' },
  tga: { kind: 'image', label: 'Targa image' }, qoi: { kind: 'image', label: 'QOI image' }, pcx: { kind: 'image', label: 'PCX image' },
  ppm: { kind: 'image', label: 'Netpbm image' }, exr: { kind: 'image', label: 'OpenEXR image' }, hdr: { kind: 'image', label: 'Radiance HDR image' },
  dds: { kind: 'image', label: 'DirectDraw texture' }, jxl: { kind: 'image', label: 'JPEG XL image' },
  // video
  mp4: { kind: 'video', label: 'MP4 video' }, mov: { kind: 'video', label: 'QuickTime video' }, m4v: { kind: 'video', label: 'M4V video' },
  webm: { kind: 'video', label: 'WebM video' }, mkv: { kind: 'video', label: 'Matroska video' }, avi: { kind: 'video', label: 'AVI video' },
  flv: { kind: 'video', label: 'Flash video' }, wmv: { kind: 'video', label: 'Windows Media video' }, mpeg: { kind: 'video', label: 'MPEG video' },
  ts: { kind: 'video', label: 'MPEG transport stream' }, '3gp': { kind: 'video', label: '3GP video' }, ogv: { kind: 'video', label: 'Ogg video' },
  // audio
  mp3: { kind: 'audio', label: 'MP3 audio' }, wav: { kind: 'audio', label: 'WAV audio' }, ogg: { kind: 'audio', label: 'Ogg Vorbis audio' },
  opus: { kind: 'audio', label: 'Opus audio' }, m4a: { kind: 'audio', label: 'M4A audio' }, aac: { kind: 'audio', label: 'AAC audio' },
  flac: { kind: 'audio', label: 'FLAC audio' }, aiff: { kind: 'audio', label: 'AIFF audio' }, wma: { kind: 'audio', label: 'Windows Media audio' },
  ac3: { kind: 'audio', label: 'Dolby AC-3 audio' }, amr: { kind: 'audio', label: 'AMR voice recording' }, caf: { kind: 'audio', label: 'Core Audio file' },
  mid: { kind: 'other', label: 'MIDI music' },
  // documents
  pdf: { kind: 'pdf', label: 'PDF document' }, docx: { kind: 'document', label: 'Word document' }, doc: { kind: 'document', label: 'Word 97–2003 document' },
  odt: { kind: 'document', label: 'OpenDocument text' }, rtf: { kind: 'document', label: 'Rich Text document' },
  pptx: { kind: 'presentation', label: 'PowerPoint presentation' }, ppt: { kind: 'presentation', label: 'PowerPoint 97–2003' },
  odp: { kind: 'presentation', label: 'OpenDocument presentation' }, epub: { kind: 'ebook', label: 'EPUB e-book' },
  // tables & data
  xlsx: { kind: 'spreadsheet', label: 'Excel workbook' }, xls: { kind: 'spreadsheet', label: 'Excel 97–2003 workbook' },
  ods: { kind: 'spreadsheet', label: 'OpenDocument spreadsheet' }, csv: { kind: 'spreadsheet', label: 'CSV table' },
  tsv: { kind: 'spreadsheet', label: 'Tab-separated table' }, json: { kind: 'data', label: 'JSON data' }, yaml: { kind: 'data', label: 'YAML data' },
  toml: { kind: 'data', label: 'TOML config' }, xml: { kind: 'data', label: 'XML data' },
  // text
  md: { kind: 'markup', label: 'Markdown' }, html: { kind: 'markup', label: 'HTML page' }, txt: { kind: 'text', label: 'Plain text' },
  srt: { kind: 'subtitle', label: 'SRT subtitles' }, vtt: { kind: 'subtitle', label: 'WebVTT subtitles' }, ass: { kind: 'subtitle', label: 'ASS/SSA subtitles' },
  // fonts
  ttf: { kind: 'font', label: 'TrueType font' }, otf: { kind: 'font', label: 'OpenType font' }, woff: { kind: 'font', label: 'WOFF web font' },
  woff2: { kind: 'font', label: 'WOFF2 web font' }, ttc: { kind: 'font', label: 'TrueType collection' },
  // archives
  zip: { kind: 'archive', label: 'ZIP archive' }, tar: { kind: 'archive', label: 'TAR archive' }, tgz: { kind: 'archive', label: 'TAR.GZ archive' },
  gz: { kind: 'archive', label: 'Gzip file' }, '7z': { kind: 'archive', label: '7-Zip archive' }, rar: { kind: 'archive', label: 'RAR archive' },
  bz2: { kind: 'archive', label: 'Bzip2 file' }, xz: { kind: 'archive', label: 'XZ file' },
  // things we can name but not convert
  exe: { kind: 'other', label: 'Windows program' }, sqlite: { kind: 'other', label: 'SQLite database' }, iso: { kind: 'other', label: 'Disc image' },
  bin: { kind: 'other', label: 'Unknown binary file' },
};

/** extension → canonical id */
const EXT_ALIAS: Record<string, string> = {
  jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', tif: 'tiff', heif: 'heic', hif: 'heic', yml: 'yaml', htm: 'html', xhtml: 'html', markdown: 'md',
  text: 'txt', log: 'txt', ssa: 'ass', mpg: 'mpeg', mpe: 'mpeg', m2ts: 'ts', mts: 'ts', oga: 'ogg', aif: 'aiff', aifc: 'aiff', midi: 'mid',
  pbm: 'ppm', pgm: 'ppm', pnm: 'ppm', 'tar.gz': 'tgz', 'tar.bz2': 'bz2', icb: 'tga', vda: 'tga', vst: 'tga', webvtt: 'vtt', db: 'sqlite',
};

const canonicalExt = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tgz';
  const e = extOf(name);
  return EXT_ALIAS[e] ?? e;
};

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Read the names in a ZIP's central directory (only touches the end of the file). */
async function zipEntries(file: File): Promise<string[]> {
  const tailLen = Math.min(file.size, 66_000);
  const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const dv = new DataView(tail.buffer, tail.byteOffset);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > file.size || cdSize > 8_000_000) return [];
  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cv = new DataView(cd.buffer);
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let p = 0; p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50; ) {
    const nameLen = cv.getUint16(p + 28, true);
    const extra = cv.getUint16(p + 30, true);
    const comment = cv.getUint16(p + 32, true);
    names.push(dec.decode(cd.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extra + comment;
  }
  return names;
}

/** Read one small entry out of a ZIP (only used for OpenDocument content sniffing). */
async function readZipEntryText(file: File, name: string): Promise<string> {
  if (file.size > 50_000_000) return '';
  const { unzipSync, strFromU8 } = await import('fflate');
  try {
    const out = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === name });
    return out[name] ? strFromU8(out[name]).slice(0, 4000) : '';
  } catch {
    return '';
  }
}

async function sniffZip(file: File, head: Uint8Array): Promise<string> {
  // OpenDocument / EPUB store an uncompressed "mimetype" file first
  const h = ascii(head, 30, 100);
  if (h.startsWith('mimetype')) {
    if (h.includes('application/epub+zip')) return 'epub';
    if (h.includes('opendocument.text')) return 'odt';
    if (h.includes('opendocument.spreadsheet')) return 'ods';
    if (h.includes('opendocument.presentation')) return 'odp';
  }
  const names = await zipEntries(file);
  if (names.includes('word/document.xml')) return 'docx';
  if (names.includes('xl/workbook.xml')) return 'xlsx';
  if (names.includes('ppt/presentation.xml')) return 'pptx';
  if (names.includes('META-INF/container.xml')) return 'epub';
  // OpenDocument whose "mimetype" entry is compressed (some writers do that): recognise by structure
  if (names.includes('content.xml') && (names.includes('META-INF/manifest.xml') || names.includes('mimetype'))) {
    const ext = canonicalExt(file.name);
    if (ext === 'ods' || ext === 'odp' || ext === 'odt') return ext;
    const content = await readZipEntryText(file, 'content.xml');
    if (content.includes('<office:spreadsheet')) return 'ods';
    if (content.includes('<office:presentation')) return 'odp';
    return 'odt';
  }
  return 'zip';
}

function sniffIsoBmff(b: Uint8Array): string | null {
  if (ascii(b, 4, 4) !== 'ftyp') return null;
  const brands = ascii(b, 8, 4) + ascii(b, 16, Math.min(32, b.length - 16));
  const major = ascii(b, 8, 4);
  if (/avif|avis/.test(brands)) return 'avif';
  if (/heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1/.test(major) || /heic|heix/.test(brands)) return 'heic';
  if (/^M4A |^M4B /.test(major)) return 'm4a';
  if (major === 'M4V ' || major === 'M4VH') return 'm4v';
  if (major === 'qt  ') return 'mov';
  if (major.startsWith('3g')) return '3gp';
  if (major === 'crx ') return 'bin';
  return 'mp4';
}

function sniffBinary(b: Uint8Array): string | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF') {
    const t = ascii(b, 8, 4);
    if (t === 'WEBP') return 'webp';
    if (t === 'WAVE') return 'wav';
    if (t === 'AVI ') return 'avi';
  }
  const iso = sniffIsoBmff(b);
  if (iso) return iso;
  if (ascii(b, 0, 2) === 'BM' && b.length > 14) return 'bmp';
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (startsWith(b, [0, 0, 1, 0]) && b[4] > 0 && b[5] === 0) return 'ico';
  if (startsWith(b, [0, 0, 2, 0]) && b[4] > 0 && b[5] === 0) return 'cur';
  if (ascii(b, 0, 4) === '8BPS') return 'psd';
  if (ascii(b, 0, 4) === 'qoif') return 'qoi';
  if (startsWith(b, [0x76, 0x2f, 0x31, 0x01])) return 'exr';
  if (ascii(b, 0, 4) === 'DDS ') return 'dds';
  if (ascii(b, 0, 10) === '#?RADIANCE' || ascii(b, 0, 6) === '#?RGBE') return 'hdr';
  if (startsWith(b, [0xff, 0x0a]) || startsWith(b, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return 'jxl';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(b, 0, 5) === '{\\rtf') return 'rtf';
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(b, 0, 64).includes('webm') ? 'webm' : 'mkv';
  if (ascii(b, 0, 4) === 'OggS') {
    const h = ascii(b, 28, 12);
    if (h.startsWith('OpusHead')) return 'opus';
    if (h.includes('theora')) return 'ogv';
    return 'ogg';
  }
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 4) === 'FORM' && /AIF[FC]/.test(ascii(b, 8, 4))) return 'aiff';
  if (ascii(b, 0, 5) === '#!AMR') return 'amr';
  if (ascii(b, 0, 4) === 'caff') return 'caf';
  if (ascii(b, 0, 4) === 'MThd') return 'mid';
  if (ascii(b, 0, 3) === 'FLV') return 'flv';
  if (startsWith(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return 'wmv'; // ASF (wmv/wma decided by extension)
  if (startsWith(b, [0, 0, 1, 0xba]) || startsWith(b, [0, 0, 1, 0xb3])) return 'mpeg';
  if (b[0] === 0x47 && b.length > 376 && b[188] === 0x47 && b[376] === 0x47) return 'ts';
  if (ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac'; // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return 'mp3'; // MPEG audio frame
  if (startsWith(b, [0x0b, 0x77])) return 'ac3';
  if (startsWith(b, [0, 1, 0, 0, 0]) || ascii(b, 0, 4) === 'true') return 'ttf';
  if (ascii(b, 0, 4) === 'OTTO') return 'otf';
  if (ascii(b, 0, 4) === 'wOFF') return 'woff';
  if (ascii(b, 0, 4) === 'wOF2') return 'woff2';
  if (ascii(b, 0, 4) === 'ttcf') return 'ttc';
  if (startsWith(b, [0x1f, 0x8b])) return 'gz';
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (ascii(b, 0, 4) === 'Rar!') return 'rar';
  if (ascii(b, 0, 3) === 'BZh') return 'bz2';
  if (startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (b.length > 262 && ascii(b, 257, 5) === 'ustar') return 'tar';
  if (ascii(b, 0, 15) === 'SQLite format 3') return 'sqlite';
  if (ascii(b, 0, 2) === 'MZ') return 'exe';
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (b.length > 32775 && ascii(b, 32769, 5) === 'CD001') return 'iso';
  return null;
}

/** Looks like readable text? (valid UTF-8 / UTF-16 with few control characters) */
function decodeText(b: Uint8Array, complete: boolean): string | null {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  let text: string;
  try {
    // a partial sample may cut a multi-byte character at the end; drop up to 3 trailing bytes
    text = new TextDecoder('utf-8', { fatal: true }).decode(complete ? b : b.subarray(0, Math.max(0, b.length - 3)));
  } catch {
    return null;
  }
  const control = [...text.slice(0, 4000)].filter((c) => {
    const code = c.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12;
  }).length;
  return control > 2 ? null : text.replace(/^﻿/, '');
}

function sniffText(text: string, ext: string, fullyRead: boolean): string {
  const t = text.trimStart();
  const head = t.slice(0, 2000).toLowerCase();
  if (/^<\?xml[\s\S]{0,400}<svg|^<svg[\s>]/i.test(t.slice(0, 1200))) return 'svg';
  if (head.startsWith('<!doctype html') || /^<html[\s>]/.test(head)) return 'html';
  if (head.startsWith('webvtt')) return 'vtt';
  if (/^\[script info\]/.test(head)) return 'ass';
  if (/^\d+\s*\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(t)) return 'srt';
  if (head.startsWith('<?xml') || (head.startsWith('<') && /<\/[a-z][\w:.-]*>\s*$/i.test(t.slice(-300)))) {
    return ext === 'html' ? 'html' : 'xml';
  }
  if ((t.startsWith('{') || t.startsWith('[')) && fullyRead) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {
      /* not JSON after all */
    }
  }
  if (['json', 'yaml', 'toml', 'xml', 'md', 'html', 'csv', 'tsv', 'srt', 'vtt', 'ass', 'txt', 'svg'].includes(ext)) return ext;
  // no helpful extension: a few content heuristics
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  const cols = (sep: string) => lines.map((l) => l.split(sep).length);
  const consistent = (sep: string) => {
    const c = cols(sep);
    return lines.length >= 2 && c[0] > 1 && c.every((n) => n === c[0]);
  };
  if (consistent('\t')) return 'tsv';
  if (consistent(',')) return 'csv';
  if (/^\[[\w.-]+\]\s*$/m.test(t) && /^[\w.-]+\s*=\s*.+$/m.test(t)) return 'toml';
  if (/^(#{1,6} |[-*] |\d+\. |> )/m.test(t) && /(^#{1,6} )|(\]\()|(\*\*\w)/m.test(t)) return 'md';
  if (lines.length > 1 && lines.every((l) => /^\s*(- |[\w"'-]+:(\s|$)|#)/.test(l))) return 'yaml';
  return 'txt';
}

/** Detect one file's type. */
export async function detect(file: File): Promise<Detected> {
  const ext = canonicalExt(file.name);
  const sampleLen = Math.min(file.size, 64 * 1024);
  const head = new Uint8Array(await file.slice(0, sampleLen).arrayBuffer());

  let format: string | null = null;
  let by: Detected['by'] = 'content';

  if (head.length >= 4 && startsWith(head, [0x50, 0x4b, 0x03, 0x04])) format = await sniffZip(file, head);
  else if (head.length >= 4 && startsWith(head, [0x50, 0x4b, 0x05, 0x06])) format = 'zip'; // empty zip
  else format = sniffBinary(head);

  // refine ambiguous containers with the extension
  if (format === 'ole') format = ['doc', 'xls', 'ppt'].includes(ext) ? ext : 'xls';
  if (format === 'wmv' && ext === 'wma') format = 'wma';
  if (format === 'gz' && (ext === 'tgz' || file.name.toLowerCase().endsWith('.tar.gz'))) format = 'tgz';
  if (format === 'mp4' && ext === 'm4a') format = 'm4a';
  if (format === 'tga' || (!format && ext === 'tga')) format = 'tga';

  if (!format) {
    const text = file.size === 0 ? '' : decodeText(head, sampleLen === file.size);
    if (text !== null) format = sniffText(text, ext, sampleLen === file.size);
    else if (['tga', 'pcx', 'ppm'].includes(ext)) format = ext; // binary images without a reliable signature
    else format = FORMATS[ext] ? ext : 'bin';
    // plain-text formats are only as certain as their structure
    if (['txt', 'csv', 'tsv', 'yaml', 'toml', 'md'].includes(format)) by = format === ext ? 'extension' : 'content';
    if (format === ext && !['json', 'svg', 'html', 'vtt', 'srt', 'ass', 'xml'].includes(format)) by = 'extension';
  }

  const info = FORMATS[format] ?? FORMATS.bin;
  const sameFamily = (a: string, b: string) => a === b || (a === 'mp4' && b === 'm4v') || (a === 'wmv' && b === 'wma') || (a === 'xml' && b === 'svg');
  const mismatch = by === 'content' && !!ext && !!FORMATS[ext] && !sameFamily(format, ext) && format !== 'bin';

  let animated: boolean | undefined;
  if (format === 'gif') animated = countGifFrames(head) > 1;
  if (format === 'webp') animated = ascii(head, 12, 4) === 'VP8X' && (head[20] & 0x02) !== 0;
  if (format === 'png') animated = ascii(head, 0, Math.min(head.length, 200)).includes('acTL');

  return { format, kind: info.kind, label: info.label, by, mismatch, animated };
}

/** Rough frame count from the first 64 KB (enough to know "more than one"). */
function countGifFrames(b: Uint8Array) {
  let n = 0;
  for (let i = 0; i < b.length - 2 && n < 3; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) n++;
  return n;
}
