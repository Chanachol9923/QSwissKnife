/* What each detected format can be turned into. */
import type { Detected } from './detect';

export type Group = 'Image' | 'Video' | 'Audio' | 'Document' | 'Table' | 'Data' | 'Subtitles' | 'Font' | 'Archive';

export interface Target {
  id: string;
  label: string;
  ext: string;
  group: Group;
  /** shown under the picker, e.g. "one image per page, zipped" */
  note?: string;
}

const t = (id: string, label: string, group: Group, ext = id, note?: string): Target => ({ id, label, ext, group, note });

const IMAGE_OUT = [
  t('png', 'PNG', 'Image'), t('jpg', 'JPG', 'Image'), t('webp', 'WebP', 'Image'), t('avif', 'AVIF', 'Image'), t('gif', 'GIF', 'Image'),
  t('bmp', 'BMP', 'Image'), t('ico', 'ICO (icon)', 'Image', 'ico', '16–256 px sizes in one icon'), t('tiff', 'TIFF', 'Image'),
  t('tga', 'TGA', 'Image'), t('qoi', 'QOI', 'Image'), t('ppm', 'PPM', 'Image'), t('svg', 'SVG', 'Image', 'svg', 'the picture wrapped in an SVG file'),
  t('pdf', 'PDF', 'Document'),
];
const VIDEO_OUT = [
  t('mp4', 'MP4', 'Video'), t('webm', 'WebM', 'Video'), t('mov', 'MOV', 'Video'), t('mkv', 'MKV', 'Video'), t('avi', 'AVI', 'Video'),
  t('wmv', 'WMV', 'Video'), t('mpeg', 'MPEG', 'Video', 'mpg'), t('flv', 'FLV', 'Video'), t('ogv', 'OGV', 'Video'), t('gif', 'GIF (animated)', 'Video'),
  t('mp3', 'MP3 (audio only)', 'Audio'), t('m4a', 'M4A (audio only)', 'Audio'), t('wav', 'WAV (audio only)', 'Audio'),
  t('ogg', 'OGG (audio only)', 'Audio'), t('opus', 'Opus (audio only)', 'Audio'), t('flac', 'FLAC (audio only)', 'Audio'),
  t('frame-jpg', 'JPG (still frame)', 'Image', 'jpg'), t('frame-png', 'PNG (still frame)', 'Image', 'png'),
];
const AUDIO_OUT = [
  t('mp3', 'MP3', 'Audio'), t('wav', 'WAV', 'Audio'), t('m4a', 'M4A', 'Audio'), t('aac', 'AAC', 'Audio'), t('ogg', 'OGG', 'Audio'),
  t('opus', 'Opus', 'Audio'), t('flac', 'FLAC', 'Audio'), t('aiff', 'AIFF', 'Audio'), t('wma', 'WMA', 'Audio'), t('ac3', 'AC3', 'Audio'),
];
const DOC_OUT = [
  t('pdf', 'PDF', 'Document'), t('docx', 'Word (DOCX)', 'Document'), t('html', 'HTML', 'Document'), t('md', 'Markdown', 'Document'),
  t('txt', 'Plain text', 'Document'),
];
const TABLE_OUT = [
  t('xlsx', 'Excel (XLSX)', 'Table'), t('ods', 'OpenDocument (ODS)', 'Table'), t('csv', 'CSV', 'Table'), t('tsv', 'TSV', 'Table'),
  t('json', 'JSON', 'Data'), t('html', 'HTML table', 'Document'), t('md', 'Markdown table', 'Document'), t('pdf', 'PDF', 'Document'),
];
const DATA_OUT = [
  t('json', 'JSON', 'Data'), t('yaml', 'YAML', 'Data'), t('toml', 'TOML', 'Data'), t('xml', 'XML', 'Data'),
  t('csv', 'CSV', 'Table', 'csv', 'needs a list of records'), t('xlsx', 'Excel (XLSX)', 'Table', 'xlsx', 'needs a list of records'),
];
const SUB_OUT = [t('srt', 'SRT', 'Subtitles'), t('vtt', 'WebVTT', 'Subtitles'), t('ass', 'ASS', 'Subtitles'), t('txt', 'Plain text (lines only)', 'Document')];
const GENERIC_OUT = [t('zip', 'ZIP (compress)', 'Archive'), t('gz', 'GZ (compress)', 'Archive', 'gz')];

/** Some browsers can decode AVIF but not create it; the converter checks once and reports here. */
let avifEncode = true;
export const setAvifEncodeSupport = (ok: boolean) => {
  avifEncode = ok;
};

