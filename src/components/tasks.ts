/*
 * App-wide task registry. Every open tool tab publishes its jobs here so the "Running tasks" tab,
 * the tab bar and the window title can show what's happening across all tools at once.
 */
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface TaskInfo {
  /** unique within its source */
  id: string;
  name: string;
  status: TaskStatus;
  /** 0..1, or null when unknown */
  progress: number | null;
  stage?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: { blob: Blob; name: string };
  cancel?: () => void;
  retry?: () => void;
  /** bring this item into view inside its tool */
  focus?: () => void;
}

export interface TaskSource {
  key: string;
  toolId: string;
  tasks: TaskInfo[];
  clearFinished?: () => void;
}

/* ---------- store ---------- */

const sources = new Map<string, TaskSource>();
const listeners = new Set<() => void>();
let snapshot: TaskSource[] = [];

function emit() {
  snapshot = [...sources.values()];
  listeners.forEach((l) => l());
}

export function publish(source: TaskSource) {
  sources.set(source.key, source);
  emit();
}

export function unpublish(key: string) {
  if (sources.delete(key)) emit();
}

export function useTaskSources(): TaskSource[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

export const isActive = (t: TaskInfo) => t.status === 'running' || t.status === 'queued';

export function summarize(tasks: TaskInfo[]) {
  const running = tasks.filter((t) => t.status === 'running').length;
  const queued = tasks.filter((t) => t.status === 'queued').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const errors = tasks.filter((t) => t.status === 'error').length;
  const counted = tasks.filter((t) => t.status !== 'canceled' && t.status !== 'error');
  const overall = counted.length ? counted.reduce((s, t) => s + (t.status === 'done' ? 1 : t.status === 'running' ? t.progress ?? 0 : 0), 0) / counted.length : 0;
  return { running, queued, done, errors, active: running + queued, overall };
}

/* ---------- per-tool context ---------- */

export interface ToolScope {
  toolId: string;
  /** whether this tool's tab is the visible one */
  active: boolean;
}

export const ToolScopeContext = createContext<ToolScope>({ toolId: 'unknown', active: true });
export const useToolScope = () => useContext(ToolScopeContext);

let seq = 0;

/** Publish a tool's task list (re-published whenever `tasks` changes, removed on unmount). */
export function usePublishTasks(tasks: TaskInfo[], clearFinished?: () => void) {
  const { toolId } = useToolScope();
  const key = useRef(`${toolId}#${++seq}`).current;
  const clearRef = useRef(clearFinished);
  clearRef.current = clearFinished;
  useEffect(() => {
    publish({ key, toolId, tasks, clearFinished: clearRef.current && (() => clearRef.current?.()) });
  }, [key, toolId, tasks]);
  useEffect(() => () => unpublish(key), [key]);
}
