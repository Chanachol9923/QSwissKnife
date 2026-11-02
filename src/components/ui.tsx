import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Info, Share, XCircle } from 'lucide-react';
import { copyText, cx } from '../lib/utils';

export function Field({ label, value, hint, children }: { label: ReactNode; value?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {value != null && <em>{value}</em>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export interface SegOption<T> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  block,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  block?: boolean;
}) {
  return (
    <div className={cx('seg', block && 'block')} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx(o.value === value && 'on')}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return <input className="range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function NumberInput({ value, onChange, min, max, step, placeholder, suffix }: { value: number | ''; onChange: (v: number | '') => void; min?: number; max?: number; step?: number; placeholder?: string; suffix?: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input mono"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={suffix ? { paddingRight: 34 } : undefined}
      />
      {suffix && <span style={{ position: 'absolute', right: 10, top: 8, fontSize: 12, color: 'var(--muted)', pointerEvents: 'none' }}>{suffix}</span>}
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'warn'; children: ReactNode }) {
  const Icon = kind === 'error' ? XCircle : kind === 'warn' ? AlertTriangle : Info;
  return (
    <div className={cx('alert', kind)}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div className={cx('progress', value == null && 'indeterminate')}>
      <div style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', small = true, className }: { text: string; label?: string; small?: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cx('btn', small && 'btn-sm', className)}
      disabled={!text}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {label && (done ? 'Copied' : label)}
    </button>
  );
}

/** Native share sheet (iOS: “Save Video”, “Save to Files”, AirDrop…). Renders nothing where unsupported. */
export function ShareButton({ blob, name, label }: { blob: Blob; name: string; label?: string }) {
  const file = useMemo(() => new File([blob], name, { type: blob.type }), [blob, name]);
  const can = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (!can) return null;
  return (
    <button
      type="button"
      className={cx('btn', label ? '' : 'btn-sm btn-icon')}
      title="Share / save to device"
      onClick={(e) => {
        e.stopPropagation();
        navigator.share({ files: [file] }).catch(() => {});
      }}
    >
      <Share size={label ? 16 : 14} />
      {label}
    </button>
  );
}

/* ---------- Toasts ---------- */
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string; action?: ToastAction };
const ToastCtx = createContext<(text: string, kind?: Toast['kind'], action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((text: string, kind: Toast['kind'] = 'success', action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    // toasts with an action stay a little longer so there's time to click
    setTimeout(() => dismiss(id), action ? 6500 : 3200);
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', t.kind)}>
            {t.kind === 'error' ? <XCircle size={16} /> : t.kind === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.action && (
              <button className="btn btn-sm" onClick={() => (t.action!.onClick(), dismiss(t.id))}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
