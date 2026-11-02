import { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, Download, ExternalLink, ListChecks, Loader2, RotateCcw, Square, Trash2, XCircle } from 'lucide-react';
import { categoryById, toolById } from '../tools/registry';
import { summarize, useTaskSources, type TaskInfo, type TaskSource } from './tasks';
import { Progress, Segmented, ShareButton } from './ui';
import { cx, downloadBlob, formatBytes, formatTime } from '../lib/utils';

type Filter = 'all' | 'active' | 'done' | 'failed';

const matches = (t: TaskInfo, f: Filter) =>
  f === 'all' || (f === 'active' ? t.status === 'running' || t.status === 'queued' : f === 'done' ? t.status === 'done' : t.status === 'error' || t.status === 'canceled');

export function TasksPage({ onOpen }: { onOpen: (toolId: string, focus?: () => void) => void }) {
  const sources = useTaskSources();
  const [filter, setFilter] = useState<Filter>('all');
  const all = sources.flatMap((s) => s.tasks);
  const sum = summarize(all);

  // tick once a second so elapsed / ETA stay fresh
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sum.running) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [sum.running]);

  const groups = sources
    .map((s) => ({ s, tasks: s.tasks.filter((t) => matches(t, filter)) }))
    .filter((g) => g.tasks.length > 0)
    // tools with work in progress first
    .sort((a, b) => summarize(b.s.tasks).active - summarize(a.s.tasks).active);

  return (
    <div className="stack">
      <div className="tool-head" style={{ marginBottom: 4 }}>
        <div className="tool-icon" style={{ ['--cat' as string]: 'var(--accent)' }}>
          <ListChecks size={24} />
        </div>
        <div>
          <h1>Running tasks</h1>
          <p>Everything in progress across your open tools. Switch freely — jobs keep running in their tabs.</p>
        </div>
      </div>

      <div className="stat-grid">
        <Stat icon={<Loader2 size={16} className={cx(sum.running > 0 && 'spin')} />} value={sum.running} label="running" tone="accent" />
        <Stat icon={<CircleDashed size={16} />} value={sum.queued} label="waiting" />
        <Stat icon={<CheckCircle2 size={16} />} value={sum.done} label="done" tone="good" />
        <Stat icon={<XCircle size={16} />} value={sum.errors} label="failed" tone={sum.errors ? 'bad' : undefined} />
      </div>
      {sum.active > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <Progress value={sum.overall} />
          <span className="field-hint">{Math.round(sum.overall * 100)}% of all active work</span>
        </div>
      )}

      {all.length > 0 && (
        <div className="row">
          <Segmented
            options={[
              { value: 'all', label: `All ${all.length}` },
              { value: 'active', label: `Active ${sum.active}` },
              { value: 'done', label: `Done ${sum.done}` },
              { value: 'failed', label: `Failed ${all.filter((t) => matches(t, 'failed')).length}` },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>
      )}

      {all.length === 0 ? (
        <div className="card empty">
          <ListChecks size={28} style={{ opacity: 0.5 }} />
          <p style={{ margin: '10px 0 0' }}>No tasks yet. Start a job in any tool — it keeps going while you open other tools, and shows up here.</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty">Nothing matches this filter.</div>
      ) : (
        groups.map(({ s, tasks }) => <ToolGroup key={s.key} source={s} tasks={tasks} onOpen={onOpen} />)
      )}
    </div>
  );
}

function Stat({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone?: 'accent' | 'good' | 'bad' }) {
  const color = tone === 'accent' ? 'var(--accent-text)' : tone === 'good' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : 'var(--muted)';
  return (
    <div className="stat">
      <div className="row" style={{ gap: 8, color }}>
        {icon}
        <b style={{ color: 'var(--text)' }}>{value}</b>
      </div>
      <span>{label}</span>
    </div>
  );
}

