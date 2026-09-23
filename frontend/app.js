import { safeUrl, displayCharacteristics, productCode, productUnit, minOrder, initialQuantity, quantityError, availableStores, catalogUrl, storeUrl, certificate, selectable, money, validResponse } from './ui-model.js';
import { t, bind, getLanguage, getLocale, setLanguage, applyTranslations, onLanguageChange, pruneBindings } from './i18n.js';
import { translations } from './locales.js';
import { createChatPayload } from './api.js';
import { observeViewport } from './viewport.js';
import { updateCartCount } from './cart-api.js';

const $ = selector => document.querySelector(selector);
const conversation = $('#conversation');
const history = [];
let busy = false;
let pendingProposal = null;
let confirmation = [];
let retryRequest = null;
let lastResponseId = 0;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function lnode(tag, key, className, params = {}) {
  return bind(node(tag, null, className), () => t(key, typeof params === 'function' ? params() : params));
}
function dynamicNode(tag, compute, className) {
  return bind(node(tag, null, className), compute);
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function button(key, onClick, style = 'button-secondary', action = false) {
  const el = lnode('button', key, `button ${style}`);
  el.type = 'button';
  if (action) { el.dataset.requestAction = ''; el.disabled = busy; }
  el.addEventListener('click', onClick);
  return el;
}

function announce(key) { bind($('#announcement'), () => t(key)); }
function connection(online) {
  $('#connection').dataset.state = online ? 'online' : 'offline';
  bind($('#connection-text'), () => t(online ? 'connection.online' : 'connection.offline'));
}
function nearBottom() { return conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 90; }
function scrollLatest() { conversation.scrollTop = conversation.scrollHeight; $('#scroll-latest').hidden = true; }
function updateInput() {
  const input = $('#query');
  $('#send').disabled = busy || !input.value.trim() || input.value.length > 2000;
  bind($('#character-count'), () => input.value.length > 1600 ? t('chat.characterCount', { count: input.value.length }) : t('chat.inputHint'));
  input.style.height = 'auto';
  input.style.height = `${Math.min(144, input.scrollHeight)}px`;
}
function setBusy(value) {
  busy = value;
  $('#reset').disabled = value;
  $('#retry').disabled = value;
  document.querySelectorAll('[data-query], [data-request-action]').forEach(el => { el.disabled = value; });
  bind($('#send-label'), () => t(busy ? 'chat.waiting' : 'chat.send'));
  updateInput();
}

// Small safe formatter: paragraphs, lists and bold, with no HTML evaluation.
function inlineText(parent, text) {
  for (const chunk of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (chunk.startsWith('**') && chunk.endsWith('**')) parent.append(node('strong', chunk.slice(2, -2)));
    else parent.append(document.createTextNode(chunk));
  }
}
function formattedText(text) {
  const body = node('div', null, 'message-text');
  let list = null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:([-*•])|\d+[.)])\s+(.+)/);
    if (match) {
      const type = match[1] ? 'UL' : 'OL';
      if (!list || list.tagName !== type) { list = node(type.toLowerCase()); body.append(list); }
      const li = node('li'); inlineText(li, match[2]); list.append(li);
    } else {
      list = null;
      if (line.trim()) { const p = node('p'); inlineText(p, line); body.append(p); }
    }
  }
  return body;
}
function message(role, text) {
  $('#welcome').hidden = true;
  const el = node('article', null, `message ${role}`);
  const label = node('div', null, 'message-label');
  if (role === 'assistant') label.append(icon('chat'));
  label.append(lnode('span', role === 'user' ? 'chat.you' : 'assistant.messageName'));
  const createdAt = new Date();
  const time = dynamicNode('time', () => createdAt.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }));
  time.dateTime = createdAt.toISOString();
  label.append(time);
  el.append(label);
  if (text) el.append(role === 'user' ? node('div', text, 'message-body') : formattedText(text));
  conversation.append(el);
  return el;
}
function clearProposal(key = 'confirmation.closed') {
  if (!pendingProposal) return;
  pendingProposal.replaceWith(lnode('p', key, 'muted-note'));
  pendingProposal = null;
}
function specs(product, limit = Infinity) {
  const getRows = () => displayCharacteristics(product.characteristics);
  const rows = getRows();
  if (!rows.length) return lnode('p', 'products.noSpecs', 'muted-note');
  const dl = node('dl', null, 'spec-list');
  for (let index = 0; index < Math.min(rows.length, limit); index++) {
    const row = node('div', null, 'spec-row');
    row.append(dynamicNode('dt', () => getRows()[index][0]), dynamicNode('dd', () => getRows()[index][1])); dl.append(row);
  }
  return dl;
}
function stockBadge(product) {
  const stock = product.stock;
  if (stock == null || !Number.isFinite(stock)) return lnode('span', 'products.stockUnknown', 'badge badge-unknown');
  if (stock <= 0) return lnode('span', 'products.unavailable', 'badge badge-unavailable');
  return lnode('span', 'products.available', 'badge badge-stock', () => ({ stock, unit: productUnit(product) }));
}
function productImage(product) {
  const url = catalogUrl(product.image);
  if (!url) return null;
  const frame = node('div', null, 'product-image');
  const img = node('img');
  img.loading = 'lazy'; img.decoding = 'async'; img.width = 320; img.height = 200;
  img.referrerPolicy = 'no-referrer';
  bind(img, () => t('products.imageAlt', { name: product.name }), 'alt');
  const fallback = lnode('p', 'products.imageUnavailable', 'muted-note'); fallback.hidden = true;
  img.addEventListener('error', () => { img.hidden = true; fallback.hidden = false; }, { once: true });
  img.src = url;
  frame.append(img, fallback);
  return frame;
}
function productLink(product) {
  const url = storeUrl(product.url);
  if (!url) return null;
  const link = lnode('a', 'products.openStore', 'button button-secondary');
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  bind(link, () => t('products.openStoreLabel', { name: product.name }), 'aria-label');
  return link;
}
function stockByCity(product) {
  const stores = availableStores(product);
  if (!stores.length) return null;
  const section = node('section', null, 'store-stocks');
  section.append(lnode('h3', 'products.storesTitle'));
  const list = node('dl', null, 'spec-list');
  for (const store of stores) {
    const row = node('div', null, 'spec-row');
    row.append(node('dt', store.name), lnode('dd', 'products.storeQuantity', null, () => ({ stock: store.quantity, unit: productUnit(product) })));
    list.append(row);
  }
  section.append(list);
  return section;
}
function certificateInfo(product, showMissing = false) {
  const cert = certificate(product);
  if (!cert) return showMissing ? lnode('p', 'products.noCertificate', 'muted-note') : null;
  if (!cert.url) return lnode('p', 'products.certificateValue', 'muted-note', () => ({ name: certificate(product).label }));
  const link = node('a', null, 'certificate-link');
  link.href = cert.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.append(icon('file'), lnode('span', 'products.certificateLink'));
  bind(link, () => t('products.openCertificate'), 'aria-label');
  return link;
}
function price(product) {
  const el = node('div', null, 'product-price');
  el.append(dynamicNode('span', () => money(product.price, product.currency)));
  if (product.price != null) el.append(dynamicNode('small', () => ` / ${productUnit(product)}`));
  return el;
}
function askAbout(product) {
  const query = t(product.stock === 0 ? 'products.analogueQuery' : 'products.stockQuery', { name: product.name, id: product.id });
  return send(query.slice(0, 2000));
}
function productAction(product) {
  if (selectable(product)) return button('cart.add', () => openConfirmation([{ product, quantity: initialQuantity(product) }]), 'button-primary', true);
  return button(product.stock === 0 ? 'products.findAnalogue' : 'products.checkStock', () => askAbout(product), 'button-secondary', true);
}
function openDetails(product) {
  const body = $('#product-detail'); body.replaceChildren();
  body.append(dynamicNode('p', () => productCode(product), 'product-code'), node('h3', product.name), stockBadge(product));
  const photo = productImage(product); if (photo) body.append(photo);
  if (product.kind === 'possible_analogue') body.append(lnode('p', 'products.analogueNote', 'muted-note'));
  body.append(price(product), node('p', product.reason, 'product-reason'), specs(product));
  const stores = stockByCity(product); if (stores) body.append(stores);
  const cert = certificateInfo(product, true); if (cert) body.append(cert);
  const link = productLink(product); if (link) body.append(link);
  const action = productAction(product);
  action.addEventListener('click', () => { if ($('#product-dialog').open) $('#product-dialog').close(); });
  body.append(action);
  $('#product-dialog').showModal();
}
function renderProducts(parent, products) {
  if (!products.length) {
    const empty = node('div', null, 'state-panel empty-results');
    empty.append(lnode('h3', 'products.notFound'), lnode('p', 'products.notFoundDescription'));
    empty.append(button('products.refine', () => { $('#query').focus(); }, 'button-secondary'));
    parent.append(empty); return;
  }
  parent.append(lnode('h3', 'products.results', 'results-heading', { count: products.length }));
  const grid = node('div', null, `product-grid${products.length === 1 ? ' single' : ''}`);
  for (const product of products) {
    const card = node('section', null, 'product-card');
    const top = node('div', null, 'product-topline');
    if (product.kind === 'possible_analogue') top.append(lnode('span', 'products.analogue', 'badge badge-analogue'));
    top.append(dynamicNode('span', () => productCode(product), 'product-code'));
    card.append(top);
    const photo = productImage(product); if (photo) card.append(photo);
    card.append(node('h3', product.name), stockBadge(product), specs(product, 3));
    if (product.reason) card.append(node('p', product.reason, 'product-reason'));
    if (product.kind === 'possible_analogue') card.append(lnode('p', 'products.compatibility', 'muted-note'));
    const cert = certificateInfo(product); if (cert) card.append(cert);
    card.append(price(product));
    const actions = node('div', null, 'product-actions');
    actions.append(button('products.details', () => openDetails(product)), productAction(product));
    const link = productLink(product); if (link) actions.append(link);
    card.append(actions);
    if (!selectable(product)) card.append(lnode('p', 'products.selectionRequirements', 'muted-note'));
    grid.append(card);
  }
  parent.append(grid);
}

