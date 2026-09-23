// Cart contents belong to the server session. Never persist a separate client cart.
import { bind, getLocale, t } from './i18n.js';

export class CartRequestError extends Error {
  constructor(code) { super(`Cart request failed: ${code}`); this.name = 'CartRequestError'; this.code = code; }
}

const optionalAmount = value => value == null || (Number.isFinite(value) && value >= 0);

export function validCart(data) {
  return Boolean(data && Array.isArray(data.items)
    && optionalAmount(data.total)
    && (data.currency == null || typeof data.currency === 'string')
    && data.items.every(item => item && typeof item.product_id === 'string' && item.product_id.trim()
      && typeof item.name === 'string' && item.name.trim()
      && Number.isFinite(item.quantity) && item.quantity > 0
      && optionalAmount(item.price) && optionalAmount(item.stock)
      && (item.currency == null || typeof item.currency === 'string')
      && (item.url == null || typeof item.url === 'string')));
}

export async function readCart({ signal, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetchImpl('/api/cart', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok) throw new CartRequestError([404, 405, 501].includes(response.status) ? 'unavailable' : 'http');
    let data;
    try { data = await response.json(); } catch { throw new CartRequestError('invalid'); }
    if (!validCart(data)) throw new CartRequestError('invalid');
    return data;
  } catch (error) {
    if (error instanceof CartRequestError) throw error;
    throw new CartRequestError(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

const requests = new WeakMap();

export async function updateCartCount(element) {
  if (!element) return null;
  const request = {};
  requests.set(element, request);
  element.hidden = true;
  try {
    const cart = await readCart();
    if (requests.get(element) !== request) return cart;
    const count = cart.items.length;
    bind(element, () => new Intl.NumberFormat(getLocale()).format(count));
    bind(element, () => t('cart.countLabel', { count }), 'aria-label');
    element.hidden = false;
    return cart;
  } catch {
    if (requests.get(element) === request) element.hidden = true;
    return null;
  }
}
