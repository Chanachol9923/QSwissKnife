/*
 * Hardware-accelerated video path built on WebCodecs (via Mediabunny). Typically many times
 * faster than FFmpeg-in-WASM because encoding runs on the GPU/media engine. Streams that don't
 * need changing are copied as-is (instant remux). Anything it can't handle throws
 * `FastPathUnsupported` so the caller can fall back to FFmpeg.
 */
import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, MkvOutputFormat, MovOutputFormat, Mp4OutputFormat, Output, Quality, WebMOutputFormat,
  type ConversionVideoOptions, type QualityLevel,
} from 'mediabunny';

export class FastPathUnsupported extends Error {}

export const fastPathAvailable = () => typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window;

export type FastContainer = 'mp4' | 'mov' | 'mkv' | 'webm';

export interface FastOptions {
  input: File;
  container: FastContainer;
  video?: {
    /** limit the short side (e.g. 720 for "720p") */
    short?: number;
    /** bits per second */
    bitrate?: number;
    level?: QualityLevel;
    crop?: { left: number; top: number; width: number; height: number };
    /** re-encode even if the stream could be copied */
    transcode?: boolean;
    /** force a constant output frame rate */
    frameRate?: number;
    /** seconds between keyframes */
    keyFrameInterval?: number;
    /** constant bitrate — steadier streaming than VBR */
    constant?: boolean;
  };
  audio?: { bitrate?: number; discard?: boolean; transcode?: boolean };
  trim?: { start: number; end: number };
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

const MIME: Record<FastContainer, string> = { mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm' };
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function fastConvert(o: FastOptions): Promise<Blob> {
  if (!fastPathAvailable()) throw new FastPathUnsupported('WebCodecs is not available in this browser');
  const webm = o.container === 'webm';
  const input = new Input({ source: new BlobSource(o.input), formats: ALL_FORMATS });
  try {
    const format =
      o.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : o.container === 'mov' ? new MovOutputFormat({ fastStart: 'in-memory' })
      : webm ? new WebMOutputFormat()
      : new MkvOutputFormat();
    const output = new Output({ format, target: new BufferTarget() });
    const v = o.video ?? {};

    let conversion: Conversion;
    try {
      conversion = await Conversion.init({
        input,
        output,
        showWarnings: false,
        trim: o.trim,
        video: (track) => {
          const opts: ConversionVideoOptions = { codec: webm ? 'vp9' : 'avc' };
          const baseW = v.crop?.width ?? track.displayWidth;
          const baseH = v.crop?.height ?? track.displayHeight;
          if (v.crop) opts.crop = v.crop;
          const s = v.short && Math.min(baseW, baseH) > v.short ? v.short / Math.min(baseW, baseH) : 1;
          if (s < 1 || v.crop || baseW % 2 || baseH % 2) {
            opts.width = even(baseW * s);
            opts.height = even(baseH * s);
            opts.fit = 'fill';
          }
          if (v.bitrate) opts.quality = new Quality({ bitrate: Math.round(v.bitrate), bitrateMode: v.constant ? 'constant' : 'variable' });
          else if (v.level) opts.quality = new Quality(v.level);
          if (v.frameRate) opts.frameRate = v.frameRate;
          if (v.keyFrameInterval) opts.keyFrameInterval = v.keyFrameInterval;
          if (v.transcode || v.bitrate || v.level || v.frameRate) opts.forceTranscode = true;
          return opts;
        },
        audio: o.audio?.discard
          ? { discard: true }
          : {
              codec: webm ? 'opus' : 'aac',
              ...(o.audio?.bitrate ? { quality: new Quality({ bitrate: o.audio.bitrate }) } : {}),
              forceTranscode: o.audio?.transcode,
            },
      });
    } catch (e) {
      throw new FastPathUnsupported(`Cannot read this file: ${(e as Error).message}`);
    }

    const lost = conversion.discardedTracks.filter((d) => d.reason !== 'discarded_by_user');
    if (!conversion.isValid || lost.length) {
      throw new FastPathUnsupported(lost.map((d) => `${d.track.type}: ${d.reason}`).join(', ') || 'conversion not possible');
    }

    const onAbort = () => void conversion.cancel();
    o.signal?.addEventListener('abort', onAbort);
    conversion.onProgress = (p) => o.onProgress?.(p);
    try {
      await conversion.execute();
    } catch (e) {
      if (o.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
      // encoder/decoder failures mid-run (e.g. unsupported profile) → let FFmpeg try
      throw new FastPathUnsupported((e as Error).message);
    } finally {
      o.signal?.removeEventListener('abort', onAbort);
    }
    const buf = output.target.buffer;
    if (!buf) throw new FastPathUnsupported('No output produced');
    return new Blob([buf], { type: MIME[o.container] });
  } finally {
    input.dispose();
  }
}
