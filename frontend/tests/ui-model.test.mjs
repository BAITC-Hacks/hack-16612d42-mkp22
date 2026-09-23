import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, characteristics, productCode, certificate, selectable, money, validResponse } from '../ui-model.js';

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
  assert.equal(productCode({ id: '123', characteristics: {} }), 'Код товара: 123');
  assert.equal(productCode({ id: '123', characteristics: { Артикул: 'EKT-16' } }), 'Артикул: EKT-16');
  assert.equal(certificate({ characteristics: {} }), null);
  assert.equal(certificate({ characteristics: { Сертификат: 'javascript:alert(1)' } }).url, null);
  assert.equal(certificate({ characteristics: { Сертификат: { url: 'https://ekt.kz/cert.pdf' } } }).url, 'https://ekt.kz/cert.pdf');
});

test('selection requires known positive stock and an explicit unit; fractional stock is valid', () => {
  for (const product of [{ stock: 0, unit: 'шт.' }, { stock: null, unit: 'шт.' }, { stock: 4, unit: null }, { stock: '4', unit: 'шт.' }]) assert.equal(selectable(product), false);
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
