import { applyTranslations, bind, getLanguage, getLocale, onLanguageChange, pruneBindings, setLanguage, t } from './i18n.js';
import { money, safeUrl } from './ui-model.js';
import { readCart } from './cart-api.js';

const result = document.querySelector('#cart-result');
const refresh = document.querySelector('#cart-refresh');
const language = document.querySelector('#language');
const announcement = document.querySelector('#cart-announcement');
let pending = false;

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function label(tag, key, className = '', params = () => ({})) {
  return bind(node(tag, className), () => t(key, params()));
}

function number(value) { return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 6 }).format(value); }

function detail(list, key, value) {
  const group = node('div', 'cart-detail');
  group.append(label('dt', key), bind(node('dd'), value));
  list.append(group);
}

function ektUrl(value) {
  const href = safeUrl(value);
  if (!href) return null;
  const host = new URL(href).hostname.toLowerCase();
  return host === 'ekt.kz' || host.endsWith('.ekt.kz') ? href : null;
}

function renderItem(item, currency) {
  const row = node('li', 'cart-item');
  const heading = node('div', 'cart-item-heading');
  heading.append(node('h2', '', item.name), label('p', 'products.code', 'cart-item-code', () => ({ id: item.product_id })));
  const url = ektUrl(item.url);
  if (url) {
    const link = label('a', 'products.openStore', 'cart-product-link');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    bind(link, () => t('products.openStoreLabel', { name: item.name }), 'aria-label');
    heading.append(link);
  }
  const details = node('dl', 'cart-item-details');
  detail(details, 'confirmation.quantity', () => number(item.quantity));
  detail(details, 'cart.unitPrice', () => money(item.price, item.currency || currency));
  detail(details, 'cart.lineTotal', () => money(Number.isFinite(item.price) ? item.price * item.quantity : null, item.currency || currency));
  detail(details, 'cart.stock', () => item.stock == null ? t('products.stockUnknown')
    : item.stock === 0 ? t('products.unavailable') : number(item.stock));
  row.append(heading, details);
  if (Number.isFinite(item.stock) && item.quantity > item.stock) row.append(label('p', 'cart.stockChanged', 'cart-stock-warning'));
  return row;
}

function state(title, description, { retry = false, loading = false, browse = false } = {}) {
  const container = node('div', 'cart-state');
  if (loading) {
    const spinner = node('span', 'cart-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    container.append(spinner);
  }
  const heading = label('h2', title);
  heading.tabIndex = -1;
  container.append(heading, label('p', description));
  if (retry) {
    const button = label('button', 'common.retry', 'button button-primary');
    button.type = 'button';
    button.addEventListener('click', () => loadCart(true));
    container.append(button);
  }
  if (browse) {
    const link = label('a', 'selection.find', 'button button-primary');
    link.href = '/';
    container.append(link);
  }
  return container;
}

async function loadCart(focus = false) {
  if (pending) return;
  pending = true;
  refresh.disabled = true;
  result.setAttribute('aria-busy', 'true');
  result.replaceChildren(state('cart.loading', 'cart.loadingDescription', { loading: true }));
  announcement.textContent = t('cart.loading');
  try {
    const cart = await readCart();
    if (!cart.items.length) {
      result.replaceChildren(state('cart.empty', 'cart.emptyDescription', { browse: true }));
      announcement.textContent = t('cart.empty');
    } else {
      const items = node('ul', 'cart-items');
      items.append(...cart.items.map(item => renderItem(item, cart.currency)));
      const summary = node('aside', 'cart-summary');
      summary.append(label('h2', 'cart.summary'), label('p', 'cart.countLabel', 'cart-item-count', () => ({ count: number(cart.items.length) })));
      const total = node('div', 'cart-total');
      total.append(label('span', 'cart.total'), bind(node('strong'), () => money(cart.total, cart.currency)));
      summary.append(total, label('p', 'cart.totalNote', 'cart-summary-note'));
      const browse = label('a', 'cart.continue', 'button button-secondary');
      browse.href = '/';
      summary.append(browse);
      const layout = node('div', 'cart-layout');
      layout.append(items, summary);
      result.replaceChildren(layout);
      announcement.textContent = t('cart.loaded', { count: number(cart.items.length) });
    }
  } catch (error) {
    const description = error.code === 'unavailable' ? 'cart.unavailableDescription'
      : error.code === 'invalid' ? 'errors.invalidResponse'
      : error.code === 'timeout' ? 'errors.timeout'
      : error.code === 'network' ? 'errors.network' : 'cart.errorDescription';
    const title = error.code === 'unavailable' ? 'cart.unavailable' : 'cart.error';
    result.replaceChildren(state(title, description, { retry: true }));
    announcement.textContent = t(title);
  } finally {
    pending = false;
    refresh.disabled = false;
    result.setAttribute('aria-busy', 'false');
    pruneBindings();
    if (focus) (result.querySelector('h2[tabindex]') || document.querySelector('#cart-content')).focus({ preventScroll: true });
  }
}

language.value = getLanguage();
language.addEventListener('change', () => setLanguage(language.value));
onLanguageChange(() => {
  language.value = getLanguage();
  announcement.textContent = t('language.changed');
});
refresh.addEventListener('click', () => loadCart());
window.addEventListener('pageshow', event => { if (event.persisted) loadCart(); });
applyTranslations();
loadCart();
