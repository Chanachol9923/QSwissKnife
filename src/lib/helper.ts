/*
 * Where the local helper lives, and how to get the desktop installer.
 *
 * - Dev server (localhost:5173) and the desktop app (127.0.0.1:4317) serve /api/yt themselves.
 * - Hosted copies (e.g. Vercel) talk to the helper the desktop app runs on this computer.
 */
export const HELPER_PORT = 4317;
export const REPO = 'https://github.com/Chanachol9923/QSwissKnife';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const host = typeof location === 'undefined' ? 'localhost' : location.hostname;

/** true when the page is served from somewhere other than this computer */
export const isHosted = !LOCAL_HOSTS.includes(host);
/** prefix for helper API calls */
export const helperBase = isHosted ? `http://127.0.0.1:${HELPER_PORT}` : '';
/** running inside the installed QSwissKnife window */
export const inDesktopApp = !isHosted && typeof location !== 'undefined' && location.port === String(HELPER_PORT);
export const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

export interface SetupRelease {
  url: string;
  version: string;
  size: number;
}

let latest: Promise<SetupRelease | null> | null = null;

/** Latest installer from GitHub Releases (looked up once per page load). */
export function latestSetup(): Promise<SetupRelease | null> {
  latest ??= fetch('https://api.github.com/repos/Chanachol9923/QSwissKnife/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((rel: { tag_name?: string; assets?: { name: string; size: number; browser_download_url: string }[] } | null) => {
      const asset = rel?.assets?.find((a) => /setup.*\.exe$/i.test(a.name));
      return asset ? { url: asset.browser_download_url, version: (rel!.tag_name ?? '').replace(/^v/, ''), size: asset.size } : null;
    })
    .catch(() => null);
  return latest;
}
