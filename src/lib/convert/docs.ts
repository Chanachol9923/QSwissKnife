/*
 * Documents: every format is read into a small block model and written back out from it,
 * so any input (DOCX, ODT, RTF, EPUB, PPTX, ODP, PDF, Markdown, HTML, text, tables) can become
 * any output (PDF, DOCX, HTML, Markdown, text).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type Block =
  | { t: 'h1' | 'h2' | 'h3' | 'p' | 'code' | 'quote'; text: string }
  | { t: 'li'; text: string; ordered?: boolean; n?: number }
  | { t: 'img'; src: string; alt?: string }
  | { t: 'table'; rows: string[][] }
  | { t: 'hr' };

const clean = (s: string) => s.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

export function fromHtml(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: Block[] = [];
  const text = (el: Element) => clean((el as HTMLElement).innerText ?? el.textContent ?? '');

  const walk = (node: Element) => {
    for (const el of Array.from(node.children)) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'template', 'head'].includes(tag)) continue;
      if (/^h[1-6]$/.test(tag)) {
        const lvl = Math.min(3, Number(tag[1]));
        const s = clean(el.textContent ?? '');
        if (s) out.push({ t: (`h${lvl}`) as 'h1', text: s });
      } else if (tag === 'p') {
        el.querySelectorAll('img').forEach((img) => img.getAttribute('src') && out.push({ t: 'img', src: img.getAttribute('src')!, alt: img.getAttribute('alt') ?? '' }));
        const s = clean(el.textContent ?? '');
        if (s) out.push({ t: 'p', text: s });
      } else if (tag === 'ul' || tag === 'ol') {
        let n = Number(el.getAttribute('start') ?? 1);
        for (const li of Array.from(el.children).filter((c) => c.tagName === 'LI')) {
          // nested lists are flattened into the same list
          const own = clean(Array.from(li.childNodes).filter((c) => !(c instanceof Element && /^(UL|OL)$/.test(c.tagName))).map((c) => c.textContent).join(''));
          if (own) out.push({ t: 'li', text: own, ordered: tag === 'ol', n: n++ });
          li.querySelectorAll(':scope > ul, :scope > ol').forEach((sub) => walk({ children: [sub] } as unknown as Element));
        }
      } else if (tag === 'pre') {
        out.push({ t: 'code', text: (el.textContent ?? '').replace(/\n$/, '') });
      } else if (tag === 'blockquote') {
        const s = clean(el.textContent ?? '');
        if (s) out.push({ t: 'quote', text: s });
      } else if (tag === 'img') {
        const src = el.getAttribute('src');
        if (src) out.push({ t: 'img', src, alt: el.getAttribute('alt') ?? '' });
      } else if (tag === 'table') {
        const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent ?? '')));
        if (rows.length) out.push({ t: 'table', rows });
      } else if (tag === 'hr') {
        out.push({ t: 'hr' });
      } else if (el.children.length) {
        // containers (div, section, article, body…): keep stray text, then recurse
        const own = clean(Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join(''));
        if (own) out.push({ t: 'p', text: own });
        walk(el);
      } else {
        const s = text(el);
        if (s) out.push({ t: 'p', text: s });
      }
    }
  };
  walk(doc.body);
  return out;
}

export async function fromMarkdown(md: string): Promise<Block[]> {
  const { marked } = await import('marked');
  return fromHtml(await marked.parse(md, { gfm: true }));
}

export function fromText(txt: string): Block[] {
  return txt
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+$/g, ''))
    .filter((p) => p.trim())
    .map((p) => ({ t: 'p' as const, text: p }));
}

export async function fromDocx(file: Blob): Promise<Block[]> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return fromHtml(value);
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const unzipFile = async (file: Blob) => unzipSync(new Uint8Array(await file.arrayBuffer()));

/** OpenDocument text (ODT) and presentations (ODP): content.xml */
export async function fromOdf(file: Blob): Promise<Block[]> {
  const files = await unzipFile(file);
  const doc = xml(strFromU8(files['content.xml']));
  const out: Block[] = [];
  const isPres = !!doc.getElementsByTagName('draw:page').length;
  if (isPres) {
    Array.from(doc.getElementsByTagName('draw:page')).forEach((page, i) => {
      out.push({ t: 'h2', text: page.getAttribute('draw:name') || `Slide ${i + 1}` });
      Array.from(page.getElementsByTagName('text:p')).forEach((p) => {
        const s = clean(p.textContent ?? '');
        if (s) out.push({ t: 'p', text: s });
      });
    });
    return out;
  }
  const body = doc.getElementsByTagName('office:text')[0];
  const walk = (node: Element) => {
    for (const el of Array.from(node.children)) {
      const s = clean(el.textContent ?? '');
      if (el.tagName === 'text:h') s && out.push({ t: (`h${Math.min(3, Number(el.getAttribute('text:outline-level') ?? 1))}`) as 'h1', text: s });
      else if (el.tagName === 'text:p') s && out.push({ t: 'p', text: s });
      else if (el.tagName === 'text:list') Array.from(el.getElementsByTagName('text:list-item')).forEach((li) => {
        const x = clean(li.textContent ?? '');
        if (x) out.push({ t: 'li', text: x });
      });
      else if (el.tagName === 'table:table')
        out.push({ t: 'table', rows: Array.from(el.getElementsByTagName('table:table-row')).map((r) => Array.from(r.getElementsByTagName('table:table-cell')).map((c) => clean(c.textContent ?? ''))) });
      else if (el.children.length) walk(el);
    }
  };
  if (body) walk(body);
  return out;
}

