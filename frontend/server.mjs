import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/cart', ['cart/index.html', 'text/html; charset=utf-8']],
  ['/cart/', ['cart/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/cart.js', ['cart.js', 'text/javascript; charset=utf-8']],
  ['/cart-api.js', ['cart-api.js', 'text/javascript; charset=utf-8']],
  ['/cart.css', ['cart.css', 'text/css; charset=utf-8']],
  ['/ui-model.js', ['ui-model.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/locales.js', ['locales.js', 'text/javascript; charset=utf-8']],
  ['/api.js', ['api.js', 'text/javascript; charset=utf-8']],
  ['/viewport.js', ['viewport.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

export function createFrontendServer({
  backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000',
  staticRoot = new URL('./', import.meta.url),
  timeoutMs = 70_000,
  maxBodyBytes = 100_000,
} = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let requestUrl;
    try {
      requestUrl = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const path = requestUrl.pathname;
    const apiRequest = (path === '/api/chat' && req.method === 'POST')
      || (path === '/api/cart' && req.method === 'GET');
    if (apiRequest || (path === '/health' && req.method === 'GET')) {
      let upstreamTimeout;
      try {
        const chunks = [];
        let bodyBytes = 0;
        for await (const chunk of req) {
          bodyBytes += chunk.length;
          if (bodyBytes > maxBodyBytes) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        const headers = {};
        if (req.headers.accept) headers.Accept = req.headers.accept;
        if (req.method === 'POST') {
          headers['Content-Type'] = req.headers['content-type'] || 'application/json';
        }
        // Session cookies belong only to the configured API, never other destinations.
        if (apiRequest && req.headers.cookie) headers.Cookie = req.headers.cookie;
        upstreamTimeout = AbortSignal.timeout(timeoutMs);
        const upstream = await fetch(new URL(path + requestUrl.search, backend), {
          method: req.method,
          headers,
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          redirect: 'manual',
          signal: upstreamTimeout,
        });
        const responseBody = Buffer.from(await upstream.arrayBuffer());
        const responseHeaders = { 'Cache-Control': 'no-store' };
        const contentType = upstream.headers.get('content-type');
        if (contentType) responseHeaders['Content-Type'] = contentType;
        if (apiRequest) {
          const cookies = upstream.headers.getSetCookie();
          if (cookies.length) responseHeaders['Set-Cookie'] = cookies;
        }
        const location = upstream.headers.get('location');
        if (location) responseHeaders.Location = location;
        res.writeHead(upstream.status, responseHeaders);
        res.end(responseBody);
      } catch (error) {
        // Reading a stalled response body may throw AbortError rather than TimeoutError.
        const timedOut = error.name === 'TimeoutError' || upstreamTimeout?.reason?.name === 'TimeoutError';
        res.writeHead(timedOut ? 504 : 502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ detail: {
          code: timedOut ? 'FRONTEND_PROXY_TIMEOUT' : 'FRONTEND_PROXY_UNAVAILABLE',
          message: timedOut ? 'Assistant response timed out.' : 'Assistant service unavailable.',
        } }));
      }
      return;
    }
    const file = files.get(path);
    if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(new URL(file[0], staticRoot));
      res.writeHead(200, { 'Content-Type': file[1] });
      res.end(body);
    } catch { res.writeHead(500).end('Unable to load UI'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 5173);
  createFrontendServer().listen(port, '127.0.0.1', () => console.log(`EKT UI: http://localhost:${port}`));
}
