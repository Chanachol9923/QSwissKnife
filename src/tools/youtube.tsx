import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clipboard, Download, ExternalLink, Loader2, Play, RefreshCw, Scissors, Square, X } from 'lucide-react';
import { Alert, Field, Progress, Segmented, ShareButton, Slider, Switch, useToast } from '../components/ui';
import { TimeInput, Timeline } from '../components/Timeline';
import { usePersistent } from '../components/hooks';
import { usePublishTasks, type TaskInfo } from '../components/tasks';
import { clamp, cx, downloadBlob, formatBytes, formatTime, uid } from '../lib/utils';

/* Talks to the local helper in server/ytHelper.ts (mounted by the Vite dev/preview server). */

type Format = 'mp4' | 'mov' | 'mp3' | 'gif';

interface Health {
  ok: boolean;
  ytdlp: string | null;
  ffmpeg: string | null;
}

interface Info {
  id: string;
  title: string;
  uploader?: string;
  duration: number;
  thumbnail?: string;
  isLive: boolean;
  heights: number[];
  url: string;
}

interface Dl {
  key: string;
  jobId?: string;
  title: string;
  thumbnail?: string;
  label: string;
  status: 'starting' | 'downloading' | 'processing' | 'fetching' | 'done' | 'error' | 'canceled';
  progress: number | null;
  detail: string;
  bytes: number;
  name?: string;
  blob?: Blob;
  error?: string;
}

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(`/api/yt${path}`, init);
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('json')) throw new Error('helper-missing');
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
};

const FORMATS: { value: Format; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'mp3', label: 'MP3' },
  { value: 'gif', label: 'GIF' },
];

const looksLikeYouTube = (s: string) => /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(s.trim());

