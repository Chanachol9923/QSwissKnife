import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Download, RefreshCw, Upload } from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { Alert, CopyButton, Field, NumberInput, Segmented, Switch } from '../components/ui';
import { usePersistent } from '../components/hooks';
import { downloadBlob, formatBytes } from '../lib/utils';

function Output({ value, label = 'Output', placeholder, minHeight = 320, file }: { value: string; label?: string; placeholder?: string; minHeight?: number; file?: string }) {
  return (
    <Field label={label}>
      <div className="out-box">
        <textarea className="textarea" readOnly value={value} placeholder={placeholder} style={{ minHeight }} />
        <div className="copy-fab row" style={{ gap: 4 }}>
          {file && value && (
            <button className="btn btn-sm btn-icon" title="Download" onClick={() => downloadBlob(new Blob([value]), file)}>
              <Download size={14} />
            </button>
          )}
          <CopyButton text={value} />
        </div>
      </div>
    </Field>
  );
}

/* ---------- JSON ---------- */
function jsonError(text: string, e: Error) {
  const m = e.message.match(/position (\d+)/);
  if (!m) return e.message;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `${e.message.replace(/ in JSON at position \d+.*/, '')} — line ${line}, column ${col}`;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

export function JsonFormatter() {
  const [input, setInput] = usePersistent('sk-json', '{"name":"QSwiftKnife","tools":30,"offline":true,"tags":["image","video","pdf"]}');
  const [indent, setIndent] = useState<'2' | '4' | 'tab' | 'min'>('2');
  const [sort, setSort] = useState(false);

  const { out, error, stats } = useMemo(() => {
    if (!input.trim()) return { out: '', error: '', stats: '' };
    try {
      let v = JSON.parse(input);
      if (sort) v = sortKeys(v);
      const out = indent === 'min' ? JSON.stringify(v) : JSON.stringify(v, null, indent === 'tab' ? '\t' : Number(indent));
      const kind = Array.isArray(v) ? `array of ${v.length}` : v && typeof v === 'object' ? `object, ${Object.keys(v).length} keys` : typeof v;
      return { out, error: '', stats: `Valid JSON · ${kind} · ${formatBytes(new Blob([out]).size)}` };
    } catch (e) {
      return { out: '', error: jsonError(input, e as Error), stats: '' };
    }
  }, [input, indent, sort]);

  return (
    <div className="stack">
      <div className="row">
        <Segmented
          options={[
            { value: '2', label: '2 spaces' },
            { value: '4', label: '4 spaces' },
            { value: 'tab', label: 'Tab' },
            { value: 'min', label: 'Minify' },
          ]}
          value={indent}
          onChange={setIndent}
        />
        <Switch checked={sort} onChange={setSort} label="Sort keys" />
        <span className="spacer" />
        {stats && <span className="badge good">{stats}</span>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="io">
        <Field label="Input">
          <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} style={{ minHeight: 420 }} placeholder="Paste JSON here…" />
        </Field>
        <Output value={out} minHeight={420} file="formatted.json" />
      </div>
    </div>
  );
}

/* ---------- CSV ⇄ JSON ---------- */
function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

const csvCell = (v: unknown, delim: string) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /["\n\r]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
};

function detectDelim(text: string) {
  const line = text.split('\n')[0] ?? '';
  const counts = [',', ';', '\t', '|'].map((d) => [d, line.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function CsvJson() {
  const [dir, setDir] = useState<'csv2json' | 'json2csv'>('csv2json');
  const [input, setInput] = useState('name,age,city\nAlice,30,Bangkok\nBob,25,"Chiang Mai, TH"');
  const [header, setHeader] = useState(true);
  const [types, setTypes] = useState(true);
  const [delim, setDelim] = useState<'auto' | ',' | ';' | '\t'>('auto');

  const { out, error, rows } = useMemo(() => {
    try {
      if (!input.trim()) return { out: '', error: '', rows: 0 };
      if (dir === 'csv2json') {
        const d = delim === 'auto' ? detectDelim(input) : delim;
        const data = parseCsv(input, d);
        const conv = (s: string): unknown => {
          if (!types) return s;
          if (s === '') return null;
          if (s === 'true' || s === 'false') return s === 'true';
          if (/^-?\d+(\.\d+)?$/.test(s) && !/^0\d/.test(s)) return Number(s);
          return s;
        };
        const result = header ? data.slice(1).map((r) => Object.fromEntries(data[0].map((h, i) => [h || `col${i + 1}`, conv(r[i] ?? '')]))) : data.map((r) => r.map(conv));
        return { out: JSON.stringify(result, null, 2), error: '', rows: result.length };
      }
      const v = JSON.parse(input);
      const arr: unknown[] = Array.isArray(v) ? v : [v];
      const d = delim === 'auto' ? ',' : delim;
      if (arr.every((x) => Array.isArray(x))) return { out: (arr as unknown[][]).map((r) => r.map((c) => csvCell(c, d)).join(d)).join('\n'), error: '', rows: arr.length };
      const keys = [...new Set(arr.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))];
      const lines = [keys.map((k) => csvCell(k, d)).join(d), ...arr.map((o) => keys.map((k) => csvCell((o as Record<string, unknown>)?.[k], d)).join(d))];
      return { out: lines.join('\n'), error: '', rows: arr.length };
    } catch (e) {
      return { out: '', error: (e as Error).message, rows: 0 };
    }
  }, [input, dir, header, types, delim]);

  return (
    <div className="stack">
      <div className="row">
        <Segmented
          options={[
            { value: 'csv2json', label: 'CSV → JSON' },
            { value: 'json2csv', label: 'JSON → CSV' },
          ]}
          value={dir}
          onChange={setDir}
        />
        <button className="btn btn-sm" onClick={() => (setInput(out), setDir(dir === 'csv2json' ? 'json2csv' : 'csv2json'))} disabled={!out} title="Use output as input">
          <ArrowLeftRight size={14} /> Swap
        </button>
        <Segmented
          options={[
            { value: 'auto', label: 'Auto' },
            { value: ',', label: ',' },
            { value: ';', label: ';' },
            { value: '\t', label: 'Tab' },
          ]}
          value={delim}
          onChange={setDelim}
        />
        {dir === 'csv2json' && (
          <>
            <Switch checked={header} onChange={setHeader} label="First row is header" />
            <Switch checked={types} onChange={setTypes} label="Detect numbers/booleans" />
          </>
        )}
        <span className="spacer" />
        {rows > 0 && <span className="badge accent">{rows} rows</span>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="io">
        <Field label="Input">
          <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} style={{ minHeight: 380 }} />
        </Field>
        <Output value={out} minHeight={380} file={dir === 'csv2json' ? 'data.json' : 'data.csv'} />
      </div>
      <FileDrop compact accept=".csv,.tsv,.json,.txt,text/*,application/json" onFiles={async (f) => setInput(await f[0].text())} title="Load a .csv or .json file" paste={false} />
    </div>
  );
}

/* ---------- Base64 ---------- */
const b64encode = (s: string, url: boolean) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const out = btoa(bin);
  return url ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
};
const b64decode = (s: string) => {
  let t = s.trim().replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function Base64Tool() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('Hello, QSwiftKnife! สวัสดี 👋');
  const [urlSafe, setUrlSafe] = useState(false);
  const { out, error } = useMemo(() => {
    try {
      return { out: input ? (mode === 'encode' ? b64encode(input, urlSafe) : b64decode(input)) : '', error: '' };
    } catch {
      return { out: '', error: 'Input is not valid Base64.' };
    }
  }, [input, mode, urlSafe]);

  return (
    <div className="stack">
      <div className="row">
        <Segmented
          options={[
            { value: 'encode', label: 'Encode' },
            { value: 'decode', label: 'Decode' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <button className="btn btn-sm" disabled={!out} onClick={() => (setInput(out), setMode(mode === 'encode' ? 'decode' : 'encode'))}>
          <ArrowLeftRight size={14} /> Swap
        </button>
        {mode === 'encode' && <Switch checked={urlSafe} onChange={setUrlSafe} label="URL-safe" />}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="io">
        <Field label={mode === 'encode' ? 'Text' : 'Base64'}>
          <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} style={{ minHeight: 300 }} />
        </Field>
        <Output value={out} minHeight={300} />
      </div>
      <span className="field-hint">For images, use Image ⇄ Base64.</span>
    </div>
  );
}

/* ---------- URL ---------- */
export function UrlTool() {
  const [input, setInput] = useState('https://example.com/search?q=swift knife&lang=th&tags=a,b#top');
  const [mode, setMode] = useState<'component' | 'uri'>('component');
  const enc = useMemo(() => (mode === 'component' ? encodeURIComponent(input) : encodeURI(input)), [input, mode]);
  const dec = useMemo(() => {
    try {
      return decodeURIComponent(input.replace(/\+/g, ' '));
    } catch {
      return '⚠ Malformed percent-encoding';
    }
  }, [input]);
  const parsed = useMemo(() => {
    try {
      return new URL(input.trim());
    } catch {
      return null;
    }
  }, [input]);

  return (
    <div className="stack">
      <Field label="Input">
        <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} style={{ minHeight: 100 }} />
      </Field>
      <div className="row">
        <Segmented
          options={[
            { value: 'component', label: 'encodeURIComponent' },
            { value: 'uri', label: 'encodeURI' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <div className="io">
        <Output label="Encoded" value={enc} minHeight={110} />
        <Output label="Decoded" value={dec} minHeight={110} />
      </div>
      {parsed && (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="card-title">Parsed URL</div>
          {(['protocol', 'host', 'pathname', 'hash'] as const).map((k) => (
            <div className="kv" key={k}>
              <span className="k">{k}</span>
              <span className="v">{parsed[k] || '—'}</span>
              <CopyButton text={parsed[k]} label="" />
            </div>
          ))}
          {[...parsed.searchParams.entries()].map(([k, v], i) => (
            <div className="kv" key={i}>
              <span className="k">?{k}</span>
              <span className="v">{v}</span>
              <CopyButton text={v} label="" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Hash ---------- */
const ALGOS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function HashTool() {
  const [src, setSrc] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('hello world');
  const [file, setFile] = useState<File | null>(null);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [upper, setUpper] = useState(false);
  const [compare, setCompare] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = src === 'text' ? new TextEncoder().encode(text) : file ? await file.arrayBuffer() : null;
      if (!data) return setHashes({});
      const entries = await Promise.all(ALGOS.map(async (a) => [a, toHex(await crypto.subtle.digest(a, data))] as const));
      if (alive) setHashes(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [src, text, file]);

  const cmp = compare.trim().toLowerCase();
  return (
    <div className="stack">
      <Segmented
        options={[
          { value: 'text', label: 'Text' },
          { value: 'file', label: 'File' },
        ]}
        value={src}
        onChange={setSrc}
      />
      {src === 'text' ? (
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 120 }} />
      ) : file ? (
        <div className="row">
          <span className="badge">{file.name}</span>
          <span className="badge">{formatBytes(file.size)}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setFile(null)}>
            <Upload size={14} /> Choose another
          </button>
        </div>
      ) : (
        <FileDrop accept="*" onFiles={(f) => setFile(f[0])} title="Drop any file to checksum" />
      )}
      <div className="card stack" style={{ gap: 8 }}>
        <div className="row">
          <div className="card-title" style={{ margin: 0 }}>
            Digests
          </div>
          <span className="spacer" />
          <Switch checked={upper} onChange={setUpper} label="Uppercase" />
        </div>
        {ALGOS.map((a) => {
          const v = hashes[a] ?? '';
          const match = cmp && v === cmp;
          return (
            <div className="kv" key={a}>
              <span className="k">{a}</span>
              <span className="v" style={match ? { borderColor: 'var(--success)', color: 'var(--success)' } : undefined}>
                {upper ? v.toUpperCase() : v || '—'}
              </span>
              <CopyButton text={upper ? v.toUpperCase() : v} label="" />
            </div>
          );
        })}
      </div>
      <Field label="Verify — paste an expected hash" hint={cmp ? (Object.values(hashes).includes(cmp) ? '✓ Match found' : '✗ No match') : undefined}>
        <input className="input mono" value={compare} onChange={(e) => setCompare(e.target.value)} placeholder="e.g. b94d27b9934d3e08…" />
      </Field>
    </div>
  );
}

/* ---------- JWT ---------- */
export function JwtTool() {
  const [token, setToken] = useState(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlN3aWZ0S25pZmUiLCJpYXQiOjE3NjAwMDAwMDAsImV4cCI6MTk5OTk5OTk5OX0.signature',
  );
  const parts = token.trim().split('.');
  const decode = (p?: string) => {
    try {
      return JSON.stringify(JSON.parse(b64decode(p ?? '')), null, 2);
    } catch {
      return null;
    }
  };
  const header = decode(parts[0]);
  const payload = decode(parts[1]);
  const claims = payload ? (JSON.parse(payload) as Record<string, unknown>) : null;
  const ts = (k: string) => (typeof claims?.[k] === 'number' ? new Date((claims[k] as number) * 1000) : null);
  const exp = ts('exp');

  return (
    <div className="stack">
      <Field label="Token">
        <textarea className="textarea" value={token} onChange={(e) => setToken(e.target.value)} style={{ minHeight: 100, wordBreak: 'break-all' }} spellCheck={false} />
      </Field>
      {token.trim() && (!header || !payload) && <Alert kind="error">Not a valid JWT (expected header.payload.signature).</Alert>}
      {claims && (
        <div className="row">
          {exp && <span className={exp.getTime() < Date.now() ? 'badge bad' : 'badge good'}>{exp.getTime() < Date.now() ? 'Expired' : 'Valid until'} {exp.toLocaleString()}</span>}
          {ts('iat') && <span className="badge">Issued {ts('iat')!.toLocaleString()}</span>}
          {ts('nbf') && <span className="badge">Not before {ts('nbf')!.toLocaleString()}</span>}
        </div>
      )}
      <div className="io">
        <Output label="Header" value={header ?? ''} minHeight={160} />
        <Output label="Payload" value={payload ?? ''} minHeight={160} />
      </div>
      <Alert>The signature is not verified — decoding happens entirely in your browser.</Alert>
    </div>
  );
}

/* ---------- UUID ---------- */
export function UuidTool() {
  const [count, setCount] = useState<number | ''>(10);
  const [upper, setUpper] = useState(false);
  const [dashes, setDashes] = useState(true);
  const [seed, setSeed] = useState(0);
  const list = useMemo(
    () =>
      Array.from({ length: Math.min(1000, Number(count) || 1) }, () => {
        let u: string = crypto.randomUUID();
        if (!dashes) u = u.replace(/-/g, '');
        return upper ? u.toUpperCase() : u;
      }),
    [count, upper, dashes, seed], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div className="stack">
      <div className="row">
        <div style={{ width: 110 }}>
          <NumberInput value={count} onChange={setCount} min={1} max={1000} />
        </div>
        <Switch checked={upper} onChange={setUpper} label="Uppercase" />
        <Switch checked={dashes} onChange={setDashes} label="Hyphens" />
        <button className="btn btn-primary" onClick={() => setSeed((s) => s + 1)}>
          <RefreshCw size={15} /> Regenerate
        </button>
      </div>
      <Output label={`${list.length} UUID v4`} value={list.join('\n')} minHeight={360} file="uuids.txt" />
    </div>
  );
}

/* ---------- Timestamp ---------- */
export function TimestampTool() {
  const [now, setNow] = useState(Date.now());
  const [input, setInput] = useState(String(Math.floor(Date.now() / 1000)));
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 16));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const parsed = useMemo(() => {
    const t = input.trim();
    if (!t) return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      // heuristics: seconds / milliseconds / microseconds
      const ms = Math.abs(n) < 1e11 ? n * 1000 : Math.abs(n) < 1e14 ? n : n / 1000;
      return new Date(ms);
    }
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }, [input]);

  const rel = (d: Date) => {
    const s = Math.round((d.getTime() - now) / 1000);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const a = Math.abs(s);
    if (a < 60) return rtf.format(s, 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    if (a < 86400 * 365) return rtf.format(Math.round(s / 86400 / 30), 'month');
    return rtf.format(Math.round(s / 86400 / 365), 'year');
  };

  const rows = parsed
    ? [
        ['Unix (s)', String(Math.floor(parsed.getTime() / 1000))],
        ['Unix (ms)', String(parsed.getTime())],
        ['ISO 8601', parsed.toISOString()],
        ['Local', parsed.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })],
        ['UTC', parsed.toUTCString()],
        ['Bangkok', parsed.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long', timeStyle: 'medium' })],
        ['Relative', rel(parsed)],
      ]
    : [];

  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <b className="mono">{Math.floor(now / 1000)}</b>
          <span>current unix time</span>
        </div>
        <div className="stat">
          <b>{new Date(now).toLocaleTimeString()}</b>
          <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        </div>
      </div>
      <div className="grid-2">
        <Field label="Timestamp or date string" hint="Seconds, milliseconds, or anything like 2026-01-31 12:00">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input mono" value={input} onChange={(e) => setInput(e.target.value)} />
            <button className="btn" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>
              Now
            </button>
          </div>
        </Field>
        <Field label="Pick a date">
          <input
            className="input"
            type="datetime-local"
            value={dateInput}
            onChange={(e) => {
              setDateInput(e.target.value);
              const d = new Date(e.target.value);
              if (!isNaN(d.getTime())) setInput(String(Math.floor(d.getTime() / 1000)));
            }}
          />
        </Field>
      </div>
      {input.trim() && !parsed && <Alert kind="error">Couldn’t parse that as a date or timestamp.</Alert>}
      {parsed && (
        <div className="card stack" style={{ gap: 8 }}>
          {rows.map(([k, v]) => (
            <div className="kv" key={k}>
              <span className="k">{k}</span>
              <span className="v">{v}</span>
              <CopyButton text={v} label="" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Color ---------- */
type RGB = [number, number, number];
function parseColor(s: string): RGB | null {
  const t = s.trim().toLowerCase();
  let m = t.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  m = t.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x))) as RGB;
  m = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  return null;
}
function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as RGB;
}
function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}
const lum = (rgb: RGB) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const toHexStr = (rgb: RGB) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

export function ColorTool() {
  const [input, setInput] = usePersistent('sk-color', '#8b74ff');
  const rgb = parseColor(input);
  const hsl = rgb && rgbToHsl(rgb);
  const shades = rgb && hsl ? [95, 85, 75, 65, 55, 45, 35, 25, 15].map((l) => toHexStr(hslToRgb(hsl[0], hsl[1] / 100, l / 100))) : [];

  return (
    <div className="tool-layout">
      <div className="stack">
        <div className="swatch" style={{ background: rgb ? toHexStr(rgb) : 'transparent', height: 180 }} />
        <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {shades.map((s) => (
            <button key={s} title={s} onClick={() => setInput(s)} style={{ flex: 1, height: 48, background: s, border: 0, cursor: 'pointer' }} />
          ))}
        </div>
        {rgb && (
          <div className="grid-2">
            {(
              [
                ['#ffffff', 'on white'],
                ['#000000', 'on black'],
              ] as const
            ).map(([bg, label]) => {
              const c = contrast(rgb, parseColor(bg)!);
              return (
                <div key={bg} className="card" style={{ background: bg, color: toHexStr(rgb), border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>Aa — {c.toFixed(2)}:1</div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    {label} · {c >= 7 ? 'AAA' : c >= 4.5 ? 'AA' : c >= 3 ? 'AA large only' : 'Fails WCAG'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <aside className="card stack">
        <Field label="Color" hint="HEX, rgb() or hsl()">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="color" value={rgb ? toHexStr(rgb) : '#000000'} onChange={(e) => setInput(e.target.value)} style={{ width: 44, height: 36, border: 0, padding: 0, background: 'none', flexShrink: 0 }} />
            <input className="input mono" value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
        </Field>
        {!rgb && <Alert kind="error">Unrecognised color.</Alert>}
        {rgb && hsl && (
          <div className="stack" style={{ gap: 8 }}>
            {[
              ['HEX', toHexStr(rgb)],
              ['RGB', `rgb(${rgb.join(', ')})`],
              ['HSL', `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`],
              ['Tailwind', `[${toHexStr(rgb)}]`],
            ].map(([k, v]) => (
              <div className="kv" key={k} style={{ gridTemplateColumns: '64px 1fr auto' }}>
                <span className="k">{k}</span>
                <span className="v">{v}</span>
                <CopyButton text={v} label="" />
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
