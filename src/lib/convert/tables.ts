/* Spreadsheets (XLSX, XLS, ODS, CSV, TSV) and structured data (JSON, YAML, TOML, XML). */
import { strToU8, zipSync } from 'fflate';
import type { Block } from './docs';

type XLSX = typeof import('xlsx');
let xlsxMod: Promise<XLSX> | null = null;
const loadXlsx = () => (xlsxMod ??= import('xlsx'));

export interface Out {
  blob: Blob;
  ext: string;
}

const text = (s: string, mime: string, ext: string): Out => ({ blob: new Blob([s], { type: `${mime};charset=utf-8` }), ext });

/* ---------- spreadsheets ---------- */

export async function readWorkbook(file: Blob, format: string) {
  const X = await loadXlsx();
  if (format === 'csv' || format === 'tsv') {
    // read as text so UTF-8 (Thai etc.) survives; SheetJS guesses a codepage for raw bytes
    return X.read(await file.text(), { type: 'string', FS: format === 'tsv' ? '\t' : undefined, raw: true });
  }
  return X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
}

type Workbook = Awaited<ReturnType<typeof readWorkbook>>;

const rowsOf = (X: XLSX, wb: Workbook, name: string) =>
  (X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) as unknown[][]).map((r) => r.map((c) => String(c ?? '')));

export async function writeWorkbook(wb: Workbook, target: string, base: string): Promise<Out> {
  const X = await loadXlsx();
  const names = wb.SheetNames;
  const multi = names.length > 1;
  const perSheet = (fn: (n: string) => string, ext: string, mime: string): Out => {
    if (!multi) return text(fn(names[0]), mime, ext);
    // one file per sheet, zipped
    const files = Object.fromEntries(names.map((n) => [`${base} - ${n.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`, strToU8('﻿' + fn(n))]));
    return { blob: new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), ext: 'zip' };
  };
  switch (target) {
    case 'xlsx':
    case 'ods': {
      const data = X.write(wb, { bookType: target, type: 'array', compression: true }) as ArrayBuffer;
      const mime = target === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.oasis.opendocument.spreadsheet';
      return { blob: new Blob([data], { type: mime }), ext: target };
    }
    // BOM so Excel opens UTF-8 CSVs correctly
    case 'csv': return perSheet((n) => '﻿' + X.utils.sheet_to_csv(wb.Sheets[n]), 'csv', 'text/csv');
    case 'tsv': return perSheet((n) => X.utils.sheet_to_csv(wb.Sheets[n], { FS: '\t' }), 'tsv', 'text/tab-separated-values');
    case 'json': {
      const data = multi ? Object.fromEntries(names.map((n) => [n, X.utils.sheet_to_json(wb.Sheets[n], { defval: null })])) : X.utils.sheet_to_json(wb.Sheets[names[0]], { defval: null });
      return text(JSON.stringify(data, null, 2), 'application/json', 'json');
    }
    case 'txt': return perSheet((n) => X.utils.sheet_to_csv(wb.Sheets[n], { FS: '\t' }), 'txt', 'text/plain');
  }
  throw new Error(`Can’t write ${target}`);
}

/** Workbook as document blocks (for HTML / Markdown / PDF output). */
export async function workbookBlocks(wb: Workbook): Promise<Block[]> {
  const X = await loadXlsx();
  const blocks: Block[] = [];
  for (const n of wb.SheetNames) {
    if (wb.SheetNames.length > 1) blocks.push({ t: 'h2', text: n });
    const rows = rowsOf(X, wb, n).filter((r) => r.some((c) => c !== ''));
    if (rows.length) blocks.push({ t: 'table', rows });
  }
  return blocks;
}

/* ---------- structured data ---------- */

export async function parseData(src: string, format: string): Promise<unknown> {
  switch (format) {
    case 'json': return JSON.parse(src);
    case 'yaml': return (await import('js-yaml')).load(src);
    case 'toml': return (await import('smol-toml')).parse(src);
    case 'xml': {
      const { XMLParser } = await import('fast-xml-parser');
      return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: true, trimValues: true }).parse(src);
    }
  }
  throw new Error(`Can’t read ${format}`);
}

/** The array of records inside a value, if it has one (top level or the only array property). */
function records(v: unknown): Record<string, unknown>[] | null {
  const isRec = (x: unknown) => x && typeof x === 'object' && !Array.isArray(x);
  if (Array.isArray(v)) return v.every(isRec) ? (v as Record<string, unknown>[]) : v.map((x) => ({ value: x }));
  if (isRec(v)) {
    const arrays = Object.values(v as object).filter(Array.isArray);
    if (arrays.length === 1) return records(arrays[0]);
    // a single object becomes a one-row table
    return [v as Record<string, unknown>];
  }
  return null;
}

/** Nested values are flattened to "a.b" columns so tables stay readable. */
function flatten(o: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

export async function writeData(value: unknown, target: string, base: string): Promise<Out> {
  switch (target) {
    case 'json': return text(JSON.stringify(value, null, 2), 'application/json', 'json');
    case 'yaml': return text((await import('js-yaml')).dump(value, { lineWidth: 120, noRefs: true }), 'application/yaml', 'yaml');
    case 'toml': {
      const root = value && typeof value === 'object' && !Array.isArray(value) ? value : { items: value };
      return text((await import('smol-toml')).stringify(root as Record<string, unknown>), 'application/toml', 'toml');
    }
    case 'xml': {
      const { XMLBuilder } = await import('fast-xml-parser');
      const isObj = value && typeof value === 'object' && !Array.isArray(value);
      const keys = isObj ? Object.keys(value as object).filter((k) => !k.startsWith('?')) : [];
      const root = isObj && keys.length === 1 ? value : { root: Array.isArray(value) ? { item: value } : value };
      const body = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@', format: true, indentBy: '  ', suppressEmptyNode: true }).build(root);
      return text(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, 'application/xml', 'xml');
    }
    case 'csv':
    case 'xlsx': {
      const rows = records(value);
      if (!rows) throw new Error('This data isn’t a list of records, so it can’t become a table.');
      const X = await loadXlsx();
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows.map((r) => flatten(r))), 'Data');
      return writeWorkbook(wb, target, base);
    }
  }
  throw new Error(`Can’t write ${target}`);
}

/** Data → workbook (so JSON etc. can also become HTML/MD tables). */
export async function dataToWorkbook(value: unknown) {
  const rows = records(value);
  if (!rows) throw new Error('This data isn’t a list of records, so it can’t become a table.');
  const X = await loadXlsx();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows.map((r) => flatten(r))), 'Data');
  return wb;
}
