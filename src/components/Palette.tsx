import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { categoryById, searchTools, toolById, type Tool } from '../tools/registry';
import { cx } from '../lib/utils';

export function Palette({ onClose, recent }: { onClose: () => void; recent: string[] }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (q.trim()) return searchTools(q);
    const rec = recent.map(toolById).filter(Boolean) as Tool[];
    return [...rec, ...searchTools('').filter((t) => !recent.includes(t.id))];
  }, [q, recent]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const go = (t?: Tool) => {
    if (!t) return;
    window.location.hash = `#/${t.id}`;
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search tools">
        <div className="palette-input">
          <Search size={18} className="muted" />
          <input
            autoFocus
            placeholder="What do you want to do? e.g. “compress video”"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') go(results[sel]);
              else if (e.key === 'Escape') onClose();
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" ref={list}>
          {!q.trim() && recent.length > 0 && <div className="nav-title" style={{ padding: '6px 10px' }}>Recent</div>}
          {results.length === 0 && <div className="empty">No tools match “{q}”</div>}
          {results.map((t, i) => {
            const Icon = t.icon;
            return (
              <div
                key={t.id}
                className={cx('palette-item', i === sel && 'sel')}
                style={{ ['--cat' as string]: categoryById(t.category).color }}
                onMouseMove={() => setSel(i)}
                onClick={() => go(t)}
              >
                <span className="ti">
                  <Icon size={16} />
                </span>
                <div className="pm">
                  <div>{t.name}</div>
                  <div>{t.desc}</div>
                </div>
                {i === sel && <CornerDownLeft size={14} className="muted" />}
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> navigate
          </span>
          <span>
            <span className="kbd">Enter</span> open
          </span>
          <span>
            <span className="kbd">/</span> or <span className="kbd">Ctrl K</span> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
