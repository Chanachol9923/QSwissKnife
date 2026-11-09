import { useMemo, useState } from 'react';
import { Search, Star, UploadCloud, X } from 'lucide-react';
import { CATEGORIES, TOOLS, categoryById, searchTools, toolById, type CategoryId, type Tool } from '../tools/registry';
import { cx } from '../lib/utils';
import { inDesktopApp } from '../lib/helper';
import { DownloadSetup } from './DownloadSetup';

interface Props {
  favs: string[];
  recent: string[];
  onToggleFav: (id: string) => void;
}

export function Home({ favs, recent, onToggleFav }: Props) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CategoryId | 'all'>('all');

  const filtered = useMemo(() => searchTools(q).filter((t) => cat === 'all' || t.category === cat), [q, cat]);
  const browsing = !q.trim() && cat === 'all';
  const favTools = favs.map(toolById).filter(Boolean) as Tool[];
  const recentTools = recent.map(toolById).filter(Boolean).slice(0, 4) as Tool[];

  const card = (t: Tool) => <ToolCard key={t.id} tool={t} fav={favs.includes(t.id)} onToggleFav={onToggleFav} />;

  return (
    <>
      <section className="hero">
        <h1>
          One knife, <span className="grad">every file job.</span>
        </h1>
        <p>Convert, compress, crop and transform images, video, audio, PDFs and data — processed locally in your browser. Nothing is uploaded.</p>
        <div className="hero-search">
          <Search size={18} className="muted" />
          <input
            placeholder={`Search ${TOOLS.length} tools…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) window.location.hash = `#/${filtered[0].id}`;
              if (e.key === 'Escape') setQ('');
            }}
          />
          {q && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setQ('')} aria-label="Clear">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="chips">
          <button className={cx('chip', cat === 'all' && 'on')} onClick={() => setCat('all')}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={cx('chip', cat === c.id && 'on')} onClick={() => setCat(c.id)}>
              <span className="nav-dot" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      </section>

      <a className="card drop-hint" href="#/convert">
        <span className="drop-icon">
          <UploadCloud size={22} />
        </span>
        <span style={{ minWidth: 0 }}>
          <b>Drop any file anywhere on this page to convert it</b>
          <span className="muted">The type is detected automatically — images, video, audio, PDF, Word, Excel, data, subtitles, fonts and archives.</span>
        </span>
      </a>

      {!inDesktopApp && (
        <div className="card app-banner">
          <div className="app-banner-text">
            <b>QSwissKnife for Windows</b>
            <span className="muted">Its own window and taskbar icon, works offline, and adds the YouTube Downloader.</span>
          </div>
          <DownloadSetup />
        </div>
      )}

      {browsing ? (
        <>
          {favTools.length > 0 && (
            <>
              <div className="section-title">
                <Star size={14} /> Favorites
              </div>
              <div className="tool-grid">{favTools.map(card)}</div>
            </>
          )}
          {recentTools.length > 0 && (
            <>
              <div className="section-title">Recently used</div>
              <div className="tool-grid">{recentTools.map(card)}</div>
            </>
          )}
          {CATEGORIES.map((c) => {
            const tools = TOOLS.filter((t) => t.category === c.id);
            return (
              <div key={c.id}>
                <div className="section-title">
                  <span className="nav-dot" style={{ background: c.color }} />
                  {c.name} <span className="count">{tools.length}</span>
                </div>
                <div className="tool-grid">{tools.map(card)}</div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div className="section-title">
            Results <span className="count">{filtered.length}</span>
          </div>
          {filtered.length ? <div className="tool-grid">{filtered.map(card)}</div> : <div className="empty">Nothing matches “{q}”. Try “compress” or “pdf”.</div>}
        </>
      )}
    </>
  );
}

function ToolCard({ tool, fav, onToggleFav }: { tool: Tool; fav: boolean; onToggleFav: (id: string) => void }) {
  const Icon = tool.icon;
  return (
    <a className="tool-card" href={`#/${tool.id}`} style={{ ['--cat' as string]: categoryById(tool.category).color }}>
      <button
        className={cx('btn btn-ghost btn-icon btn-sm star', fav && 'on')}
        title={fav ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => {
          e.preventDefault();
          onToggleFav(tool.id);
        }}
      >
        <Star size={15} fill={fav ? 'currentColor' : 'none'} />
      </button>
      <span className="ti">
        <Icon size={19} />
      </span>
      <div>
        <h3>{tool.name}</h3>
        <p>{tool.desc}</p>
      </div>
    </a>
  );
}