function openConfirmation(items) {
  if (busy || !items.length || items.length > 6 || items.some(item => !item.product || !selectable(item.product))) return;
  if ($('#product-dialog').open) $('#product-dialog').close();
  confirmation = items.map(item => ({ ...item }));
  const container = $('#confirm-items'); container.replaceChildren();
  confirmation.forEach((item, index) => {
    const { product } = item;
    const row = node('section', null, 'confirm-item');
    row.append(node('h3', product.name), dynamicNode('p', () => productCode(product), 'product-code'));
    if (product.kind === 'possible_analogue') row.append(lnode('p', 'products.confirmAnalogueNote', 'muted-note'));
    row.append(stockBadge(product));
    const control = node('div', null, 'quantity-control');
    const label = lnode('label', 'confirmation.quantity'); label.htmlFor = `quantity-${index}`;
    const input = node('input');
    const minimum = minOrder(product);
    input.id = label.htmlFor; input.type = 'number'; input.min = String(minimum ?? 0); input.step = minimum === null ? 'any' : String(minimum); input.max = String(Math.min(product.stock, 1_000_000)); input.required = true;
    input.value = String(item.quantity); input.inputMode = 'decimal';
    bind(input, () => t('confirmation.quantityLabel', { name: product.name, unit: productUnit(product) }), 'aria-label');
    input.addEventListener('input', () => {
      item.quantity = input.valueAsNumber;
      validateQuantity(input, item);
      updateTotal();
    });
    control.append(label, input, dynamicNode('span', () => productUnit(product)));
    row.append(control);
    if (minimum !== null) row.append(lnode('p', 'products.minimumOrder', 'muted-note', () => ({ count: minimum, unit: productUnit(product) })));
    const error = node('p', null, 'quantity-error'); error.id = `quantity-error-${index}`; error.hidden = true; error.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', error.id);
    row.append(error); container.append(row);
    validateQuantity(input, item);
  });
  updateTotal();
  $('#confirm-dialog').showModal();
}
function updateTotal() {
  const valid = confirmation.length > 0 && confirmation.every(item => !quantityError(item.product, item.quantity));
  $('#confirm-submit').disabled = !valid;
  const currencies = new Set(confirmation.map(item => item.product.currency));
  if (valid && currencies.size === 1 && [...currencies][0] && confirmation.every(item => Number.isFinite(item.product.price))) {
    const total = confirmation.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    bind($('#confirm-total'), () => t('confirmation.total', { amount: money(total, [...currencies][0]) }));
  } else bind($('#confirm-total'), () => t('confirmation.totalUnknown'));
}

