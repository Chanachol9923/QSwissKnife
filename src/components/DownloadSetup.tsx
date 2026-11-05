import { useEffect, useState } from 'react';
import { Download, Loader2, Monitor } from 'lucide-react';
import { REPO, inDesktopApp, isWindows, latestSetup, type SetupRelease } from '../lib/helper';
import { cx, formatBytes } from '../lib/utils';

/**
 * "Download for Windows" — fetches the newest QSwissKnife-Setup from GitHub Releases.
 * Hidden inside the desktop app itself.
 */
export function DownloadSetup({ compact, className }: { compact?: boolean; className?: string }) {
  const [rel, setRel] = useState<SetupRelease | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!compact && !inDesktopApp) latestSetup().then(setRel);
  }, [compact]);

  if (inDesktopApp) return null;
  if (compact && !isWindows) return null;

  const go = async () => {
    setBusy(true);
    const r = rel ?? (await latestSetup());
    setBusy(false);
    // no release published yet (or GitHub unreachable): send people to the Releases page instead
    if (r) window.location.href = r.url;
    else window.open(`${REPO}/releases`, '_blank', 'noopener');
  };

  return (
    <div className={cx('download-setup', compact && 'compact', className)}>
      <button className={cx('btn', compact ? 'btn-sm btn-block' : 'btn-primary')} onClick={go} disabled={busy} title="Install QSwissKnife on this PC">
        {busy ? <Loader2 size={15} className="spin" /> : compact ? <Download size={14} /> : <Monitor size={16} />}
        {compact ? 'Get the Windows app' : 'Download for Windows'}
      </button>
      {!compact && (
        <span className="field-hint">
          {rel ? `Version ${rel.version} · ${formatBytes(rel.size)} · ` : ''}
          Windows 10/11, no admin needed{isWindows ? '' : ' (this computer isn’t Windows)'}
        </span>
      )}
    </div>
  );
}
