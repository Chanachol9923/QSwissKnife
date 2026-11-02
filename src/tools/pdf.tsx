import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileText, GripVertical, Loader2, Trash2, X } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { FileDrop } from '../components/FileDrop';
import { Alert, Field, NumberInput, Segmented, Slider, Switch, useToast } from '../components/ui';
import { useObjectUrl } from '../components/hooks';
import { canvasToBlob, loadBitmap } from '../lib/image';
import { baseName, downloadBlob, downloadZip, formatBytes, uid } from '../lib/utils';

const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' });

async function loadPdf(file: File) {
  return PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
}

/* ---------- Reorderable list ---------- */
interface Entry {
  id: string;
  file: File;
  info?: string;
  error?: string;
}

function useReorder<T>(setList: React.Dispatch<React.SetStateAction<T[]>>) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const move = (from: number, to: number) =>
    setList((l) => {
      if (to < 0 || to >= l.length) return l;
      const c = [...l];
      const [x] = c.splice(from, 1);
      c.splice(to, 0, x);
      return c;
    });
  const rowProps = (i: number) => ({
    draggable: true,
    onDragStart: () => setDragIdx(i),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIdx !== null && dragIdx !== i) {
        move(dragIdx, i);
        setDragIdx(i);
      }
    },
    onDragEnd: () => setDragIdx(null),
    style: dragIdx === i ? { opacity: 0.5 } : undefined,
  });
  return { move, rowProps };
}

function Thumb({ file }: { file: File }) {
  const url = useObjectUrl(file.type.startsWith('image/') ? file : null);
  return <div className="file-thumb">{url ? <img src={url} alt="" /> : <FileText size={20} />}</div>;
}