function validateQuantity(input, item) {
  const code = quantityError(item.product, item.quantity);
  const keys = { invalid: 'confirmation.quantityInvalid', maximum: 'confirmation.quantityMaximum', minimum: 'confirmation.quantityMinimum', multiple: 'confirmation.quantityMultiple' };
  const text = code ? t(keys[code], { stock: Math.min(item.product.stock, 1_000_000), count: minOrder(item.product), unit: productUnit(item.product) }) : '';
  input.setCustomValidity(text);
  input.setAttribute('aria-invalid', String(Boolean(code)));
  const error = document.getElementById(input.getAttribute('aria-describedby'));
  if (error) { error.textContent = text; error.hidden = !code; }
}

function renderProposal(parent, data, responseId) {
  if (data.cart.status !== 'awaiting_confirmation' || !data.cart.items.length) return;
  const items = data.cart.items.map(item => ({ product: data.products.find(p => p.id === item.product_id), quantity: item.quantity }));
  if (items.some(item => !item.product || !selectable(item.product))) return;
  const panel = node('div', null, 'state-panel confirmation-proposal');
  panel.append(lnode('h3', 'confirmation.pendingTitle'), lnode('p', 'confirmation.pendingDescription'));
  const list = node('ul', null, 'proposal-list');
  for (const item of items) list.append(dynamicNode('li', () => `${item.product.name} — ${item.quantity} ${productUnit(item.product)}`));
  panel.append(list, button('confirmation.review', () => { if (responseId === lastResponseId) openConfirmation(items); }, 'button-primary', true));
  panel.append(button('common.cancel', () => clearProposal('confirmation.cancelled')));
  parent.append(panel); pendingProposal = panel;
}
function renderOutcome(parent, data, requestedItems) {
  if (data.cart.status !== 'confirmed' || !requestedItems.length) return;
  const added = data.cart.added_to_cart === true;
  const panel = node('div', null, `state-panel ${added ? 'success cart-success' : 'selection-confirmed'}`);
  panel.append(lnode('h3', added ? 'cart.success' : 'selection.confirmed'));
  panel.append(lnode('p', added ? 'cart.successDescription' : 'selection.confirmedDescription'));
  const link = lnode('a', 'cart.open', 'button button-primary');
  const cartUrl = added ? safeUrl(data.cart.cart_url) : null;
  link.href = cartUrl || '/cart';
  if (cartUrl && new URL(cartUrl).origin !== window.location.origin) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  panel.append(link);
  if (added) updateCartCount($('#selection-count'));
  parent.append(panel);
  announce(added ? 'cart.successAnnouncement' : 'selection.confirmedAnnouncement');
}