/** PowerPoint (PPTX): text of each slide, in order */
export async function fromPptx(file: Blob): Promise<Block[]> {
  const files = await unzipFile(file);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  const out: Block[] = [];
  slides.forEach((name, i) => {
    out.push({ t: 'h2', text: `Slide ${i + 1}` });
    const d = xml(strFromU8(files[name]));
    Array.from(d.getElementsByTagName('a:p')).forEach((p) => {
      const s = clean(Array.from(p.getElementsByTagName('a:t')).map((x) => x.textContent).join(''));
      if (s) out.push({ t: 'p', text: s });
    });
  });
  return out;
}

/** EPUB: chapters in reading order */
export async function fromEpub(file: Blob): Promise<Block[]> {
  const files = await unzipFile(file);
  const container = xml(strFromU8(files['META-INF/container.xml']));
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ?? '';
  const opf = xml(strFromU8(files[opfPath]));
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map(Array.from(opf.getElementsByTagName('item')).map((i) => [i.getAttribute('id'), i.getAttribute('href')]));
  const out: Block[] = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const href = manifest.get(ref.getAttribute('idref'));
    const data = href && files[decodeURIComponent(base + href)];
    if (!data) continue;
    if (out.length) out.push({ t: 'hr' });
    out.push(...fromHtml(strFromU8(data)).filter((b) => b.t !== 'img'));
  }
  return out;
}

/** RTF → plain text (good enough for letters and notes; formatting is dropped) */
export function rtfToText(rtf: string): string {
  let depth = 0;
  const skipAt: number[] = [];
  let out = '';
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    const skipping = skipAt.length > 0;
    if (c === '{') {
      depth++;
      if (rtf.startsWith('{\\*', i) || /^\{\\(fonttbl|colortbl|stylesheet|info|pict|header|footer)/.test(rtf.slice(i, i + 14))) skipAt.push(depth);
    } else if (c === '}') {
      if (skipAt[skipAt.length - 1] === depth) skipAt.pop();
      depth--;
    } else if (c === '\\') {
      const m = /^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\(.)/i.exec(rtf.slice(i, i + 40));
      if (!m) continue;
      i += m[0].length - 1;
      if (skipping) continue;
      if (m[3]) out += new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(m[3], 16)]));
      else if (m[4]) out += m[4] === '~' ? ' ' : /[\\{}]/.test(m[4]) ? m[4] : '';
      else if (m[1] === 'par' || m[1] === 'line') out += '\n';
      else if (m[1] === 'tab') out += '\t';
      else if (m[1] === 'u' && m[2]) {
        out += String.fromCharCode((Number(m[2]) + 65536) % 65536);
        if (rtf[i + 1] === '?') i++; // skip the ANSI fallback character
      }
    } else if (!skipping && c !== '\r' && c !== '\n') out += c;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** PDF text, page by page, grouped into lines and paragraphs. */
