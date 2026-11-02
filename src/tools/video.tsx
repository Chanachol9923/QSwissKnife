import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, AudioLines, Download, FileArchive, Film, Gauge, Pause, Play, RefreshCw, RotateCcw, ScrollText, Square, Target, Trash2, X, Zap, Copy,
} from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { TimeInput, Timeline } from '../components/Timeline';
import { ASPECTS, CropBox, centeredRect, type Rect } from '../components/CropBox';
import { Alert, Field, NumberInput, Progress, Segmented, ShareButton, Slider, Switch, useToast } from '../components/ui';
import { useObjectUrl, usePersistent } from '../components/hooks';
import { queueStats, useQueue, type JobCtx, type QItem } from '../components/useQueue';
import { isFFmpegLoaded, readMediaInfo, runFFmpeg, type MediaInfo, type RunOptions } from '../lib/ffmpeg';
import { FastPathUnsupported, fastConvert, fastPathAvailable, type FastContainer } from '../lib/fastvideo';
import { clamp, cx, downloadBlob, downloadZip, extOf, formatBytes, formatTime, withExt } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Types & engine plumbing                                             */
/* ------------------------------------------------------------------ */

type Engine = 'fast' | 'ffmpeg';
interface MediaResult {
  blob: Blob;
  name: string;
  engine: Engine;
  note?: string;
  warn?: boolean;
}
type MItem<P> = QItem<MediaResult, MediaInfo, P>;

