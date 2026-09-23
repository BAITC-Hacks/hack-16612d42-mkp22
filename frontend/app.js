import { safeUrl, characteristics, productCode, certificate, selectable, money, validResponse } from './ui-model.js';

const $ = selector => document.querySelector(selector);
const conversation = $('#conversation');
const history = [];
const selected = new Map();
let busy = false;
let pendingProposal = null;
let confirmation = [];
let retryRequest = null;
let lastCartUrl = null;
let lastResponseId = 0;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
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

function button(text, onClick, style = 'button-secondary', action = false) {
  const el = node('button', text, `button ${style}`);
  el.type = 'button';
  if (action) { el.dataset.requestAction = ''; el.disabled = busy; }
  el.addEventListener('click', onClick);
  return el;
}

function announce(text) { $('#announcement').textContent = text; }
function connection(online) {
  $('#connection').dataset.state = online ? 'online' : 'offline';
  $('#connection-text').textContent = online ? 'Сервер на связи' : 'Не удалось связаться с сервером';
}
function nearBottom() { return conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 90; }
function scrollLatest() { conversation.scrollTop = conversation.scrollHeight; $('#scroll-latest').hidden = true; }
function updateInput() {
  const input = $('#query');
  $('#send').disabled = busy || !input.value.trim() || input.value.length > 2000;
  $('#character-count').textContent = input.value.length > 1600 ? `${input.value.length} / 2000` : 'Можно указать название или артикул';
  input.style.height = 'auto';
  input.style.height = `${Math.min(144, input.scrollHeight)}px`;
}
function setBusy(value) {
  busy = value;
  $('#reset').disabled = value;
  $('#retry').disabled = value;
  document.querySelectorAll('[data-query], [data-request-action]').forEach(el => { el.disabled = value; });
  $('#send-label').textContent = value ? 'Ожидаем' : 'Отправить';
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
  label.append(node('span', role === 'user' ? 'Вы' : 'EKT · AI-консультант'));
  const time = node('time', new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  time.dateTime = new Date().toISOString();
  label.append(time);
  el.append(label);
  if (text) el.append(role === 'user' ? node('div', text, 'message-body') : formattedText(text));
  conversation.append(el);
  return el;
}
function clearProposal(text = 'Предложение закрыто. Вы можете выбрать товар из карточки заново.') {
  if (!pendingProposal) return;
  pendingProposal.replaceWith(node('p', text, 'muted-note'));
  pendingProposal = null;
}
function specs(product, limit = Infinity) {
  const rows = characteristics(product.characteristics).filter(([key]) => !/сертификат|certificate/i.test(key));
  if (!rows.length) return node('p', 'Характеристики не указаны в каталоге.', 'muted-note');
  const dl = node('dl', null, 'spec-list');
  for (const [key, value] of rows.slice(0, limit)) {
    const row = node('div', null, 'spec-row');
    row.append(node('dt', key), node('dd', value)); dl.append(row);
  }
  return dl;
}
function stockBadge(product) {
  const stock = product.stock;
  if (stock == null || !Number.isFinite(stock)) return node('span', 'Наличие уточняется', 'badge badge-unknown');
  if (stock <= 0) return node('span', 'Нет в наличии', 'badge badge-unavailable');
  return node('span', `В наличии: ${stock}${product.unit ? ` ${product.unit}` : ' (единица не указана)'}`, 'badge badge-stock');
}
function certificateInfo(product, showMissing = false) {
  const cert = certificate(product);
  if (!cert) return showMissing ? node('p', 'Сертификат не предоставлен в данных каталога.', 'muted-note') : null;
  if (!cert.url) return node('p', `Сертификат: ${cert.label}`, 'muted-note');
  const link = node('a', null, 'certificate-link');
  link.href = cert.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.append(icon('file'), node('span', 'Сертификат ↗'));
  link.setAttribute('aria-label', 'Открыть сертификат в новой вкладке');
  return link;
}
function price(product) {
  const el = node('div', money(product.price, product.currency), 'product-price');
  if (product.price != null && product.unit) el.append(node('small', ` / ${product.unit}`));
  return el;
}
function askAbout(product) {
  const query = product.stock === 0
    ? `Подбери возможный аналог товара «${product.name}» (код ${product.id}) с учётом его характеристик. Объясни различия.`
    : `Уточни наличие и единицу измерения товара «${product.name}» (код ${product.id}).`;
  return send(query.slice(0, 2000));
}
function productAction(product) {
  if (selectable(product)) return button('Выбрать для корзины', () => openConfirmation([{ product, quantity: Math.min(1, product.stock) }]), 'button-primary', true);
  return button(product.stock === 0 ? 'Подобрать аналог' : 'Уточнить наличие', () => askAbout(product), 'button-secondary', true);
}
function openDetails(product) {
  const body = $('#product-detail'); body.replaceChildren();
  body.append(node('p', productCode(product), 'product-code'), node('h3', product.name), stockBadge(product));
  if (product.kind === 'possible_analogue') body.append(node('p', 'Возможный аналог. Проверьте техническую совместимость перед покупкой.', 'muted-note'));
  body.append(price(product), node('p', product.reason, 'product-reason'), specs(product));
  const cert = certificateInfo(product, true); if (cert) body.append(cert);
  const action = productAction(product);
  action.addEventListener('click', () => { if ($('#product-dialog').open) $('#product-dialog').close(); });
  body.append(action);
  $('#product-dialog').showModal();
}
function renderProducts(parent, products) {
  if (!products.length) {
    const empty = node('div', null, 'state-panel empty-results');
    empty.append(node('h3', 'Пока нет товаров для показа'), node('p', 'Уточните название, артикул или параметры. Если ассистент задал вопрос — ответьте, чтобы продолжить подбор.'));
    empty.append(button('Уточнить запрос', () => { $('#query').focus(); }, 'button-secondary'));
    parent.append(empty); return;
  }
  parent.append(node('h3', `Товары по вашему запросу · ${products.length}`, 'results-heading'));
  const grid = node('div', null, `product-grid${products.length === 1 ? ' single' : ''}`);
  for (const product of products) {
    const card = node('section', null, 'product-card');
    const top = node('div', null, 'product-topline');
    if (product.kind === 'possible_analogue') top.append(node('span', 'Возможный аналог', 'badge badge-analogue'));
    top.append(node('span', productCode(product), 'product-code'));
    card.append(top, node('h3', product.name), stockBadge(product), specs(product, 3));
    if (product.reason) card.append(node('p', product.reason, 'product-reason'));
    if (product.kind === 'possible_analogue') card.append(node('p', 'Совместимость требует проверки.', 'muted-note'));
    const cert = certificateInfo(product); if (cert) card.append(cert);
    card.append(price(product));
    const actions = node('div', null, 'product-actions');
    actions.append(button('Подробнее', () => openDetails(product)), productAction(product));
    card.append(actions);
    if (!selectable(product)) card.append(node('p', 'Для выбора нужны подтверждённое наличие и единица измерения.', 'muted-note'));
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
    row.append(node('h3', product.name), node('p', productCode(product), 'product-code'));
    if (product.kind === 'possible_analogue') row.append(node('p', 'Возможный аналог: перед выбором проверьте совместимость.', 'muted-note'));
    row.append(stockBadge(product));
    const control = node('div', null, 'quantity-control');
    const label = node('label', 'Количество'); label.htmlFor = `quantity-${index}`;
    const input = node('input');
    input.id = label.htmlFor; input.type = 'number'; input.min = '0'; input.step = 'any'; input.max = String(Math.min(product.stock, 1_000_000)); input.required = true;
    input.value = String(item.quantity); input.inputMode = 'decimal';
    input.setAttribute('aria-label', `Количество: ${product.name}, ${product.unit}`);
    input.addEventListener('input', () => {
      item.quantity = input.valueAsNumber;
      input.setCustomValidity(item.quantity > 0 ? '' : 'Укажите количество больше нуля.');
      updateTotal();
    });
    control.append(label, input, node('span', product.unit)); row.append(control); container.append(row);
  });
  updateTotal();
  $('#confirm-dialog').showModal();
}
function updateTotal() {
  const valid = confirmation.every(item => Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= Math.min(item.product.stock, 1_000_000));
  $('#confirm-submit').disabled = !valid;
  const currencies = new Set(confirmation.map(item => item.product.currency));
  if (valid && currencies.size === 1 && [...currencies][0] && confirmation.every(item => Number.isFinite(item.product.price))) {
    const total = confirmation.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    $('#confirm-total').textContent = `По данным каталога: ${money(total, [...currencies][0])}`;
  } else $('#confirm-total').textContent = 'Итоговая сумма будет зависеть от актуальных цен и наличия.';
}