export async function fromPdf(file: Blob, progress?: (p: number) => void): Promise<Block[]> {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: Block[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines: { y: number; h: number; text: string }[] = [];
    for (const item of content.items as { str: string; transform: number[]; height: number; hasEOL?: boolean }[]) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < 3) last.text += item.str;
      else lines.push({ y, h: item.height || 10, text: item.str });
    }
    if (n > 1) out.push({ t: 'hr' });
    let para = '';
    let prev: (typeof lines)[number] | null = null;
    for (const l of lines) {
      const gap = prev ? prev.y - l.y : 0;
      if (prev && gap > prev.h * 1.7 && para.trim()) {
        out.push({ t: 'p', text: para.trim() });
        para = '';
      }
      para += (para && !/[฀-๿]$/.test(para) ? ' ' : '') + l.text.trim();
      prev = l;
    }
    if (para.trim()) out.push({ t: 'p', text: para.trim() });
    progress?.(n / pdf.numPages);
  }
  return out;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
export function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toHtml(blocks: Block[], title: string): string {
  let body = '';
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) body += `</${list}>\n`;
    list = null;
  };
  for (const b of blocks) {
    if (b.t === 'li') {
      const want = b.ordered ? 'ol' : 'ul';
      if (list !== want) {
        closeList();
        body += `<${want}>\n`;
        list = want;
      }
      body += `  <li>${esc(b.text)}</li>\n`;
      continue;
    }
    closeList();
    if (b.t === 'h1' || b.t === 'h2' || b.t === 'h3') body += `<${b.t}>${esc(b.text)}</${b.t}>\n`;
    else if (b.t === 'p') body += `<p>${esc(b.text).replace(/\n/g, '<br>')}</p>\n`;
    else if (b.t === 'code') body += `<pre><code>${esc(b.text)}</code></pre>\n`;
    else if (b.t === 'quote') body += `<blockquote>${esc(b.text)}</blockquote>\n`;
    else if (b.t === 'img') body += `<p><img src="${esc(b.src)}" alt="${esc(b.alt ?? '')}"></p>\n`;
    else if (b.t === 'hr') body += '<hr>\n';
    else if (b.t === 'table')
      body += `<table>\n${b.rows.map((r, i) => `  <tr>${r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('\n')}\n</table>\n`;
  }
  closeList();
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font: 16px/1.65 system-ui, "Segoe UI", "Leelawadee UI", Tahoma, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1d2029; }
  h1, h2, h3 { line-height: 1.25; margin: 1.6em 0 .5em; }
  pre { background: #f4f5f8; padding: 12px 14px; border-radius: 8px; overflow: auto; }
  blockquote { border-left: 3px solid #c9cdd8; margin: 0; padding-left: 14px; color: #555; }
  table { border-collapse: collapse; margin: 1em 0; } th, td { border: 1px solid #d4d8e1; padding: 6px 10px; text-align: left; } th { background: #f4f5f8; }
  img { max-width: 100%; }
</style>
</head>
<body>
${body}</body>
</html>
`;
}

