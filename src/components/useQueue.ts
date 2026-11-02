import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePublishTasks, type TaskInfo } from './tasks';
import { uid } from '../lib/utils';

export type QStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface QItem<R, M = unknown, P = unknown> {
  id: string;
  file: File;
  status: QStatus;
  progress: number;
  stage?: string;
  result?: R;
  error?: string;
  /** probed facts about the file (duration, size…) */
  meta?: M;
  /** per-file user settings (trim range, crop rect…) */
  params?: P;
  startedAt?: number;
  finishedAt?: number;
}

export interface JobCtx {
  signal: AbortSignal;
  progress: (ratio: number) => void;
  stage: (text: string) => void;
}

interface Options<R, M, P> {
  concurrency: number;
  /** start jobs as soon as files arrive (images) vs. wait for start() (video) */
  auto: boolean;
  process: (item: QItem<R, M, P>, ctx: JobCtx) => Promise<R>;
  /** called from the Running tasks tab to show an item inside its tool */
  onFocus?: (id: string) => void;
}

/**
 * A file job queue. Files can be added at any time — while a batch is running they are
 * picked up as soon as a slot frees, up to `concurrency` jobs at once.
 */
export function useQueue<R, M = unknown, P = unknown>({ concurrency, auto, process, onFocus }: Options<R, M, P>) {
  const [items, setItems] = useState<QItem<R, M, P>[]>([]);
  const [running, setRunning] = useState(auto);
  const controllers = useRef(new Map<string, AbortController>());
  const processRef = useRef(process);
  processRef.current = process;

  const patch = useCallback((id: string, p: Partial<QItem<R, M, P>>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i))), []);

  const launch = (it: QItem<R, M, P>) => {
    const ctrl = new AbortController();
    controllers.current.set(it.id, ctrl);
    patch(it.id, { status: 'running', progress: 0, stage: undefined, error: undefined, result: undefined, startedAt: Date.now(), finishedAt: undefined });
    let last = 0;
    processRef
      .current(it, {
        signal: ctrl.signal,
        progress: (p) => {
          // throttle re-renders to ~10/s per job
          const now = Date.now();
          if (ctrl.signal.aborted || (now - last < 100 && p < 1)) return;
          last = now;
          patch(it.id, { progress: p });
        },
        stage: (s) => !ctrl.signal.aborted && patch(it.id, { stage: s, progress: 0 }),
      })
      .then((result) => !ctrl.signal.aborted && patch(it.id, { status: 'done', result, progress: 1, finishedAt: Date.now() }))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        console.error(e);
        patch(it.id, { status: 'error', error: (e as Error)?.message || String(e), finishedAt: Date.now() });
      })
      .finally(() => {
        if (controllers.current.get(it.id) === ctrl) controllers.current.delete(it.id);
      });
  };

  // scheduler: fill free slots with queued items
  useEffect(() => {
    if (!running) return;
    const busy = items.filter((i) => i.status === 'running').length;
    const queued = items.filter((i) => i.status === 'queued');
    if (!queued.length) {
      if (!busy && !auto) setRunning(false);
      return;
    }
    queued.slice(0, Math.max(0, concurrency - busy)).forEach(launch);
  }, [items, running, concurrency, auto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => controllers.current.forEach((c) => c.abort()), []);

  const abort = (id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
  };

  const cancel = (id: string) => {
    abort(id);
    patch(id, { status: 'canceled', progress: 0, stage: undefined });
  };
  const retry = (id: string) => {
    patch(id, { status: 'queued', error: undefined, result: undefined, progress: 0 });
    setRunning(true);
  };
  const clearFinished = () => setItems((prev) => prev.filter((i) => i.status !== 'done'));

  // Publish to the app-wide Running tasks view.
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;
  const tasks = useMemo<TaskInfo[]>(
    () =>
      items.map((i) => {
        const r = i.result as { blob?: Blob; name?: string } | undefined;
        return {
          id: i.id,
          name: i.file.name,
          status: i.status,
          progress: i.status === 'done' ? 1 : i.progress,
          stage: i.stage,
          startedAt: i.startedAt,
          finishedAt: i.finishedAt,
          error: i.error,
          result: r?.blob instanceof Blob ? { blob: r.blob, name: r.name ?? i.file.name } : undefined,
          cancel: i.status === 'running' || i.status === 'queued' ? () => cancel(i.id) : undefined,
          retry: i.status === 'error' || i.status === 'canceled' ? () => retry(i.id) : undefined,
          focus: () => focusRef.current?.(i.id),
        };
      }),
    [items], // eslint-disable-line react-hooks/exhaustive-deps
  );
  usePublishTasks(tasks, clearFinished);

  return {
    items,
    running,
    add: (files: File[], init?: (f: File) => Partial<QItem<R, M, P>>) => {
      const next = files.map((file) => ({ id: uid(), file, status: 'queued' as const, progress: 0, ...init?.(file) }));
      setItems((prev) => [...prev, ...next]);
      return next;
    },
    patch,
    start: () => {
      // retry anything that failed or was canceled, then go
      setItems((prev) => prev.map((i) => (i.status === 'error' || i.status === 'canceled' ? { ...i, status: 'queued', error: undefined } : i)));
      setRunning(true);
    },
    /** stop launching new jobs and cancel the running ones (they go back to the queue) */
    stop: () => {
      if (!auto) setRunning(false);
      setItems((prev) =>
        prev.map((i) => {
          if (i.status !== 'running') return i;
          abort(i.id);
          return { ...i, status: 'queued', progress: 0, stage: undefined };
        }),
      );
    },
    cancel,
    retry,
    remove: (id: string) => {
      abort(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    clear: () => {
      controllers.current.forEach((c) => c.abort());
      controllers.current.clear();
      setItems([]);
      if (!auto) setRunning(false);
    },
    clearFinished,
    /** settings changed — redo everything (running jobs are restarted) */
    requeueAll: () =>
      setItems((prev) =>
        prev.map((i) => {
          abort(i.id);
          return { ...i, status: 'queued', progress: 0, result: undefined, error: undefined, stage: undefined };
        }),
      ),
  };
}

export type Queue<R, M = unknown, P = unknown> = ReturnType<typeof useQueue<R, M, P>>;

export function queueStats(items: QItem<unknown, unknown, unknown>[]) {
  const count = (s: QStatus) => items.filter((i) => i.status === s).length;
  const counted = items.filter((i) => i.status !== 'canceled' && i.status !== 'error');
  const overall = counted.length ? counted.reduce((s, i) => s + (i.status === 'done' ? 1 : i.status === 'running' ? i.progress : 0), 0) / counted.length : 0;
  return { done: count('done'), running: count('running'), queued: count('queued'), errors: count('error'), canceled: count('canceled'), overall };
}
