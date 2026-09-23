const $ = (selector) => document.querySelector(selector);
const conversation = $('#conversation');
const welcome = $('#welcome');
const history = [];
let busy = false;
let pendingConfirmation = null;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function message(role, text) {
  welcome.hidden = true;
  const el = node('article', null, `message ${role}`);
  if (role === 'assistant') el.append(node('div', '✦ EKT АССИСТЕНТ', 'message-label'));
  el.append(node('div', text, 'message-text'));
  conversation.append(el);
  scroll();
  return el;
}

function scroll() { conversation.scrollTop = conversation.scrollHeight; }

function setBusy(value) {
  busy = value;
  $('#send').disabled = value;
  $('#reset').disabled = value;
  $('#query').disabled = value;
  document.querySelectorAll('[data-query], .confirm button').forEach(button => { button.disabled = value; });
  $('#send').textContent = value ? '…' : '↑';
  conversation.setAttribute('aria-busy', String(value));
}

function clearConfirmation() {
  if (pendingConfirmation) {
    pendingConfirmation.replaceWith(node('p', 'Предыдущее предложение закрыто.', 'warning'));
    pendingConfirmation = null;
  }
}

function renderProducts(parent, products) {
  if (!products.length) return;
  const list = node('div', null, 'products');
  for (const p of products) {
    const card = node('section', null, 'product');
    card.append(node('span', p.kind === 'possible_analogue' ? 'ВОЗМОЖНЫЙ АНАЛОГ · требуется проверка' : 'ИЗ КАТАЛОГА', 'product-tag'));
    card.append(node('h3', p.name));
    card.append(node('p', `Артикул: ${p.id}`));
    card.append(node('strong', p.price == null ? 'Цена не указана' : `${new Intl.NumberFormat('ru-RU').format(p.price)} ${p.currency || '(валюта не указана)'}`));
    card.append(node('p', p.stock == null ? 'Наличие не указано' : `Остаток: ${p.stock} ${p.unit || '(единица не указана)'}`));
    card.append(node('p', p.reason));
    if (p.characteristics != null) {
      const details = node('details');
      details.append(node('summary', 'Характеристики'));
      details.append(node('pre', typeof p.characteristics === 'string' ? p.characteristics : JSON.stringify(p.characteristics, null, 2)));
      card.append(details);
    }
    list.append(card);
  }
  parent.append(list);
}

function renderConfirmation(parent, data) {
  if (data.cart?.status !== 'awaiting_confirmation' || !data.cart.items.length) return;
  const panel = node('div', null, 'confirm');
  panel.append(node('strong', 'Подтвердить выбранные позиции?'));
  for (const item of data.cart.items) {
    const product = data.products.find(p => p.id === item.product_id);
    panel.append(node('div', `${product?.name || item.product_id} — ${item.quantity} ${product?.unit || ''}`));
  }
  panel.append(node('p', 'Подтверждение проверит актуальное наличие. Корзина ekt.kz пока не подключена.', 'warning'));
  const confirm = node('button', 'Подтверждаю выбор');
  confirm.type = 'button';
  confirm.addEventListener('click', () => send('Подтверждаю выбранные позиции.', data.cart.items));
  const cancel = node('button', 'Отмена', 'cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', clearConfirmation);
  panel.append(confirm, cancel);
  parent.append(panel);
  pendingConfirmation = panel;
}

async function send(query, confirmCart = []) {
  query = query.trim();
  if (!query || busy || query.length > 2000) return;
  // An old proposal cannot be confirmed after a different conversation turn.
  clearConfirmation();
  $('#error').hidden = true;
  const priorHistory = history.slice(-12);
  message('user', query);
  $('#query').value = '';
  setBusy(true);
  const loading = message('assistant', 'Проверяю каталог и подбираю варианты…');
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, history: priorHistory, confirm_cart: confirmCart }),
      signal: AbortSignal.timeout(125_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail?.message === 'string' ? data.detail.message : 'Не удалось обработать запрос. Попробуйте ещё раз.');
    if (typeof data.answer !== 'string' || !Array.isArray(data.products)) throw new Error('Сервер вернул некорректный ответ. Повторите запрос.');
    loading.remove();
    const reply = message('assistant', data.answer);
    renderProducts(reply, data.products);
    for (const warning of data.warnings || []) reply.append(node('p', warning, 'warning'));
    if (data.catalog_checked_at) {
      const date = new Date(data.catalog_checked_at);
      if (!Number.isNaN(date.valueOf())) reply.append(node('p', `Каталог проверен: ${date.toLocaleString('ru-RU')}`, 'warning'));
    }
    if (data.cart?.status === 'confirmed') reply.append(node('p', 'Выбор подтверждён. Товары не добавлены в корзину ekt.kz.', 'warning'));
    renderConfirmation(reply, data);
    history.push({ role: 'user', content: query }, { role: 'assistant', content: data.answer.slice(0, 4000) });
    history.splice(0, Math.max(0, history.length - 12));
    $('#connection').textContent = '● Подключён к серверу';
  } catch (error) {
    loading.remove();
    $('#error').textContent = error.name === 'TimeoutError' ? 'Время ожидания истекло. Попробуйте ещё раз.' : error.message || 'Ошибка соединения.';
    $('#error').hidden = false;
    $('#query').value = query;
    if (confirmCart.length) $('#error').append(node('div', 'Подтверждение не выполнено. Попросите помощника заново предложить позиции.'));
  } finally {
    setBusy(false);
    $('#query').focus();
    scroll();
  }
}

$('#chat-form').addEventListener('submit', event => { event.preventDefault(); send($('#query').value); });
$('#query').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send($('#query').value); }
});
document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => send(button.dataset.query)));
$('#reset').addEventListener('click', () => {
  if (busy) return;
  clearConfirmation();
  history.length = 0;
  conversation.querySelectorAll('.message').forEach(el => el.remove());
  welcome.hidden = false;
  $('#error').hidden = true;
  $('#query').value = '';
  $('#query').focus();
});
fetch('/health', { signal: AbortSignal.timeout(5000) })
  .then(response => { $('#connection').textContent = response.ok ? '● Сервер подключён' : '○ Сервер недоступен'; })
  .catch(() => { $('#connection').textContent = '○ Сервер недоступен'; });
