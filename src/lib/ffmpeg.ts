import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

/*
 * A small pool of FFmpeg instances. Each one is a separate single-threaded worker, so running
 * N jobs at once really uses N CPU cores. Idle instances are kept warm for the next job.
 */
const MAX_IDLE = 4;
const idle: FFmpeg[] = [];
let everLoaded = false;

async function create(): Promise<FFmpeg> {
  const ff = new FFmpeg();
  await ff.load({ coreURL, wasmURL });
  everLoaded = true;
  return ff;
}

/** true once the engine has been downloaded/compiled at least once this session */
export const isFFmpegLoaded = () => everLoaded;

async function acquire(): Promise<FFmpeg> {
  return idle.pop() ?? create();
}

function release(ff: FFmpeg) {
  if (idle.length < MAX_IDLE) idle.push(ff);
  else ff.terminate();
}

/** Exposed for tests / tooling: borrow an instance and give it back. */
export async function withFFmpeg<T>(fn: (ff: FFmpeg) => Promise<T>): Promise<T> {
  const ff = await acquire();
  try {
    return await fn(ff);
  } finally {
    release(ff);
  }
}

const abortError = () => new DOMException('Canceled', 'AbortError');

/**
 * Borrow an instance for one job. On abort the worker is terminated (that is the only way to
 * stop FFmpeg mid-run) and dropped from the pool.
 */
async function job<T>(signal: AbortSignal | undefined, fn: (ff: FFmpeg) => Promise<T>): Promise<T> {
  if (signal?.aborted) throw abortError();
  const ff = await acquire();
  if (signal?.aborted) {
    release(ff);
    throw abortError();
  }
  const kill = () => ff.terminate();
  signal?.addEventListener('abort', kill);
  try {
    return await fn(ff);
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener('abort', kill);
    if (!signal?.aborted) release(ff);
  }
}

const inputName = (file: File, base: string) => `${base}${file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : ''}`;

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio?: boolean;
  hasVideo: boolean;
  /** average frames per second, when known */
  fps?: number;
}

/** Read duration / size from FFmpeg's banner — used when the browser can't read the file itself. */
export function probe(input: File, signal?: AbortSignal): Promise<MediaInfo> {
  return job(signal, async (ff) => {
    const inName = inputName(input, 'probe');
    const lines: string[] = [];
    const log = ({ message }: { message: string }) => lines.push(message);
    ff.on('log', log);
    try {
      await ff.writeFile(inName, await fetchFile(input));
      await ff.exec(['-hide_banner', '-i', inName]); // exits non-zero (no output) — expected
    } finally {
      ff.off('log', log);
      await ff.deleteFile(inName).catch(() => {});
    }
    const text = lines.join('\n');
    const d = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const v = text.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
    const f = text.match(/Stream #.*Video:.*?([\d.]+) fps/);
    return {
      duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
      width: v ? Number(v[1]) : 0,
      height: v ? Number(v[2]) : 0,
      hasVideo: /Stream #.*Video:/.test(text),
      hasAudio: /Stream #.*Audio:/.test(text),
      fps: f ? Number(f[1]) : undefined,
    };
  });
}

function browserMeta(file: File): Promise<MediaInfo | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (r: MediaInfo | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => done(null), 8000);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () =>
      done(Number.isFinite(v.duration) && v.duration > 0 ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight, hasVideo: v.videoWidth > 0 } : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

/** Container-level read via Mediabunny: only touches headers/indexes, so it's fast even for huge files. */
async function demuxMeta(file: File): Promise<MediaInfo | null> {
  const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [v, a, duration] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack(), input.computeDuration()]);
    if (!duration) return null;
    const fps = v ? (await v.computePacketStats(120)).averagePacketRate : undefined;
    return { duration, width: v?.displayWidth ?? 0, height: v?.displayHeight ?? 0, hasVideo: !!v, hasAudio: !!a, fps };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** Demuxer first, then browser metadata, then an FFmpeg probe for exotic formats. */
export async function readMediaInfo(file: File, expectVideo: boolean): Promise<MediaInfo> {
  const d = await demuxMeta(file);
  if (d && (!expectVideo || d.width)) return d;
  const b = await browserMeta(file);
  if (b && (!expectVideo || b.width)) return b;
  try {
    return await probe(file);
  } catch {
    return b ?? { duration: 0, width: 0, height: 0, hasVideo: expectVideo };
  }
}

export interface RunOptions {
  input: File;
  args: (inName: string) => string[];
  output: string;
  mime: string;
  /** expected output duration in seconds; enables accurate progress parsed from the log */
  duration?: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  onLog?: (line: string) => void;
}

export function runFFmpeg({ input, args, output, mime, duration, signal, onProgress, onLog }: RunOptions): Promise<Blob> {
  return job(signal, async (ff) => {
    const inName = inputName(input, 'input');
    const progress = ({ progress }: { progress: number }) => {
      if (!duration) onProgress?.(Math.max(0, Math.min(1, progress)));
    };
    const log = ({ message }: { message: string }) => {
      onLog?.(message);
      const m = duration && message.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m) onProgress?.(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / duration!));
    };
    ff.on('progress', progress);
    ff.on('log', log);
    try {
      await ff.writeFile(inName, await fetchFile(input));
      const code = await ff.exec(args(inName));
      if (code !== 0) throw new Error(`FFmpeg exited with code ${code}. Open the log for details.`);
      const data = await ff.readFile(output);
      if (typeof data === 'string' || data.length === 0) throw new Error('No output was produced.');
      return new Blob([data as BlobPart], { type: mime });
    } finally {
      ff.off('progress', progress);
      ff.off('log', log);
      if (!signal?.aborted) {
        await ff.deleteFile(inName).catch(() => {});
        await ff.deleteFile(output).catch(() => {});
      }
    }
  });
}
