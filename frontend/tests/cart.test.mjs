import test from 'node:test';
import assert from 'node:assert/strict';
import { readCart, updateCartCount, validCart } from '../cart-api.js';

const item = { product_id: '515291', name: 'Автомат 16А', quantity: 2, price: 450, currency: 'KZT', stock: 365, url: 'https://ekt.kz/product/515291' };
const cart = { items: [item], total: 900, currency: 'KZT' };
const response = value => ({ ok: true, json: async () => value });

test('cart GET uses the server cookie session and preserves authoritative values', async () => {
  let request;
  const data = await readCart({ fetchImpl: async (url, options) => { request = { url, ...options }; return response(cart); } });
  assert.equal(request.url, '/api/cart');
  assert.equal(request.method, 'GET');
  assert.equal(request.credentials, 'same-origin');
  assert.equal(request.cache, 'no-store');
  assert.equal(data, cart);
  assert.equal(data.items[0].quantity, 2);
});

test('cart validation accepts empty cart and unknown optional catalog values but rejects corrupt quantities', () => {
  assert.equal(validCart({ items: [], total: 0, currency: 'KZT' }), true);
  assert.equal(validCart({ items: [{ ...item, price: null, stock: null, url: null }], total: null, currency: 'KZT' }), true);
  for (const value of [null, {}, { ...cart, items: [null] }, { ...cart, total: -1 },
    { ...cart, items: [{ ...item, quantity: 0 }] }, { ...cart, items: [{ ...item, quantity: '2' }] },
    { ...cart, items: [{ ...item, price: '450' }] }, { ...cart, items: [{ ...item, stock: Infinity }] }]) {
    assert.equal(validCart(value), false);
  }
});

test('unavailable, malformed, and network responses remain errors instead of becoming empty carts', async () => {
  for (const status of [404, 405, 501]) {
    await assert.rejects(readCart({ fetchImpl: async () => ({ ok: false, status }) }), { code: 'unavailable' });
  }
  await assert.rejects(readCart({ fetchImpl: async () => ({ ok: false, status: 500 }) }), { code: 'http' });
  await assert.rejects(readCart({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) }), { code: 'invalid' });
  await assert.rejects(readCart({ fetchImpl: async () => response({ items: 'invalid' }) }), { code: 'invalid' });
  await assert.rejects(readCart({ fetchImpl: async () => { throw new TypeError('fetch failed'); } }), { code: 'network' });
});

test('header count is the server line count and is hidden if the next refresh fails', async () => {
  const originalFetch = globalThis.fetch;
  const element = { hidden: false, textContent: '', setAttribute(name, value) { this[name] = value; } };
  try {
    globalThis.fetch = async () => response(cart);
    await updateCartCount(element);
    assert.equal(element.hidden, false);
    assert.equal(element.textContent, '1');
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    assert.equal(await updateCartCount(element), null);
    assert.equal(element.hidden, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('an older count response cannot overwrite a newer cart refresh', async () => {
  const originalFetch = globalThis.fetch;
  const element = { hidden: false, textContent: '', setAttribute() {} };
  let finishFirst;
  try {
    globalThis.fetch = () => new Promise(resolve => { finishFirst = resolve; });
    const first = updateCartCount(element);
    globalThis.fetch = async () => response({ items: [], total: 0, currency: 'KZT' });
    await updateCartCount(element);
    finishFirst(response(cart));
    await first;
    assert.equal(element.hidden, false);
    assert.equal(element.textContent, '0');
  } finally { globalThis.fetch = originalFetch; }
});
