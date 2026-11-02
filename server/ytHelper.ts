/*
 * Local YouTube helper. Runs inside the Vite dev/preview server (see vite.config.ts) and wraps the
 * yt-dlp and ffmpeg binaries installed on this machine. Browsers can't download from YouTube
 * directly, so the page asks this helper to do it and then fetches the finished file.
 *
 *   GET    /api/yt/health          → tool versions
 *   GET    /api/yt/info?url=…      → title, duration, thumbnail, available heights
 *   POST   /api/yt/jobs            → start a download { url, title, format, quality, start, end, … }
 *   GET    /api/yt/jobs/:id        → progress
 *   GET    /api/yt/jobs/:id/file   → the finished file
 *   DELETE /api/yt/jobs/:id        → cancel / clean up
 *
 * Env overrides: YTDLP_PATH, FFMPEG_PATH.
 */
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
// recent yt-dlp needs a JS runtime for YouTube; the Node running this server is always available
const JS_RUNTIME = ['--js-runtimes', `node:${process.execPath}`];
const FFMPEG_LOC = process.env.FFMPEG_PATH ? ['--ffmpeg-location', process.env.FFMPEG_PATH] : [];
const JOB_TTL_MS = 60 * 60 * 1000;
const ALLOWED_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

type Format = 'mp4' | 'mov' | 'mp3' | 'gif';

interface JobRequest {
  url: string;
  title?: string;
  format: Format;
  /** max video height; 0 = best available */
  quality?: number;
  start?: number;
  end?: number;
  /** total duration of the source, for progress estimates */
  duration?: number;
  audioKbps?: number;
  gifFps?: number;
  gifWidth?: number;
}

interface Job {
  id: string;
  req: JobRequest;
  status: 'downloading' | 'processing' | 'done' | 'error' | 'canceled';
  /** 0..1, or null when unknown */
  progress: number | null;
  detail: string;
  bytes: number;
  dir: string;
  file?: string;
  name?: string;
  size?: number;
  error?: string;
  proc?: ChildProcess;
  created: number;
}

const jobs = new Map<string, Job>();

/* ---------- small http helpers ---------- */

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000) throw new Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}

function checkUrl(url: unknown): string {
  if (typeof url !== 'string') throw new Error('Missing URL');
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error('That isn’t a valid link');
  }
  if (!/^https?:$/.test(u.protocol) || !ALLOWED_HOSTS.test(u.hostname)) throw new Error('Only YouTube links are supported');
  return u.toString();
}

