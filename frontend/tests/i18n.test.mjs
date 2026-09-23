import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translations } from '../locales.js';
import { t, setLanguage, getLanguage, getLocale } from '../i18n.js';

test('all languages have complete dictionaries and matching interpolation parameters', () => {
  const keys = Object.keys(translations.ru).sort();
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const language of ['ru', 'kz', 'en']) {
    assert.deepEqual(Object.keys(translations[language]).sort(), keys);
    for (const key of keys) {
      assert.equal(typeof translations[language][key], 'string', `${language}:${key}`);
      assert.ok(translations[language][key].trim(), `${language}:${key} is empty`);
      assert.deepEqual(placeholders(translations[language][key]), placeholders(translations.ru[key]), `${language}:${key} parameters`);
    }
  }
});

test('HTML localization markers and literal translation keys exist', async () => {
  for (const file of ['index.html', 'cart/index.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-aria|-placeholder|-title|-content)?="([^"]+)"/g)) assert.ok(translations.ru[match[1]], `${file}: ${match[1]}`);
  }
  for (const file of ['app.js', 'ui-model.js', 'cart.js', 'cart-api.js']) {
    const code = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of code.matchAll(/\bt\('([^']+)'/g)) assert.ok(translations.ru[match[1]], `${file}: ${match[1]}`);
  }
});

test('language changes select the correct locale and reject unsupported input', () => {
  assert.equal(getLanguage(), 'ru');
  assert.ok(setLanguage('kz'));
  assert.equal(getLocale(), 'kk-KZ');
  assert.equal(setLanguage('unknown'), false);
  assert.equal(getLanguage(), 'kz');
  setLanguage('en');
  assert.equal(getLocale(), 'en-GB');
  setLanguage('ru');
  assert.equal(getLocale(), 'ru-RU');
});

test('interpolation leaves dynamic catalog values unchanged', () => {
  const value = 'ВВГнг 3×2,5 — <script> — ӘҒҚҢӨҰҮҺІ';
  // Find a dictionary entry accepting a product name without translating that name.
  const key = Object.keys(translations.ru).find(key => translations.ru[key].includes('{name}'));
  assert.ok(key);
  for (const language of ['ru', 'kz', 'en']) assert.ok(t(key, { name: value, id: 'ID-42', unit: 'м', quantity: 2 }, language).includes(value));
});
