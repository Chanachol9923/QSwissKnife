/* Files dropped anywhere in the app (e.g. on Home) waiting to be picked up by Convert Anything. */
const pending: File[] = [];
const listeners = new Set<() => void>();

export function sendToConverter(files: File[]) {
  if (!files.length) return;
  pending.push(...files);
  listeners.forEach((l) => l());
}

/** Take everything waiting (called by the converter when it mounts and on every new drop). */
export function takePending(): File[] {
  return pending.splice(0, pending.length);
}

export function onPending(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
