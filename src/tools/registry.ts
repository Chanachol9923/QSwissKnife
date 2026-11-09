import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  ArrowRightLeft, AudioLines, AudioWaveform, Binary, Braces, Clapperboard, Clock, CloudDownload, Combine, Crop, FileImage, FileStack, Film, Fingerprint,
  Hash, ImageDown, ImagePlus, KeyRound, Link2, Music, Palette, QrCode, Repeat, Ruler, Scaling, Scissors,
  Sheet, SquareDashed, Type, Video, Wand2, FileText, type LucideIcon,
} from 'lucide-react';

export type CategoryId = 'convert' | 'image' | 'video' | 'audio' | 'pdf' | 'dev' | 'text';

export const CATEGORIES: { id: CategoryId; name: string; color: string }[] = [
  { id: 'convert', name: 'Convert', color: 'var(--accent)' },
  { id: 'image', name: 'Image', color: 'var(--c-image)' },
  { id: 'video', name: 'Video', color: 'var(--c-video)' },
  { id: 'audio', name: 'Audio', color: 'var(--c-audio)' },
  { id: 'pdf', name: 'PDF', color: 'var(--c-pdf)' },
  { id: 'dev', name: 'Developer', color: 'var(--c-dev)' },
  { id: 'text', name: 'Text & Misc', color: 'var(--c-text)' },
];

export interface Tool {
  id: string;
  name: string;
  desc: string;
  category: CategoryId;
  icon: LucideIcon;
  keywords: string;
  component: LazyExoticComponent<ComponentType>;
}

const from = <M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M) =>
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));

const image = () => import('./image');
const crop = () => import('./imageCrop');
const video = () => import('./video');
const pdf = () => import('./pdf');
const dev = () => import('./dev');
const text = () => import('./text');
const youtube = () => import('./youtube');
const converter = () => import('./converter');