async function send(query, items = [], retry = false) {
  query = query.trim();
  if (!query || busy || query.length > 2000) return;
  clearProposal();
  $('#error').hidden = true;
  retryRequest = null;
  const previousHistory = history.slice(-12);
  const responseId = ++lastResponseId;
  if (!retry) message('user', query);
  // Keep drafts typed while waiting, including during confirmation requests.
  if (!items.length && !retry) $('#query').value = '';
  setBusy(true);
  const loading = message('assistant');
  const typing = node('div', null, 'typing');
  typing.setAttribute('role', 'status');
  const dots = node('span', null, 'typing-dots'); dots.setAttribute('aria-hidden', 'true');
  dots.append(node('i'), node('i'), node('i'));
  let loadingKey = items.length ? 'chat.checkingStock' : 'chat.checkingCatalog';
  const status = dynamicNode('span', () => t(loadingKey));
  typing.append(dots, status); loading.append(typing);
  scrollLatest();
  // /api/chat is not streaming. This describes waiting, not received tokens.
  const typingTimer = setTimeout(() => { if (!items.length) { loadingKey = 'chat.typing'; status.textContent = t(loadingKey); } }, 1600);
  const slowTimer = setTimeout(() => { loadingKey = 'chat.slow'; status.textContent = t(loadingKey); }, 18000);
  const confirmCart = items.map(item => ({ product_id: item.product.id, quantity: item.quantity }));
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(createChatPayload({ query, history: previousHistory, confirmCart, language: getLanguage() })),
      signal: AbortSignal.timeout(125_000),
    });
    let data;
    try { data = await response.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { translationKey: 'errors.invalidResponse' }); }
    if (!response.ok) {
      const error = new Error('Chat request failed');
      error.status = response.status;
      error.translationKey = errorKey(data.detail?.code, response.status);
      throw error;
    }
    if (!validResponse(data)) throw Object.assign(new Error('Invalid catalog response'), { translationKey: 'errors.invalidResponse' });
    const follow = nearBottom();
    loading.remove();
    const reply = message('assistant', data.answer);
    renderProducts(reply, data.products);
    renderOutcome(reply, data, items);
    renderProposal(reply, data, responseId);
    const meta = node('div', null, 'answer-meta');
    const checked = new Date(data.catalog_checked_at);
    if (data.catalog_checked_at && !Number.isNaN(checked.valueOf())) meta.append(lnode('span', 'chat.catalogChecked', null, () => ({ date: checked.toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })));
    if (Array.isArray(data.warnings) && data.warnings.length) {
      const details = node('details'); details.append(lnode('summary', 'chat.warnings'));
      const list = node('ul');
      data.warnings.filter(warning => typeof warning === 'string').forEach(warning => {
        const key = ['Остатки — снимок каталога, не резерв. API корзины ekt.kz не подключён.', 'Остатки — снимок detail API EKT, не резерв. API корзины ekt.kz не подключён.'].includes(warning)
          ? 'warnings.catalog' : ['warnings.catalog', 'warnings.analogues'].find(key => translations.ru[key] === warning);
        // Unknown catalog/AI prose is source data; do not translate it heuristically.
        list.append(key ? lnode('li', key) : node('li', warning));
      });
      details.append(list); meta.append(details);
    }
    reply.append(meta);
    history.push({ role: 'user', content: query }, { role: 'assistant', content: data.answer.slice(0, 4000) });
    history.splice(0, Math.max(0, history.length - 12));
    connection(true);
    if (follow) {
      // Start at the answer, rather than jumping past its product cards.
      conversation.scrollTop = Math.max(0, reply.offsetTop - conversation.offsetTop - 16);
    }
    $('#scroll-latest').hidden = nearBottom();
  } catch (error) {
    loading.remove();
    bind($('#error-title'), () => t(items.length ? 'errors.confirmTitle' : 'errors.answerTitle'));
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    const key = timeout ? 'errors.timeout' : error.translationKey || (error instanceof TypeError ? 'errors.network' : 'errors.generic');
    bind($('#error-message'), () => `${t(key)}${items.length ? ` ${t('errors.confirmFailureNote')}` : ''}`);
    $('#error').hidden = false;
    retryRequest = { query, items, retry: true };
    bind($('#retry'), () => t(items.length ? 'confirmation.retry' : 'common.retry'));
    if (error.status >= 500 || error instanceof TypeError || timeout) connection(false);
    announce('errors.announcement');
  } finally {
    clearTimeout(typingTimer); clearTimeout(slowTimer);
    pruneBindings();
    setBusy(false);
  }
}

