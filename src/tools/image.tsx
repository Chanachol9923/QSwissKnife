import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Download, FileArchive, ImageIcon, Loader2, Trash2, X } from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { Compare } from '../components/Compare';
import { Alert, CopyButton, Field, NumberInput, Progress, Segmented, Slider, Switch, useToast } from '../components/ui';
import { queueStats, useQueue, type QItem } from '../components/useQueue';
import { useDebounced, useObjectUrl } from '../components/hooks';
import { IMAGE_FORMATS, canEncode, formatFromMime, formatInfo, processImage, type ImageFormat, type ProcessOptions, type ResizeSpec } from '../lib/image';
import { baseName, cx, downloadBlob, downloadZip, formatBytes, withExt } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Shared batch engine                                                 */
/* ------------------------------------------------------------------ */

type ImgResult = { blob: Blob; name: string; width: number; height: number; source: { width: number; height: number } };
type Item = QItem<ImgResult>;

function useAvifSupport() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    canEncode('image/avif').then(setOk);
  }, []);
  return ok;
}

type FormatChoice = ImageFormat | 'keep';
const resolveFormat = (choice: FormatChoice, file: File): ImageFormat => (choice === 'keep' ? formatFromMime(file.type) ?? 'image/png' : choice);

function formatOptions(avif: boolean, withKeep: boolean) {
  return [
    ...(withKeep ? [{ value: 'keep' as FormatChoice, label: 'Original' }] : []),
    ...IMAGE_FORMATS.map((f) => ({
      value: f.value as FormatChoice,
      label: f.label,
      disabled: f.value === 'image/avif' && !avif,
      title: f.value === 'image/avif' && !avif ? 'Your browser cannot encode AVIF' : undefined,
    })),
  ];
}

interface BatchProps {
  settings: ReactNode;
  /** stable key describing current settings; changing it reprocesses everything */
  settingsKey: string;
  build: (file: File) => ProcessOptions;
  suffix: string;
  zipName: string;
  footer?: ReactNode;
}

