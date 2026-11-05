import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Home as HomeIcon, ListChecks, Loader2, Menu, Moon, Search, ShieldCheck, Star, Sun } from 'lucide-react';
import { CATEGORIES, TOOLS, categoryById, toolById, type Tool } from './tools/registry';
import { Palette } from './components/Palette';
import { Home } from './components/Home';
import { TabBar, type TabState } from './components/TabBar';
import { TasksPage } from './components/TasksPage';
import { DownloadSetup } from './components/DownloadSetup';
import { ToolScopeContext, summarize, useTaskSources, type TaskInfo } from './components/tasks';
import { usePersistent } from './components/hooks';
import { useToast } from './components/ui';
import { cx } from './lib/utils';

/** scroll position per route, so switching tabs returns you to where you were */
const scrollMemory = new Map<string, number>();

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    let current = read();
    const on = () => {
      scrollMemory.set(current, window.scrollY); // still the old page's scroll at this point
      current = read();
      setRoute(current);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const toolHref = (id: string) => `#/${id}`;
const go = (route: string) => {
  window.location.hash = `#/${route}`;
};

export default function App() {
  const route = useHashRoute();
  const tool = toolById(route);
  const activeKey = tool ? tool.id : route === 'tasks' ? 'tasks' : route === '' ? '' : '?';
  const [theme, setTheme] = usePersistent<'dark' | 'light'>('sk-theme', 'dark');
  const [favs, setFavs] = usePersistent<string[]>('sk-favs', []);
  const [recent, setRecent] = usePersistent<string[]>('sk-recent', []);
  const [tabs, setTabs] = usePersistent<string[]>('sk-tabs', []);
  // tools are only mounted once opened this session; after that they stay alive until their tab closes
  const [mounted, setMounted] = useState<string[]>([]);
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const toast = useToast();
  const prevKey = useRef(activeKey);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f6fa' : '#0a0c10');
  }, [theme]);

  useEffect(() => {
    setNavOpen(false);
    requestAnimationFrame(() => window.scrollTo({ top: scrollMemory.get(route) ?? 0 }));
    if (tool) {
      setRecent((r) => [tool.id, ...r.filter((x) => x !== tool.id)].slice(0, 6));
      setTabs((t) => (t.includes(tool.id) ? t : [...t, tool.id]));
      setMounted((m) => (m.includes(tool.id) ? m : [...m, tool.id]));
    }
    // the tab we're leaving and the one we're entering are both "seen" up to now
    const now = Date.now();
    setLastSeen((s) => ({ ...s, [prevKey.current]: now, [activeKey]: now }));
    prevKey.current = activeKey;
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- tasks across tabs ---------- */
  const sources = useTaskSources();
  const tabState = useMemo(() => {
    const out: Record<string, TabState> = {};
    for (const s of sources) {
      const st = (out[s.toolId] ??= { tasks: [], unseen: 0 });
      st.tasks = st.tasks.concat(s.tasks);
    }
    for (const [id, st] of Object.entries(out)) {
      if (id === activeKey) continue;
      const seen = lastSeen[id] ?? 0;
      st.unseen = st.tasks.filter((t: TaskInfo) => t.status === 'done' && (t.finishedAt ?? 0) > seen).length;
    }
    return out;
  }, [sources, lastSeen, activeKey]);
  const totals = summarize(sources.flatMap((s) => s.tasks));

  // Tell the user when a background tab finishes its batch.
  const prevActive = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const [id, st] of Object.entries(tabState)) {
      const sum = summarize(st.tasks);
      const before = prevActive.current[id] ?? 0;
      prevActive.current[id] = sum.active;
      if (before > 0 && sum.active === 0 && id !== activeKey) {
        const name = toolById(id)?.name ?? id;
        const failed = st.tasks.filter((t) => t.status === 'error').length;
        toast(`${name}: ${sum.done} done${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'success', { label: 'Open', onClick: () => go(id) });
      }
    }
  }, [tabState]); // eslint-disable-line react-hooks/exhaustive-deps

  // window title (also visible on the taskbar) shows how much is still running
  useEffect(() => {
    const base = tool ? `${tool.name} · QSwissKnife` : route === 'tasks' ? 'Running tasks · QSwissKnife' : 'QSwissKnife';
    document.title = totals.active ? `(${totals.active}) ${base}` : base;
  }, [tool, route, totals.active]);

  // closing the window would lose running work
  const activeRef = useRef(0);
  activeRef.current = totals.active;
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const closeTab = (id: string) => {
    const sum = summarize(tabState[id]?.tasks ?? []);
    const name = toolById(id)?.name ?? id;
    if (sum.active && !window.confirm(`${name} still has ${sum.active} task${sum.active > 1 ? 's' : ''} in progress.\nClosing the tab cancels them. Close anyway?`)) return;
    const idx = tabs.indexOf(id);
    const rest = tabs.filter((t) => t !== id);
    setTabs(rest);
    setMounted((m) => m.filter((t) => t !== id));
    scrollMemory.delete(id);
    if (activeKey === id) go(rest[idx] ?? rest[idx - 1] ?? '');
  };

  const openFromTasks = (toolId: string, focus?: () => void) => {
    go(toolId);
    if (focus) setTimeout(() => (focus(), window.scrollTo({ top: 0, behavior: 'smooth' })), 60);
  };

  const toggleFav = (id: string) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const favTools = useMemo(() => favs.map(toolById).filter(Boolean) as Tool[], [favs]);

  return (
    <div className="app">
      <div className={cx('scrim', navOpen && 'open')} onClick={() => setNavOpen(false)} />
      <aside className={cx('sidebar', navOpen && 'open')}>
        <div className="sidebar-head">
          <a className="logo" href="#/">
            <span className="logo-mark">
              <KnifeMark />
            </span>
            <span>
              QSwissKnife
              <small>by AnnoyingDoggo · {TOOLS.length} tools</small>
            </span>
          </a>
        </div>
        <button className="search-btn" onClick={() => setPaletteOpen(true)}>
          <Search size={15} />
          <span>Search tools…</span>
          <span className="kbd desktop-only">Ctrl K</span>
        </button>
        <nav className="nav">
          <a className={cx('nav-link', activeKey === '' && 'active')} href="#/">
            <HomeIcon size={16} /> All tools
          </a>
          <a className={cx('nav-link', activeKey === 'tasks' && 'active')} href="#/tasks">
            <ListChecks size={16} /> Running tasks
            {totals.active > 0 && <span className="badge accent" style={{ marginLeft: 'auto', height: 20 }}>{totals.active}</span>}
          </a>
          {favTools.length > 0 && (
            <div className="nav-section">
              <div className="nav-title">
                <Star size={11} /> Favorites
              </div>
              {favTools.map((t) => (
                <NavLink key={t.id} tool={t} active={t.id === tool?.id} busy={summarize(tabState[t.id]?.tasks ?? []).active} />
              ))}
            </div>
          )}
          {CATEGORIES.map((c) => (
            <div className="nav-section" key={c.id}>
              <div className="nav-title">
                <span className="nav-dot" style={{ background: c.color }} />
                {c.name}
              </div>
              {TOOLS.filter((t) => t.category === c.id).map((t) => (
                <NavLink key={t.id} tool={t} active={t.id === tool?.id} busy={summarize(tabState[t.id]?.tasks ?? []).active} />
              ))}
            </div>
          ))}
        </nav>
        <DownloadSetup compact className="sidebar-download" />
        <div className="sidebar-foot">
          <ShieldCheck size={14} />
          Files never leave your device
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="crumbs">
            <a href="#/">Home</a>
            {tool && (
              <>
                <ChevronRight size={14} />
                <span>{categoryById(tool.category).name}</span>
                <ChevronRight size={14} />
                <b>{tool.name}</b>
              </>
            )}
            {activeKey === 'tasks' && (
              <>
                <ChevronRight size={14} />
                <b>Running tasks</b>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {tool && (
              <button className="btn btn-ghost btn-icon" onClick={() => toggleFav(tool.id)} title={favs.includes(tool.id) ? 'Remove from favorites' : 'Add to favorites'}>
                <Star size={17} className={cx('star', favs.includes(tool.id) && 'on')} fill={favs.includes(tool.id) ? 'currentColor' : 'none'} />
              </button>
            )}
            <button className="btn btn-ghost btn-icon" onClick={() => setPaletteOpen(true)} aria-label="Search">
              <Search size={17} />
            </button>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <TabBar tabs={tabs} active={activeKey} state={tabState} totalActive={totals.active} totalRunning={totals.running} onClose={closeTab} />

        <main className="content">
          {activeKey === '' && <Home favs={favs} recent={recent} onToggleFav={toggleFav} />}
          {activeKey === 'tasks' && <TasksPage onOpen={openFromTasks} />}
          {activeKey === '?' && (
            <div className="empty">
              <h2>Tool not found</h2>
              <a href="#/">Back to all tools</a>
            </div>
          )}
          {tabs
            .filter((id) => mounted.includes(id))
            .map((id) => {
              const t = toolById(id);
              return t ? <ToolPane key={id} tool={t} active={id === activeKey} /> : null;
            })}
        </main>
      </div>

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} recent={recent} />}
    </div>
  );
}

function NavLink({ tool, active, busy }: { tool: Tool; active: boolean; busy: number }) {
  const Icon = tool.icon;
  return (
    <a className={cx('nav-link', active && 'active')} href={toolHref(tool.id)}>
      <Icon size={16} />
      {tool.name}
      {busy > 0 && <Loader2 size={13} className="spin" style={{ marginLeft: 'auto', color: 'var(--accent-text)' }} />}
    </a>
  );
}

/** One tool tab. Stays mounted while hidden so its files, settings and running jobs survive. */
function ToolPane({ tool, active }: { tool: Tool; active: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const scope = useMemo(() => ({ toolId: tool.id, active }), [tool.id, active]);
  useEffect(() => {
    // don't leave previews playing in a tab you can't see
    if (!active) ref.current?.querySelectorAll('video, audio').forEach((m) => (m as HTMLMediaElement).pause());
  }, [active]);
  return (
    <section ref={ref} hidden={!active} role="tabpanel" aria-label={tool.name}>
      <ToolScopeContext.Provider value={scope}>
        <ToolPage tool={tool} />
      </ToolScopeContext.Provider>
    </section>
  );
}

function ToolPage({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const Comp = tool.component;
  const cat = categoryById(tool.category);
  return (
    <div style={{ ['--cat' as string]: cat.color }}>
      <div className="tool-head">
        <div className="tool-icon">
          <Icon size={24} />
        </div>
        <div>
          <h1>{tool.name}</h1>
          <p>{tool.desc}</p>
        </div>
      </div>
      <ToolErrorBoundary>
        <Suspense
          fallback={
            <div className="empty">
              <Loader2 className="spin" />
            </div>
          }
        >
          <Comp />
        </Suspense>
      </ToolErrorBoundary>
    </div>
  );
}

class ToolErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty stack" style={{ alignItems: 'center' }}>
        <b>This tool hit an unexpected error.</b>
        <span className="mono" style={{ fontSize: 12 }}>{this.state.error.message}</span>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Reload tool
        </button>
      </div>
    );
  }
}

export function KnifeMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20 L17 5 l2.5 2.5 L8 21 Z" fill="currentColor" fillOpacity=".25" />
      <path d="M8 16 l2 2" />
    </svg>
  );
}
