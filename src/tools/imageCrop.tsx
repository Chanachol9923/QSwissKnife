import { useEffect, useState } from 'react';
import { Download, FlipHorizontal2, FlipVertical2, Maximize, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { ASPECTS, CropBox, centeredRect, type Rect } from '../components/CropBox';
import { Field, NumberInput, Segmented, Slider, useToast } from '../components/ui';
import { useObjectUrl } from '../components/hooks';
import { canvasToBlob, formatFromMime, formatInfo, loadBitmap, type ImageFormat } from '../lib/image';
import { clamp, downloadBlob, formatBytes, withExt } from '../lib/utils';

async function transform(src: Blob, op: 'cw' | 'ccw' | 'fh' | 'fv'): Promise<Blob> {
  const bmp = await loadBitmap(src);
  const rot = op === 'cw' || op === 'ccw';
  const c = document.createElement('canvas');
  c.width = rot ? bmp.height : bmp.width;
  c.height = rot ? bmp.width : bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  if (op === 'cw') ctx.rotate(Math.PI / 2);
  if (op === 'ccw') ctx.rotate(-Math.PI / 2);
  if (op === 'fh') ctx.scale(-1, 1);
  if (op === 'fv') ctx.scale(1, -1);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();
  return canvasToBlob(c, 'image/png');
}

export function ImageCrop() {
  const [file, setFile] = useState<File | null>(null);
  const [work, setWork] = useState<Blob | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [aspect, setAspect] = useState<number | null>(null);
  const [format, setFormat] = useState<ImageFormat>('image/png');
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const url = useObjectUrl(work);
  const toast = useToast();

  const open = (f: File) => {
    setFile(f);
    setWork(f);
    setFormat(formatFromMime(f.type) ?? 'image/png');
  };

  useEffect(() => {
    if (!work) return;
    loadBitmap(work).then((b) => {
      setSize({ w: b.width, h: b.height });
      setRect(centeredRect(b.width, b.height, aspect, 1));
      b.close();
    });
  }, [work]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyAspect = (a: number | null) => {
    setAspect(a);
    if (size) setRect(centeredRect(size.w, size.h, a, a ? 1 : 1));
  };

  const op = async (o: 'cw' | 'ccw' | 'fh' | 'fv') => {
    if (!work) return;
    setBusy(true);
    setWork(await transform(work, o));
    setBusy(false);
  };

  const setField = (k: keyof Rect, v: number | '') => {
    if (!size || v === '') return;
    const r = { ...rect, [k]: Math.round(v) };
    if (aspect && k === 'w') r.h = Math.round(r.w / aspect);
    if (aspect && k === 'h') r.w = Math.round(r.h * aspect);
    r.w = clamp(r.w, 1, size.w);
    r.h = clamp(r.h, 1, size.h);
    r.x = clamp(r.x, 0, size.w - r.w);
    r.y = clamp(r.y, 0, size.h - r.h);
    setRect(r);
  };

  const exportCrop = async () => {
    if (!work || !file) return;
    setBusy(true);
    try {
      const bmp = await loadBitmap(work);
      const c = document.createElement('canvas');
      c.width = rect.w;
      c.height = rect.h;
      const ctx = c.getContext('2d')!;
      if (format === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      bmp.close();
      const blob = await canvasToBlob(c, format, quality / 100);
      downloadBlob(blob, withExt(file.name, formatInfo(format).ext, '-cropped'));
      toast(`Saved ${rect.w}×${rect.h} · ${formatBytes(blob.size)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!file) return <FileDrop accept="image/*" onFiles={(f) => open(f[0])} />;

  return (
    <div className="tool-layout">
      <div className="stack">
        <div className="stage checker" style={{ padding: 24 }}>
          {url && size && (
            <div className="media-wrap">
              <img src={url} alt="" draggable={false} />
              <CropBox width={size.w} height={size.h} rect={rect} aspect={aspect} onChange={setRect} />
            </div>
          )}
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => op('ccw')} disabled={busy} title="Rotate left">
            <RotateCcw size={14} /> Left
          </button>
          <button className="btn btn-sm" onClick={() => op('cw')} disabled={busy} title="Rotate right">
            <RotateCw size={14} /> Right
          </button>
          <button className="btn btn-sm" onClick={() => op('fh')} disabled={busy}>
            <FlipHorizontal2 size={14} /> Flip H
          </button>
          <button className="btn btn-sm" onClick={() => op('fv')} disabled={busy}>
            <FlipVertical2 size={14} /> Flip V
          </button>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => size && setRect({ x: 0, y: 0, w: size.w, h: size.h })}>
            <Maximize size={14} /> Select all
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setWork(file)}>
            <Undo2 size={14} /> Reset
          </button>
        </div>
        <FileDrop accept="image/*" compact onFiles={(f) => open(f[0])} />
      </div>
      <aside className="card stack">
        <Field label="Aspect ratio">
          <Segmented options={ASPECTS.map((a) => ({ value: a.label, label: a.label }))} value={ASPECTS.find((a) => a.value === aspect)?.label ?? 'Free'} onChange={(l) => applyAspect(ASPECTS.find((a) => a.label === l)!.value)} />
        </Field>
        <div className="grid-2">
          <Field label="X">
            <NumberInput value={rect.x} onChange={(v) => setField('x', v)} suffix="px" />
          </Field>
          <Field label="Y">
            <NumberInput value={rect.y} onChange={(v) => setField('y', v)} suffix="px" />
          </Field>
          <Field label="Width">
            <NumberInput value={rect.w} onChange={(v) => setField('w', v)} suffix="px" />
          </Field>
          <Field label="Height">
            <NumberInput value={rect.h} onChange={(v) => setField('h', v)} suffix="px" />
          </Field>
        </div>
        {size && (
          <span className="field-hint">
            Source: {size.w}×{size.h}px
          </span>
        )}
        <Field label="Format">
          <Segmented
            block
            options={[
              { value: 'image/png', label: 'PNG' },
              { value: 'image/jpeg', label: 'JPG' },
              { value: 'image/webp', label: 'WebP' },
            ]}
            value={format === 'image/avif' ? 'image/png' : format}
            onChange={setFormat}
          />
        </Field>
        {format !== 'image/png' && (
          <Field label="Quality" value={`${quality}%`}>
            <Slider min={10} max={100} value={quality} onChange={setQuality} />
          </Field>
        )}
        <button className="btn btn-primary btn-lg btn-block" onClick={exportCrop} disabled={busy || !rect.w}>
          <Download size={16} /> Crop & download
        </button>
      </aside>
    </div>
  );
}