const sanitize = (s: string) =>
  s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}m${String(s).padStart(2, '0')}s`;
};

function run(cmd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(lastError(stderr) || err.message)) : resolve(stdout),
    ),
  );
}

function lastError(stderr: string) {
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim());
  return (lines.reverse().find((l) => /ERROR/i.test(l)) ?? lines[0] ?? '').replace(/^ERROR:\s*/, '').slice(0, 400);
}

function kill(p?: ChildProcess) {
  if (!p?.pid || p.exitCode !== null) return;
  // yt-dlp spawns ffmpeg; on Windows only taskkill /T takes the whole tree down
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], () => {});
  else p.kill('SIGTERM');
}

async function dirBytes(dir: string) {
  try {
    const names = await readdir(dir);
    const sizes = await Promise.all(names.map((n) => stat(join(dir, n)).then((s) => s.size, () => 0)));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

/* ---------- health + info ---------- */

let healthCache: { at: number; value: unknown } | null = null;
async function health() {
  if (healthCache && Date.now() - healthCache.at < 30_000) return healthCache.value;
  const [ytdlp, ffmpeg] = await Promise.all([
    run(YTDLP, ['--version']).then((s) => s.trim(), () => null),
    run(FFMPEG, ['-version']).then((s) => s.split('\n')[0].replace(/^ffmpeg version\s*/, '').split(' ')[0], () => null),
  ]);
  const value = { ok: true, ytdlp, ffmpeg };
  healthCache = { at: Date.now(), value };
  return value;
}

const infoCache = new Map<string, { at: number; value: unknown }>();
async function info(url: string) {
  const hit = infoCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const raw = await run(YTDLP, ['-J', '--no-playlist', '--no-warnings', ...JS_RUNTIME, '--', url], 90_000);
  const d = JSON.parse(raw);
  const heights = [...new Set<number>((d.formats ?? []).filter((f: { vcodec?: string; height?: number }) => f.height && f.vcodec && f.vcodec !== 'none').map((f: { height: number }) => f.height))].sort((a, b) => b - a);
  const value = {
    id: d.id,
    title: d.title,
    uploader: d.uploader ?? d.channel,
    duration: d.duration ?? 0,
    thumbnail: d.thumbnail,
    isLive: !!d.is_live,
    heights,
  };
  infoCache.set(url, { at: Date.now(), value });
  return value;
}

/* ---------- jobs ---------- */

function ytFormatArgs(r: JobRequest): string[] {
  const h = r.quality || 0;
  switch (r.format) {
    case 'mp3':
      return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', `${r.audioKbps || 192}K`];
    case 'gif':
      // a small H.264 source is plenty for a GIF and much quicker to fetch
      return ['-S', `res:${Math.min(720, Math.max(360, Math.round((r.gifWidth || 480) * 1.2)))},vcodec:h264`, '-f', 'bv*/b', '--merge-output-format', 'mp4'];
    case 'mov':
      // MOV only really works with H.264/AAC, so prefer those over higher-res VP9/AV1
      return ['-S', `${h ? `res:${h},` : ''}vcodec:h264,acodec:aac`, '-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
    default:
      // H.264 preferred at equal resolution for compatibility (iPhone, Discord, editors)
      return ['-S', h ? `res:${h},vcodec:h264,acodec:aac` : 'res,fps,vcodec:h264,acodec:aac', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
  }
}

function spawnTracked(job: Job, cmd: string, args: string[], onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    job.proc = p;
    let errText = '';
    const pending = { out: '', err: '' };
    const feed = (buf: Buffer, isErr: boolean) => {
      const text = buf.toString('utf8');
      if (isErr) errText = (errText + text).slice(-8000);
      // chunks can end mid-line; keep the tail until its newline arrives
      const key = isErr ? 'err' : 'out';
      const lines = (pending[key] + text).split(/\r?\n|\r/);
      pending[key] = lines.pop() ?? '';
      lines.forEach((l) => l && onLine(l));
    };
    p.stdout.on('data', (b: Buffer) => feed(b, false));
    p.stderr.on('data', (b: Buffer) => feed(b, true));
    p.on('error', (e) => reject(new Error(`Couldn’t start ${cmd}: ${e.message}`)));
    p.on('close', (code) => {
      job.proc = undefined;
      if (pending.out) onLine(pending.out);
      if (job.status === 'canceled') reject(new Error('Canceled'));
      else if (code === 0) resolve();
      else reject(new Error(lastError(errText) || `${cmd} exited with code ${code}`));
    });
  });
}

/** ffmpeg post-processing with progress from its time= output */
function ffmpegStep(job: Job, args: string[], expected: number) {
  return spawnTracked(job, FFMPEG, ['-hide_banner', '-y', ...args], (l) => {
    const m = l.match(/time=(\d+):(\d+):([\d.]+)/);
    if (m && expected > 0) job.progress = Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / expected);
  });
}

async function runJob(job: Job) {
  const r = job.req;
  const section = r.start != null && r.end != null && r.end > r.start;
  const length = section ? r.end! - r.start! : r.duration || 0;

  // 1. download
  let src = '';
  const sizer = setInterval(async () => {
    job.bytes = await dirBytes(job.dir);
  }, 1000);
  try {
    job.detail = section ? 'Downloading selected range…' : 'Downloading…';
    await spawnTracked(
      job,
      YTDLP,
      [
        // --print implies --quiet, so --progress is needed to keep the progress lines
        '--no-playlist', '--newline', '--progress', '--no-colors', '--no-warnings', '--no-mtime', ...JS_RUNTIME, ...FFMPEG_LOC,
        ...ytFormatArgs(r),
        ...(section ? ['--download-sections', `*${r.start!.toFixed(2)}-${r.end!.toFixed(2)}`, '--force-keyframes-at-cuts'] : []),
        '--progress-template', 'download:SKPROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '--print', 'after_move:SKFILE:%(filepath)s',
        '-o', join(job.dir, 'src.%(ext)s'),
        '--', r.url,
      ],
      (line) => {
        if (line.startsWith('SKFILE:')) src = line.slice(7).trim();
        const m = line.match(/^SKPROG\s+([\d.]+)%\|([^|]*)\|(.*)$/);
        if (m) {
          // yt-dlp downloads video and audio separately; this is per-stream progress
          job.progress = Number(m[1]) / 100;
          job.detail = `Downloading… ${m[2].trim()}${m[3].trim() && m[3].trim() !== 'NA' ? ` · ${m[3].trim()} left` : ''}`;
        } else if (/\[Merger\]|\[ExtractAudio\]|\[FixupM3u8\]/.test(line)) {
          job.progress = null;
          job.detail = line.includes('ExtractAudio') ? 'Converting to MP3…' : 'Merging audio & video…';
        }
      },
    );
  } finally {
    clearInterval(sizer);
  }
  if (!src) {
    const names = (await readdir(job.dir)).filter((n) => n.startsWith('src.'));
    if (!names.length) throw new Error('yt-dlp finished without producing a file');
    src = join(job.dir, names[0]);
  }

  // 2. post-process into the requested format
  job.status = 'processing';
  job.progress = 0;
  let out = src;
  if (r.format === 'mp4') {
    // remux so the index sits at the front: streams instantly in Discord/browsers
    job.detail = 'Optimising for streaming…';
    out = join(job.dir, 'final.mp4');
    await ffmpegStep(job, ['-i', src, '-c', 'copy', '-movflags', '+faststart', out], length);
  } else if (r.format === 'mov') {
    job.detail = 'Packaging as MOV…';
    out = join(job.dir, 'final.mov');
    try {
      await ffmpegStep(job, ['-i', src, '-c', 'copy', '-movflags', '+faststart', '-tag:v', 'avc1', out], length);
    } catch (e) {
      if ((job.status as Job['status']) === 'canceled') throw e; // set concurrently by DELETE
      job.detail = 'Re-encoding to H.264 for MOV…';
      await ffmpegStep(job, ['-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], length);
    }
  } else if (r.format === 'gif') {
    job.detail = 'Making GIF…';
    out = join(job.dir, 'final.gif');
    const fps = Math.min(30, Math.max(5, r.gifFps || 12));
    const w = Math.min(1280, Math.max(120, r.gifWidth || 480));
    await ffmpegStep(job, ['-i', src, '-filter_complex', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', out], length);
  }

  const range = section ? ` [${fmtTime(r.start!)}-${fmtTime(r.end!)}]` : '';
  job.file = out;
  job.name = `${sanitize(r.title || 'video')}${range}${extname(out)}`;
  job.size = (await stat(out)).size;
  job.progress = 1;
  job.detail = 'Ready';
  job.status = 'done';
}

async function createJob(body: unknown): Promise<Job> {
  const b = body as Partial<JobRequest>;
  const url = checkUrl(b.url);
  const format: Format = (['mp4', 'mov', 'mp3', 'gif'] as const).includes(b.format as Format) ? (b.format as Format) : 'mp4';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const req: JobRequest = {
    url,
    format,
    title: typeof b.title === 'string' ? b.title : undefined,
    quality: num(b.quality),
    start: num(b.start),
    end: num(b.end),
    duration: num(b.duration),
    audioKbps: num(b.audioKbps),
    gifFps: num(b.gifFps),
    gifWidth: num(b.gifWidth),
  };
  const job: Job = { id: randomUUID(), req, status: 'downloading', progress: null, detail: 'Starting…', bytes: 0, dir: await mkdtemp(join(tmpdir(), 'qswiftknife-yt-')), created: Date.now() };
  jobs.set(job.id, job);
  runJob(job).catch((e: Error) => {
    if (job.status === 'canceled') return;
    job.status = 'error';
    job.error = e.message;
    job.detail = 'Failed';
  });
  return job;
}

const view = (j: Job) => ({ id: j.id, status: j.status, progress: j.progress, detail: j.detail, bytes: j.bytes, name: j.name, size: j.size, error: j.error });

async function dispose(job: Job) {
  kill(job.proc);
  jobs.delete(job.id);
  // give the killed processes a moment to release file handles (Windows)
  setTimeout(() => rm(job.dir, { recursive: true, force: true }).catch(() => {}), 1500);
}

/* ---------- router ---------- */

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname.replace(/^\/api\/yt/, '');
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, await health());
    if (req.method === 'GET' && path === '/info') return send(res, 200, await info(checkUrl(url.searchParams.get('url'))));
    if (req.method === 'POST' && path === '/jobs') return send(res, 200, view(await createJob(await readJson(req))));

    const m = path.match(/^\/jobs\/([\w-]+)(\/file)?$/);
    const job = m && jobs.get(m[1]);
    if (m && !job) return send(res, 404, { error: 'Unknown or expired job' });
    if (job && req.method === 'GET' && !m![2]) return send(res, 200, view(job));
    if (job && req.method === 'DELETE') {
      if (job.status === 'downloading' || job.status === 'processing') job.status = 'canceled';
      await dispose(job);
      return send(res, 200, { ok: true });
    }
    if (job && req.method === 'GET' && m![2]) {
      if (job.status !== 'done' || !job.file) return send(res, 409, { error: 'Not ready' });
      const mime = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.gif': 'image/gif' }[extname(job.file)] ?? 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', String(job.size ?? (await stat(job.file)).size));
      res.setHeader('Content-Disposition', `attachment; filename="${(job.name ?? 'download').replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(job.name ?? 'download')}`);
      createReadStream(job.file).pipe(res);
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
}

export function ytHelper(): Plugin {
  const sweep = () => {
    for (const j of jobs.values()) if (Date.now() - j.created > JOB_TTL_MS) dispose(j);
  };
  const mount = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void }; httpServer?: { on: (ev: string, fn: () => void) => void } | null }) => {
    server.middlewares.use('/api/yt', (req, res) => void handle(req, res));
    const timer = setInterval(sweep, 10 * 60_000);
    timer.unref?.();
    server.httpServer?.on('close', () => {
      clearInterval(timer);
      for (const j of jobs.values()) dispose(j);
    });
  };
  return {
    name: 'qswiftknife-yt-helper',
    configureServer: (server) => mount(server),
    configurePreviewServer: (server) => mount(server),
  };
}