interface MediaCtx extends JobCtx {
  meta: MediaInfo;
  /** run FFmpeg on this item's file */
  exec: (o: Omit<RunOptions, 'input' | 'signal' | 'onProgress' | 'onLog'>) => Promise<Blob>;
  /** try the hardware path first (unless disabled), fall back to FFmpeg */
  run: (fast: (() => Promise<Blob>) | null, slow: () => Promise<Blob>) => Promise<{ blob: Blob; engine: Engine }>;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

interface EditorProps<P> {
  item: MItem<P>;
  meta: MediaInfo;
  params: P;
  setParams: (p: P) => void;
  media: MediaHandle;
}

interface MediaHandle {
  ref: React.RefObject<HTMLVideoElement>;
  time: number;
  seek: (t: number) => void;
  playable: boolean;
  props: React.VideoHTMLAttributes<HTMLVideoElement> & { ref: React.RefObject<HTMLVideoElement> };
}

interface ToolSpec<P> {
  kind: 'video' | 'audio';
  dropTitle: string;
  settings: ReactNode;
  /** extra info for the selected file (e.g. computed bitrate) */
  selectedInfo?: (item: MItem<P> | undefined) => ReactNode;
  initParams?: (meta: MediaInfo) => P;
  /** custom stage (e.g. crop overlay); defaults to a player */
  stage?: (p: EditorProps<P>) => ReactNode;
  editor?: (p: EditorProps<P>) => ReactNode;
  process: (item: MItem<P>, ctx: MediaCtx) => Promise<MediaResult>;
  action: string;
  preview: 'video' | 'audio' | 'image' | 'none';
  /** offer the hardware engine switch */
  fast?: boolean;
  /** compare output size with input */
  sizes?: boolean;
  zipName: string;
  /** shared toolbar actions for the selected item (e.g. "apply crop to all") */
  extra?: (p: { selected?: MItem<P>; setAllParams: (fn: (item: MItem<P>) => P | undefined) => void }) => ReactNode;
}

const VIDEO_ACCEPT = 'video/*,.mkv,.avi,.mov,.flv,.wmv,.m4v,.3gp,.ts';
const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.wma,.aiff';
const DEFAULT_PARALLEL = typeof navigator !== 'undefined' && navigator.hardwareConcurrency >= 8 ? 3 : 2;

/* ------------------------------------------------------------------ */
/* Batch shell                                                         */
/* ------------------------------------------------------------------ */

function MediaBatchTool<P>(spec: ToolSpec<P>) {
  const [engine, setEngine] = usePersistent<'auto' | 'ffmpeg'>('sk-engine', 'auto');
  const [parallel, setParallel] = usePersistent('sk-parallel', DEFAULT_PARALLEL);
  const [selected, setSelected] = useState<string | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const logs = useRef(new Map<string, string[]>());
  const toast = useToast();

  const q = useQueue<MediaResult, MediaInfo, P>({
    concurrency: parallel,
    auto: false,
    onFocus: setSelected,
    process: async (item, jc) => {
      let meta = item.meta;
      if (!meta) {
        jc.stage('Reading file…');
        meta = await readMediaInfo(item.file, specRef.current.kind === 'video');
        q.patch(item.id, { meta });
      }
      const log: string[] = [];
      logs.current.set(item.id, log);
      const exec: MediaCtx['exec'] = (o) =>
        runFFmpeg({
          ...o,
          input: item.file,
          signal: jc.signal,
          onProgress: jc.progress,
          onLog: (l) => {
            log.push(l);
            if (log.length > 300) log.shift();
          },
        });
      const run: MediaCtx['run'] = async (fast, slow) => {
        if (fast && engineRef.current === 'auto' && fastPathAvailable()) {
          try {
            jc.stage('Hardware encoding…');
            return { blob: await fast(), engine: 'fast' };
          } catch (e) {
            if (isAbort(e)) throw e;
            log.push(`[fast path] ${e instanceof FastPathUnsupported ? 'not supported' : 'failed'}: ${(e as Error).message} — using FFmpeg`);
          }
        }
        jc.stage(isFFmpegLoaded() ? 'Encoding with FFmpeg…' : 'Loading FFmpeg engine…');
        const p = slow();
        if (!isFFmpegLoaded()) p.then(() => {}, () => {});
        return { blob: await p, engine: 'ffmpeg' };
      };
      return specRef.current.process({ ...item, meta }, { ...jc, meta, exec, run });
    },
  });

  // read metadata for new files one at a time (cheap for the browser, but FFmpeg probes are not)
  const metaChain = useRef(Promise.resolve());
  const add = (files: File[]) => {
    const added = q.add(files);
    if (!selected && added[0]) setSelected(added[0].id);
    for (const it of added) {
      metaChain.current = metaChain.current.then(async () => {
        const meta = await readMediaInfo(it.file, spec.kind === 'video');
        const init = specRef.current.initParams;
        q.patch(it.id, { meta, ...(init ? { params: init(meta) } : {}) });
      });
    }
  };

  const items = q.items;
  const stats = queueStats(items);
  const sel = items.find((i) => i.id === selected) ?? items[0];
  const done = items.filter((i) => i.status === 'done' && i.result);
  const pending = stats.queued + stats.errors + stats.canceled;
  const busy = q.running && stats.running + stats.queued > 0;
  const zip = () => downloadZip(done.map((i) => ({ name: i.result!.name, blob: i.result!.blob })), spec.zipName).then(() => toast('ZIP downloaded'));
  const setAllParams = (fn: (item: MItem<P>) => P | undefined) => items.forEach((i) => {
    const p = fn(i);
    if (p !== undefined) q.patch(i.id, { params: p });
  });

  return (
    <div className="tool-layout">
      <div className="stack">
        {items.length === 0 ? (
          <FileDrop accept={spec.kind === 'video' ? VIDEO_ACCEPT : AUDIO_ACCEPT} multiple onFiles={add} title={spec.dropTitle} hint="Select or drop several files to process them as a batch" />
        ) : (
          <>
            {sel && <Selected key={sel.id} item={sel} spec={spec} setParams={(p) => q.patch(sel.id, { params: p })} />}
            {spec.extra?.({ selected: sel, setAllParams })}
            {sel?.status === 'done' && sel.result && <ResultCard item={sel} preview={spec.preview} sizes={spec.sizes} log={logs.current.get(sel.id)} />}
            {sel?.status === 'error' && (
              <>
                <Alert kind="error">{sel.error}</Alert>
                {logs.current.get(sel.id)?.length ? <LogView lines={logs.current.get(sel.id)} /> : null}
              </>
            )}
            <div>
              <div className="list-head">
                <h3>
                  {done.length}/{items.length} done
                </h3>
                {stats.running > 0 && <span className="badge accent">{stats.running} running</span>}
                {stats.errors > 0 && <span className="badge bad">{stats.errors} failed</span>}
                <span className="spacer" />
                {stats.done > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={q.clearFinished} title="Remove finished files from the list">
                    <Trash2 size={14} /> Clear done
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => (q.clear(), setSelected(null))}>
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
                  <MediaRow
                    key={it.id}
                    item={it}
                    kind={spec.kind}
                    active={sel?.id === it.id}
                    sizes={spec.sizes}
                    onSelect={() => setSelected(it.id)}
                    onCancel={() => q.cancel(it.id)}
                    onRetry={() => q.retry(it.id)}
                    onRemove={() => q.remove(it.id)}
                  />
                ))}
              </div>
            </div>
            <FileDrop
              accept={spec.kind === 'video' ? VIDEO_ACCEPT : AUDIO_ACCEPT}
              multiple
              compact
              onFiles={add}
              title={busy ? 'Add more — they join the running batch' : 'Add more files'}
            />
            <div className="mobile-cta">
              {busy ? (
                <button className="btn btn-danger" onClick={q.stop}>
                  <Square size={14} /> Stop · {Math.round(stats.overall * 100)}%
                </button>
              ) : pending ? (
                <button className="btn btn-primary" onClick={q.start}>
                  <Play size={16} /> {spec.action} {pending > 1 ? `${pending} files` : ''}
                </button>
              ) : done.length ? (
                <button className="btn btn-primary" onClick={() => (done.length === 1 ? downloadBlob(done[0].result!.blob, done[0].result!.name) : zip())}>
                  <Download size={16} /> {done.length > 1 ? `Download all (${done.length})` : 'Download'}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>

      <aside className="card stack">
        {spec.settings}
        {spec.selectedInfo?.(sel)}
        <div className="divider" />
        {spec.fast && (
          <Field label="Engine" hint={engine === 'auto' ? (fastPathAvailable() ? 'Uses hardware encoding (WebCodecs) when possible, FFmpeg otherwise.' : 'This browser has no WebCodecs — FFmpeg will be used.') : 'Software encoding only — slower, but most compatible.'}>
            <Segmented
              block
              options={[
                { value: 'auto', label: <><Zap size={13} /> Fast (auto)</> },
                { value: 'ffmpeg', label: 'FFmpeg only' },
              ]}
              value={engine}
              onChange={setEngine}
            />
          </Field>
        )}
        <Field label="Files at once" hint="More = faster batches, but uses more memory. Use 1 for very large files.">
          <Segmented block options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} value={parallel} onChange={setParallel} />
        </Field>
        {busy ? (
          <button className="btn btn-lg btn-block btn-danger" onClick={q.stop}>
            <Square size={14} /> Stop ({stats.done}/{items.length - stats.canceled})
          </button>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" disabled={!pending} onClick={q.start}>
            <Play size={16} /> {spec.action} {pending > 1 ? `${pending} files` : pending === 1 ? '1 file' : ''}
          </button>
        )}
        {!busy && done.length > 0 && !pending && (
          <button className="btn btn-sm btn-block" onClick={() => (q.requeueAll(), q.start())}>
            <RefreshCw size={14} /> Run all again with current settings
          </button>
        )}
        <span className="field-hint">
          {busy ? 'Files you add now are processed automatically. Setting changes apply to files that haven’t started yet.' : 'Everything runs on your device — nothing is uploaded.'}
        </span>
      </aside>
    </div>
  );
}

function Selected<P>({ item, spec, setParams }: { item: MItem<P>; spec: ToolSpec<P>; setParams: (p: P) => void }) {
  const url = useObjectUrl(item.file);
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playable, setPlayable] = useState(true);
  const media: MediaHandle = {
    ref,
    time,
    playable,
    seek: (t) => {
      if (ref.current) ref.current.currentTime = t;
    },
    props: { ref, src: url, controls: true, playsInline: true, preload: 'metadata', onTimeUpdate: (e) => setTime(e.currentTarget.currentTime), onError: () => setPlayable(false) },
  };
  const ready = item.meta && (!spec.initParams || item.params !== undefined);
  const ep = ready ? ({ item, meta: item.meta!, params: item.params as P, setParams, media } satisfies EditorProps<P>) : null;

  return (
    <>
      {spec.kind === 'audio' ? (
        <div className="card" style={{ padding: 12 }}>
          <video {...media.props} style={{ width: '100%', height: 54, display: 'block' }} />
        </div>
      ) : (
        <div className="stage" style={{ background: '#000', padding: spec.stage ? 16 : 0 }}>
          {!playable ? (
            <div className="muted" style={{ padding: 40, textAlign: 'center' }}>
              This browser can’t preview this format, but it can still be processed.
            </div>
          ) : spec.stage && ep ? (
            spec.stage(ep)
          ) : (
            <video {...media.props} />
          )}
        </div>
      )}
      {ep && spec.editor?.(ep)}
    </>
  );
}

