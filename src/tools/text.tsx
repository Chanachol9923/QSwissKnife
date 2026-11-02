import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeftRight, Download, RefreshCw } from 'lucide-react';
import { Alert, CopyButton, Field, NumberInput, Segmented, Slider, Switch } from '../components/ui';
import { downloadBlob } from '../lib/utils';

/* ---------- QR ---------- */
const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

export function QrTool() {
  const [kind, setKind] = useState<'text' | 'wifi'>('text');
  const [text, setText] = useState('https://example.com');
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [enc, setEnc] = useState<'WPA' | 'WEP' | 'nopass'>('WPA');
  const [ecc, setEcc] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [size, setSize] = useState(512);
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const [png, setPng] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  const payload = kind === 'text' ? text : ssid ? `WIFI:T:${enc};S:${wifiEscape(ssid)};${enc !== 'nopass' ? `P:${wifiEscape(pass)};` : ''};` : '';

  useEffect(() => {
    if (!payload) {
      setPng('');
      setSvg('');
      return;
    }
    const opts = { errorCorrectionLevel: ecc, margin: 2, color: { dark: fg, light: bg } };
    Promise.all([QRCode.toDataURL(payload, { ...opts, width: size }), QRCode.toString(payload, { ...opts, type: 'svg' })])
      .then(([p, s]) => {
        setPng(p);
        setSvg(s);
        setError('');
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [payload, ecc, size, fg, bg]);

  return (
    <div className="tool-layout">
      <div className="stack">
        <Segmented
          options={[
            { value: 'text', label: 'Text / URL' },
            { value: 'wifi', label: 'Wi-Fi' },
          ]}
          value={kind}
          onChange={setKind}
        />
        {kind === 'text' ? (
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 100, fontFamily: 'var(--font)' }} placeholder="URL or any text" />
        ) : (
          <div className="grid-3">
            <Field label="Network name (SSID)">
              <input className="input" value={ssid} onChange={(e) => setSsid(e.target.value)} />
            </Field>
            <Field label="Password">
              <input className="input" value={pass} onChange={(e) => setPass(e.target.value)} disabled={enc === 'nopass'} />
            </Field>
            <Field label="Security">
              <select className="select" value={enc} onChange={(e) => setEnc(e.target.value as typeof enc)}>
                <option value="WPA">WPA/WPA2/WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">None</option>
              </select>
            </Field>
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="stage" style={{ background: 'var(--surface-2)' }}>
          {png ? <img src={png} alt="QR code" style={{ width: 300, height: 300, imageRendering: 'pixelated' }} /> : <span className="muted">Enter something to generate a QR code</span>}
        </div>
      </div>
      <aside className="card stack">
        <Field label="Error correction" hint="Higher survives damage/logos but is denser.">
          <Segmented block options={(['L', 'M', 'Q', 'H'] as const).map((v) => ({ value: v, label: v }))} value={ecc} onChange={setEcc} />
        </Field>
        <Field label="PNG size" value={`${size}px`}>
          <Slider min={128} max={2048} step={64} value={size} onChange={setSize} />
        </Field>
        <div className="grid-2">
          <Field label="Foreground">
            <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} style={{ width: '100%', height: 36, border: 0, padding: 0, background: 'none' }} />
          </Field>
          <Field label="Background">
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ width: '100%', height: 36, border: 0, padding: 0, background: 'none' }} />
          </Field>
        </div>
        <button className="btn btn-primary btn-lg btn-block" disabled={!png} onClick={async () => downloadBlob(await (await fetch(png)).blob(), 'qrcode.png')}>
          <Download size={16} /> Download PNG
        </button>
        <button className="btn btn-block" disabled={!svg} onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'qrcode.svg')}>
          <Download size={16} /> Download SVG
        </button>
      </aside>
    </div>
  );
}

