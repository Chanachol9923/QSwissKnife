import { useRef, useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { clamp } from '../lib/utils';

export function Compare({ before, after, beforeLabel = 'Original', afterLabel = 'Result' }: { before: string; after: string; beforeLabel?: string; afterLabel?: string }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  const update = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    setPos(clamp(((clientX - r.left) / r.width) * 100, 0, 100));
  };

  return (
    <div
      ref={ref}
      className="compare"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e.clientX);
      }}
      onPointerMove={(e) => e.buttons && update(e.clientX)}
    >
      <img src={before} alt="Original" draggable={false} />
      <div className="after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <img src={after} alt="Result" draggable={false} />
      </div>
      <div className="compare-line" style={{ left: `${pos}%` }}>
        <div className="compare-knob">
          <ChevronsLeftRight size={16} />
        </div>
      </div>
      <span className="compare-tag" style={{ left: 10 }}>
        {beforeLabel}
      </span>
      <span className="compare-tag" style={{ right: 10 }}>
        {afterLabel}
      </span>
    </div>
  );
}