function MediaRow<P>({ item, kind, active, sizes, onSelect, onCancel, onRetry, onRemove }: { item: MItem<P>; kind: 'video' | 'audio'; active: boolean; sizes?: boolean; onSelect: () => void; onCancel: () => void; onRetry: () => void; onRemove: () => void }) {
  const m = item.meta;
  const r = item.result;
  const elapsed = item.startedAt ? (Date.now() - item.startedAt) / 1000 : 0;
  const eta = item.status === 'running' && item.progress > 0.03 ? (elapsed * (1 - item.progress)) / item.progress : null;
  const stop = (fn: () => void) => (e: React.MouseEvent) => (e.stopPropagation(), fn());

  return (
    <div className={cx('file-row', active && 'active')} onClick={onSelect}>
      <div className="file-thumb">{kind === 'video' ? <Film size={18} /> : <AudioLines size={18} />}</div>
      <div className="file-meta">
        <div className="file-name">{item.file.name}</div>
        <div className="file-sub">
          <span>{formatBytes(item.file.size)}</span>
          {m?.duration ? <span>· {formatTime(m.duration)}</span> : null}
          {m?.width ? (
            <span>
              · {m.width}×{m.height}
            </span>
          ) : null}
          {item.status === 'queued' && <span className="badge">Waiting</span>}
          {item.status === 'canceled' && <span className="badge">Canceled</span>}
          {item.status === 'error' && <span className="badge bad" title={item.error}>Failed</span>}
          {r && (
            <>
              {sizes ? (
                <span className={cx('badge', r.blob.size < item.file.size ? 'good' : 'warn')}>
                  <ArrowRight size={11} /> {formatBytes(r.blob.size)}
                  {` · ${r.blob.size < item.file.size ? '−' : '+'}${Math.abs(Math.round((1 - r.blob.size / item.file.size) * 100))}%`}
                </span>
              ) : (
                <span className="badge good">{formatBytes(r.blob.size)}</span>
              )}
              {r.engine === 'fast' ? (
                <span className="badge accent" title="Encoded with hardware acceleration (WebCodecs)">
                  <Zap size={10} /> Fast
                </span>
              ) : (
                <span className="badge">FFmpeg</span>
              )}
              {r.warn && <span className="badge warn">Check</span>}
            </>
          )}
        </div>
        {item.status === 'running' && (
          <div style={{ marginTop: 6 }}>
            <Progress value={item.progress > 0 ? item.progress : null} />
            <div className="file-sub" style={{ marginTop: 3 }}>
              <span>{item.stage ?? 'Starting…'}</span>
              {item.progress > 0 && <span className="mono">{Math.round(item.progress * 100)}%</span>}
              {eta != null && <span>· ~{formatTime(eta)} left</span>}
            </div>
          </div>
        )}
      </div>
      <div className="file-actions">
        {r && (
          <>
            <ShareButton blob={r.blob} name={r.name} />
            <button className="btn btn-sm btn-icon" title={`Download ${r.name}`} onClick={stop(() => downloadBlob(r.blob, r.name))}>
              <Download size={14} />
            </button>
          </>
        )}
        {(item.status === 'error' || item.status === 'canceled') && (
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

function ResultCard<P>({ item, preview, sizes, log }: { item: MItem<P>; preview: ToolSpec<P>['preview']; sizes?: boolean; log?: string[] }) {
  const r = item.result!;
  const url = useObjectUrl(r.blob);
  const [showLog, setShowLog] = useState(false);
  return (
    <div className="card stack">
      <div className="row">
        <b style={{ wordBreak: 'break-all' }}>{r.name}</b>
        <span className="spacer" />
        {sizes && (
          <span className={cx('badge', r.blob.size < item.file.size ? 'good' : 'warn')}>
            {formatBytes(item.file.size)} <ArrowRight size={11} /> {formatBytes(r.blob.size)}
          </span>
        )}
      </div>
      {r.note && <Alert kind={r.warn ? 'warn' : 'info'}>{r.note}</Alert>}
      {url && preview === 'video' && <video src={url} controls playsInline style={{ width: '100%', maxHeight: 360, borderRadius: 8, background: '#000' }} />}
      {url && preview === 'audio' && <audio src={url} controls style={{ width: '100%' }} />}
      {url && preview === 'image' && (
        <div className="stage checker" style={{ minHeight: 0 }}>
          <img src={url} alt="Result" />
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => downloadBlob(r.blob, r.name)}>
          <Download size={16} /> Download ({formatBytes(r.blob.size)})
        </button>
        <ShareButton blob={r.blob} name={r.name} label="Share / Save" />
        {r.engine === 'ffmpeg' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowLog((s) => !s)}>
            <ScrollText size={14} /> Log
          </button>
        )}
      </div>
      {showLog && <LogView lines={log} />}
    </div>
  );
}

function LogView({ lines }: { lines?: string[] }) {
  return <pre className="log">{lines?.slice(-150).join('\n') || 'No log output.'}</pre>;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** FFmpeg scale filter that limits the *short* side (so "720p" works for portrait clips too). */
function scaleFilter(meta: MediaInfo | null, short: number): string | null {
  if (!meta?.width || !meta.height) return short ? `scale=-2:'min(${short},ih)'` : null;
  const portrait = meta.height > meta.width;
  if (short && Math.min(meta.width, meta.height) > short) return portrait ? `scale=${short}:-2` : `scale=-2:${short}`;
  if (meta.width % 2 || meta.height % 2) return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return null;
}

const RESOLUTIONS = [
  { value: 0, label: 'Original' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
];

const fastContainerFor = (name: string): FastContainer => {
  const e = extOf(name);
  return e === 'mov' ? 'mov' : e === 'mkv' ? 'mkv' : e === 'webm' ? 'webm' : 'mp4';
};

/* ------------------------------------------------------------------ */
/* Compress video                                                      */
/* ------------------------------------------------------------------ */

const SIZE_PRESETS = [8, 10, 16, 25, 50, 100];
const MB = 1_000_000; // decimal MB keeps us under both "MB" and "MiB" style upload limits

/** Pick a sensible short-side resolution for a given video bitrate so low targets don't look blocky. */
function autoResolution(videoKbps: number) {
  if (videoKbps >= 2500) return 1080;
  if (videoKbps >= 1200) return 720;
  if (videoKbps >= 600) return 540;
  if (videoKbps >= 300) return 480;
  return 360;
}

interface TargetPlan {
  ok: boolean;
  videoKbps: number;
  audioKbps: number;
  short: number;
  reason?: string;
}

function planTarget(targetMB: number, duration: number, keepAudio: boolean, res: number, meta: MediaInfo | null, sourceBytes: number): TargetPlan {
  const budgetKbps = ((targetMB * MB * 8) / 1000 / duration) * 0.96; // ~4% container overhead
  const audioFor = (kbps: number) => (!keepAudio ? 0 : kbps > 1500 ? 128 : kbps > 500 ? 96 : kbps > 160 ? 64 : 32);
  if (budgetKbps - audioFor(budgetKbps) < 40) {
    const minMB = (((40 + audioFor(0)) * 1000 * duration) / 8 / MB / 0.96).toFixed(1);
    return { ok: false, videoKbps: 0, audioKbps: 0, short: 0, reason: `${targetMB} MB is too small for ${formatTime(duration)} of video. Try at least ~${minMB} MB${keepAudio ? ' or remove audio' : ''}.` };
  }
  // never spend more than the source already uses — a bigger budget can't add quality back
  const sourceKbps = (sourceBytes * 8) / 1000 / duration;
  const totalKbps = Math.min(budgetKbps, Math.max(sourceKbps, 80));
  const audioKbps = audioFor(totalKbps);
  const videoKbps = Math.max(40, Math.floor(totalKbps - audioKbps));
  const srcShort = meta?.width && meta.height ? Math.min(meta.width, meta.height) : Infinity;
  return { ok: true, videoKbps, audioKbps, short: Math.min(res || autoResolution(videoKbps), srcShort) };
}

const crfToLevel = (crf: number) => (crf <= 20 ? 'very-high' : crf <= 24 ? 'high' : crf <= 29 ? 'medium' : crf <= 34 ? 'low' : 'very-low') as 'very-high' | 'high' | 'medium' | 'low' | 'very-low';

const STD_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
/** snap a measured average frame rate (e.g. 29.83 from a phone's VFR clip) to the nearest standard rate */
const snapFps = (f: number) => STD_FPS.reduce((best, x) => (Math.abs(x - f) < Math.abs(best - f) ? x : best), STD_FPS[0]);

type FpsChoice = 'auto' | 'original' | 30 | 24;

/**
 * Output frame rate for "smooth playback": constant, never above the source, and capped at 30
 * when the bitrate budget is tight (fewer frames → more bits per frame → less stutter and blockiness).
 */
function outputFps(meta: MediaInfo, choice: FpsChoice, videoKbps?: number): number | undefined {
  const src = meta.fps && meta.fps > 1 ? snapFps(meta.fps) : undefined;
  const cap = choice === 'original' ? Infinity : choice === 'auto' ? (videoKbps && videoKbps < 1500 ? 30 : 60) : choice;
  if (!src) return Number.isFinite(cap) && cap <= 30 ? cap : undefined;
  return src > cap + 0.5 ? cap : src;
}

export function VideoCompress() {
  const [mode, setMode] = useState<'target' | 'quality'>('target');
  const [targetMB, setTargetMB] = useState<number | ''>(25);
  const [crf, setCrf] = useState(28);
  const [res, setRes] = useState(0);
  const [preset, setPreset] = useState('veryfast');
  const [keepAudio, setKeepAudio] = useState(true);
  const [smooth, setSmooth] = useState(true);
  const [fpsChoice, setFpsChoice] = useState<FpsChoice>('auto');

  const planFor = (item: MItem<unknown>, meta: MediaInfo) =>
    meta.duration && targetMB ? planTarget(Number(targetMB), meta.duration, keepAudio && meta.hasAudio !== false, res, meta, item.file.size) : null;

  /** FFmpeg flags that keep playback steady while a file streams (Discord, browsers, chat apps) */
  const smoothArgs = (meta: MediaInfo, fps: number | undefined, vf: string | null, kbps?: number) => {
    const filters = [vf, smooth && fps ? `fps=${fps}` : null].filter(Boolean).join(',');
    return [
      ...(filters ? ['-vf', filters] : []),
      ...(smooth
        ? [
            ...(fps ? [] : ['-vsync', 'cfr']),
            '-g', String(Math.round((fps ?? meta.fps ?? 30) * 2)),
            '-profile:v', 'high',
            ...(kbps ? ['-maxrate', `${Math.round(kbps * 1.1)}k`, '-bufsize', `${kbps}k`] : []),
          ]
        : kbps
          ? ['-maxrate', `${Math.round(kbps * 1.25)}k`, '-bufsize', `${kbps * 2}k`]
          : []),
    ];
  };

  return (
    <MediaBatchTool<unknown>
      kind="video"
      dropTitle="Drop videos to compress"
      action="Compress"
      preview="video"
      sizes
      fast
      zipName="compressed-videos.zip"
      process={async (item, ctx) => {
        const { meta } = ctx;
        const name = withExt(item.file.name, 'mp4', '-compressed');
        const common = ['-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

        if (mode === 'quality') {
          const vf = scaleFilter(meta, res);
          const fps = smooth ? outputFps(meta, fpsChoice) : undefined;
          const { blob, engine } = await ctx.run(
            () =>
              fastConvert({
                input: item.file,
                container: 'mp4',
                video: { short: res || undefined, level: crfToLevel(crf), ...(smooth ? { frameRate: fps, keyFrameInterval: 2 } : {}) },
                audio: keepAudio ? {} : { discard: true },
                signal: ctx.signal,
                onProgress: ctx.progress,
              }),
            () =>
              ctx.exec({
                args: (i) => ['-i', i, ...smoothArgs(meta, fps, vf), '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), ...common, ...(keepAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']), 'out.mp4'],
                output: 'out.mp4',
                mime: 'video/mp4',
                duration: meta.duration,
              }),
          );
          return { blob, name, engine };
        }

        // Target size: encode at a computed bitrate, then retry lower if it overshoots.
        if (!meta.duration) throw new Error('Couldn’t read the video length, so a target size can’t be calculated.');
        const plan = planFor(item as MItem<unknown>, meta)!;
        if (!plan.ok) throw new Error(plan.reason);
        const limit = Number(targetMB) * MB;
        const vf = scaleFilter(meta, plan.short);
        const fps = smooth ? outputFps(meta, fpsChoice, plan.videoKbps) : undefined;
        const audio = keepAudio ? ['-c:a', 'aac', '-b:a', `${plan.audioKbps}k`] : ['-an'];
        let kbps = plan.videoKbps;
        let blob: Blob | null = null;
        let engine: Engine = 'fast';
        let allowFast = true;
        const attempts: string[] = [];
        for (let pass = 1; pass <= 3; pass++) {
          const r = await ctx.run(
            allowFast
              ? () =>
                  fastConvert({
                    input: item.file,
                    container: 'mp4',
                    video: { short: plan.short, bitrate: kbps * 1000, ...(smooth ? { frameRate: fps, keyFrameInterval: 2, constant: true } : {}) },
                    audio: keepAudio ? { bitrate: plan.audioKbps * 1000, transcode: true } : { discard: true },
                    signal: ctx.signal,
                    onProgress: ctx.progress,
                  })
              : null,
            () =>
              ctx.exec({
                args: (i) => ['-i', i, ...smoothArgs(meta, fps, vf, kbps), '-c:v', 'libx264', '-preset', preset, '-b:v', `${kbps}k`, ...common, ...audio, 'out.mp4'],
                output: 'out.mp4',
                mime: 'video/mp4',
                duration: meta.duration,
              }),
          );
          blob = r.blob;
          engine = r.engine;
          allowFast = r.engine === 'fast';
          attempts.push(`${kbps} kbps → ${formatBytes(blob.size)}`);
          if (blob.size <= limit) break;
          if (pass < 3) ctx.stage(`${formatBytes(blob.size)} is over ${targetMB} MB — retrying lower…`);
          kbps = Math.max(30, Math.floor(kbps * (limit / blob.size) * 0.92));
        }
        const fits = blob!.size <= limit;
        const fpsNote = fps ? ` · constant ${fps} fps` : '';
        return {
          blob: blob!,
          name,
          engine,
          warn: !fits,
          note: fits
            ? `Fits under ${targetMB} MB${fpsNote}${attempts.length > 1 ? ` · ${attempts.length} passes (${attempts.join(', ')})` : ''}.`
            : `Couldn’t get under ${targetMB} MB after 3 tries (${attempts.join(', ')}). Try a lower resolution or remove audio.`,
        };
      }}
      selectedInfo={(sel) => {
        if (mode !== 'target' || !sel?.meta) return null;
        const plan = planFor(sel as MItem<unknown>, sel.meta);
        if (!plan) return <Alert kind="warn">Couldn’t read this video’s length yet.</Alert>;
        if (!plan.ok) return <Alert kind="error">{plan.reason}</Alert>;
        const fps = smooth ? outputFps(sel.meta, fpsChoice, plan.videoKbps) : undefined;
        return (
          <div className="stack" style={{ gap: 6 }}>
            <span className="field-hint">For the selected file:</span>
            <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="stat">
                <b>{plan.videoKbps >= 1000 ? `${(plan.videoKbps / 1000).toFixed(1)}M` : `${plan.videoKbps}k`}</b>
                <span>bitrate</span>
              </div>
              <div className="stat">
                <b>{plan.short}p</b>
                <span>{res ? 'size' : 'auto size'}</span>
              </div>
              <div className="stat">
                <b>{fps ? Math.round(fps) : sel.meta.fps ? Math.round(sel.meta.fps) : '—'}</b>
                <span>fps</span>
              </div>
            </div>
            {sel.file.size <= Number(targetMB) * MB && <span className="field-hint">Already under {targetMB} MB — may still shrink.</span>}
          </div>
        );
      }}
      settings={
        <>
          <Field label="Mode">
            <Segmented
              block
              options={[
                { value: 'target', label: <><Target size={13} /> Target size</> },
                { value: 'quality', label: <><Gauge size={13} /> Quality</> },
              ]}
              value={mode}
              onChange={setMode}
            />
          </Field>
          {mode === 'target' ? (
            <Field label="Max file size (each file)" hint="Quality is lowered automatically until each video fits.">
              <NumberInput value={targetMB} onChange={setTargetMB} min={0.1} step={0.1} suffix="MB" />
              <div className="row" style={{ gap: 6 }}>
                {SIZE_PRESETS.map((mb) => (
                  <button key={mb} className={cx('chip', targetMB === mb && 'on')} style={{ height: 28 }} onClick={() => setTargetMB(mb)}>
                    {mb} MB
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            <Field label="Quality (CRF)" value={crf} hint="Lower = better quality & bigger file. 28 is a good balance.">
              <Slider min={18} max={40} value={crf} onChange={setCrf} />
              <div className="row muted" style={{ fontSize: 11.5, justifyContent: 'space-between' }}>
                <span>Best quality</span>
                <span>Smallest file</span>
              </div>
            </Field>
          )}
          <Field label="Resolution (max)">
            <Segmented block options={mode === 'target' ? [{ value: 0, label: 'Auto' }, ...RESOLUTIONS.slice(1)] : RESOLUTIONS} value={res} onChange={setRes} />
          </Field>
          <Switch checked={smooth} onChange={setSmooth} label="Smooth playback (Discord-friendly)" />
          {smooth && (
            <>
              <span className="field-hint">Constant frame rate, steady bitrate and a keyframe every 2 s — avoids stutter when the video streams in Discord, LINE, browsers and chat apps.</span>
              <Field label="Frame rate">
                <Segmented
                  block
                  options={[
                    { value: 'auto', label: 'Auto', title: 'Keep the source rate; drop to 30 fps when the bitrate is low' },
                    { value: 'original', label: 'Original' },
                    { value: 30, label: '30' },
                    { value: 24, label: '24' },
                  ]}
                  value={fpsChoice}
                  onChange={setFpsChoice}
                />
              </Field>
            </>
          )}
          <Field label="FFmpeg speed" hint="Only used when hardware encoding isn’t available.">
            <Segmented
              block
              options={[
                { value: 'ultrafast', label: 'Fastest' },
                { value: 'veryfast', label: 'Balanced' },
                { value: 'medium', label: 'Smaller' },
              ]}
              value={preset}
              onChange={setPreset}
            />
          </Field>
          <Switch checked={keepAudio} onChange={setKeepAudio} label="Keep audio" />
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Convert video                                                       */
/* ------------------------------------------------------------------ */

const VIDEO_TARGETS: Record<string, { label: string; mime: string; args: string[]; fast?: FastContainer }> = {
  mp4: { label: 'MP4', mime: 'video/mp4', fast: 'mp4', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] },
  webm: { label: 'WebM', mime: 'video/webm', fast: 'webm', args: ['-c:v', 'libvpx', '-b:v', '0', '-crf', '10', '-qmin', '4', '-qmax', '42', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '128k'] },
  mov: { label: 'MOV', mime: 'video/quicktime', fast: 'mov', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k'] },
  mkv: { label: 'MKV', mime: 'video/x-matroska', fast: 'mkv', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k'] },
  avi: { label: 'AVI', mime: 'video/x-msvideo', args: ['-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame', '-b:a', '192k'] },
};

export function VideoConvert() {
  const [target, setTarget] = useState('mp4');
  const [res, setRes] = useState(0);
  const t = VIDEO_TARGETS[target];

  return (
    <MediaBatchTool<unknown>
      kind="video"
      dropTitle="Drop videos to convert"
      action={`Convert to ${t.label}:`}
      preview={target === 'mkv' || target === 'avi' ? 'none' : 'video'}
      sizes
      fast
      zipName="converted-videos.zip"
      process={async (item, ctx) => {
        const out = `out.${target}`;
        const vf = scaleFilter(ctx.meta, res);
        const { blob, engine } = await ctx.run(
          t.fast ? () => fastConvert({ input: item.file, container: t.fast!, video: res ? { short: res, transcode: true } : {}, signal: ctx.signal, onProgress: ctx.progress }) : null,
          async () => {
            // try an instant stream copy first; re-encode if the codecs don't fit the container
            if (!res) {
              try {
                ctx.stage('Remuxing (no re-encode)…');
                return await ctx.exec({ args: (i) => ['-i', i, '-c', 'copy', out], output: out, mime: t.mime, duration: ctx.meta.duration });
              } catch (e) {
                if (isAbort(e)) throw e;
                ctx.stage('Re-encoding with FFmpeg…');
              }
            }
            return ctx.exec({ args: (i) => ['-i', i, ...(vf ? ['-vf', vf] : []), ...t.args, out], output: out, mime: t.mime, duration: ctx.meta.duration });
          },
        );
        return { blob, engine, name: withExt(item.file.name, target) };
      }}
      settings={
        <>
          <Field label="Convert to">
            <Segmented block options={Object.entries(VIDEO_TARGETS).map(([k, v]) => ({ value: k, label: v.label }))} value={target} onChange={setTarget} />
          </Field>
          <Field label="Resolution (max)">
            <Segmented block options={RESOLUTIONS} value={res} onChange={setRes} />
          </Field>
          <span className="field-hint">Streams that already fit the target format are copied instantly without re-encoding.</span>
          {target === 'avi' && <Alert>AVI always uses FFmpeg (slower).</Alert>}
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Timeline + range editing (trim / GIF)                               */
/* ------------------------------------------------------------------ */

interface Range {
  start: number;
  end: number;
}

function RangeEditor({ meta, params, setParams, media }: EditorProps<Range>) {
  const d = meta.duration;
  const { start: s, end: e } = params;
  const [playing, setPlaying] = useState(false);
  const set = (a: number, b: number) => setParams({ start: a, end: b });

  // stop preview playback at the end of the selection
  useEffect(() => {
    const v = media.ref.current;
    if (playing && v && media.time >= e) {
      v.pause();
      setPlaying(false);
    }
  }, [media.time, playing, e, media.ref]);

  if (!d) return <Alert kind="warn">Couldn’t read this file’s length.</Alert>;
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <Timeline duration={d} start={s} end={e} current={media.time} onChange={(a, b) => (set(a, b), media.seek(a === s ? b : a))} onSeek={media.seek} />
      <div className="row">
        <div style={{ width: 120 }}>
          <Field label="Start">
            <TimeInput value={s} onCommit={(v) => set(clamp(v, 0, e - 0.1), e)} />
          </Field>
        </div>
        <div style={{ width: 120 }}>
          <Field label="End">
            <TimeInput value={e} onCommit={(v) => set(s, clamp(v, s + 0.1, d))} />
          </Field>
        </div>
        <span className="spacer" />
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          <button className="btn btn-sm" onClick={() => set(clamp(media.time, 0, e - 0.1), e)} title="Set start to playhead">
            [ Start here
          </button>
          <button className="btn btn-sm" onClick={() => set(s, clamp(media.time, s + 0.1, d))} title="Set end to playhead">
            End here ]
          </button>
          <button
            className="btn btn-sm"
            disabled={!media.playable}
            onClick={() => {
              const v = media.ref.current;
              if (!v) return;
              if (playing) {
                v.pause();
                setPlaying(false);
              } else {
                v.currentTime = s;
                v.play();
                setPlaying(true);
              }
            }}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />} Preview
          </button>
        </div>
      </div>
      <span className="field-hint">
        Selection: <b className="mono">{formatTime(e - s)}</b> — each file keeps its own range; click a file in the list to edit it.
      </span>
    </div>
  );
}

function ApplyToAll<P>({ label, selected, setAllParams, map }: { label: string; selected?: MItem<P>; setAllParams: (fn: (i: MItem<P>) => P | undefined) => void; map: (src: P, srcMeta: MediaInfo, target: MItem<P>) => P | undefined }) {
  if (!selected?.params || !selected.meta) return null;
  return (
    <div className="row">
      <button className="btn btn-sm" onClick={() => setAllParams((t) => (t.id === selected.id || !t.meta ? undefined : map(selected.params as P, selected.meta!, t)))}>
        <Copy size={14} /> {label}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trim                                                                */
/* ------------------------------------------------------------------ */

export function VideoTrim() {
  const [precise, setPrecise] = useState(false);
  return (
    <MediaBatchTool<Range>
      kind="video"
      dropTitle="Drop videos to trim"
      action="Trim"
      preview="video"
      fast
      zipName="trimmed-videos.zip"
      initParams={(m) => ({ start: 0, end: m.duration })}
      editor={(p) => <RangeEditor {...p} />}
      extra={({ selected, setAllParams }) => (
        <ApplyToAll label="Use this range for all files" selected={selected} setAllParams={setAllParams} map={(src, _m, t) => ({ start: Math.min(src.start, t.meta!.duration - 0.1), end: Math.min(src.end, t.meta!.duration) })} />
      )}
      process={async (item, ctx) => {
        const { start: s, end: e } = item.params ?? { start: 0, end: ctx.meta.duration };
        const container = fastContainerFor(item.file.name);
        const keepExt = extOf(item.file.name) || 'mp4';
        const { blob, engine } = await ctx.run(
          () => fastConvert({ input: item.file, container, trim: { start: s, end: e }, video: { transcode: precise }, audio: { transcode: precise }, signal: ctx.signal, onProgress: ctx.progress }),
          () =>
            ctx.exec({
              args: (i) =>
                precise
                  ? ['-ss', s.toFixed(3), '-to', e.toFixed(3), '-i', i, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'out.' + (precise ? 'mp4' : keepExt)]
                  : ['-ss', s.toFixed(3), '-to', e.toFixed(3), '-i', i, '-c', 'copy', '-avoid_negative_ts', 'make_zero', 'out.' + keepExt],
              output: 'out.' + (precise ? 'mp4' : keepExt),
              mime: precise ? 'video/mp4' : item.file.type || 'video/mp4',
              duration: e - s,
            }),
        );
        const ext = engine === 'fast' ? container : precise ? 'mp4' : keepExt;
        return { blob, engine, name: withExt(item.file.name, ext, '-trimmed') };
      }}
      settings={
        <>
          <Field label="Cut mode">
            <Segmented
              block
              options={[
                { value: 'fast', label: 'Fast (copy)' },
                { value: 'precise', label: 'Frame-accurate' },
              ]}
              value={precise ? 'precise' : 'fast'}
              onChange={(v) => setPrecise(v === 'precise')}
            />
          </Field>
          <span className="field-hint">
            {precise ? 'Re-encodes so the cut lands exactly where you set it.' : 'Instant and lossless, but the start snaps to the nearest keyframe (may be off by a second or two).'}
          </span>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Crop                                                                */
/* ------------------------------------------------------------------ */

export function VideoCrop() {
  const [aspect, setAspect] = useState<number | null>(9 / 16);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  return (
    <MediaBatchTool<Rect>
      kind="video"
      dropTitle="Drop videos to crop"
      action="Crop"
      preview="video"
      fast
      zipName="cropped-videos.zip"
      initParams={(m) => centeredRect(m.width || 2, m.height || 2, aspectRef.current, 1)}
      stage={({ meta, params, setParams, media }) =>
        meta.width ? (
          <div className="media-wrap">
            <video {...media.props} controls={false} muted onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())} />
            <CropBox width={meta.width} height={meta.height} rect={params} aspect={aspect} onChange={setParams} />
          </div>
        ) : (
          <div className="muted" style={{ padding: 40 }}>
            Can’t read the frame size of this file.
          </div>
        )
      }
      editor={({ meta, params, setParams }) => (
        <div className="row">
          <span className="mono muted" style={{ fontSize: 12 }}>
            {even(params.w)}×{even(params.h)} at ({even(params.x)}, {even(params.y)})
          </span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setParams(centeredRect(meta.width, meta.height, aspect, 1))}>
            <RotateCcw size={14} /> Re-center
          </button>
        </div>
      )}
      extra={({ selected, setAllParams }) => (
        <>
        <AspectSync aspect={aspect} setAllParams={setAllParams} />
        <ApplyToAll
          label="Apply this crop to all files"
          selected={selected}
          setAllParams={setAllParams}
          map={(src, m, t) => {
            const tm = t.meta!;
            if (!tm.width) return undefined;
            const sx = tm.width / m.width;
            const sy = tm.height / m.height;
            return { x: Math.round(src.x * sx), y: Math.round(src.y * sy), w: Math.round(src.w * sx), h: Math.round(src.h * sy) };
          }}
        />
        </>
      )}
      process={async (item, ctx) => {
        const r = item.params ?? centeredRect(ctx.meta.width, ctx.meta.height, aspect, 1);
        const c = { w: even(r.w), h: even(r.h), x: even(r.x), y: even(r.y) };
        const { blob, engine } = await ctx.run(
          () => fastConvert({ input: item.file, container: 'mp4', video: { crop: { left: c.x, top: c.y, width: c.w, height: c.h }, level: 'high' }, signal: ctx.signal, onProgress: ctx.progress }),
          () =>
            ctx.exec({
              args: (i) => ['-i', i, '-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'out.mp4'],
              output: 'out.mp4',
              mime: 'video/mp4',
              duration: ctx.meta.duration,
            }),
        );
        return { blob, engine, name: withExt(item.file.name, 'mp4', '-cropped') };
      }}
      settings={
        <>
          <Field label="Aspect ratio" hint="Changing this re-centres the crop on every file.">
            <Segmented options={ASPECTS.map((a) => ({ value: a.label, label: a.label }))} value={ASPECTS.find((a) => a.value === aspect)?.label ?? 'Free'} onChange={(l) => setAspect(ASPECTS.find((x) => x.label === l)!.value)} />
          </Field>
          <span className="field-hint">Drag the box to move it, drag the handles to resize. Tap the video to play/pause. Each file keeps its own crop.</span>
        </>
      }
    />
  );
}

/** re-centre every file's crop when the aspect preset changes */
function AspectSync({ aspect, setAllParams }: { aspect: number | null; setAllParams: (fn: (i: MItem<Rect>) => Rect | undefined) => void }) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    setAllParams((t) => (t.meta?.width ? centeredRect(t.meta.width, t.meta.height, aspect, 1) : undefined));
  }, [aspect]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/* ------------------------------------------------------------------ */
/* Video → GIF                                                         */
/* ------------------------------------------------------------------ */

export function VideoToGif() {
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);
  const [dither, setDither] = useState(true);

  return (
    <MediaBatchTool<Range>
      kind="video"
      dropTitle="Drop videos to make GIFs"
      action="Create GIF:"
      preview="image"
      zipName="gifs.zip"
      initParams={(m) => ({ start: 0, end: Math.min(m.duration, 5) })}
      editor={(p) => <RangeEditor {...p} />}
      process={async (item, ctx) => {
        const { start: s, end: e } = item.params ?? { start: 0, end: Math.min(ctx.meta.duration, 5) };
        const len = e - s;
        const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=${dither ? 'bayer:bayer_scale=4' : 'none'}:diff_mode=rectangle`;
        const { blob, engine } = await ctx.run(null, () =>
          ctx.exec({ args: (i) => ['-ss', s.toFixed(3), '-t', len.toFixed(3), '-i', i, '-filter_complex', filter, '-loop', '0', 'out.gif'], output: 'out.gif', mime: 'image/gif', duration: len }),
        );
        return { blob, engine, name: withExt(item.file.name, 'gif') };
      }}
      selectedInfo={(sel) => {
        const r = sel?.params as Range | undefined;
        if (!r) return null;
        const len = r.end - r.start;
        return (
          <>
            <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="stat">
                <b>{formatTime(len)}</b>
                <span>length</span>
              </div>
              <div className="stat">
                <b>{Math.round(len * fps)}</b>
                <span>frames</span>
              </div>
            </div>
            {len > 15 && <Alert kind="warn">Long GIFs get huge. Keep it under ~10 s or lower fps/width.</Alert>}
          </>
        );
      }}
      settings={
        <>
          <Field label="Frame rate" value={`${fps} fps`}>
            <Slider min={5} max={30} value={fps} onChange={setFps} />
          </Field>
          <Field label="Width" value={`${width}px`}>
            <Slider min={160} max={960} step={20} value={width} onChange={setWidth} />
          </Field>
          <Switch checked={dither} onChange={setDither} label="Dithering (smoother gradients)" />
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

const AUDIO_TARGETS: Record<string, { label: string; mime: string; codec: string[]; lossless?: boolean }> = {
  same: { label: 'Original', mime: '', codec: ['-c:a', 'copy'], lossless: true },
  mp3: { label: 'MP3', mime: 'audio/mpeg', codec: ['-c:a', 'libmp3lame'] },
  m4a: { label: 'M4A', mime: 'audio/mp4', codec: ['-c:a', 'aac'] },
  ogg: { label: 'OGG', mime: 'audio/ogg', codec: ['-c:a', 'libvorbis'] },
  opus: { label: 'Opus', mime: 'audio/ogg', codec: ['-c:a', 'libopus'] },
  wav: { label: 'WAV', mime: 'audio/wav', codec: ['-c:a', 'pcm_s16le'], lossless: true },
  flac: { label: 'FLAC', mime: 'audio/flac', codec: ['-c:a', 'flac'], lossless: true },
};

function AudioTool({ source, trimFirst }: { source: 'video' | 'audio'; trimFirst?: boolean }) {
  const [target, setTarget] = useState(trimFirst ? 'same' : 'mp3');
  const [bitrate, setBitrate] = useState(192);
  const [rate, setRate] = useState(0);
  const [mono, setMono] = useState(false);
  const t = AUDIO_TARGETS[target];
  // "Original" stream-copies the audio, which only makes sense for audio files (a video's track has no file type of its own)
  const formats = Object.entries(AUDIO_TARGETS).filter(([k]) => k !== 'same' || source === 'audio');

  return (
    <MediaBatchTool<Range>
      kind={source}
      dropTitle={source === 'video' ? 'Drop videos to extract audio' : trimFirst ? 'Drop audio files to trim' : 'Drop audio files'}
      action={source === 'video' ? 'Extract' : trimFirst ? 'Trim' : 'Convert'}
      preview="audio"
      sizes={source === 'audio'}
      zipName={source === 'video' ? 'extracted-audio.zip' : 'audio.zip'}
      initParams={(m) => ({ start: 0, end: m.duration })}
      editor={(p) => <RangeEditor {...p} />}
      extra={({ selected, setAllParams }) => (
        <ApplyToAll label="Use this range for all files" selected={selected} setAllParams={setAllParams} map={(src, _m, x) => ({ start: Math.min(src.start, x.meta!.duration - 0.1), end: Math.min(src.end, x.meta!.duration) })} />
      )}
      process={async (item, ctx) => {
        const d = ctx.meta.duration;
        const { start: s, end: e } = item.params ?? { start: 0, end: d };
        const trimmed = s > 0.05 || (d > 0 && e < d - 0.05);
        const ext = target === 'same' ? extOf(item.file.name) || 'm4a' : target;
        const out = `out.${ext}`;
        const { blob, engine } = await ctx.run(null, () =>
          ctx.exec({
            args: (i) => [
              ...(trimmed ? ['-ss', s.toFixed(3), '-to', e.toFixed(3)] : []),
              '-i', i, '-vn', ...t.codec,
              ...(t.lossless ? [] : ['-b:a', `${bitrate}k`]),
              ...(rate && target !== 'same' ? ['-ar', String(rate)] : []),
              ...(mono && target !== 'same' ? ['-ac', '1'] : []),
              out,
            ],
            output: out,
            mime: t.mime || item.file.type || 'audio/mpeg',
            duration: trimmed ? e - s : d,
          }),
        );
        return { blob, engine, name: withExt(item.file.name, ext, trimmed ? '-cut' : '') };
      }}
      settings={
        <>
          <Field label="Output format">
            <Segmented block options={formats.map(([k, v]) => ({ value: k, label: v.label }))} value={target} onChange={setTarget} />
          </Field>
          {target === 'same' ? (
            <span className="field-hint">Keeps the original format and quality — the cut is lossless and instant.</span>
          ) : t.lossless ? (
            <span className="field-hint">{t.label} is lossless — no bitrate needed. Files will be large.</span>
          ) : (
            <Field label="Bitrate" value={`${bitrate} kbps`}>
              <Segmented block options={[64, 128, 192, 256, 320].map((b) => ({ value: b, label: String(b) }))} value={bitrate} onChange={setBitrate} />
            </Field>
          )}
          {target !== 'same' && (
            <>
              <Field label="Sample rate">
                <select className="select" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  <option value={0}>Keep original</option>
                  <option value={48000}>48 kHz</option>
                  <option value={44100}>44.1 kHz</option>
                  <option value={22050}>22.05 kHz</option>
                  <option value={16000}>16 kHz (speech)</option>
                </select>
              </Field>
              <Switch checked={mono} onChange={setMono} label="Mix down to mono" />
            </>
          )}
          <span className="field-hint">Drag the timeline handles to keep only part of each file — leave it full length to keep everything.</span>
        </>
      }
    />
  );
}

export const ExtractAudio = () => <AudioTool source="video" />;
export const AudioConvert = () => <AudioTool source="audio" />;
export const AudioTrim = () => <AudioTool source="audio" trimFirst />;
