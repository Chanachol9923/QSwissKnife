/* Subtitles, fonts and archives — small formats with hand-written readers/writers. */
import { gunzipSync, gzipSync, strFromU8, unzipSync, unzlibSync, zipSync, zlibSync } from 'fflate';

/* ------------------------------------------------------------------ */
/* Subtitles: SRT ⇄ WebVTT ⇄ ASS                                       */
/* ------------------------------------------------------------------ */

interface Cue {
  start: number; // seconds
  end: number;
  text: string;
}

const parseClock = (s: string) => {
  const m = s.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

const clock = (t: number, sep: ',' | '.', hourDigits = 2) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(hourDigits, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};

export function parseSubtitles(src: string, format: string): Cue[] {
  const s = src.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (format === 'ass') {
    const cues: Cue[] = [];
    let fields: string[] = [];
    for (const line of s.split('\n')) {
      if (/^Format:/i.test(line) && !fields.length) continue;
      const fm = line.match(/^Format:\s*(.*)$/i);
      if (fm) fields = fm[1].split(',').map((x) => x.trim().toLowerCase());
      const dm = line.match(/^Dialogue:\s*(.*)$/i);
      if (!dm) continue;
      const cols = fields.length ? fields : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const parts = dm[1].split(',');
      const textIdx = cols.indexOf('text');
      const textVal = parts.slice(textIdx).join(',');
      cues.push({
        start: parseClock(parts[cols.indexOf('start')]),
        end: parseClock(parts[cols.indexOf('end')]),
        text: textVal.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim(),
      });
    }
    return cues;
  }
  // SRT and VTT share the "start --> end" block structure
  return s
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) return null;
      const [a, b] = lines[i].split('-->');
      return { start: parseClock(a), end: parseClock(b.trim().split(/\s/)[0]), text: lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim() };
    })
    .filter((c): c is Cue => !!c && !!c.text);
}

export function writeSubtitles(cues: Cue[], target: string): string {
  switch (target) {
    case 'srt': return cues.map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${c.text}\n`).join('\n');
    case 'vtt': return `WEBVTT\n\n${cues.map((c) => `${clock(c.start, '.')} --> ${clock(c.end, '.')}\n${c.text}\n`).join('\n')}`;
    case 'ass': {
      const t = (x: number) => clock(x, '.', 1).slice(0, -1); // ASS uses h:mm:ss.cc
      return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,50,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${cues
        .map((c) => `Dialogue: 0,${t(c.start)},${t(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, '\\N')}`)
        .join('\n')}\n`;
    }
    case 'txt': return cues.map((c) => c.text).join('\n') + '\n';
  }
  throw new Error(`Can’t write ${target}`);
}

/* ------------------------------------------------------------------ */
/* Fonts: TTF/OTF ⇄ WOFF                                               */
/* ------------------------------------------------------------------ */

export function sfntToWoff(src: Uint8Array): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const flavor = dv.getUint32(0);
  const numTables = dv.getUint16(4);
  const tables = Array.from({ length: numTables }, (_, i) => {
    const r = 12 + i * 16;
    const offset = dv.getUint32(r + 8);
    const length = dv.getUint32(r + 12);
    const data = src.subarray(offset, offset + length);
    const comp = zlibSync(data, { level: 9 });
    return { tag: dv.getUint32(r), checksum: dv.getUint32(r + 4), length, data: comp.length < length ? comp : data };
  });
  const pad4 = (n: number) => (n + 3) & ~3;
  const headerLen = 44 + numTables * 20;
  const total = tables.reduce((s, t) => s + pad4(t.data.length), headerLen);
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, 0x774f4646); // 'wOFF'
  ov.setUint32(4, flavor);
  ov.setUint32(8, total);
  ov.setUint16(12, numTables);
  ov.setUint32(16, 12 + numTables * 16 + tables.reduce((s, t) => s + pad4(t.length), 0)); // totalSfntSize
  ov.setUint16(20, 1); // version 1.0
  let off = headerLen;
  tables.forEach((t, i) => {
    const r = 44 + i * 20;
    ov.setUint32(r, t.tag);
    ov.setUint32(r + 4, off);
    ov.setUint32(r + 8, t.data.length);
    ov.setUint32(r + 12, t.length);
    ov.setUint32(r + 16, t.checksum);
    out.set(t.data, off);
    off += pad4(t.data.length);
  });
  return out;
}

