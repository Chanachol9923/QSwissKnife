/*
 * Standalone server for the installed app: serves the built web app and the YouTube helper with
 * nothing but Node's built-in modules, so an install needs no node_modules.
 *
 *   node serve.mjs [--port 4317] [--root ../app] [--parent-pid 1234]
 *
 * Bundled to a single serve.mjs by launcher/package.ps1.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleYt, startYtHousekeeping } from './ytHelper';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(arg('port', '4317'));
const root = resolve(arg('root', join(here, '..', 'app')));
const parentPid = Number(arg('parent-pid', '0'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(urlPath: string, res: import('node:http').ServerResponse, head: boolean) {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info) {
    // the app routes with #hashes, so anything unknown without an extension gets the shell
    if (extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    file = join(root, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('App files are missing — reinstall QSwissKnife.');
      return;
    }
  }
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (head) res.end();
  else createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url.startsWith('/api/yt/') || url === '/api/yt') return handleYt(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(url, res, req.method === 'HEAD').catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
  });
});

const stopHousekeeping = startYtHousekeeping();
const shutdown = () => {
  stopHousekeeping();
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Exit together with the app window, so closing QSwissKnife never leaves a server behind.
if (parentPid) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      shutdown();
    }
  }, 3000).unref();
}

server.on('error', (e) => {
  console.error(`QSwissKnife server: ${(e as Error).message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`QSwissKnife serving ${root} on http://127.0.0.1:${port}/`));