const BROWSER_IMAGES = ['png', 'jpg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'svg', 'heic'];
const FFMPEG_IMAGES = ['tiff', 'psd', 'tga', 'qoi', 'pcx', 'ppm', 'exr', 'hdr', 'dds'];

/** Why a recognised file can't be converted (null = it can). */
export function unsupportedReason(d: Detected): string | null {
  switch (d.format) {
    case 'doc': case 'ppt': return 'Old binary Office files can’t be read here. Open it in Word/PowerPoint and save as DOCX/PPTX first.';
    case 'woff2': return 'WOFF2 needs Brotli decompression, which isn’t available here yet.';
    case 'ttc': return 'Font collections (TTC) aren’t supported — extract a single font first.';
    case '7z': case 'rar': case 'bz2': case 'xz': return `${d.label}s can’t be opened in the browser. Use 7-Zip to extract it first.`;
    case 'jxl': return 'JPEG XL can’t be decoded here yet.';
    case 'mid': return 'MIDI is sheet music, not sound — there’s no audio to convert.';
    case 'exe': case 'sqlite': case 'iso': case 'bin': return null; // generic archive outputs still apply
  }
  return null;
}

export function targetsFor(d: Detected): Target[] {
  const f = d.format;
  let list: Target[] = [];
  if (BROWSER_IMAGES.includes(f) || FFMPEG_IMAGES.includes(f)) {
    list = IMAGE_OUT.filter((x) => x.id !== 'avif' || avifEncode);
    if (d.animated || f === 'gif') list = [...list, t('mp4', 'MP4 (animation)', 'Video'), t('webm', 'WebM (animation)', 'Video')];
  } else if (d.kind === 'video') list = VIDEO_OUT;
  else if (d.kind === 'audio') list = AUDIO_OUT;
  else if (f === 'pdf') list = [t('png', 'PNG images', 'Image', 'png', 'one image per page (zipped if several)'), t('jpg', 'JPG images', 'Image', 'jpg', 'one image per page (zipped if several)'), ...DOC_OUT.filter((x) => x.id !== 'pdf')];
  else if (['docx', 'odt', 'rtf', 'epub', 'pptx', 'odp'].includes(f)) list = DOC_OUT;
  else if (['md', 'html', 'txt'].includes(f)) list = DOC_OUT;
  else if (d.kind === 'spreadsheet') list = TABLE_OUT;
  else if (d.kind === 'data') list = DATA_OUT;
  else if (d.kind === 'subtitle') list = SUB_OUT;
  else if (['ttf', 'otf'].includes(f)) list = [t('woff', 'WOFF web font', 'Font')];
  else if (f === 'woff') list = [t('sfnt', 'TTF / OTF (original)', 'Font', 'ttf', 'restores the desktop font')];
  else if (f === 'zip') list = [t('tar', 'TAR', 'Archive'), t('tgz', 'TAR.GZ', 'Archive', 'tar.gz')];
  else if (f === 'tar') list = [t('zip', 'ZIP', 'Archive'), t('tgz', 'TAR.GZ', 'Archive', 'tar.gz')];
  else if (f === 'tgz') list = [t('zip', 'ZIP', 'Archive'), t('tar', 'TAR', 'Archive')];
  else if (f === 'gz') return [t('gunzip', 'Decompress', 'Archive', '', 'restores the original file')];

  if (unsupportedReason(d)) return [];
  // anything can be packed into an archive
  const ids = new Set(list.map((x) => x.id));
  return [...list.filter((x) => x.ext !== extFor(f) || x.id.startsWith('frame')), ...GENERIC_OUT.filter((g) => !ids.has(g.id) && f !== 'zip' && f !== 'tgz')];
}

const extFor = (format: string) => ({ jpg: 'jpg', mpeg: 'mpg', tgz: 'tar.gz' } as Record<string, string>)[format] ?? format;

/** Sensible default: the most useful conversion for this kind of file. */
export function defaultTarget(d: Detected, targets: Target[]): Target | undefined {
  const prefer: Record<string, string[]> = {
    heic: ['jpg'], png: ['jpg', 'webp'], jpg: ['png', 'webp'], webp: ['png', 'jpg'], avif: ['png', 'jpg'], gif: ['mp4', 'png'],
    bmp: ['png'], tiff: ['png', 'jpg'], psd: ['png'], svg: ['png'], ico: ['png'],
    mov: ['mp4'], mkv: ['mp4'], avi: ['mp4'], webm: ['mp4'], mp4: ['mp3', 'webm'], wmv: ['mp4'], flv: ['mp4'],
    wav: ['mp3'], flac: ['mp3'], m4a: ['mp3'], mp3: ['wav'], ogg: ['mp3'], opus: ['mp3'], aiff: ['mp3'], wma: ['mp3'], aac: ['mp3'], amr: ['mp3'],
    pdf: ['docx', 'png'], docx: ['pdf'], odt: ['docx', 'pdf'], rtf: ['docx'], epub: ['pdf'], pptx: ['pdf'], md: ['pdf', 'html'], html: ['pdf', 'md'], txt: ['pdf'],
    xlsx: ['csv'], xls: ['xlsx'], ods: ['xlsx'], csv: ['xlsx'], tsv: ['xlsx'], json: ['yaml', 'csv'], yaml: ['json'], toml: ['json'], xml: ['json'],
    srt: ['vtt'], vtt: ['srt'], ass: ['srt'], ttf: ['woff'], otf: ['woff'], woff: ['sfnt'], zip: ['tgz'], tar: ['zip'], tgz: ['zip'],
  };
  for (const id of prefer[d.format] ?? []) {
    const hit = targets.find((x) => x.id === id);
    if (hit) return hit;
  }
  return targets[0];
}