export function woffToSfnt(src: Uint8Array): { data: Uint8Array; ext: 'ttf' | 'otf' } {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  const tables = Array.from({ length: numTables }, (_, i) => {
    const r = 44 + i * 20;
    const offset = dv.getUint32(r + 4);
    const compLength = dv.getUint32(r + 8);
    const origLength = dv.getUint32(r + 12);
    const raw = src.subarray(offset, offset + compLength);
    return { tag: dv.getUint32(r), checksum: dv.getUint32(r + 16), data: compLength < origLength ? unzlibSync(raw) : raw };
  }).sort((a, b) => a.tag - b.tag);
  const pad4 = (n: number) => (n + 3) & ~3;
  const headerLen = 12 + numTables * 16;
  const out = new Uint8Array(tables.reduce((s, t) => s + pad4(t.data.length), headerLen));
  const ov = new DataView(out.buffer);
  const pow = 2 ** Math.floor(Math.log2(numTables));
  ov.setUint32(0, flavor);
  ov.setUint16(4, numTables);
  ov.setUint16(6, pow * 16);
  ov.setUint16(8, Math.log2(pow));
  ov.setUint16(10, numTables * 16 - pow * 16);
  let off = headerLen;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    ov.setUint32(r, t.tag);
    ov.setUint32(r + 4, t.checksum);
    ov.setUint32(r + 8, off);
    ov.setUint32(r + 12, t.data.length);
    out.set(t.data, off);
    off += pad4(t.data.length);
  });
  return { data: out, ext: flavor === 0x4f54544f ? 'otf' : 'ttf' };
}

/* ------------------------------------------------------------------ */
/* Archives: ZIP ⇄ TAR ⇄ TAR.GZ, GZ                                     */
/* ------------------------------------------------------------------ */

type Files = Record<string, Uint8Array>;

export function readTar(buf: Uint8Array): Files {
  const files: Files = {};
  let longName: string | null = null;
  for (let p = 0; p + 512 <= buf.length; ) {
    const header = buf.subarray(p, p + 512);
    if (header.every((b) => b === 0)) break;
    const field = (o: number, l: number) => strFromU8(header.subarray(o, o + l)).replace(/\0.*$/s, '');
    let name = field(0, 100);
    const prefix = field(345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const data = buf.subarray(p + 512, p + 512 + size);
    if (type === 'L') longName = strFromU8(data).replace(/\0.*$/s, '');
    else if (type === '0' || type === '\0' || type === '7') {
      files[longName ?? name] = data.slice();
      longName = null;
    } else longName = null;
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export function writeTar(files: Files): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const header = (name: string, size: number, type = '0') => {
    const h = new Uint8Array(512);
    const put = (s: string, o: number, l: number) => h.set(enc.encode(s).subarray(0, l), o);
    put(name, 0, 100);
    put('0000644\0', 100, 8);
    put('0000000\0', 108, 8);
    put('0000000\0', 116, 8);
    put(size.toString(8).padStart(11, '0') + '\0', 124, 12);
    put(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
    put('        ', 148, 8);
    h[156] = type.charCodeAt(0);
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    const sum = h.reduce((s, b) => s + b, 0);
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
  };
  const pad = (n: number) => new Uint8Array((512 - (n % 512)) % 512);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    if (enc.encode(name).length > 99) {
      // GNU long name
      const long = enc.encode(name + '\0');
      chunks.push(header('././@LongLink', long.length, 'L'), long, pad(long.length));
    }
    chunks.push(header(name, data.length), data, pad(data.length));
  }
  chunks.push(new Uint8Array(1024));
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function readArchive(buf: Uint8Array, format: string): Files {
  if (format === 'zip') return Object.fromEntries(Object.entries(unzipSync(buf)).filter(([n]) => !n.endsWith('/')));
  if (format === 'tar') return readTar(buf);
  if (format === 'tgz') return readTar(gunzipSync(buf));
  throw new Error(`Can’t open ${format}`);
}

export function writeArchive(files: Files, target: string): Uint8Array {
  if (target === 'zip') return zipSync(files, { level: 6 });
  if (target === 'tar') return writeTar(files);
  if (target === 'tgz') return gzipSync(writeTar(files), { level: 6 });
  throw new Error(`Can’t write ${target}`);
}

export { gunzipSync, gzipSync };