export function toMarkdown(blocks: Block[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.t === 'h1') parts.push(`# ${b.text}`);
    else if (b.t === 'h2') parts.push(`## ${b.text}`);
    else if (b.t === 'h3') parts.push(`### ${b.text}`);
    else if (b.t === 'p') parts.push(b.text);
    else if (b.t === 'li') parts.push(`${b.ordered ? `${b.n ?? 1}.` : '-'} ${b.text}`);
    else if (b.t === 'code') parts.push('```\n' + b.text + '\n```');
    else if (b.t === 'quote') parts.push(b.text.split('\n').map((l) => `> ${l}`).join('\n'));
    else if (b.t === 'img') parts.push(b.src.startsWith('data:') ? `![${b.alt ?? ''}](embedded-image)` : `![${b.alt ?? ''}](${b.src})`);
    else if (b.t === 'hr') parts.push('---');
    else if (b.t === 'table' && b.rows.length) {
      const w = Math.max(...b.rows.map((r) => r.length));
      const row = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`;
      parts.push([row(b.rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...b.rows.slice(1).map(row)].join('\n'));
    }
  }
  // consecutive list items stay together
  return parts.join('\n\n').replace(/\n\n(?=(?:- |\d+\. ))/g, (m, offset, all) => (/(?:^|\n)(?:- |\d+\. )[^\n]*$/.test(all.slice(0, offset)) ? '\n' : m)) + '\n';
}

export function toText(blocks: Block[]): string {
  return (
    blocks
      .map((b) => {
        if (b.t === 'li') return `${b.ordered ? `${b.n ?? 1}.` : '•'} ${b.text}`;
        if (b.t === 'table') return b.rows.map((r) => r.join('\t')).join('\n');
        if (b.t === 'hr') return '────────';
        if (b.t === 'img') return '';
        return b.text;
      })
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}

/* ---------- DOCX writer (paragraphs, headings, lists, tables, code) ---------- */

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text: string, mono = false) =>
  text
    .split('\n')
    .map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${mono ? '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>`)
    .join('');
const para = (text: string, style?: string, mono = false) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(text, mono)}</w:p>`;

export function toDocx(blocks: Block[]): Blob {
  const body = blocks
    .map((b) => {
      switch (b.t) {
        case 'h1': return para(b.text, 'Heading1');
        case 'h2': return para(b.text, 'Heading2');
        case 'h3': return para(b.text, 'Heading3');
        case 'li': return para(`${b.ordered ? `${b.n ?? 1}.` : '•'}\t${b.text}`, 'ListParagraph');
        case 'code': return para(b.text, 'Code', true);
        case 'quote': return para(b.text, 'Quote');
        case 'hr': return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr></w:pPr></w:p>';
        case 'img': return b.alt ? para(`[${b.alt}]`) : '';
        case 'table':
          return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${b.rows
            .map((r, i) => `<w:tr>${r.map((c) => `<w:tc><w:p>${i === 0 ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEsc(c)}</w:t></w:r>` : run(c)}</w:p></w:tc>`).join('')}</w:tr>`)
            .join('')}</w:tbl><w:p/>`;
        default: return para(b.text);
      }
    })
    .join('');
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const heading = (id: string, size: number) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${id.slice(-1)}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'word/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Leelawadee UI"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading('Heading1', 36)}${heading('Heading2', 30)}${heading('Heading3', 26)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="40"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F3F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders></w:tblPr></w:style></w:styles>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  };
  return new Blob([zipSync(files) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ---------- PDF writer: draws pages with the system fonts (any script, incl. Thai) ---------- */

const PAGE_W = 1240; // A4 at 150 dpi
const PAGE_H = 1754;
const MARGIN = 110;
const FONT = '"Segoe UI", "Leelawadee UI", Tahoma, system-ui, sans-serif';
const MONO = 'Consolas, "Cascadia Mono", monospace';

/** Break text into lines that fit `width`, using word segmentation (so Thai wraps correctly). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const pieces = seg ? Array.from(seg.segment(rawLine), (s) => s.segment) : rawLine.split(/(\s+)/);
    let line = '';
    for (const piece of pieces) {
      if (ctx.measureText(line + piece).width <= width || !line) {
        // a single piece wider than the line (long URL) gets split by characters
        if (!line && ctx.measureText(piece).width > width) {
          for (const ch of piece) {
            if (ctx.measureText(line + ch).width > width && line) {
              lines.push(line);
              line = '';
            }
            line += ch;
          }
        } else line += piece;
      } else {
        lines.push(line.trimEnd());
        line = piece.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

export async function toPdf(blocks: Block[], title: string, progress?: (p: number) => void): Promise<Blob> {
  const pages: HTMLCanvasElement[] = [];
  let ctx!: CanvasRenderingContext2D;
  let y = 0;
  const newPage = () => {
    const c = document.createElement('canvas');
    c.width = PAGE_W;
    c.height = PAGE_H;
    ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'top';
    pages.push(c);
    y = MARGIN;
  };
  const need = (h: number) => {
    if (y + h > PAGE_H - MARGIN) newPage();
  };
  const width = PAGE_W - MARGIN * 2;
  const textBlock = (text: string, weight: string, size: number, lh: number, color = '#1d2029', indent = 0, before = 0, after = 18) => {
    const font = `${weight} ${size}px ${FONT}`;
    ctx.font = font;
    y += before;
    for (const line of wrap(ctx, text, width - indent)) {
      need(size * lh);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(line, MARGIN + indent, y);
      y += size * lh;
    }
    y += after;
  };

  newPage();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === 'h1') textBlock(b.text, 'bold', 44, 1.25, '#111318', 0, i ? 28 : 0, 18);
    else if (b.t === 'h2') textBlock(b.text, 'bold', 34, 1.3, '#111318', 0, i ? 22 : 0, 14);
    else if (b.t === 'h3') textBlock(b.text, 'bold', 28, 1.3, '#111318', 0, i ? 16 : 0, 10);
    else if (b.t === 'p') textBlock(b.text, 'normal', 24, 1.55);
    else if (b.t === 'quote') {
      const top = y;
      textBlock(b.text, 'italic', 24, 1.55, '#555a66', 28);
      ctx.fillStyle = '#c9cdd8';
      ctx.fillRect(MARGIN, Math.max(MARGIN, top), 5, Math.max(10, y - top - 18));
    } else if (b.t === 'li') {
      ctx.font = `24px ${FONT}`;
      need(38);
      ctx.fillStyle = '#1d2029';
      ctx.fillText(b.ordered ? `${b.n ?? 1}.` : '•', MARGIN + 8, y);
      textBlock(b.text, 'normal', 24, 1.5, '#1d2029', 46, 0, 6);
    } else if (b.t === 'code') {
      ctx.font = `21px ${MONO}`;
      const lines = wrap(ctx, b.text, width - 36);
      for (const line of lines) {
        need(32);
        ctx.fillStyle = '#f2f3f6';
        ctx.fillRect(MARGIN, y - 4, width, 32);
        ctx.fillStyle = '#1d2029';
        ctx.font = `21px ${MONO}`;
        ctx.fillText(line, MARGIN + 18, y);
        y += 31;
      }
      y += 22;
    } else if (b.t === 'hr') {
      need(30);
      ctx.fillStyle = '#d4d8e1';
      ctx.fillRect(MARGIN, y + 12, width, 2);
      y += 36;
    } else if (b.t === 'img') {
      const img = await loadImage(b.src);
      if (img && img.naturalWidth) {
        const s = Math.min(1, width / img.naturalWidth, (PAGE_H - MARGIN * 2) / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        need(h + 10);
        ctx.drawImage(img, MARGIN, y, w, h);
        y += h + 22;
      }
    } else if (b.t === 'table' && b.rows.length) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const cw = width / cols;
      b.rows.forEach((r, ri) => {
        ctx.font = `${ri === 0 ? 'bold ' : ''}20px ${FONT}`;
        const cells = Array.from({ length: cols }, (_, c) => wrap(ctx, r[c] ?? '', cw - 20));
        const h = Math.max(...cells.map((l) => l.length)) * 28 + 16;
        need(h);
        if (ri === 0) {
          ctx.fillStyle = '#f2f3f6';
          ctx.fillRect(MARGIN, y, width, h);
        }
        ctx.strokeStyle = '#d4d8e1';
        ctx.lineWidth = 1.5;
        cells.forEach((lines, c) => {
          ctx.strokeRect(MARGIN + c * cw, y, cw, h);
          ctx.fillStyle = '#1d2029';
          ctx.font = `${ri === 0 ? 'bold ' : ''}20px ${FONT}`;
          lines.forEach((l, li) => ctx.fillText(l, MARGIN + c * cw + 10, y + 8 + li * 28));
        });
        y += h;
      });
      y += 24;
    }
    progress?.((i + 1) / blocks.length / 2);
  }

  // page numbers
  pages.forEach((c, i) => {
    const g = c.getContext('2d')!;
    g.font = `18px ${FONT}`;
    g.fillStyle = '#8a8f9c';
    g.textAlign = 'center';
    g.fillText(`${i + 1} / ${pages.length}`, PAGE_W / 2, PAGE_H - MARGIN / 2);
  });

  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('QSwissKnife');
  for (let i = 0; i < pages.length; i++) {
    const jpg = await new Promise<Blob>((r) => pages[i].toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const img = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const page = pdf.addPage([595.28, 841.89]);
    page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    progress?.(0.5 + (i + 1) / pages.length / 2);
  }
  return new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' });
}