function errorKey(code, status) {
  if (typeof code !== 'string') code = '';
  if (code === 'CART_UNAVAILABLE') return 'errors.cartUnavailable';
  if (code === 'CART_INVALID') return 'errors.cartInvalid';
  if (code === 'AI_REFUSAL') return 'errors.refusal';
  if (code?.endsWith('_TIMEOUT') || status === 504) return 'errors.timeout';
  if (code?.endsWith('_SCHEMA') || ['AI_INCOMPLETE', 'AI_PRODUCT_ID', 'AI_ANALOGUE'].includes(code)) return 'errors.invalidResponse';
  if (status === 413) return 'errors.limit';
  if (status >= 500 || status === 429) return 'errors.unavailable';
  return 'errors.generic';
}

$('#chat-form').addEventListener('submit', event => { event.preventDefault(); send($('#query').value); });
$('#query').addEventListener('input', updateInput);
$('#query').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send($('#query').value); }
});
document.querySelectorAll('[data-query]').forEach(el => el.addEventListener('click', () => send(t(el.dataset.query))));
$('#confirm-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || $('#confirm-submit').disabled || !$('#confirm-form').reportValidity()) return;
  const items = confirmation.map(item => ({ ...item }));
  $('#confirm-dialog').close();
  const description = items.map(item => t('confirmation.item', { name: item.product.name.slice(0, 160), id: item.product.id, count: item.quantity, unit: productUnit(item.product) })).join('; ');
  send(t('confirmation.query', { items: description }).slice(0, 2000), items);
});
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => $(`#${el.dataset.close}`).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
$('#retry').addEventListener('click', () => {
  if (!retryRequest || busy) return;
  const { query, items } = retryRequest;
  if (items.length) openConfirmation(items);
  else send(query, [], true);
});
$('#error-close').addEventListener('click', () => { $('#error').hidden = true; });
$('#help-example').addEventListener('click', () => {
  $('#query').value = t('help.exampleQuery');
  updateInput(); $('#query').focus();
});
$('#scroll-latest').addEventListener('click', scrollLatest);
conversation.addEventListener('scroll', () => { $('#scroll-latest').hidden = !$('#welcome').hidden || nearBottom(); }, { passive: true });
$('#reset').addEventListener('click', () => {
  if (busy) return;
  clearProposal(); history.length = 0; retryRequest = null;
  conversation.querySelectorAll('.message').forEach(el => el.remove());
  pruneBindings();
  $('#welcome').hidden = false; $('#error').hidden = true; $('#scroll-latest').hidden = true;
  $('#query').value = ''; updateInput();
  conversation.scrollTop = 0; $('#query').focus(); announce('chat.newAnnouncement');
});
fetch('/health', { signal: AbortSignal.timeout(5000) })
  .then(response => { if (!lastResponseId) connection(response.ok); })
  .catch(() => { if (!lastResponseId) connection(false); });
const updateViewport = observeViewport();
$('#language').value = getLanguage();
$('#language').addEventListener('change', event => setLanguage(event.target.value));
onLanguageChange(() => {
  $('#language').value = getLanguage();
  $('#confirm-items').querySelectorAll('input').forEach((input, index) => validateQuantity(input, confirmation[index]));
  updateInput();
  updateViewport();
  announce('language.changed');
});
applyTranslations();
bind($('#send-label'), () => t(busy ? 'chat.waiting' : 'chat.send'));
updateCartCount($('#selection-count'));
window.addEventListener('pageshow', event => { if (event.persisted) updateCartCount($('#selection-count')); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateCartCount($('#selection-count')); });
updateInput();
