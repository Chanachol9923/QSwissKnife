import { useEffect, useRef, useState } from 'react';
import { useDrag } from './hooks';
import { clamp, formatTime, parseTime } from '../lib/utils';

export function Timeline({ duration, start, end, current, onChange, onSeek }: { duration: number; start: number; end: number; current: number; onChange: (s: number, e: number) => void; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(t / (duration || 1)) * 100}%`;
  const drag = useDrag<{ which: 's' | 'e' | 'range'; s: number; e: number; width: number }>((st, dx) => {
    const dt = (dx / st.width) * duration;
    if (st.which === 's') onChange(clamp(st.s + dt, 0, st.e - 0.1), st.e);
    else if (st.which === 'e') onChange(st.s, clamp(st.e + dt, st.s + 0.1, duration));
    else {
      const len = st.e - st.s;
      const s = clamp(st.s + dt, 0, duration - len);
      onChange(s, s + len);
    }
  });
  const begin = (e: React.PointerEvent, which: 's' | 'e' | 'range') => drag(e, { which, s: start, e: end, width: ref.current!.getBoundingClientRect().width });

  return (
    <div
      ref={ref}
      className="timeline"
      onPointerDown={(e) => {
        const r = ref.current!.getBoundingClientRect();
        onSeek(clamp(((e.clientX - r.left) / r.width) * duration, 0, duration));
      }}
    >
      <div className="timeline-sel" style={{ left: pct(start), width: pct(end - start), cursor: 'grab' }} onPointerDown={(e) => begin(e, 'range')} />
      <div className="timeline-knob" style={{ left: pct(start) }} onPointerDown={(e) => begin(e, 's')} />
      <div className="timeline-knob" style={{ left: pct(end) }} onPointerDown={(e) => begin(e, 'e')} />
      <div className="timeline-head" style={{ left: pct(current) }} />
    </div>
  );
}

export function TimeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  return (
    <input
      className="input mono"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseTime(text);
        if (Number.isFinite(v)) onCommit(v);
        else setText(formatTime(value));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
