import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, catalogUrl, storeUrl, characteristics, displayCharacteristics, productCode, productUnit, minOrder, initialQuantity, quantityError, availableStores, certificate, selectable, money, validResponse } from '../ui-model.js';
import { setLanguage } from '../i18n.js';

test('catalog URLs cannot execute code, disclose credentials or become relative links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//evil.example/x', '/cart', 'https://user:pass@example.com', null]) assert.equal(safeUrl(value), null);
  assert.equal(safeUrl('https://ekt.kz/files/certificate.pdf'), 'https://ekt.kz/files/certificate.pdf');
});

test('heterogeneous catalog characteristics become named values, preserving zeros', () => {
  assert.deepEqual(characteristics({ 'Ток': 16, 'Монтаж': { 'Тип': 'DIN' }, 'Остаток': 0 }), [['Ток', '16'], ['Монтаж · Тип', 'DIN'], ['Остаток', '0']]);
  assert.deepEqual(characteristics([{ name: 'Ток', value: 16, unit: 'А' }]), [['Ток', '16 А']]);
  assert.deepEqual(characteristics('{"Ток":"16 А"}'), [['Ток', '16 А']]);
  assert.deepEqual(characteristics('Медный провод'), [['Описание', 'Медный провод']]);
  assert.deepEqual(characteristics(null), []);
});

test('internal IDs are not presented as articles; certificate must exist in catalog data', () => {
  assert.equal(productCode({ id: '515291', article: '027228', characteristics: { Артикул: 'old-article' } }), 'Артикул: 027228');
  assert.equal(productCode({ id: '123', characteristics: {} }), 'Код товара: 123');
  assert.equal(productCode({ id: '123', characteristics: { Артикул: 'EKT-16' } }), 'Артикул: EKT-16');
  assert.equal(certificate({ characteristics: {} }), null);
  assert.equal(certificate({ characteristics: { Сертификат: 'javascript:alert(1)' } }).url, null);
  assert.equal(certificate({ characteristics: { Сертификат: { url: 'https://ekt.kz/cert.pdf' } } }).url, 'https://ekt.kz/cert.pdf');
});

test('catalog metadata is hidden without removing useful zero-valued specifications', () => {
  const data = {
    BRAND_PRIORITY: 1, CML2_ARTICLE: '027228', CML2_MORE: 'internal', IMYAKARTINKI: 'x.jpg',
    NOVINKA: true, SPETSPREDLOZHENIE: true, RECOMMEND: true, KRATNOST_MIN: 5,
    group: { KRATNOST_PACK: 10 }, 'Ток': '16 А', 'Полюса': 1, 'Температура': 0,
  };
  assert.deepEqual(displayCharacteristics(data), [['Ток', '16 А'], ['Полюса', '1'], ['Температура', '0']]);
  assert.deepEqual(displayCharacteristics({ BRAND_PRIORITY: [1, 2], NOVINKA: { value: true }, 'Ток': [16, 20] }), [['Ток 1', '16'], ['Ток 2', '20']]);
  assert.equal(characteristics(data).length, 12, 'presentation filtering must not mutate the catalog');
});

test('missing units get localized generic labels while catalog units remain unchanged', () => {
  try {
    for (const [language, unit] of [['ru', 'ед.'], ['kz', 'бірл.'], ['en', 'units']]) {
      setLanguage(language);
      for (const value of [null, undefined, '', '  ']) assert.equal(productUnit({ unit: value }), unit);
      assert.equal(productUnit({ unit: 'м' }), 'м');
    }
  } finally { setLanguage('ru'); }
});

test('minimum order and multiples apply without rounding the requested quantity', () => {
  const product = { stock: 365, min_order: 5, unit: null };
  assert.equal(initialQuantity(product), 5);
  assert.equal(quantityError(product, 5), null);
  assert.equal(quantityError(product, 365), null);
  assert.equal(quantityError(product, 2), 'minimum');
  assert.equal(quantityError(product, 6), 'multiple');
  assert.equal(quantityError(product, 370), 'maximum');
  for (const quantity of [0, -1, NaN, Infinity]) assert.equal(quantityError(product, quantity), 'invalid');
  assert.equal(quantityError({ stock: 3, min_order: 5 }, 5), 'maximum');
  assert.equal(quantityError({ stock: 10, min_order: 0.1 }, 0.3), null);
  assert.equal(quantityError({ stock: 10, min_order: 0.1 }, 0.35), 'multiple');
  for (const value of [undefined, null, '5', 0, -1, NaN]) assert.equal(minOrder({ min_order: value }), null);
  assert.equal(initialQuantity({ stock: 0.5 }), 0.5);
  assert.equal(quantityError({ stock: 0.5 }, 0.25), null);
});

test('warehouse display contains only known positive quantities', () => {
  const stores = [{ name: 'Алматы', quantity: 5 }, { name: 'Астана', quantity: 8 },
    { name: 'Empty', quantity: 0 }, { name: 'Unknown', quantity: null }, { name: '', quantity: 2 }, null];
  assert.deepEqual(availableStores({ stores }), stores.slice(0, 2));
  assert.deepEqual(availableStores({}), []);
});

test('EKT links and relative catalog images resolve without weakening cart URL checks', () => {
  assert.equal(storeUrl('https://ekt.kz/catalog/027228'), 'https://ekt.kz/catalog/027228');
  assert.equal(storeUrl('/catalog/027228'), 'https://ekt.kz/catalog/027228');
  for (const value of ['https://ekt.kz.evil.example/', 'https://evil.example/', '//evil.example/', 'javascript:alert(1)', 'https://user:pass@ekt.kz/']) assert.equal(storeUrl(value), null);
  assert.equal(catalogUrl('/images/product.jpg'), 'https://ekt.kz/images/product.jpg');
  assert.equal(safeUrl('/cart'), null, 'cart URL policy must still require absolute URLs');
});

test('selection requires known positive stock; missing units and fractional stock are valid', () => {
  for (const stock of [0, -1, null, undefined, '365', NaN, Infinity]) assert.equal(selectable({ stock, unit: 'шт.' }), false);
  for (const unit of [null, undefined, '', 'шт.']) assert.equal(selectable({ stock: 365, unit }), true);
  assert.equal(selectable({ stock: 365 }), true);
  assert.equal(selectable({ stock: 0.5, unit: 'м' }), true);
  assert.match(money(0, 'KZT'), /^0 /);
  assert.equal(money(null, 'KZT'), 'Цена не указана');
  assert.match(money(42, null), /валюта не указана/);
});

test('malformed server responses cannot enter the catalog or confirmation flow', () => {
  const data = { answer: 'Товар найден', products: [{ id: '1', name: 'Автомат' }], cart: { status: 'awaiting_confirmation', items: [{ product_id: '1', quantity: 2 }], added_to_cart: false } };
  assert.ok(validResponse(data));
  for (const invalid of [null, {}, { ...data, products: [null] }, { ...data, cart: { status: 'confirmed', items: [{ product_id: '1', quantity: -1 }] } }]) assert.ok(!validResponse(invalid));
});