function BatchImageTool({ settings, settingsKey, build, suffix, zipName, footer }: BatchProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const debouncedKey = useDebounced(settingsKey, 250);
  const buildRef = useRef(build);
  buildRef.current = build;
  const toast = useToast();

  // Files added while a batch is running simply join the queue; nothing in flight is restarted.
  const q = useQueue<ImgResult>({
    concurrency: 2,
    auto: true,
    onFocus: setSelected,
    process: async (it) => {
      const opts = buildRef.current(it.file);
      try {
        const r = await processImage(it.file, opts);
        return { ...r, name: withExt(it.file.name, formatInfo(opts.format).ext, suffix) };
      } catch {
        throw new Error('Could not decode this image (unsupported format?)');
      }
    },
  });

  // settings changed → redo everything with the new settings
  const firstKey = useRef(debouncedKey);
  useEffect(() => {
    if (firstKey.current === debouncedKey) return;
    firstKey.current = debouncedKey;
    q.requeueAll();
  }, [debouncedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (files: File[]) => {
    const next = q.add(files);
    if (!selected && next[0]) setSelected(next[0].id);
  };

  const items = q.items;
  const stats = queueStats(items);
  const done = items.filter((i) => i.status === 'done' && i.result);
  const busy = stats.running + stats.queued > 0;
  const totalIn = done.reduce((s, i) => s + i.file.size, 0);
  const totalOut = done.reduce((s, i) => s + i.result!.blob.size, 0);
  const sel = items.find((i) => i.id === selected) ?? items[0];
  const zip = () => downloadZip(done.map((i) => ({ name: i.result!.name, blob: i.result!.blob })), zipName).then(() => toast('ZIP downloaded'));

  return (
    <div className="tool-layout">
      <div className="stack">
        {items.length === 0 ? (
          <FileDrop accept="image/*" multiple onFiles={add} title="Drop images here" hint="JPG, PNG, WebP, AVIF, GIF, BMP — select or drop as many as you like" />
        ) : (
          <>
            {sel && <Preview item={sel} />}
            <div>
              <div className="list-head">
                <h3>
                  {done.length}/{items.length} done
                </h3>
                {done.length > 0 && <SavingsBadge before={totalIn} after={totalOut} />}
                {busy && <Loader2 size={15} className="spin muted" />}
                <span className="spacer" />
                <button className="btn btn-ghost btn-sm" onClick={() => (q.clear(), setSelected(null))}>
                  <Trash2 size={14} /> Clear
                </button>
                {done.length > 1 && (
                  <button className="btn btn-sm" onClick={zip}>
                    <FileArchive size={14} /> Download ZIP
                  </button>
                )}
              </div>
              {busy && items.length > 1 && (
                <div style={{ marginBottom: 10 }}>
                  <Progress value={stats.overall} />
                </div>
              )}
              <div className="files">
                {items.map((it) => (
                  <ItemRow key={it.id} item={it} active={sel?.id === it.id} onSelect={() => setSelected(it.id)} onRemove={() => q.remove(it.id)} onRetry={() => q.retry(it.id)} />
                ))}
              </div>
            </div>
            <FileDrop accept="image/*" multiple compact onFiles={add} title={busy ? 'Add more — they join the queue' : 'Add more images'} />
            {done.length > 0 && (
              <div className="mobile-cta">
                <button className="btn btn-primary" onClick={() => (done.length === 1 ? downloadBlob(done[0].result!.blob, done[0].result!.name) : zip())}>
                  <Download size={16} /> {done.length > 1 ? `Download all (${done.length})` : 'Download'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <aside className="card stack">
        {settings}
        {footer}
        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={!done.length}
          onClick={() => (done.length === 1 ? downloadBlob(done[0].result!.blob, done[0].result!.name) : zip())}
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
          {done.length > 1 ? `Download all (${done.length}${busy ? ` of ${items.length}` : ''})` : 'Download'}
        </button>
      </aside>
    </div>
  );
}

function SavingsBadge({ before, after }: { before: number; after: number }) {
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  return (
    <span className={cx('badge', pct > 0 ? 'good' : pct < 0 ? 'bad' : '')}>
      {formatBytes(before)} <ArrowRight size={11} /> {formatBytes(after)} · {pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : '±0%'}
    </span>
  );
}

function ItemRow({ item, active, onSelect, onRemove, onRetry }: { item: Item; active: boolean; onSelect: () => void; onRemove: () => void; onRetry: () => void }) {
  const thumb = useObjectUrl(item.file);
  const r = item.result;
  return (
    <div className="file-row" style={active ? { borderColor: 'var(--accent)' } : undefined} onClick={onSelect}>
      <div className="file-thumb">{thumb && <img src={thumb} alt="" />}</div>
      <div className="file-meta">
        <div className="file-name">{item.file.name}</div>
        <div className="file-sub">
          {item.status === 'running' && (
            <span>
              <Loader2 size={11} className="spin" /> Processing…
            </span>
          )}
          {item.status === 'queued' && <span>Queued</span>}
          {item.status === 'error' && (
            <span style={{ color: 'var(--danger)' }}>
              {item.error}{' '}
              <button className="btn btn-ghost btn-sm" style={{ height: 20 }} onClick={(e) => (e.stopPropagation(), onRetry())}>
                Retry
              </button>
            </span>
          )}
          {r && (
            <>
              <span>
                {r.source.width}×{r.source.height}
                {(r.width !== r.source.width || r.height !== r.source.height) && ` → ${r.width}×${r.height}`}
              </span>
              <SavingsBadge before={item.file.size} after={r.blob.size} />
            </>
          )}
        </div>
      </div>
      <div className="file-actions">
        {r && (
          <button
            className="btn btn-sm btn-icon"
            title={`Download ${r.name}`}
            onClick={(e) => {
              e.stopPropagation();
              downloadBlob(r.blob, r.name);
            }}
          >
            <Download size={14} />
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm btn-icon"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function Preview({ item }: { item: Item }) {
  const before = useObjectUrl(item.file);
  const after = useObjectUrl(item.result?.blob);
  return (
    <div className="stage checker">
      {before && after && item.result ? (
        <Compare before={before} after={after} afterLabel={`Result · ${formatBytes(item.result!.blob.size)}`} beforeLabel={`Original · ${formatBytes(item.file.size)}`} />
      ) : before ? (
        <img src={before} alt="" style={{ opacity: 0.6 }} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const MAX_DIMS = [0, 3840, 2560, 1920, 1280, 1080, 720];

export function ImageCompress() {
  const avif = useAvifSupport();
  const [format, setFormat] = useState<FormatChoice>('keep');
  const [quality, setQuality] = useState(75);
  const [maxDim, setMaxDim] = useState(0);

  return (
    <BatchImageTool
      settingsKey={`${format}|${quality}|${maxDim}`}
      build={(file) => ({
        format: resolveFormat(format, file),
        quality: quality / 100,
        resize: maxDim ? { mode: 'fit', maxW: maxDim, maxH: maxDim } : { mode: 'none' },
      })}
      suffix="-min"
      zipName="compressed-images.zip"
      settings={
        <>
          <Field label="Output format">
            <Segmented block options={formatOptions(avif, true)} value={format} onChange={setFormat} />
          </Field>
          <Field label="Quality" value={`${quality}%`} hint="70–80% is usually visually lossless.">
            <Slider min={10} max={100} value={quality} onChange={setQuality} />
          </Field>
          <Field label="Max dimension" hint="Downscale large photos — the biggest win for file size.">
            <select className="select" value={maxDim} onChange={(e) => setMaxDim(Number(e.target.value))}>
              {MAX_DIMS.map((d) => (
                <option key={d} value={d}>
                  {d ? `${d}px` : 'Keep original size'}
                </option>
              ))}
            </select>
          </Field>
        </>
      }
      footer={
        format === 'image/png' || format === 'keep' ? (
          <Alert>PNG is lossless — quality has no effect on PNG files. Switch to WebP for big savings with transparency kept.</Alert>
        ) : (
          <Alert>Metadata (EXIF, GPS) is stripped on re-encode.</Alert>
        )
      }
    />
  );
}

export function ImageConvert() {
  const avif = useAvifSupport();
  const [format, setFormat] = useState<FormatChoice>('image/webp');
  const [quality, setQuality] = useState(90);
  const [bg, setBg] = useState('#ffffff');
  const lossy = format !== 'keep' && formatInfo(format).lossy;

  return (
    <BatchImageTool
      settingsKey={`${format}|${quality}|${bg}`}
      build={(file) => ({ format: resolveFormat(format, file), quality: quality / 100, background: bg })}
      suffix=""
      zipName="converted-images.zip"
      settings={
        <>
          <Field label="Convert to">
            <Segmented block options={formatOptions(avif, false)} value={format} onChange={setFormat} />
          </Field>
          {lossy && (
            <Field label="Quality" value={`${quality}%`}>
              <Slider min={10} max={100} value={quality} onChange={setQuality} />
            </Field>
          )}
          {format === 'image/jpeg' && (
            <Field label="Background" hint="JPG has no transparency — transparent pixels get this colour.">
              <div className="row">
                <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ width: 44, height: 36, border: 0, background: 'none', padding: 0 }} />
                <input className="input mono" value={bg} onChange={(e) => setBg(e.target.value)} style={{ flex: 1 }} />
              </div>
            </Field>
          )}
        </>
      }
    />
  );
}

export function ImageResize() {
  const avif = useAvifSupport();
  const [mode, setMode] = useState<'percent' | 'fit' | 'exact'>('percent');
  const [percent, setPercent] = useState(50);
  const [w, setW] = useState<number | ''>(1280);
  const [h, setH] = useState<number | ''>(720);
  const [format, setFormat] = useState<FormatChoice>('keep');
  const [quality, setQuality] = useState(90);

  const spec: ResizeSpec = useMemo(() => {
    if (mode === 'percent') return { mode, percent };
    if (mode === 'fit') return { mode, maxW: Number(w) || 0, maxH: Number(h) || 0 };
    return { mode, width: Number(w) || 1, height: Number(h) || 1 };
  }, [mode, percent, w, h]);

  return (
    <BatchImageTool
      settingsKey={`${JSON.stringify(spec)}|${format}|${quality}`}
      build={(file) => ({ format: resolveFormat(format, file), quality: quality / 100, resize: spec })}
      suffix="-resized"
      zipName="resized-images.zip"
      settings={
        <>
          <Field label="Resize by">
            <Segmented
              block
              options={[
                { value: 'percent', label: 'Percent' },
                { value: 'fit', label: 'Fit in box' },
                { value: 'exact', label: 'Exact' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </Field>
          {mode === 'percent' ? (
            <Field label="Scale" value={`${percent}%`}>
              <Slider min={5} max={200} value={percent} onChange={setPercent} />
              <div className="row">
                {[25, 50, 75, 150, 200].map((p) => (
                  <button key={p} className="btn btn-sm" onClick={() => setPercent(p)}>
                    {p}%
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            <div className="grid-2">
              <Field label={mode === 'fit' ? 'Max width' : 'Width'}>
                <NumberInput value={w} onChange={setW} min={1} suffix="px" placeholder="any" />
              </Field>
              <Field label={mode === 'fit' ? 'Max height' : 'Height'}>
                <NumberInput value={h} onChange={setH} min={1} suffix="px" placeholder="any" />
              </Field>
            </div>
          )}
          {mode === 'fit' && <span className="field-hint">Keeps aspect ratio and never upscales. Leave one blank to constrain only the other.</span>}
          {mode === 'exact' && <span className="field-hint">Stretches to exactly these pixels. Use Crop first to avoid distortion.</span>}
          <Field label="Output format">
            <Segmented block options={formatOptions(avif, true)} value={format} onChange={setFormat} />
          </Field>
          {format !== 'image/png' && (
            <Field label="Quality" value={`${quality}%`}>
              <Slider min={10} max={100} value={quality} onChange={setQuality} />
            </Field>
          )}
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */

function readDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function ImageBase64() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [file, setFile] = useState<File | null>(null);
  const [dataUrl, setDataUrl] = useState('');
  const [raw, setRaw] = useState(false);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (file) readDataUrl(file).then(setDataUrl);
  }, [file]);

  const output = raw ? dataUrl.replace(/^data:[^,]+,/, '') : dataUrl;
  const decoded = useMemo(() => {
    const t = input.trim();
    if (!t) return null;
    if (t.startsWith('data:image/')) return t;
    if (/^[A-Za-z0-9+/=\s]+$/.test(t)) {
      const head = t.slice(0, 12);
      const mime = head.startsWith('/9j') ? 'jpeg' : head.startsWith('iVBOR') ? 'png' : head.startsWith('R0lG') ? 'gif' : head.startsWith('UklG') ? 'webp' : head.startsWith('PHN2') ? 'svg+xml' : 'png';
      return `data:image/${mime};base64,${t.replace(/\s/g, '')}`;
    }
    return 'invalid';
  }, [input]);

  return (
    <div className="stack">
      <Segmented
        options={[
          { value: 'encode', label: 'Image → Base64' },
          { value: 'decode', label: 'Base64 → Image' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'encode' ? (
        !file ? (
          <FileDrop accept="image/*" onFiles={(f) => setFile(f[0])} />
        ) : (
          <div className="io">
            <div className="stack">
              <div className="stage checker">
                <img src={dataUrl} alt="" />
              </div>
              <div className="row">
                <span className="badge">{file.name}</span>
                <span className="badge">{formatBytes(file.size)}</span>
                <span className="badge accent">Base64: {formatBytes(output.length)}</span>
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setFile(null)}>
                  <X size={14} /> Change
                </button>
              </div>
            </div>
            <div className="stack">
              <div className="row">
                <Switch checked={raw} onChange={setRaw} label="Raw Base64 (no data: prefix)" />
                <span className="spacer" />
                <CopyButton text={output} />
                <CopyButton text={`<img src="${dataUrl}" alt="" />`} label="Copy <img>" />
                <CopyButton text={`url("${dataUrl}")`} label="Copy CSS" />
              </div>
              <textarea className="textarea" readOnly value={output} style={{ minHeight: 320 }} />
            </div>
          </div>
        )
      ) : (
        <div className="io">
          <Field label="Base64 or data URI">
            <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} placeholder="data:image/png;base64,iVBORw0KGgo…" style={{ minHeight: 320 }} />
          </Field>
          <div className="stack">
            <div className="stage checker">
              {decoded && decoded !== 'invalid' ? <img src={decoded} alt="Decoded" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} onLoad={(e) => ((e.target as HTMLImageElement).style.display = '')} /> : <span className="muted"><ImageIcon size={18} /> Preview appears here</span>}
            </div>
            {decoded === 'invalid' && <Alert kind="error">That doesn’t look like Base64.</Alert>}
            {decoded && decoded !== 'invalid' && (
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const blob = await (await fetch(decoded)).blob();
                  downloadBlob(blob, `image.${blob.type.split('/')[1]?.replace('+xml', '') || 'png'}`);
                }}
              >
                <Download size={16} /> Download image
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

async function extractPalette(file: File, count: number) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 120 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const bk = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bk.r += data[i];
    bk.g += data[i + 1];
    bk.b += data[i + 2];
    bk.n++;
    buckets.set(key, bk);
  }
  const total = [...buckets.values()].reduce((s, b) => s + b.n, 0);
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map((b) => ({ r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n), n: b.n }));
  const picked: typeof sorted = [];
  for (const minDist of [48, 32, 20, 0]) {
    for (const col of sorted) {
      if (picked.length >= count) break;
      if (picked.includes(col)) continue;
      if (picked.every((p) => Math.hypot(p.r - col.r, p.g - col.g, p.b - col.b) >= minDist)) picked.push(col);
    }
    if (picked.length >= count) break;
  }
  return picked.map((p) => ({ hex: hex(p.r, p.g, p.b), rgb: `rgb(${p.r}, ${p.g}, ${p.b})`, share: p.n / total, light: 0.299 * p.r + 0.587 * p.g + 0.114 * p.b > 150 }));
}

export function ImagePalette() {
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState(8);
  const [colors, setColors] = useState<Awaited<ReturnType<typeof extractPalette>>>([]);
  const url = useObjectUrl(file);
  const toast = useToast();

  useEffect(() => {
    if (file) extractPalette(file, count).then(setColors).catch(() => toast('Could not read this image', 'error'));
  }, [file, count]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) return <FileDrop accept="image/*" onFiles={(f) => setFile(f[0])} />;
  return (
    <div className="tool-layout">
      <div className="stack">
        <div className="stage checker">{url && <img src={url} alt="" />}</div>
        <div style={{ display: 'flex', height: 56, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {colors.map((c) => (
            <div key={c.hex} style={{ flex: Math.max(c.share, 0.04), background: c.hex }} title={c.hex} />
          ))}
        </div>
        <FileDrop accept="image/*" compact onFiles={(f) => setFile(f[0])} />
      </div>
      <aside className="card stack">
        <Field label="Colors" value={count}>
          <Slider min={3} max={16} value={count} onChange={setCount} />
        </Field>
        <div className="files">
          {colors.map((c) => (
            <div key={c.hex} className="file-row" style={{ padding: 8 }}>
              <div className="file-thumb" style={{ background: c.hex, width: 36, height: 36 }} />
              <div className="file-meta">
                <div className="file-name mono">{c.hex}</div>
                <div className="file-sub">
                  {c.rgb} · {(c.share * 100).toFixed(1)}%
                </div>
              </div>
              <CopyButton text={c.hex} label="" />
            </div>
          ))}
        </div>
        <CopyButton small={false} className="btn-block" text={colors.map((c) => c.hex).join(', ')} label="Copy all HEX" />
        <CopyButton small={false} className="btn-block" text={`:root {\n${colors.map((c, i) => `  --color-${i + 1}: ${c.hex};`).join('\n')}\n}`} label="Copy as CSS variables" />
        <span className="field-hint">{baseName(file.name)}</span>
      </aside>
    </div>
  );
}
