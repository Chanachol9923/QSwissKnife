import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowRight, BookOpen, Braces, Captions, CheckCircle2, ChevronDown, Code2, Download, File as FileIcon, FileArchive,
  FileText, Film, ImageIcon, Loader2, Music, Play, Presentation, RotateCcw, ScanSearch, Sheet, Square, Trash2, Type, X, Zap,
} from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { Alert, Field, Progress, Segmented, ShareButton, Slider, Switch, useToast } from '../components/ui';
import { useObjectUrl, usePersistent } from '../components/hooks';
import { queueStats, useQueue, type QItem } from '../components/useQueue';
import { useToolScope } from '../components/tasks';
import { detect, type Detected, type Kind } from '../lib/convert/detect';
import { defaultTarget, setAvifEncodeSupport, targetsFor, unsupportedReason, type Target } from '../lib/convert/targets';
import { canEncode } from '../lib/image';
import { convertFile, type ConvertOptions, type ConvertResult } from '../lib/convert';
import { onPending, takePending } from '../lib/convert/inbox';
import { cx, downloadBlob, downloadZip, formatBytes } from '../lib/utils';

// only offer AVIF output where this browser can actually create it
canEncode('image/avif').then(setAvifEncodeSupport);

type Params = { target: string };
type Item = QItem<ConvertResult, Detected, Params>;

const KIND_ICON: Record<Kind, typeof FileIcon> = {
  image: ImageIcon, video: Film, audio: Music, pdf: FileText, document: FileText, presentation: Presentation, ebook: BookOpen,
  spreadsheet: Sheet, data: Braces, markup: Code2, text: FileText, subtitle: Captions, font: Type, archive: Archive, other: FileIcon,
};

const SUPPORTED: [string, string][] = [
  ['Images', 'JPG · PNG · WebP · AVIF · HEIC (iPhone) · GIF · BMP · ICO · TIFF · SVG · PSD · TGA · QOI · PPM · EXR · HDR · DDS'],
  ['Video', 'MP4 · MOV · WebM · MKV · AVI · WMV · FLV · MPEG · TS · 3GP · OGV → also GIF, audio, or a still frame'],
  ['Audio', 'MP3 · WAV · M4A · AAC · OGG · Opus · FLAC · AIFF · WMA · AC3 · AMR · CAF'],
  ['Documents', 'PDF · Word (DOCX) · ODT · RTF · EPUB · PowerPoint (PPTX) · ODP · Markdown · HTML · TXT → PDF, DOCX, HTML, Markdown, text; PDF → images'],
  ['Tables & data', 'Excel (XLSX/XLS) · ODS · CSV · TSV · JSON · YAML · TOML · XML'],
  ['Other', 'Subtitles SRT · VTT · ASS — Fonts TTF/OTF ⇄ WOFF — Archives ZIP ⇄ TAR ⇄ TAR.GZ, GZ; any file → ZIP/GZ'],
];

