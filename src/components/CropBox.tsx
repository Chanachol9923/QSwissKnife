import { useRef } from 'react';
import { clamp } from '../lib/utils';
import { useDrag } from './hooks';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN = 8;

/** Fit the largest rect of the given aspect ratio centred inside W×H. */
export function centeredRect(W: number, H: number, aspect: number | null, cover = 0.8): Rect {
  let w = W * cover;
  let h = H * cover;
  if (aspect) {
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
  }
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: Math.round(w), h: Math.round(h) };
}

function resize(start: Rect, mode: Handle, dx: number, dy: number, W: number, H: number, aspect: number | null): Rect {
  if (mode === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, W - start.w), y: clamp(start.y + dy, 0, H - start.h) };
  }
  let l = start.x;
  let t = start.y;
  let r = start.x + start.w;
  let b = start.y + start.h;
  if (mode.includes('w')) l = clamp(l + dx, 0, r - MIN);
  if (mode.includes('e')) r = clamp(r + dx, l + MIN, W);
  if (mode.includes('n')) t = clamp(t + dy, 0, b - MIN);
  if (mode.includes('s')) b = clamp(b + dy, t + MIN, H);
  if (!aspect) return { x: l, y: t, w: r - l, h: b - t };

  const fromLeft = mode.includes('w');
  const fromTop = mode.includes('n');
  let w = r - l;
  let h = b - t;
  if (mode === 'n' || mode === 's') w = h * aspect;
  else h = w / aspect;
  const availW = fromLeft ? r : W - l;
  const availH = fromTop ? b : H - t;
  w = Math.min(w, availW, availH * aspect);
  h = w / aspect;
  const x = fromLeft ? r - w : mode === 'n' || mode === 's' ? clamp(l, 0, W - w) : l;
  const y = fromTop ? b - h : t;
  return { x, y, w, h };
}

interface Props {
  /** natural media size */
  width: number;
  height: number;
  rect: Rect;
  aspect: number | null;
  onChange: (r: Rect) => void;
}

/** Overlay that sits inside a `.media-wrap` on top of an <img>/<video>. Works in natural pixel units. */
export function CropBox({ width, height, rect, aspect, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useDrag<{ rect: Rect; mode: Handle; scale: number }>((s, dx, dy) => {
    const r = resize(s.rect, s.mode, dx * s.scale, dy * s.scale, width, height, aspect);
    onChange({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  });

  const begin = (e: React.PointerEvent, mode: Handle) => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    const scale = width / parent.getBoundingClientRect().width;
    drag(e, { rect, mode, scale });
  };

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  return (
    <div
      ref={box}
      className="crop-box"
      style={{ left: pct(rect.x, width), top: pct(rect.y, height), width: pct(rect.w, width), height: pct(rect.h, height) }}
      onPointerDown={(e) => begin(e, 'move')}
    >
      <span className="crop-size">
        {rect.w} × {rect.h}
      </span>
      {HANDLES.map((h) => (
        <span key={h} className="crop-handle" data-h={h} onPointerDown={(e) => begin(e, h)} />
      ))}
    </div>
  );
}

export const ASPECTS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:5', value: 4 / 5 },
];
