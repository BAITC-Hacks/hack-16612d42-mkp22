import { t, getLocale } from './i18n.js';

// Presentation helpers. The server remains the authority for catalog and cart state.
export function safeUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function characteristics(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return value.trim() ? [[t('common.description'), value]] : []; }
  }
  const rows = [];
  function visit(entry, label = '', depth = 0) {
    if (entry == null || rows.length >= 80 || depth > 5) return;
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => {
        if (item && typeof item === 'object' && !Array.isArray(item) && ('value' in item || 'значение' in item)) {
          const key = item.name ?? item.label ?? item.key ?? item.название ?? (label || t('common.parameter', { index: index + 1 }));
          const val = item.value ?? item.значение;
          visit(val, String(key), depth + 1);
          if (item.unit && rows.length) rows[rows.length - 1][1] += ` ${item.unit}`;
        } else visit(item, label ? `${label} ${index + 1}` : t('common.parameter', { index: index + 1 }), depth + 1);
      });
    } else if (typeof entry === 'object') {
      for (const [key, val] of Object.entries(entry)) visit(val, label ? `${label} · ${key}` : key, depth + 1);
    } else rows.push([label || t('common.description'), typeof entry === 'boolean' ? t(entry ? 'common.yes' : 'common.no') : String(entry)]);
  }
  visit(value);
  return rows;
}

export function productCode(product) {
  const article = characteristics(product.characteristics).find(([key]) => /^(артикул|article|sku)$/i.test(key));
  return t(article ? 'products.sku' : 'products.code', { id: article ? article[1] : product.id });
}

export function certificate(product) {
  const entries = characteristics(product.characteristics).filter(([key]) => /сертификат|certificate/i.test(key));
  const linked = entries.find(([, value]) => safeUrl(value));
  if (linked) return { label: t('products.certificate'), url: safeUrl(linked[1]) };
  return entries.length ? { label: entries.map(([, value]) => value).join(' · '), url: null } : null;
}

export function selectable(product) {
  return Number.isFinite(product.stock) && product.stock > 0;
}

export function money(price, currency) {
  if (!Number.isFinite(price)) return t('products.priceUnknown');
  const amount = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(price);
  return `${amount} ${currency === 'KZT' ? '₸' : currency || t('common.currencyUnknown')}`;
}

export function validResponse(data) {
  return data && typeof data.answer === 'string' && data.answer.trim() && Array.isArray(data.products)
    && data.products.length <= 6 && data.products.every(p => p && typeof p.id === 'string' && typeof p.name === 'string')
    && data.cart && ['not_requested', 'awaiting_confirmation', 'confirmed'].includes(data.cart.status)
    && Array.isArray(data.cart.items) && data.cart.items.length <= 6
    && data.cart.items.every(item => item && typeof item.product_id === 'string' && Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 1_000_000);
}