export function Converter() {
  const [opts, setOpts] = usePersistent<ConvertOptions>('sk-convert-opts', { quality: 0.9, audioKbps: 192, videoLevel: 'medium' });
  const [parallel, setParallel] = usePersistent('sk-convert-parallel', 2);
  const [auto, setAuto] = usePersistent('sk-convert-auto', false);
  const [showFormats, setShowFormats] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const toast = useToast();
  const { active } = useToolScope();

  const q = useQueue<ConvertResult, Detected, Params>({
    concurrency: parallel,
    auto: false,
    process: async (item, jc) => {
      let d = item.meta;
      if (!d) {
        jc.stage('Detecting…');
        d = await detect(item.file);
      }
      const list = targetsFor(d);
      const target = list.find((t) => t.id === item.params?.target) ?? defaultTarget(d, list);
      if (!target) throw new Error(unsupportedReason(d) ?? `${d.label} can’t be converted.`);
      return convertFile(item.file, d, target, optsRef.current, { signal: jc.signal, progress: jc.progress, stage: jc.stage });
    },
  });

  const add = (files: File[]) => {
    const added = q.add(files);
    // detect in the background; a file can't start converting before we know what it is
    Promise.all(
      added.map(async (it) => {
        try {
          const d = await detect(it.file);
          const t = defaultTarget(d, targetsFor(d));
          q.patch(it.id, { meta: d, params: { target: t?.id ?? '' }, ...(t ? {} : { status: 'error', error: unsupportedReason(d) ?? `${d.label} can’t be converted.` }) });
        } catch (e) {
          q.patch(it.id, { status: 'error', error: `Couldn’t read this file: ${(e as Error).message}` });
        }
      }),
    ).then(() => {
      if (auto) q.start();
    });
  };

  // files dropped elsewhere in the app (Home) arrive through the inbox
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    const drain = () => {
      const files = takePending();
      if (files.length) addRef.current(files);
    };
    drain();
    return onPending(drain);
  }, []);

  const items = q.items;
  const stats = queueStats(items);
  const ready = items.filter((i) => i.meta && i.params?.target);
  const done = items.filter((i) => i.status === 'done' && i.result);
  const pending = items.filter((i) => (i.status === 'queued' || i.status === 'error' || i.status === 'canceled') && i.params?.target).length;
  const busy = q.running && stats.running + stats.queued > 0;
  const detecting = items.some((i) => !i.meta && i.status === 'queued');

  // "Set all to": formats every detected file can become
  const common = useMemo(() => {
    const lists = ready.map((i) => targetsFor(i.meta!));
    if (!lists.length) return [];
    return lists[0].filter((t) => lists.every((l) => l.some((x) => x.id === t.id)));
  }, [ready]);

  const zip = () => downloadZip(done.map((i) => ({ name: i.result!.name, blob: i.result!.blob })), 'converted.zip').then(() => toast('ZIP downloaded'));
  const kinds = new Set(ready.map((i) => i.meta!.kind));

  return (
    <div className="tool-layout">
      <div className="stack">
        {items.length === 0 ? (
          <>
            <FileDrop
              accept="*"
              multiple
              onFiles={add}
              title="Drop any files to convert"
              hint="The type is detected from the file itself — mixed batches are fine"
            />
            <SupportedFormats open={true} />
          </>
        ) : (
          <>
            <div>
              <div className="list-head">
                <h3>
                  {done.length}/{items.length} converted
                </h3>
                {stats.running > 0 && <span className="badge accent">{stats.running} running</span>}
                {detecting && (
                  <span className="badge">
                    <Loader2 size={11} className="spin" /> detecting
                  </span>
                )}
                <span className="spacer" />
                {common.length > 1 && ready.length > 1 && (
                  <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <span className="muted">Set all to</span>
                    <select
                      className="select"
                      style={{ height: 30, width: 'auto' }}
                      value=""
                      onChange={(e) => e.target.value && ready.forEach((i) => i.status !== 'running' && q.patch(i.id, { params: { target: e.target.value }, status: i.status === 'done' ? 'queued' : i.status, result: i.status === 'done' ? undefined : i.result }))}
                    >
                      <option value="">choose…</option>
                      {common.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {stats.done > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={q.clearFinished}>
                    <Trash2 size={14} /> Clear done
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={q.clear}>
                  <X size={14} /> Clear all
                </button>
                {done.length > 1 && (
                  <button className="btn btn-sm" onClick={zip}>
                    <FileArchive size={14} /> ZIP ({done.length})
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
                  <ConvertRow
                    key={it.id}
                    item={it}
                    onTarget={(target) => q.patch(it.id, { params: { target }, ...(it.status === 'done' || it.status === 'error' ? { status: 'queued', result: undefined, error: undefined } : {}) })}
                    onCancel={() => q.cancel(it.id)}
                    onRetry={() => q.retry(it.id)}
                    onRemove={() => q.remove(it.id)}
                  />
                ))}
              </div>
            </div>
            <FileDrop accept="*" multiple compact onFiles={add} title={busy ? 'Add more — they join the running batch' : 'Add more files'} paste={active} />
            <div className="mobile-cta">
              {busy ? (
                <button className="btn btn-danger" onClick={q.stop}>
                  <Square size={14} /> Stop · {Math.round(stats.overall * 100)}%
                </button>
              ) : pending ? (
                <button className="btn btn-primary" onClick={q.start}>
                  <Play size={16} /> Convert {pending > 1 ? `${pending} files` : ''}
                </button>
              ) : done.length ? (
                <button className="btn btn-primary" onClick={() => (done.length === 1 ? downloadBlob(done[0].result!.blob, done[0].result!.name) : zip())}>
                  <Download size={16} /> {done.length > 1 ? `Download all (${done.length})` : 'Download'}
                </button>
              ) : null}
            </div>
            <SupportedFormats open={showFormats} onToggle={() => setShowFormats((s) => !s)} />
          </>
        )}
      </div>

      <aside className="card stack">
        {(kinds.has('image') || kinds.has('pdf') || !kinds.size) && (
          <Field label="Image quality" value={`${Math.round(opts.quality * 100)}%`} hint="For JPG, WebP and AVIF results.">
            <Slider min={0.3} max={1} step={0.05} value={opts.quality} onChange={(v) => setOpts({ ...opts, quality: v })} />
          </Field>
        )}
        {(kinds.has('video') || !kinds.size) && (
          <Field label="Video quality">
            <Segmented
              block
              options={[
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Balanced' },
                { value: 'low', label: 'Small file' },
              ]}
              value={opts.videoLevel}
              onChange={(v) => setOpts({ ...opts, videoLevel: v })}
            />
          </Field>
        )}
        {(kinds.has('audio') || kinds.has('video') || !kinds.size) && (
          <Field label="Audio bitrate" value={`${opts.audioKbps} kbps`}>
            <Segmented block options={[96, 128, 192, 256, 320].map((b) => ({ value: b, label: String(b) }))} value={opts.audioKbps} onChange={(v) => setOpts({ ...opts, audioKbps: v })} />
          </Field>
        )}
        <div className="divider" />
        <Field label="Files at once">
          <Segmented block options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} value={parallel} onChange={setParallel} />
        </Field>
        <Switch checked={auto} onChange={setAuto} label="Convert as soon as files are added" />
        {busy ? (
          <button className="btn btn-lg btn-block btn-danger" onClick={q.stop}>
            <Square size={14} /> Stop ({stats.done}/{items.length})
          </button>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" disabled={!pending || detecting} onClick={q.start}>
            {detecting ? <Loader2 size={16} className="spin" /> : <Play size={16} />} Convert {pending > 1 ? `${pending} files` : pending === 1 ? '1 file' : ''}
          </button>
        )}
        {done.length > 0 && !busy && (
          <button className="btn btn-block" onClick={() => (done.length === 1 ? downloadBlob(done[0].result!.blob, done[0].result!.name) : zip())}>
            <Download size={16} /> {done.length > 1 ? `Download all as ZIP (${done.length})` : 'Download result'}
          </button>
        )}
        <span className="field-hint">Everything is converted on this device — nothing is uploaded. Files added while converting join the batch.</span>
      </aside>
    </div>
  );
}

function ConvertRow({ item, onTarget, onCancel, onRetry, onRemove }: { item: Item; onTarget: (t: string) => void; onCancel: () => void; onRetry: () => void; onRemove: () => void }) {
  const d = item.meta;
  const r = item.result;
  const targets = useMemo(() => (d ? targetsFor(d) : []), [d]);
  const groups = useMemo(() => {
    const m = new Map<string, Target[]>();
    targets.forEach((t) => m.set(t.group, [...(m.get(t.group) ?? []), t]));
    return [...m];
  }, [targets]);
  const current = targets.find((t) => t.id === item.params?.target);
  const Icon = d ? KIND_ICON[d.kind] : ScanSearch;
  const thumb = useObjectUrl(d?.kind === 'image' && ['png', 'jpg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'].includes(d.format) ? item.file : null);
  const elapsed = item.startedAt ? ((item.finishedAt ?? Date.now()) - item.startedAt) / 1000 : 0;
  const stop = (fn: () => void) => (e: React.MouseEvent) => (e.stopPropagation(), fn());

  return (
    <div className="file-row convert-row">
      <div className="file-thumb">{thumb ? <img src={thumb} alt="" /> : <Icon size={18} />}</div>
      <div className="file-meta">
        <div className="file-name">{item.file.name}</div>
        <div className="file-sub">
          <span>{formatBytes(item.file.size)}</span>
          {!d && item.status === 'queued' && (
            <span>
              <Loader2 size={11} className="spin" /> Detecting…
            </span>
          )}
          {d && (
            <span className={cx('badge', d.mismatch ? 'warn' : '')} title={d.by === 'content' ? 'Identified from the file’s content' : 'Identified from the file name'}>
              {d.mismatch ? <AlertTriangle size={11} /> : d.by === 'content' ? <CheckCircle2 size={11} /> : null}
              {d.label}
              {d.animated ? ' (animated)' : ''}
            </span>
          )}
          {d?.mismatch && <span style={{ color: 'var(--warn)' }}>named .{item.file.name.split('.').pop()}, but it’s really {d.format.toUpperCase()}</span>}
        </div>
        {item.status === 'running' && (
          <div style={{ marginTop: 6 }}>
            <Progress value={item.progress > 0 ? item.progress : null} />
            <div className="file-sub" style={{ marginTop: 3 }}>
              <span>{item.stage ?? 'Starting…'}</span>
              {item.progress > 0 && <span className="mono">{Math.round(item.progress * 100)}%</span>}
            </div>
          </div>
        )}
        {item.status === 'error' && <div className="file-sub" style={{ color: 'var(--danger)', marginTop: 4 }}>{item.error}</div>}
        {r && (
          <div className="file-sub" style={{ marginTop: 4 }}>
            <CheckCircle2 size={12} style={{ color: 'var(--success)' }} />
            <b style={{ fontWeight: 500, color: 'var(--text)' }}>{r.name}</b>
            <span className="badge good">{formatBytes(r.blob.size)}</span>
            {r.engine === 'fast' && (
              <span className="badge accent">
                <Zap size={10} /> Fast
              </span>
            )}
            {elapsed > 0 && <span>· {elapsed < 1 ? '<1 s' : `${elapsed.toFixed(1)} s`}</span>}
          </div>
        )}
      </div>

      {targets.length > 0 && item.status !== 'running' && (
        <div className="convert-to">
          <ArrowRight size={14} className="muted" />
          <select className="select" value={item.params?.target ?? ''} onChange={(e) => onTarget(e.target.value)} title={current?.note}>
            {groups.map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      <div className="file-actions">
        {r && (
          <>
            <ShareButton blob={r.blob} name={r.name} />
            <button className="btn btn-sm btn-icon" title={`Download ${r.name}`} onClick={stop(() => downloadBlob(r.blob, r.name))}>
              <Download size={14} />
            </button>
          </>
        )}
        {(item.status === 'error' || item.status === 'canceled') && targets.length > 0 && (
          <button className="btn btn-sm btn-icon" title="Retry" onClick={stop(onRetry)}>
            <RotateCcw size={14} />
          </button>
        )}
        {item.status === 'running' ? (
          <button className="btn btn-ghost btn-sm btn-icon" title="Cancel" onClick={stop(onCancel)}>
            <Square size={13} />
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm btn-icon" title="Remove" onClick={stop(onRemove)}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function SupportedFormats({ open, onToggle }: { open: boolean; onToggle?: () => void }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <button className="row" style={{ background: 'none', border: 0, padding: 0, cursor: onToggle ? 'pointer' : 'default', width: '100%', color: 'inherit' }} onClick={onToggle}>
        <b style={{ fontSize: 13 }}>What can it convert?</b>
        <span className="spacer" />
        {onToggle && <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />}
      </button>
      {open && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {SUPPORTED.map(([k, v]) => (
            <div key={k} style={{ fontSize: 12.5 }}>
              <b style={{ display: 'block', color: 'var(--text-2)' }}>{k}</b>
              <span className="muted">{v}</span>
            </div>
          ))}
          <Alert>Not sure what a file is? Drop it in — QSwissKnife reads its content to tell, even if the extension is wrong or missing.</Alert>
        </div>
      )}
    </div>
  );
}