export const TOOLS: Tool[] = [
  // Convert
  { id: 'convert', name: 'Convert Anything', desc: 'Drop any file — its type is detected automatically. 80+ formats: images, video, audio, PDF, Word, Excel, data, subtitles, fonts, archives.', category: 'convert', icon: ArrowRightLeft, keywords: 'convert converter any file format detect universal heic docx pdf xlsx csv json yaml mp4 mp3 srt ttf woff zip', component: from(converter, 'Converter') },
  // Image
  { id: 'image-compress', name: 'Compress Image', desc: 'Shrink JPG, PNG & WebP with a live before/after preview.', category: 'image', icon: ImageDown, keywords: 'reduce size optimize smaller jpg png webp batch', component: from(image, 'ImageCompress') },
  { id: 'image-convert', name: 'Convert Image', desc: 'Batch convert between JPG, PNG, WebP and AVIF.', category: 'image', icon: Repeat, keywords: 'format jpg png webp avif heic transform', component: from(image, 'ImageConvert') },
  { id: 'image-resize', name: 'Resize Image', desc: 'Scale by percent, fit within a box, or set exact pixels.', category: 'image', icon: Scaling, keywords: 'scale dimension width height thumbnail batch', component: from(image, 'ImageResize') },
  { id: 'image-crop', name: 'Crop & Rotate', desc: 'Crop with aspect presets, rotate and flip.', category: 'image', icon: Crop, keywords: 'cut trim rotate flip mirror aspect ratio', component: from(crop, 'ImageCrop') },
  { id: 'image-base64', name: 'Image ⇄ Base64', desc: 'Encode images to data URIs or decode them back.', category: 'image', icon: FileImage, keywords: 'data uri base64 encode decode inline', component: from(image, 'ImageBase64') },
  { id: 'image-palette', name: 'Color Palette', desc: 'Extract dominant colors from any image.', category: 'image', icon: Palette, keywords: 'colors dominant extract swatch eyedropper', component: from(image, 'ImagePalette') },
  // Video
  { id: 'youtube', name: 'YouTube Downloader', desc: 'Save videos as MP4, MOV, MP3 or GIF — the whole thing or just a range.', category: 'video', icon: CloudDownload, keywords: 'youtube yt download save mp4 mp3 gif mov clip yt-dlp', component: from(youtube, 'YouTubeDownloader') },
  { id: 'video-compress', name: 'Compress Video', desc: 'Reduce video size with H.264 quality and resolution control.', category: 'video', icon: Video, keywords: 'reduce shrink smaller mp4 h264 crf', component: from(video, 'VideoCompress') },
  { id: 'video-convert', name: 'Convert Video', desc: 'MP4, WebM, MOV, MKV, AVI — re-encode or remux.', category: 'video', icon: Film, keywords: 'format mp4 webm mov mkv avi transcode', component: from(video, 'VideoConvert') },
  { id: 'video-trim', name: 'Trim Video', desc: 'Cut a clip with a visual timeline.', category: 'video', icon: Scissors, keywords: 'cut clip segment start end', component: from(video, 'VideoTrim') },
  { id: 'video-crop', name: 'Crop Video', desc: 'Crop the frame visually with aspect presets.', category: 'video', icon: SquareDashed, keywords: 'frame aspect vertical reels tiktok', component: from(video, 'VideoCrop') },
  { id: 'video-gif', name: 'Video to GIF', desc: 'Make high-quality GIFs with palette optimisation.', category: 'video', icon: Clapperboard, keywords: 'gif animation meme loop', component: from(video, 'VideoToGif') },
  // Audio
  { id: 'audio-extract', name: 'Extract & Trim Audio', desc: 'Pull the soundtrack out of videos — all of it or just a part.', category: 'audio', icon: AudioLines, keywords: 'mp3 rip soundtrack video to audio cut clip trim', component: from(video, 'ExtractAudio') },
  { id: 'audio-trim', name: 'Trim Audio', desc: 'Cut songs and recordings losslessly, or convert while cutting.', category: 'audio', icon: AudioWaveform, keywords: 'cut clip ringtone shorten mp3 wav', component: from(video, 'AudioTrim') },
  { id: 'audio-convert', name: 'Convert Audio', desc: 'MP3, WAV, OGG, M4A, FLAC, Opus with bitrate control.', category: 'audio', icon: Music, keywords: 'mp3 wav ogg flac aac m4a opus bitrate', component: from(video, 'AudioConvert') },
  // PDF
  { id: 'pdf-merge', name: 'Merge PDF', desc: 'Combine several PDFs into one, in any order.', category: 'pdf', icon: Combine, keywords: 'join combine concatenate', component: from(pdf, 'PdfMerge') },
  { id: 'pdf-split', name: 'Split & Extract PDF', desc: 'Pull out page ranges or split every page.', category: 'pdf', icon: FileStack, keywords: 'pages extract range separate', component: from(pdf, 'PdfSplit') },
  { id: 'pdf-images', name: 'Images to PDF', desc: 'Turn photos and scans into a single PDF.', category: 'pdf', icon: ImagePlus, keywords: 'jpg png to pdf scan photo', component: from(pdf, 'ImagesToPdf') },
  // Dev
  { id: 'json', name: 'JSON Formatter', desc: 'Pretty-print, minify and validate JSON.', category: 'dev', icon: Braces, keywords: 'beautify minify validate lint', component: from(dev, 'JsonFormatter') },
  { id: 'csv-json', name: 'CSV ⇄ JSON', desc: 'Convert spreadsheets to JSON and back.', category: 'dev', icon: Sheet, keywords: 'table excel tsv convert', component: from(dev, 'CsvJson') },
  { id: 'base64', name: 'Base64', desc: 'Encode and decode Base64 text (UTF-8 safe).', category: 'dev', icon: Binary, keywords: 'encode decode b64', component: from(dev, 'Base64Tool') },
  { id: 'url-encode', name: 'URL Encode', desc: 'Encode/decode URLs and inspect query strings.', category: 'dev', icon: Link2, keywords: 'percent encode decode query parse', component: from(dev, 'UrlTool') },
  { id: 'hash', name: 'Hash Generator', desc: 'SHA-1, SHA-256, SHA-384, SHA-512 of text or files.', category: 'dev', icon: Fingerprint, keywords: 'sha checksum digest integrity', component: from(dev, 'HashTool') },
  { id: 'jwt', name: 'JWT Decoder', desc: 'Inspect JWT header, payload and expiry.', category: 'dev', icon: KeyRound, keywords: 'token jwt decode bearer', component: from(dev, 'JwtTool') },
  { id: 'uuid', name: 'UUID Generator', desc: 'Generate v4 UUIDs in bulk.', category: 'dev', icon: Hash, keywords: 'guid random id', component: from(dev, 'UuidTool') },
  { id: 'timestamp', name: 'Timestamp Converter', desc: 'Unix time ⇄ human dates across time zones.', category: 'dev', icon: Clock, keywords: 'epoch unix date time iso', component: from(dev, 'TimestampTool') },
  { id: 'color', name: 'Color Converter', desc: 'HEX, RGB, HSL with contrast checking.', category: 'dev', icon: Palette, keywords: 'hex rgb hsl contrast wcag', component: from(dev, 'ColorTool') },
  // Text & misc
  { id: 'qr', name: 'QR Code Generator', desc: 'Create QR codes for links, Wi-Fi and text.', category: 'text', icon: QrCode, keywords: 'qr barcode wifi link', component: from(text, 'QrTool') },
  { id: 'password', name: 'Password Generator', desc: 'Strong, random passwords & passphrases.', category: 'text', icon: Wand2, keywords: 'random secure secret', component: from(text, 'PasswordTool') },
  { id: 'text-case', name: 'Text Case & Counter', desc: 'Change case and count words, characters and lines.', category: 'text', icon: Type, keywords: 'upper lower camel snake kebab word count', component: from(text, 'TextCaseTool') },
  { id: 'diff', name: 'Text Diff', desc: 'Compare two texts line by line.', category: 'text', icon: FileText, keywords: 'compare difference changes', component: from(text, 'DiffTool') },
  { id: 'units', name: 'Unit Converter', desc: 'Length, weight, temperature, data size and more.', category: 'text', icon: Ruler, keywords: 'convert metric imperial bytes celsius', component: from(text, 'UnitTool') },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);
export const categoryById = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)!;

export function searchTools(q: string): Tool[] {
  const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return TOOLS;
  return TOOLS.map((t) => {
    const hay = `${t.name} ${t.desc} ${t.keywords} ${categoryById(t.category).name}`.toLowerCase();
    const name = t.name.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!hay.includes(term)) return null;
      score += name.startsWith(term) ? 3 : name.includes(term) ? 2 : 1;
    }
    return { t, score };
  })
    .filter((x): x is { t: Tool; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}
