import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createFrontendServer } from '../server.mjs';

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('chat establishes a session and cart receives its cookie, with independent Set-Cookie headers', async t => {
  const requests = [];
  const cookies = [
    'ekt_session=test-session-only; Path=/; HttpOnly; SameSite=Lax',
    'test_preference=en; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/; SameSite=Lax',
  ];
  const backend = await listen(t, http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url === '/api/chat?language=en') {
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookies });
      res.end(JSON.stringify({ cart: { added_to_cart: true, cart_url: `${backend}/cart` } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; profile="cart"' });
    res.end(JSON.stringify({ items: [{ product_id: 'fixture-1', quantity: 2 }], total: 20, currency: 'KZT' }));
  }));
  const frontend = await listen(t, createFrontendServer({ backend }));
  const logs = [];
  for (const method of ['log', 'error', 'warn']) t.mock.method(console, method, (...args) => logs.push(args.join(' ')));
  const body = JSON.stringify({ message: 'fixture request', confirm_cart: true });
  const chat = await fetch(`${frontend}/api/chat?language=en`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'not-forwarded-test-value' },
    body,
  });
  assert.equal(chat.status, 201);
  assert.deepEqual(chat.headers.getSetCookie(), cookies);
  assert.equal((await chat.json()).cart.cart_url, `${backend}/cart`, 'backend response must remain unchanged');
  const cart = await fetch(`${frontend}/api/cart?refresh=1`, { headers: { Cookie: 'ekt_session=test-session-only' } });
  assert.equal(cart.status, 200);
  assert.equal(cart.headers.get('content-type'), 'application/json; profile="cart"');
  assert.equal(cart.headers.get('cache-control'), 'no-store');
  assert.equal((await cart.json()).items[0].quantity, 2);
  assert.equal(requests[0].body, body);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[1].url, '/api/cart?refresh=1');
  assert.equal(requests[1].headers.cookie, 'ekt_session=test-session-only');
  assert.equal(requests[1].method, 'GET');
  assert.deepEqual(logs, [], 'proxy must not log request headers, cookie values, or API bodies');
});

test('proxy allowlist rejects unrelated routes and methods; health receives no session cookie', async t => {
  const requests = [];
  const backend = await listen(t, http.createServer((req, res) => {
    requests.push({ url: req.url, cookie: req.headers.cookie });
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': 'unexpected=fixture; Path=/' });
    res.end('ok');
  }));
  const frontend = await listen(t, createFrontendServer({ backend }));
  for (const [path, method] of [['/api/private', 'GET'], ['/api/cart', 'POST'], ['/api/chat', 'GET'], ['/health', 'POST']]) {
    const response = await fetch(`${frontend}${path}`, { method });
    assert.equal(response.status, 404);
    await response.text();
  }
  assert.equal(requests.length, 0);
  const health = await fetch(`${frontend}/health`, { headers: { Cookie: 'ekt_session=fixture' } });
  assert.equal(await health.text(), 'ok');
  assert.equal(health.headers.get('content-type'), 'text/plain');
  assert.deepEqual(health.headers.getSetCookie(), []);
  assert.deepEqual(requests, [{ url: '/health', cookie: undefined }]);
});

test('upstream redirects are not followed with a session cookie', async t => {
  let destinationRequests = 0;
  const destination = await listen(t, http.createServer((_req, res) => {
    destinationRequests += 1;
    res.end('must not reach this destination');
  }));
  const backend = await listen(t, http.createServer((_req, res) => {
    res.writeHead(307, { Location: `${destination}/private`, 'Content-Type': 'text/plain' });
    res.end('redirect');
  }));
  const frontend = await listen(t, createFrontendServer({ backend }));
  const response = await fetch(`${frontend}/api/cart`, { redirect: 'manual', headers: { Cookie: 'ekt_session=fixture' } });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), `${destination}/private`);
  assert.equal(await response.text(), 'redirect');
  assert.equal(destinationRequests, 0);
});

test('cart page and its assets are served through an explicit static allowlist', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-ui-server-'));
  t.after(async () => {
    for (const file of ['cart/index.html', 'cart.js', 'cart-api.js', 'cart.css', '.env']) {
      await rm(join(directory, file), { force: true });
    }
    await rmdir(join(directory, 'cart'));
    await rmdir(directory);
  });
  await mkdir(join(directory, 'cart'));
  await writeFile(join(directory, 'cart', 'index.html'), '<main>Cart fixture</main>');
  for (const file of ['cart.js', 'cart-api.js', 'cart.css']) await writeFile(join(directory, file), `/* ${file} fixture */`);
  await writeFile(join(directory, '.env'), 'PRIVATE_FIXTURE=not-served');
  const frontend = await listen(t, createFrontendServer({ staticRoot: pathToFileURL(directory + sep) }));
  for (const route of ['/cart', '/cart/']) {
    const response = await fetch(frontend + route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), '<main>Cart fixture</main>');
  }
  for (const file of ['cart.js', 'cart-api.js', 'cart.css']) {
    const response = await fetch(`${frontend}/${file}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `/* ${file} fixture */`);
  }
  for (const route of ['/.env', '/server.mjs', '/cart/../.env']) {
    const response = await fetch(frontend + route);
    assert.equal(response.status, 404);
    await response.text();
  }
});

test('proxy keeps body size limits and returns a safe error when the upstream times out', async t => {
  let requests = 0;
  const backend = await listen(t, http.createServer(() => { requests += 1; }));
  const frontend = await listen(t, createFrontendServer({ backend, maxBodyBytes: 32, timeoutMs: 30 }));
  const oversized = await fetch(`${frontend}/api/chat`, { method: 'POST', body: 'x'.repeat(64) });
  assert.equal(oversized.status, 413);
  await oversized.text();
  assert.equal(requests, 0);
  const unavailable = await fetch(`${frontend}/api/cart`, { headers: { Cookie: 'ekt_session=private-fixture' } });
  assert.equal(unavailable.status, 502);
  const detail = (await unavailable.json()).detail;
  assert.equal(detail.code, 'FRONTEND_PROXY_UNAVAILABLE');
  assert.equal(JSON.stringify(detail).includes('private-fixture'), false);
});