/* ---------- Password ---------- */
const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
const AMBIGUOUS = /[O0oIl1|`'"]/g;
const WORDS =
  'able acid aged also area army away baby back ball band bank base bath bear beat bell belt best bird blow blue boat body bomb bond bone book boom born boss both bowl bulk burn bush busy cake calm came camp card care cart case cash cast cell chat chip city clay club coal coat code cold cook cool cope copy core corn cost crew crop dark data date dawn deal dear debt deck deep deer desk dial diet disk dock door dose down draw drop drum duck dust duty each earn ease east easy edge else epic even ever exam exit face fact fair fall farm fast fate fear feed feel fern file film find fine fire firm fish five flag flat flow foam fold folk food foot fork form fort four free frog fuel full fund gain game gate gear gift girl glad glow goal gold golf good gray grid grow gulf hair half hall hand hard harm hawk head heat help herb hero high hill hint hold hole home hook hope horn host hour huge hunt idea inch iron item jazz join joke jump jury keen keep kick kind king kite knee knot lake lamp land lane last lava lawn lead leaf lens life lift lime line link lion list load loan lock loft long loop lord lost loud luck lung made mail main make mall many mask mass meal meat menu mild milk mill mind mint mist mode mood moon moss most moth move much nail name navy neck nest news next nice nine node noon nose note oath ocean odd oven palm park path peak pear pine pink pipe plan play plot plug poem pole pond pool port pure quiz race rack rain rank rare reef rice rich ride ring rise road rock roof room root rope rose ruby rule safe sail salt sand seal seat seed ship shoe shop silk sing site size skin sky slow snow soap sock soft soil song soup star stem step stop swan tail tale tank team tent text tide tile time tiny tone tool tour town tree trip tune turn twin unit vast vine void vote wage wake walk wall wave weed west wind wing wise wolf wood wool word work yard year zero zone'.split(
    ' ',
  );

function randInt(max: number) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / max) * max; // rejection sampling: no modulo bias
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

export function PasswordTool() {
  const [mode, setMode] = useState<'chars' | 'words'>('chars');
  const [len, setLen] = useState(20);
  const [words, setWords] = useState(5);
  const [opts, setOpts] = useState({ lower: true, upper: true, digits: true, symbols: true, noAmbig: false });
  const [sep, setSep] = useState('-');
  const [seed, setSeed] = useState(0);

  const pool = useMemo(() => {
    let p = (Object.keys(SETS) as (keyof typeof SETS)[]).filter((k) => opts[k]).map((k) => SETS[k]).join('');
    if (opts.noAmbig) p = p.replace(AMBIGUOUS, '');
    return p;
  }, [opts]);

  const list = useMemo(
    () =>
      Array.from({ length: 6 }, () =>
        mode === 'chars'
          ? pool
            ? Array.from({ length: len }, () => pool[randInt(pool.length)]).join('')
            : ''
          : Array.from({ length: words }, () => WORDS[randInt(WORDS.length)]).join(sep) + (opts.digits ? sep + randInt(100) : ''),
      ),
    [mode, pool, len, words, sep, opts.digits, seed], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const bits = mode === 'chars' ? len * Math.log2(pool.length || 1) : words * Math.log2(WORDS.length) + (opts.digits ? Math.log2(100) : 0);
  const strength = bits < 40 ? ['Weak', 'bad'] : bits < 64 ? ['Fair', 'warn'] : bits < 90 ? ['Strong', 'good'] : ['Very strong', 'good'];
  const tog = (k: keyof typeof opts) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <div className="tool-layout">
      <div className="stack">
        <div className="card stack" style={{ gap: 12 }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="mono" style={{ fontSize: 22, flex: 1, wordBreak: 'break-all', lineHeight: 1.35 }}>
              {list[0] || '—'}
            </div>
            <CopyButton text={list[0]} small={false} />
            <button className="btn btn-icon" onClick={() => setSeed((s) => s + 1)} title="Regenerate">
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="row">
            <span className={`badge ${strength[1]}`}>{strength[0]}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              ~{Math.round(bits)} bits of entropy
            </span>
          </div>
        </div>
        <div className="files">
          {list.slice(1).map((p, i) => (
            <div className="file-row" key={i}>
              <span className="mono file-meta" style={{ wordBreak: 'break-all' }}>
                {p}
              </span>
              <CopyButton text={p} label="" />
            </div>
          ))}
        </div>
      </div>
      <aside className="card stack">
        <Segmented
          block
          options={[
            { value: 'chars', label: 'Password' },
            { value: 'words', label: 'Passphrase' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'chars' ? (
          <>
            <Field label="Length" value={len}>
              <Slider min={6} max={64} value={len} onChange={setLen} />
            </Field>
            <Switch checked={opts.lower} onChange={tog('lower')} label="Lowercase (a-z)" />
            <Switch checked={opts.upper} onChange={tog('upper')} label="Uppercase (A-Z)" />
            <Switch checked={opts.digits} onChange={tog('digits')} label="Numbers (0-9)" />
            <Switch checked={opts.symbols} onChange={tog('symbols')} label="Symbols (!@#…)" />
            <Switch checked={opts.noAmbig} onChange={tog('noAmbig')} label="Avoid look-alikes (O0Il1)" />
          </>
        ) : (
          <>
            <Field label="Words" value={words}>
              <Slider min={3} max={10} value={words} onChange={setWords} />
            </Field>
            <Field label="Separator">
              <Segmented block options={['-', '.', '_', ' '].map((s) => ({ value: s, label: s === ' ' ? 'space' : s }))} value={sep} onChange={setSep} />
            </Field>
            <Switch checked={opts.digits} onChange={tog('digits')} label="Append a number" />
          </>
        )}
        <span className="field-hint">Generated with crypto.getRandomValues — never stored or sent anywhere.</span>
      </aside>
    </div>
  );
}

/* ---------- Text case & count ---------- */
const splitWords = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const CASES: { label: string; fn: (s: string) => string }[] = [
  { label: 'UPPER', fn: (s) => s.toUpperCase() },
  { label: 'lower', fn: (s) => s.toLowerCase() },
  { label: 'Title Case', fn: (s) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) },
  { label: 'Sentence case', fn: (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) },
  { label: 'camelCase', fn: (s) => splitWords(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') },
  { label: 'PascalCase', fn: (s) => splitWords(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') },
  { label: 'snake_case', fn: (s) => splitWords(s).map((w) => w.toLowerCase()).join('_') },
  { label: 'kebab-case', fn: (s) => splitWords(s).map((w) => w.toLowerCase()).join('-') },
  { label: 'CONSTANT', fn: (s) => splitWords(s).map((w) => w.toUpperCase()).join('_') },
  { label: 'Trim lines', fn: (s) => s.split('\n').map((l) => l.trim()).join('\n') },
  { label: 'Remove blank lines', fn: (s) => s.split('\n').filter((l) => l.trim()).join('\n') },
  { label: 'Sort lines', fn: (s) => s.split('\n').sort((a, b) => a.localeCompare(b)).join('\n') },
  { label: 'Dedupe lines', fn: (s) => [...new Set(s.split('\n'))].join('\n') },
  { label: 'Reverse', fn: (s) => [...s].reverse().join('') },
];

export function TextCaseTool() {
  const [text, setText] = useState('The quick brown fox jumps over the lazy dog.\nQSwiftKnife makes everyday file chores fast.');
  const stats = useMemo(() => {
    const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
    const words = seg ? [...seg.segment(text)].filter((s) => s.isWordLike).length : text.split(/\s+/).filter(Boolean).length;
    return [
      ['Characters', [...text].length],
      ['No spaces', [...text.replace(/\s/g, '')].length],
      ['Words', words],
      ['Lines', text ? text.split('\n').length : 0],
      ['Sentences', (text.match(/[^.!?\n]+[.!?]+/g) ?? []).length],
      ['Bytes (UTF-8)', new TextEncoder().encode(text).length],
      ['Read time', `${Math.max(1, Math.round(words / 230))} min`],
    ] as const;
  }, [text]);

  return (
    <div className="stack">
      <div className="stat-grid">
        {stats.map(([k, v]) => (
          <div className="stat" key={k}>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {CASES.map((c) => (
          <button key={c.label} className="btn btn-sm" onClick={() => setText(c.fn(text))}>
            {c.label}
          </button>
        ))}
        <span className="spacer" />
        <CopyButton text={text} />
      </div>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 360, fontFamily: 'var(--font)', fontSize: 14 }} />
      <span className="field-hint">Word count uses language-aware segmentation, so Thai text without spaces is counted correctly.</span>
    </div>
  );
}

/* ---------- Diff ---------- */
type Op = { t: '=' | '+' | '-'; a?: number; b?: number; s: string };
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ t: '=', a: ++i, b: ++j, s: a[i - 1] });
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', a: ++i, s: a[i - 1] });
    else out.push({ t: '+', b: ++j, s: b[j - 1] });
  }
  while (i < n) out.push({ t: '-', a: ++i, s: a[i - 1] });
  while (j < m) out.push({ t: '+', b: ++j, s: b[j - 1] });
  return out;
}

export function DiffTool() {
  const [left, setLeft] = useState('apple\nbanana\ncherry\ndate');
  const [right, setRight] = useState('apple\nblueberry\ncherry\ndate\nelderberry');
  const [ignoreWs, setIgnoreWs] = useState(false);
  const norm = (s: string) => s.split('\n').map((l) => (ignoreWs ? l.trim().replace(/\s+/g, ' ') : l));
  const a = norm(left);
  const b = norm(right);
  const tooBig = a.length * b.length > 25_000_000;
  const ops = useMemo(() => (tooBig ? [] : diffLines(a, b)), [left, right, ignoreWs]); // eslint-disable-line react-hooks/exhaustive-deps
  const added = ops.filter((o) => o.t === '+').length;
  const removed = ops.filter((o) => o.t === '-').length;

  return (
    <div className="stack">
      <div className="io">
        <Field label="Original">
          <textarea className="textarea" value={left} onChange={(e) => setLeft(e.target.value)} />
        </Field>
        <Field label="Changed">
          <textarea className="textarea" value={right} onChange={(e) => setRight(e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <span className="badge good">+{added}</span>
        <span className="badge bad">−{removed}</span>
        {!added && !removed && !tooBig && <span className="badge accent">Identical</span>}
        <Switch checked={ignoreWs} onChange={setIgnoreWs} label="Ignore whitespace" />
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => (setLeft(right), setRight(left))}>
          <ArrowLeftRight size={14} /> Swap
        </button>
      </div>
      {tooBig && <Alert kind="warn">Texts are too large to diff in the browser.</Alert>}
      <div className="card" style={{ padding: 0, overflow: 'auto', fontFamily: 'var(--mono)', fontSize: 12.5 }}>
        {ops.map((o, i) => (
          <div
            key={i}
            style={{
              display: 'grid', gridTemplateColumns: '44px 44px 18px 1fr', padding: '1px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              background: o.t === '+' ? 'var(--success-soft)' : o.t === '-' ? 'var(--danger-soft)' : undefined,
              color: o.t === '+' ? 'var(--success)' : o.t === '-' ? 'var(--danger)' : 'var(--text-2)',
            }}
          >
            <span className="muted">{o.a ?? ''}</span>
            <span className="muted">{o.b ?? ''}</span>
            <span>{o.t === '=' ? ' ' : o.t === '-' ? '−' : '+'}</span>
            <span>{o.s || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Units ---------- */
const UNITS: Record<string, Record<string, number>> = {
  Length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, 'wa (วา)': 2 },
  Weight: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.0283495, lb: 0.453592, 'baht (บาท, gold)': 0.0152 },
  Area: { 'm²': 1, 'km²': 1e6, 'ft²': 0.092903, acre: 4046.86, ha: 10000, 'rai (ไร่)': 1600, 'ngan (งาน)': 400, 'sq wa (ตร.ว.)': 4 },
  Volume: { ml: 0.001, l: 1, 'm³': 1000, 'tsp': 0.00492892, tbsp: 0.0147868, cup: 0.236588, 'fl oz': 0.0295735, gal: 3.78541 },
  Data: { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, bit: 0.125, Mbit: 125000 },
  Speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 0.514444 },
  Time: { ms: 0.001, s: 1, min: 60, h: 3600, day: 86400, week: 604800, year: 31557600 },
  Temperature: { '°C': 0, '°F': 0, K: 0 },
};
const toC = (v: number, u: string) => (u === '°F' ? ((v - 32) * 5) / 9 : u === 'K' ? v - 273.15 : v);
const fromC = (v: number, u: string) => (u === '°F' ? (v * 9) / 5 + 32 : u === 'K' ? v + 273.15 : v);
const fmt = (n: number) => (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0) ? n.toExponential(6) : Number(n.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 10 }));

export function UnitTool() {
  const [cat, setCat] = useState('Length');
  const units = Object.keys(UNITS[cat]);
  const [from, setFrom] = useState('m');
  const [value, setValue] = useState<number | ''>(1);
  useEffect(() => setFrom(Object.keys(UNITS[cat])[cat === 'Data' ? 3 : 2] ?? Object.keys(UNITS[cat])[0]), [cat]);

  const convert = (to: string) => {
    const v = Number(value) || 0;
    if (cat === 'Temperature') return fromC(toC(v, from), to);
    return (v * UNITS[cat][from]) / UNITS[cat][to];
  };

  return (
    <div className="stack">
      <div className="chips" style={{ marginTop: 0 }}>
        {Object.keys(UNITS).map((c) => (
          <button key={c} className={`chip ${c === cat ? 'on' : ''}`} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="grid-2">
        <Field label="Value">
          <NumberInput value={value} onChange={setValue} />
        </Field>
        <Field label="From">
          <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="card stack" style={{ gap: 8 }}>
        {units
          .filter((u) => u !== from)
          .map((u) => {
            const v = fmt(convert(u));
            return (
              <div className="kv" key={u} style={{ gridTemplateColumns: '140px 1fr auto' }}>
                <span className="k">{u}</span>
                <span className="v">{v}</span>
                <CopyButton text={v.replace(/,/g, '')} label="" />
              </div>
            );
          })}
      </div>
    </div>
  );
}