export function YouTubeDownloader() {
  const [health, setHealth] = useState<Health | 'checking' | 'missing'>('checking');
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [format, setFormat] = usePersistent<Format>('sk-yt-format', 'mp4');
  const [quality, setQuality] = usePersistent('sk-yt-quality', 1080);
  const [audioKbps, setAudioKbps] = usePersistent('sk-yt-mp3', 192);
  const [gifFps, setGifFps] = useState(12);
  const [gifWidth, setGifWidth] = useState(480);
  const [partial, setPartial] = useState(false);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [preview, setPreview] = useState(false);
  const [autoSave, setAutoSave] = usePersistent('sk-yt-autosave', true);
  const [dls, setDls] = useState<Dl[]>([]);
  const toast = useToast();
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;

  const checkHealth = () => {
    setHealth('checking');
    api<Health>('/health').then(setHealth, () => setHealth('missing'));
  };
  useEffect(checkHealth, []);

  const ready = typeof health === 'object' && !!health.ytdlp && !!health.ffmpeg;
  const gif = format === 'gif';
  const useRange = partial || gif;
  const len = range.end - range.start;

  const load = async (link = url) => {
    if (!link.trim()) return;
    setLoading(true);
    setError('');
    setInfo(null);
    setPreview(false);
    try {
      const i = await api<Omit<Info, 'url'>>(`/info?url=${encodeURIComponent(link.trim())}`);
      if (i.isLive) throw new Error('Live streams can’t be downloaded here.');
      setInfo({ ...i, url: link.trim() });
      setRange({ start: 0, end: Math.min(i.duration || 0, 10) });
      setPartial(false);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg === 'helper-missing' ? 'The local helper isn’t responding.' : msg);
    } finally {
      setLoading(false);
    }
  };

  const patch = (key: string, p: Partial<Dl>) => setDls((prev) => prev.map((d) => (d.key === key ? { ...d, ...p } : d)));

  // poll active jobs
  useEffect(() => {
    const active = dls.filter((d) => d.jobId && (d.status === 'downloading' || d.status === 'processing'));
    if (!active.length) return;
    const t = setTimeout(async () => {
      for (const d of active) {
        try {
          const j = await api<{ status: Dl['status']; progress: number | null; detail: string; bytes: number; name?: string; error?: string }>(`/jobs/${d.jobId}`);
          if (j.status === 'done') {
            patch(d.key, { status: 'fetching', detail: 'Transferring to browser…', progress: null, name: j.name });
            const r = await fetch(`/api/yt/jobs/${d.jobId}/file`);
            if (!r.ok) throw new Error('Could not fetch the finished file');
            const blob = await r.blob();
            patch(d.key, { status: 'done', blob, progress: 1, detail: 'Done' });
            fetch(`/api/yt/jobs/${d.jobId}`, { method: 'DELETE' }).catch(() => {}); // free the helper's temp files
            if (autoSaveRef.current) downloadBlob(blob, j.name ?? 'download');
            toast(`Downloaded ${j.name}`);
          } else if (j.status === 'error') {
            patch(d.key, { status: 'error', error: j.error, detail: 'Failed' });
          } else {
            patch(d.key, { status: j.status, progress: j.progress, detail: j.detail, bytes: j.bytes });
          }
        } catch (e) {
          patch(d.key, { status: 'error', error: (e as Error).message });
        }
      }
    }, 800);
    return () => clearTimeout(t);
  }, [dls]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!info) return;
    const key = uid();
    const q = format === 'mp4' || format === 'mov' ? quality : 0;
    const label = [
      format.toUpperCase(),
      format === 'mp3' ? `${audioKbps} kbps` : format === 'gif' ? `${gifWidth}px · ${gifFps} fps` : q ? `${q}p` : 'best',
      useRange ? `${formatTime(range.start)}–${formatTime(range.end)}` : 'full',
    ].join(' · ');
    setDls((prev) => [{ key, title: info.title, thumbnail: info.thumbnail, label, status: 'starting', progress: null, detail: 'Starting…', bytes: 0 }, ...prev]);
    try {
      const j = await api<{ id: string }>('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: info.url,
          title: info.title,
          format,
          quality: q,
          duration: info.duration,
          audioKbps,
          gifFps,
          gifWidth,
          ...(useRange ? { start: range.start, end: range.end } : {}),
        }),
      });
      patch(key, { jobId: j.id, status: 'downloading' });
    } catch (e) {
      patch(key, { status: 'error', error: (e as Error).message });
    }
  };

  const cancel = (d: Dl) => {
    if (d.jobId) fetch(`/api/yt/jobs/${d.jobId}`, { method: 'DELETE' }).catch(() => {});
    patch(d.key, { status: 'canceled', detail: 'Canceled', progress: null });
  };

  // Publish downloads to the app-wide Running tasks view.
  const tasks = useMemo<TaskInfo[]>(
    () =>
      dls.map((d) => {
        const busy = d.status === 'starting' || d.status === 'downloading' || d.status === 'processing' || d.status === 'fetching';
        return {
          id: d.key,
          name: d.name ?? `${d.title} · ${d.label}`,
          status: busy ? 'running' : d.status === 'done' ? 'done' : d.status === 'error' ? 'error' : 'canceled',
          progress: d.status === 'done' ? 1 : d.progress,
          stage: d.detail + (d.bytes > 0 && d.status === 'downloading' ? ` · ${formatBytes(d.bytes)}` : ''),
          error: d.error,
          result: d.blob ? { blob: d.blob, name: d.name ?? 'download' } : undefined,
          cancel: busy ? () => cancel(d) : undefined,
        };
      }),
    [dls], // eslint-disable-line react-hooks/exhaustive-deps
  );
  usePublishTasks(tasks, () => setDls((p) => p.filter((d) => !['done', 'error', 'canceled'].includes(d.status))));

  /* ---------- helper not available ---------- */
  if (health === 'checking') {
    return (
      <div className="empty">
        <Loader2 className="spin" />
      </div>
    );
  }
  if (!ready) {
    const h = typeof health === 'object' ? health : null;
    return (
      <div className="card stack" style={{ maxWidth: 720 }}>
        <div className="card-title">Local helper needed</div>
        <p className="muted" style={{ margin: 0 }}>
          Browsers can’t download from YouTube directly, so this tool uses a small helper that runs on your computer with{' '}
          <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">yt-dlp</a> and FFmpeg.
        </p>
        {health === 'missing' ? (
          <Alert kind="warn">
            The helper isn’t running. It starts automatically with <code className="mono">npm run dev</code> (or <code className="mono">npm run preview</code>) in the QSwiftKnife folder —
            a static build hosted elsewhere doesn’t include it.
          </Alert>
        ) : (
          <>
            <Status ok={!!h?.ytdlp} label="yt-dlp" version={h?.ytdlp} install="winget install yt-dlp.yt-dlp   (macOS: brew install yt-dlp)" />
            <Status ok={!!h?.ffmpeg} label="FFmpeg" version={h?.ffmpeg} install="winget install Gyan.FFmpeg   (macOS: brew install ffmpeg)" />
            <span className="field-hint">After installing, restart the dev server so it picks up the new PATH. You can also point to the binaries with YTDLP_PATH / FFMPEG_PATH.</span>
          </>
        )}
        <button className="btn" onClick={checkHealth} style={{ alignSelf: 'flex-start' }}>
          <RefreshCw size={14} /> Check again
        </button>
      </div>
    );
  }

  /* ---------- main UI ---------- */
  const heights = info ? [...new Set([2160, 1440, 1080, 720, 480, 360].filter((h) => info.heights.some((x) => x >= h)))] : [1080, 720, 480];
  const effQuality = quality && !heights.includes(quality) ? heights.find((h) => h <= quality) ?? 0 : quality;

  return (
    <div className="tool-layout">
      <div className="stack">
        <div className="card stack" style={{ gap: 10 }}>
          <Field label="YouTube link">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                className="input"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…  or  https://youtu.be/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  const t = e.clipboardData.getData('text');
                  if (looksLikeYouTube(t)) setTimeout(() => load(t), 0);
                }}
                onKeyDown={(e) => e.key === 'Enter' && load()}
              />
              {navigator.clipboard?.readText && (
                <button
                  className="btn btn-icon"
                  title="Paste from clipboard"
                  onClick={async () => {
                    try {
                      const t = await navigator.clipboard.readText();
                      setUrl(t);
                      load(t);
                    } catch {
                      /* permission denied — user can paste manually */
                    }
                  }}
                >
                  <Clipboard size={16} />
                </button>
              )}
              <button className="btn btn-primary" onClick={() => load()} disabled={loading || !url.trim()}>
                {loading ? <Loader2 size={16} className="spin" /> : 'Fetch'}
              </button>
            </div>
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
        </div>

        {info && (
          <div className="card stack">
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              {info.thumbnail && <img src={info.thumbnail} alt="" style={{ width: 160, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />}
              <div style={{ minWidth: 0 }}>
                <b style={{ display: 'block', lineHeight: 1.35 }}>{info.title}</b>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {info.uploader} · {formatTime(info.duration)}
                </div>
                <a className="muted" style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 6 }} href={info.url} target="_blank" rel="noreferrer">
                  Open on YouTube <ExternalLink size={12} />
                </a>
              </div>
            </div>

            {gif ? (
              <span className="field-hint">GIFs always use a range — pick a short moment (under ~10 s looks best).</span>
            ) : (
              <Switch checked={partial} onChange={setPartial} label={<><Scissors size={14} /> Only download part of the video</>} />
            )}

            {useRange && info.duration > 0 && (
              <div className="stack" style={{ gap: 10 }}>
                <Timeline
                  duration={info.duration}
                  start={range.start}
                  end={range.end}
                  current={range.start}
                  onChange={(s, e) => setRange({ start: s, end: e })}
                  onSeek={() => {}}
                />
                <div className="row">
                  <div style={{ width: 120 }}>
                    <Field label="Start">
                      <TimeInput value={range.start} onCommit={(v) => setRange((r) => ({ ...r, start: clamp(v, 0, r.end - 0.5) }))} />
                    </Field>
                  </div>
                  <div style={{ width: 120 }}>
                    <Field label="End">
                      <TimeInput value={range.end} onCommit={(v) => setRange((r) => ({ ...r, end: clamp(v, r.start + 0.5, info.duration) }))} />
                    </Field>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => setPreview((p) => !p)}>
                    <Play size={14} /> {preview ? 'Hide preview' : 'Preview range'}
                  </button>
                </div>
                <span className="field-hint">
                  Only this <b className="mono">{formatTime(len)}</b> is downloaded — much faster than fetching the whole video. Times accept seconds or m:ss.
                </span>
                {gif && len > 15 && <Alert kind="warn">That’s a long GIF — expect a big file. Shorten the range or lower fps/width.</Alert>}
                {preview && (
                  <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
                    <iframe
                      key={`${Math.floor(range.start)}-${Math.ceil(range.end)}`}
                      src={`https://www.youtube-nocookie.com/embed/${info.id}?start=${Math.floor(range.start)}&end=${Math.ceil(range.end)}&autoplay=1&rel=0`}
                      title="Preview"
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {dls.length > 0 && (
          <div>
            <div className="list-head">
              <h3>Downloads</h3>
              <span className="spacer" />
              {dls.some((d) => d.status === 'done' || d.status === 'error' || d.status === 'canceled') && (
                <button className="btn btn-ghost btn-sm" onClick={() => setDls((p) => p.filter((d) => !['done', 'error', 'canceled'].includes(d.status)))}>
                  <X size={14} /> Clear finished
                </button>
              )}
            </div>
            <div className="files">
              {dls.map((d) => (
                <DlRow key={d.key} d={d} onCancel={() => cancel(d)} onRemove={() => setDls((p) => p.filter((x) => x.key !== d.key))} />
              ))}
            </div>
          </div>
        )}

        {info && (
          <div className="mobile-cta">
            <button className="btn btn-primary" onClick={start} disabled={useRange && len <= 0}>
              <Download size={16} /> Download {format.toUpperCase()}
            </button>
          </div>
        )}
      </div>

      <aside className="card stack">
        <Field label="Format">
          <Segmented block options={FORMATS} value={format} onChange={setFormat} />
        </Field>
        {(format === 'mp4' || format === 'mov') && (
          <Field label="Quality (max)" hint="H.264 is preferred at each size so files play everywhere (iPhone, Discord, editors).">
            <Segmented block options={[...heights.slice(0, 4).map((h) => ({ value: h, label: h >= 2160 ? '4K' : `${h}p` })), { value: 0, label: 'Best' }]} value={effQuality} onChange={setQuality} />
          </Field>
        )}
        {format === 'mp3' && (
          <Field label="Bitrate" value={`${audioKbps} kbps`}>
            <Segmented block options={[128, 192, 256, 320].map((b) => ({ value: b, label: String(b) }))} value={audioKbps} onChange={setAudioKbps} />
          </Field>
        )}
        {gif && (
          <>
            <Field label="Frame rate" value={`${gifFps} fps`}>
              <Slider min={5} max={30} value={gifFps} onChange={setGifFps} />
            </Field>
            <Field label="Width" value={`${gifWidth}px`}>
              <Slider min={160} max={960} step={20} value={gifWidth} onChange={setGifWidth} />
            </Field>
          </>
        )}
        <Switch checked={autoSave} onChange={setAutoSave} label="Save automatically when finished" />
        <button className="btn btn-primary btn-lg btn-block" disabled={!info || (useRange && len <= 0)} onClick={start}>
          <Download size={16} /> Download {format.toUpperCase()}
          {useRange && info ? ` · ${formatTime(len)}` : ''}
        </button>
        <span className="field-hint">
          You can start several downloads — they run side by side. Only download videos you own or have permission to use.
        </span>
        <span className="field-hint">
          Helper: yt-dlp {typeof health === 'object' && health.ytdlp} · FFmpeg {typeof health === 'object' && health.ffmpeg}
        </span>
      </aside>
    </div>
  );
}

function Status({ ok, label, version, install }: { ok: boolean; label: string; version?: string | null; install: string }) {
  return (
    <div className="file-row" style={{ cursor: 'default' }}>
      {ok ? <CheckCircle2 size={18} style={{ color: 'var(--success)' }} /> : <X size={18} style={{ color: 'var(--danger)' }} />}
      <div className="file-meta">
        <div className="file-name">
          {label} {ok ? <span className="muted">{version}</span> : <span style={{ color: 'var(--danger)' }}>not found</span>}
        </div>
        {!ok && <div className="file-sub mono">{install}</div>}
      </div>
    </div>
  );
}

function DlRow({ d, onCancel, onRemove }: { d: Dl; onCancel: () => void; onRemove: () => void }) {
  const busy = d.status === 'starting' || d.status === 'downloading' || d.status === 'processing' || d.status === 'fetching';
  return (
    <div className={cx('file-row')} style={{ cursor: 'default', alignItems: 'flex-start' }}>
      <div className="file-thumb" style={{ width: 64, height: 36 }}>
        {d.thumbnail && <img src={d.thumbnail} alt="" />}
      </div>
      <div className="file-meta">
        <div className="file-name">{d.name ?? d.title}</div>
        <div className="file-sub">
          <span>{d.label}</span>
          {d.status === 'done' && d.blob && <span className="badge good">{formatBytes(d.blob.size)}</span>}
          {d.status === 'error' && <span className="badge bad">Failed</span>}
          {d.status === 'canceled' && <span className="badge">Canceled</span>}
        </div>
        {busy && (
          <div style={{ marginTop: 6 }}>
            <Progress value={d.progress && d.progress > 0 ? d.progress : null} />
            <div className="file-sub" style={{ marginTop: 3 }}>
              <span>{d.detail}</span>
              {d.bytes > 0 && d.status === 'downloading' && <span className="mono">{formatBytes(d.bytes)}</span>}
            </div>
          </div>
        )}
        {d.status === 'error' && <div className="file-sub" style={{ color: 'var(--danger)', marginTop: 4 }}>{d.error}</div>}
      </div>
      <div className="file-actions">
        {d.status === 'done' && d.blob && (
          <>
            <ShareButton blob={d.blob} name={d.name ?? 'download'} />
            <button className="btn btn-sm btn-icon" title="Save" onClick={() => downloadBlob(d.blob!, d.name ?? 'download')}>
              <Download size={14} />
            </button>
          </>
        )}
        {busy ? (
          <button className="btn btn-ghost btn-sm btn-icon" title="Cancel" onClick={onCancel}>
            <Square size={13} />
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm btn-icon" title="Remove" onClick={onRemove}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
