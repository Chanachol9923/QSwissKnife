import { useEffect, useRef } from 'react';
import { Home as HomeIcon, ListChecks, X } from 'lucide-react';
import { categoryById, toolById } from '../tools/registry';
import { summarize, type TaskInfo } from './tasks';
import { cx } from '../lib/utils';

export interface TabState {
  tasks: TaskInfo[];
  /** finished while the tab wasn't being looked at */
  unseen: number;
}

interface Props {
  tabs: string[];
  active: string;
  state: Record<string, TabState>;
  totalActive: number;
  totalRunning: number;
  onClose: (id: string) => void;
}

/** Small progress ring for tabs with work in progress. */
function Ring({ value }: { value: number | null }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg className={cx('ring', value == null && 'ring-spin')} width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="2.4" />
      <circle
        cx="9" cy="9" r={r} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round"
        strokeDasharray={`${c * (value ?? 0.28)} ${c}`} transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

export function TabBar({ tabs, active, state, totalActive, totalRunning, onClose }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  // keep the active tab in view
  useEffect(() => {
    scroller.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  return (
    <div className="tabbar" role="tablist">
      <div className="tabbar-scroll" ref={scroller}>
        <a className={cx('tab tab-home', active === '' && 'active')} href="#/" role="tab" aria-selected={active === ''} title="All tools">
          <HomeIcon size={15} />
          <span className="tab-label desktop-only">Home</span>
        </a>
        {tabs.map((id) => {
          const tool = toolById(id);
          if (!tool) return null;
          const Icon = tool.icon;
          const st = state[id] ?? { tasks: [], unseen: 0 };
          const sum = summarize(st.tasks);
          const errors = st.tasks.some((t) => t.status === 'error');
          return (
            <a
              key={id}
              className={cx('tab', active === id && 'active')}
              href={`#/${id}`}
              role="tab"
              aria-selected={active === id}
              style={{ ['--cat' as string]: categoryById(tool.category).color }}
              title={sum.active ? `${tool.name} — ${sum.running} running, ${sum.queued} waiting (${Math.round(sum.overall * 100)}%)` : tool.name}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(id);
                }
              }}
            >
              {sum.active ? <Ring value={sum.running ? sum.overall : null} /> : <Icon size={15} className="tab-icon" />}
              <span className="tab-label">{tool.name}</span>
              {sum.active > 0 && <span className="tab-count">{sum.active}</span>}
              {!sum.active && errors && <span className="tab-dot bad" title="Something failed" />}
              {!sum.active && !errors && st.unseen > 0 && <span className="tab-dot good" title={`${st.unseen} finished`} />}
              <button
                className="tab-close"
                title="Close tab"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(id);
                }}
              >
                <X size={13} />
              </button>
            </a>
          );
        })}
      </div>
      <a className={cx('tab tab-tasks', active === 'tasks' && 'active', totalActive > 0 && 'busy')} href="#/tasks" role="tab" aria-selected={active === 'tasks'} title="Running tasks">
        <ListChecks size={15} />
        <span className="tab-label desktop-only">Tasks</span>
        {totalActive > 0 && (
          <span className="tab-count">
            {totalRunning > 0 && <span className="pulse" />}
            {totalActive}
          </span>
        )}
      </a>
    </div>
  );
}
