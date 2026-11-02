import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, UploadCloud } from 'lucide-react';
import { cx } from '../lib/utils';
import { useToolScope } from './tasks';

interface Props {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title?: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
  /** listen for Ctrl+V of files anywhere on the page */
  paste?: boolean;
}

function matches(file: File, accept: string) {
  if (!accept || accept === '*') return true;
  return accept.split(',').some((rule) => {
    const r = rule.trim().toLowerCase();
    if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r);
    if (r.endsWith('/*')) return file.type.startsWith(r.slice(0, -1));
    return file.type === r;
  });
}

export function FileDrop({ accept, multiple, onFiles, title, hint, compact, paste = true }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  // hidden tool tabs stay mounted; only the visible one should take pasted files
  const { active } = useToolScope();

  const take = (list: FileList | File[] | null) => {
    if (!list) return;
    let files = Array.from(list).filter((f) => matches(f, accept));
    if (!multiple) files = files.slice(0, 1);
    if (files.length) onFiles(files);
  };

  useEffect(() => {
    if (!paste || !active) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        take(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <div
      className={cx('drop', over && 'over', compact && 'compact')}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="drop-icon">{compact ? <Plus size={18} /> : <UploadCloud size={26} />}</div>
      {compact ? (
        <span className="muted">
          {title ?? (multiple ? 'Add more files' : 'Replace file')}
          <span className="desktop-only"> — drop, click or paste</span>
        </span>
      ) : (
        <>
          <strong>{title ?? (multiple ? 'Drop files here' : 'Drop a file here')}</strong>
          <span className="muted desktop-only">
            or click to browse · <span className="kbd">Ctrl</span> + <span className="kbd">V</span> to paste
          </span>
          <span className="muted touch-only">Tap to choose from Photos or Files</span>
          {hint && <span className="muted">{hint}</span>}
        </>
      )}
    </div>
  );
}
