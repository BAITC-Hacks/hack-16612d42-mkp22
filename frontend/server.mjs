import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 5173);
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/ui-model.js', ['ui-model.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/locales.js', ['locales.js', 'text/javascript; charset=utf-8']],
  ['/api.js', ['api.js', 'text/javascript; charset=utf-8']],
  ['/viewport.js', ['viewport.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if ((path === '/api/chat' && req.method === 'POST') || (path === '/health' && req.method === 'GET')) {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 100_000) {
          res.writeHead(413).end();
          return;
        }
      }
      const upstream = await fetch(new URL(path, backend), {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(120_000),
      });
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(await upstream.text());
    } catch {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ detail: { code: 'FRONTEND_PROXY_UNAVAILABLE', message: 'Assistant service unavailable.' } }));
    }
    return;
  }
  const file = files.get(path);
  if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': file[1] });
    res.end(await readFile(new URL(file[0], import.meta.url)));
  } catch { res.writeHead(500).end('Unable to load UI'); }
}).listen(port, '127.0.0.1', () => console.log(`EKT UI: http://localhost:${port}`));