function renderProposal(parent, data, responseId) {
  if (data.cart.status !== 'awaiting_confirmation' || !data.cart.items.length) return;
  const items = data.cart.items.map(item => ({ product: data.products.find(p => p.id === item.product_id), quantity: item.quantity }));
  if (items.some(item => !item.product || !selectable(item.product))) return;
  const panel = node('div', null, 'state-panel confirmation-proposal');
  panel.append(node('h3', 'Выбор ждёт вашего подтверждения'), node('p', 'Ничего не добавлено. Проверьте позиции и количество.'));
  const list = node('ul', null, 'proposal-list');
  for (const item of items) list.append(node('li', `${item.product.name} — ${item.quantity} ${item.product.unit}`));
  panel.append(list, button('Проверить и подтвердить', () => { if (responseId === lastResponseId) openConfirmation(items); }, 'button-primary', true));
  panel.append(button('Отмена', () => clearProposal('Предложение отменено. Ничего не добавлено.')));
  parent.append(panel); pendingProposal = panel;
}
function renderOutcome(parent, data, requestedItems) {
  if (data.cart.status !== 'confirmed' || !requestedItems.length) return;
  const added = data.cart.added_to_cart === true;
  lastCartUrl = added ? safeUrl(data.cart.cart_url) : null;
  const panel = node('div', null, `state-panel ${added ? 'success cart-success' : 'selection-confirmed'}`);
  panel.append(node('h3', added ? 'Товары добавлены в корзину' : 'Выбор подтверждён'));
  panel.append(node('p', added ? 'Добавление подтверждено магазином. Можно перейти к оформлению.' : 'Наличие проверено. Товары не добавлены в корзину EKT: сервис добавления пока недоступен.'));
  for (const item of data.cart.items) {
    const product = data.products.find(p => p.id === item.product_id);
    if (product) selected.set(product.id, { product, quantity: item.quantity, added });
  }
  $('#selection-count').textContent = String(selected.size);
  if (added && lastCartUrl) {
    const link = node('a', 'Перейти в корзину', 'button button-primary');
    link.href = lastCartUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; panel.append(link);
  } else panel.append(button('Посмотреть выбранные товары', openSelection));
  parent.append(panel);
  announce(added ? 'Товары добавлены в корзину.' : 'Выбор подтверждён. Товары не добавлены в корзину EKT.');
}
function openSelection() {
  const container = $('#selection-content'); container.replaceChildren();
  if (!selected.size) {
    const empty = node('div', null, 'selection-empty');
    empty.append(icon('cart'), node('h3', 'Вы пока не выбрали товары'), node('p', 'Начните с поиска в чате. В карточке нажмите «Выбрать для корзины» и подтвердите количество.'));
    empty.append(button('Найти товар', () => { $('#selection-dialog').close(); $('#query').focus(); }, 'button-primary'));
    container.append(empty);
  } else {
    container.append(node('p', 'Подтверждённые позиции текущего диалога. Наличие не резервируется.'));
    for (const { product, quantity, added } of selected.values()) {
      const entry = node('section', null, 'selection-entry');
      entry.append(node('h3', product.name), node('p', `${quantity} ${product.unit} · ${productCode(product)}`, 'muted-note'));
      entry.append(node('span', added ? 'Добавлено в корзину' : 'Выбор подтверждён · не в корзине', 'badge badge-stock')); container.append(entry);
    }
  }
  if (![...selected.values()].some(item => item.added)) container.append(node('p', 'Добавление в корзину EKT пока недоступно. Этот список не является заказом.', 'muted-note'));
  $('#selection-dialog').showModal();
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
  const status = node('span', items.length ? 'Проверяем актуальное наличие…' : 'Проверяем каталог…');
  typing.append(dots, status); loading.append(typing);
  scrollLatest();
  // /api/chat is not streaming. This describes waiting, not received tokens.
  const typingTimer = setTimeout(() => { if (!items.length) status.textContent = 'Ассистент готовит ответ…'; }, 1600);
  const slowTimer = setTimeout(() => { status.textContent = 'Запрос занимает больше времени. Ждём ответ сервера…'; }, 18000);
  const confirmCart = items.map(item => ({ product_id: item.product.id, quantity: item.quantity }));
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, history: previousHistory, confirm_cart: confirmCart }),
      signal: AbortSignal.timeout(125_000),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('Сервер вернул ответ, который не удалось прочитать. Попробуйте ещё раз.'); }
    if (!response.ok) {
      const error = new Error(typeof data.detail?.message === 'string' ? data.detail.message : 'Не удалось обработать запрос. Уточните вопрос или повторите попытку.');
      error.status = response.status;
      throw error;
    }
    if (!validResponse(data)) throw new Error('Не удалось прочитать данные каталога. Повторите запрос.');
    const follow = nearBottom();
    loading.remove();
    const reply = message('assistant', data.answer);
    renderProducts(reply, data.products);
    renderOutcome(reply, data, items);
    renderProposal(reply, data, responseId);
    const meta = node('div', null, 'answer-meta');
    const checked = new Date(data.catalog_checked_at);
    if (data.catalog_checked_at && !Number.isNaN(checked.valueOf())) meta.append(node('span', `Каталог проверен: ${checked.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`));
    if (Array.isArray(data.warnings) && data.warnings.length) {
      const details = node('details'); details.append(node('summary', 'Что важно учесть'));
      const list = node('ul');
      data.warnings.filter(warning => typeof warning === 'string').forEach(warning => list.append(node('li', warning)));
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
    $('#error-title').textContent = items.length ? 'Не удалось подтвердить выбор' : 'Не удалось получить ответ';
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    $('#error-message').textContent = timeout ? 'Сервер не ответил вовремя. Попробуйте ещё раз.' : error.message === 'Failed to fetch' ? 'Проверьте соединение и повторите запрос.' : error.message;
    if (items.length) $('#error-message').append(document.createTextNode(' Ничего не подтверждено в интерфейсе. Проверьте актуальное наличие перед новой попыткой.'));
    $('#error').hidden = false;
    retryRequest = { query, items, retry: true };
    $('#retry').textContent = items.length ? 'Проверить выбор' : 'Повторить';
    if (error.status >= 500 || error instanceof TypeError || timeout) connection(false);
    announce('Не удалось выполнить запрос. Доступна повторная попытка.');
  } finally {
    clearTimeout(typingTimer); clearTimeout(slowTimer);
    setBusy(false);
  }
}