function ToolGroup({ source, tasks, onOpen }: { source: TaskSource; tasks: TaskInfo[]; onOpen: (toolId: string, focus?: () => void) => void }) {
  const tool = toolById(source.toolId);
  if (!tool) return null;
  const Icon = tool.icon;
  const sum = summarize(source.tasks);
  return (
    <div className="card task-group" style={{ ['--cat' as string]: categoryById(tool.category).color }}>
      <div className="task-group-head">
        <span className="ti">
          <Icon size={17} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b>{tool.name}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {[sum.running && `${sum.running} running`, sum.queued && `${sum.queued} waiting`, sum.done && `${sum.done} done`, sum.errors && `${sum.errors} failed`].filter(Boolean).join(' · ') || 'idle'}
          </div>
        </div>
        {source.clearFinished && sum.done > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={source.clearFinished} title="Remove finished items from this tool">
            <Trash2 size={14} /> Clear done
          </button>
        )}
        <button className="btn btn-sm" onClick={() => onOpen(source.toolId)}>
          <ExternalLink size={14} /> Open
        </button>
      </div>
      <div className="files">
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} onShow={() => onOpen(source.toolId, t.focus)} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ t, onShow }: { t: TaskInfo; onShow: () => void }) {
  const elapsed = t.startedAt ? ((t.finishedAt ?? Date.now()) - t.startedAt) / 1000 : 0;
  const eta = t.status === 'running' && t.progress && t.progress > 0.03 ? (elapsed * (1 - t.progress)) / t.progress : null;
  return (
    <div className="file-row task-row" onClick={onShow} title="Show in its tool">
      <div className="task-status">
        {t.status === 'running' ? (
          <Loader2 size={16} className="spin" style={{ color: 'var(--accent-text)' }} />
        ) : t.status === 'queued' ? (
          <CircleDashed size={16} className="muted" />
        ) : t.status === 'done' ? (
          <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
        ) : (
          <XCircle size={16} style={{ color: t.status === 'error' ? 'var(--danger)' : 'var(--muted)' }} />
        )}
      </div>
      <div className="file-meta">
        <div className="file-name">{t.result?.name ?? t.name}</div>
        {t.status === 'running' ? (
          <div style={{ marginTop: 6 }}>
            <Progress value={t.progress && t.progress > 0 ? t.progress : null} />
            <div className="file-sub" style={{ marginTop: 3 }}>
              <span>{t.stage ?? 'Working…'}</span>
              {t.progress != null && t.progress > 0 && <span className="mono">{Math.round(t.progress * 100)}%</span>}
              {eta != null && <span>· ~{formatTime(eta)} left</span>}
            </div>
          </div>
        ) : (
          <div className="file-sub">
            {t.status === 'queued' && <span>Waiting for a free slot</span>}
            {t.status === 'done' && (
              <>
                <span className="badge good">Done</span>
                {t.result && <span>{formatBytes(t.result.blob.size)}</span>}
                {elapsed > 0 && <span>· took {formatTime(elapsed)}</span>}
              </>
            )}
            {t.status === 'error' && <span style={{ color: 'var(--danger)' }}>{t.error ?? 'Failed'}</span>}
            {t.status === 'canceled' && <span>Canceled</span>}
          </div>
        )}
      </div>
      <div className="file-actions" onClick={(e) => e.stopPropagation()}>
        {t.result && (
          <>
            <ShareButton blob={t.result.blob} name={t.result.name} />
            <button className="btn btn-sm btn-icon" title={`Download ${t.result.name}`} onClick={() => downloadBlob(t.result!.blob, t.result!.name)}>
              <Download size={14} />
            </button>
          </>
        )}
        {t.retry && (
          <button className="btn btn-sm btn-icon" title="Retry" onClick={t.retry}>
            <RotateCcw size={14} />
          </button>
        )}
        {t.cancel && (
          <button className="btn btn-ghost btn-sm btn-icon" title="Cancel" onClick={t.cancel}>
            <Square size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