function EntryList({ list, setList }: { list: Entry[]; setList: React.Dispatch<React.SetStateAction<Entry[]>> }) {
  const { move, rowProps } = useReorder(setList);
  return (
    <div className="files">
      {list.map((e, i) => (
        <div key={e.id} className="file-row" {...rowProps(i)}>
          <GripVertical size={16} className="muted" style={{ cursor: 'grab', flexShrink: 0 }} />
          <span className="mono muted" style={{ width: 18, textAlign: 'right' }}>
            {i + 1}
          </span>
          <Thumb file={e.file} />
          <div className="file-meta">
            <div className="file-name">{e.file.name}</div>
            <div className="file-sub">
              {formatBytes(e.file.size)}
              {e.info && <span>· {e.info}</span>}
              {e.error && <span style={{ color: 'var(--danger)' }}>· {e.error}</span>}
            </div>
          </div>
          <div className="file-actions">
            <button className="btn btn-ghost btn-sm btn-icon" disabled={i === 0} onClick={() => move(i, i - 1)} title="Move up">
              <ArrowUp size={14} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={i === list.length - 1} onClick={() => move(i, i + 1)} title="Move down">
              <ArrowDown size={14} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setList((l) => l.filter((x) => x.id !== e.id))} title="Remove">
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Merge ---------- */
export function PdfMerge() {
  const [list, setList] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const add = async (files: File[]) => {
    const entries = files.map((file) => ({ id: uid(), file }) as Entry);
    setList((l) => [...l, ...entries]);
    for (const en of entries) {
      try {
        const doc = await loadPdf(en.file);
        const n = doc.getPageCount();
        setList((l) => l.map((x) => (x.id === en.id ? { ...x, info: `${n} page${n > 1 ? 's' : ''}` } : x)));
      } catch {
        setList((l) => l.map((x) => (x.id === en.id ? { ...x, error: 'Not a readable PDF' } : x)));
      }
    }
  };

  const merge = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await PDFDocument.create();
      for (const en of list.filter((e) => !e.error)) {
        const src = await loadPdf(en.file);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      downloadBlob(pdfBlob(bytes), 'merged.pdf');
      toast(`Merged ${out.getPageCount()} pages · ${formatBytes(bytes.length)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const valid = list.filter((e) => !e.error);
  return (
    <div className="tool-layout">
      <div className="stack">
        {list.length === 0 ? (
          <FileDrop accept="application/pdf,.pdf" multiple onFiles={add} title="Drop PDFs to merge" />
        ) : (
          <>
            <div className="list-head">
              <h3>{list.length} files</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                Drag to reorder
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setList([])}>
                <Trash2 size={14} /> Clear
              </button>
            </div>
            <EntryList list={list} setList={setList} />
            <FileDrop accept="application/pdf,.pdf" multiple compact onFiles={add} />
          </>
        )}
      </div>
      <aside className="card stack">
        <span className="field-hint">Files are merged top to bottom. Password-protected PDFs may not merge correctly.</span>
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary btn-lg btn-block" disabled={valid.length < 2 || busy} onClick={merge}>
          {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Merge {valid.length || ''} PDFs
        </button>
      </aside>
    </div>
  );
}

/* ---------- Split ---------- */
/** "1-3, 5, 8-" → zero-based indices (deduped, in the order written) */
export function parseRanges(text: string, total: number): number[] | string {
  const out: number[] = [];
  for (const raw of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(/^(\d*)\s*-\s*(\d*)$/);
    let a: number;
    let b: number;
    if (m) {
      a = m[1] ? Number(m[1]) : 1;
      b = m[2] ? Number(m[2]) : total;
    } else if (/^\d+$/.test(raw)) {
      a = b = Number(raw);
    } else return `“${raw}” isn’t a valid page or range`;
    if (a < 1 || b > total || a > b) return `“${raw}” is outside 1–${total}`;
    for (let i = a; i <= b; i++) if (!out.includes(i - 1)) out.push(i - 1);
  }
  return out.length ? out : 'Enter at least one page';
}

export function PdfSplit() {
  const [file, setFile] = useState<File | null>(null);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState<'ranges' | 'each' | 'chunks'>('ranges');
  const [ranges, setRanges] = useState('1-3');
  const [chunk, setChunk] = useState<number | ''>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (!file) return;
    setError('');
    loadPdf(file)
      .then((d) => setTotal(d.getPageCount()))
      .catch(() => setError('Could not read this PDF.'));
  }, [file]);

  const parsed = parseRanges(ranges, total);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const src = await loadPdf(file);
      const make = async (idx: number[]) => {
        const d = await PDFDocument.create();
        (await d.copyPages(src, idx)).forEach((p) => d.addPage(p));
        return pdfBlob(await d.save());
      };
      const base = baseName(file.name);
      if (mode === 'ranges') {
        if (typeof parsed === 'string') return;
        downloadBlob(await make(parsed), `${base}-pages.pdf`);
        toast(`Extracted ${parsed.length} pages`);
      } else {
        const size = mode === 'each' ? 1 : Math.max(1, Number(chunk) || 1);
        const parts: { name: string; blob: Blob }[] = [];
        for (let i = 0; i < total; i += size) {
          const idx = Array.from({ length: Math.min(size, total - i) }, (_, k) => i + k);
          const label = idx.length > 1 ? `${idx[0] + 1}-${idx[idx.length - 1] + 1}` : `${idx[0] + 1}`;
          parts.push({ name: `${base}-p${label}.pdf`, blob: await make(idx) });
        }
        await downloadZip(parts, `${base}-split.zip`);
        toast(`Created ${parts.length} PDFs`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!file) return <FileDrop accept="application/pdf,.pdf" onFiles={(f) => setFile(f[0])} title="Drop a PDF" />;
  return (
    <div className="tool-layout">
      <div className="stack">
        <div className="file-row">
          <div className="file-thumb">
            <FileText size={20} />
          </div>
          <div className="file-meta">
            <div className="file-name">{file.name}</div>
            <div className="file-sub">
              {formatBytes(file.size)} · {total || '…'} pages
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setFile(null)}>
            <X size={14} />
          </button>
        </div>
        {total > 0 && (
          <div className="card">
            <div className="card-title">Pages</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Array.from({ length: total }, (_, i) => {
                const on = mode !== 'ranges' || (typeof parsed !== 'string' && parsed.includes(i));
                return (
                  <div
                    key={i}
                    className="mono"
                    style={{
                      width: 38, height: 50, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 12,
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                      color: on ? 'var(--accent-text)' : 'var(--muted)',
                    }}
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
      <aside className="card stack">
        <Field label="Mode">
          <Segmented
            block
            options={[
              { value: 'ranges', label: 'Extract' },
              { value: 'each', label: 'Every page' },
              { value: 'chunks', label: 'Chunks' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </Field>
        {mode === 'ranges' && (
          <Field label="Pages" hint="e.g. 1-3, 5, 8-  (open-ended ranges allowed)">
            <input className="input mono" value={ranges} onChange={(e) => setRanges(e.target.value)} />
          </Field>
        )}
        {mode === 'ranges' && typeof parsed === 'string' && total > 0 && <Alert kind="error">{parsed}</Alert>}
        {mode === 'chunks' && (
          <Field label="Pages per file">
            <NumberInput value={chunk} onChange={setChunk} min={1} max={total} />
          </Field>
        )}
        {mode !== 'ranges' && <span className="field-hint">Downloads a ZIP of separate PDFs.</span>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !total || (mode === 'ranges' && typeof parsed === 'string')} onClick={run}>
          {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />} {mode === 'ranges' ? 'Extract pages' : 'Split PDF'}
        </button>
      </aside>
    </div>
  );
}

/* ---------- Images → PDF ---------- */
const PAGE_SIZES: Record<string, [number, number] | null> = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export function ImagesToPdf() {
  const [list, setList] = useState<Entry[]>([]);
  const [size, setSize] = useState<'fit' | 'a4' | 'letter'>('a4');
  const [margin, setMargin] = useState(24);
  const [quality, setQuality] = useState(85);
  const [lossless, setLossless] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const add = (files: File[]) => setList((l) => [...l, ...files.map((file) => ({ id: uid(), file }))]);

  const run = async () => {
    setBusy(true);
    try {
      const doc = await PDFDocument.create();
      for (const en of list) {
        const bmp = await loadBitmap(en.file);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d')!;
        if (!lossless) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const blob = await canvasToBlob(c, lossless ? 'image/png' : 'image/jpeg', quality / 100);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const img = lossless ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const fixed = PAGE_SIZES[size];
        if (!fixed) {
          const p = doc.addPage([img.width + margin * 2, img.height + margin * 2]);
          p.drawImage(img, { x: margin, y: margin, width: img.width, height: img.height });
        } else {
          // auto-orient the page to match the image
          const [pw, ph] = img.width > img.height ? [fixed[1], fixed[0]] : fixed;
          const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
          const w = img.width * s;
          const h = img.height * s;
          const p = doc.addPage([pw, ph]);
          p.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
      }
      const out = await doc.save();
      downloadBlob(pdfBlob(out), 'images.pdf');
      toast(`Created ${list.length}-page PDF · ${formatBytes(out.length)}`);
    } catch (e) {
      toast((e as Error).message || 'Failed to build PDF', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tool-layout">
      <div className="stack">
        {list.length === 0 ? (
          <FileDrop accept="image/*" multiple onFiles={add} title="Drop images" hint="Each image becomes one page" />
        ) : (
          <>
            <div className="list-head">
              <h3>{list.length} pages</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                Drag to reorder
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setList([])}>
                <Trash2 size={14} /> Clear
              </button>
            </div>
            <EntryList list={list} setList={setList} />
            <FileDrop accept="image/*" multiple compact onFiles={add} />
          </>
        )}
      </div>
      <aside className="card stack">
        <Field label="Page size">
          <Segmented
            block
            options={[
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter' },
              { value: 'fit', label: 'Fit image' },
            ]}
            value={size}
            onChange={setSize}
          />
        </Field>
        <Field label="Margin" value={`${margin}pt`}>
          <Slider min={0} max={72} value={margin} onChange={setMargin} />
        </Field>
        <Switch checked={lossless} onChange={setLossless} label="Lossless (PNG, larger file)" />
        {!lossless && (
          <Field label="Image quality" value={`${quality}%`}>
            <Slider min={30} max={100} value={quality} onChange={setQuality} />
          </Field>
        )}
        <button className="btn btn-primary btn-lg btn-block" disabled={!list.length || busy} onClick={run}>
          {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Create PDF
        </button>
      </aside>
    </div>
  );
}