$('#chat-form').addEventListener('submit', event => { event.preventDefault(); send($('#query').value); });
$('#query').addEventListener('input', updateInput);
$('#query').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send($('#query').value); }
});
document.querySelectorAll('[data-query]').forEach(el => el.addEventListener('click', () => send(el.dataset.query)));
$('#confirm-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || $('#confirm-submit').disabled || !$('#confirm-form').reportValidity()) return;
  const items = confirmation.map(item => ({ ...item }));
  $('#confirm-dialog').close();
  const description = items.map(item => `${item.product.name.slice(0, 160)} (код ${item.product.id}), ${item.quantity} ${item.product.unit}`).join('; ');
  send(`Подтверждаю выбор для корзины: ${description}`.slice(0, 2000), items);
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
$('#selection-open').addEventListener('click', openSelection);
$('#help-example').addEventListener('click', () => {
  $('#query').value = 'Нужен автоматический выключатель 16А, 1 полюс, характеристика C. Какие варианты есть в наличии?';
  updateInput(); $('#query').focus();
});
$('#scroll-latest').addEventListener('click', scrollLatest);
conversation.addEventListener('scroll', () => { $('#scroll-latest').hidden = !$('#welcome').hidden || nearBottom(); }, { passive: true });
$('#reset').addEventListener('click', () => {
  if (busy) return;
  clearProposal(); history.length = 0; selected.clear(); retryRequest = null; lastCartUrl = null;
  conversation.querySelectorAll('.message').forEach(el => el.remove());
  $('#welcome').hidden = false; $('#error').hidden = true; $('#scroll-latest').hidden = true;
  $('#selection-count').textContent = '0'; $('#query').value = ''; updateInput();
  conversation.scrollTop = 0; $('#query').focus(); announce('Начат новый диалог.');
});
fetch('/health', { signal: AbortSignal.timeout(5000) })
  .then(response => { if (!lastResponseId) connection(response.ok); })
  .catch(() => { if (!lastResponseId) connection(false); });
updateInput();
