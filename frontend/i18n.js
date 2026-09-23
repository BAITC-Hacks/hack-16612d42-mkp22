import { translations } from './locales.js';

export const supportedLanguages = ['ru', 'kz', 'en'];
export const languageLocales = { ru: 'ru-RU', kz: 'kk-KZ', en: 'en-GB' };
export const storageKey = 'ekt-language';
let language = 'ru';
try {
  const saved = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
  if (supportedLanguages.includes(saved)) language = saved;
} catch { /* Private browsing can disable storage. The UI still works. */ }

const bindings = new Map();
const listeners = new Set();
export const getLanguage = () => language;
export const getLocale = () => languageLocales[language];

export function pruneBindings() {
  for (const element of bindings.keys()) if (!element.isConnected) bindings.delete(element);
}

export function t(key, params = {}, lang = language) {
  const value = translations[lang]?.[key] ?? translations.ru[key];
  if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

// Updating text/attributes in place preserves dialogs, drafts, focus and scroll.
export function bind(element, compute, attribute = 'textContent') {
  if (!bindings.has(element)) bindings.set(element, new Map());
  bindings.get(element).set(attribute, compute);
  const value = compute();
  if (attribute === 'textContent') element.textContent = value;
  else element.setAttribute(attribute, value);
  return element;
}

export function applyTranslations(root = document) {
  for (const [selector, attribute] of [
    ['data-i18n', 'textContent'], ['data-i18n-aria', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder'], ['data-i18n-title', 'title'],
    ['data-i18n-content', 'content'],
  ]) {
    root.querySelectorAll(`[${selector}]`).forEach(element => {
      const value = t(element.getAttribute(selector));
      if (attribute === 'textContent') element.textContent = value;
      else element.setAttribute(attribute, value);
    });
  }
  for (const [element, attributes] of bindings) {
    if (!element.isConnected) { bindings.delete(element); continue; }
    for (const [attribute, compute] of attributes) {
      if (attribute === 'textContent') element.textContent = compute();
      else element.setAttribute(attribute, compute());
    }
  }
  document.documentElement.lang = language === 'kz' ? 'kk' : language;
  document.documentElement.dataset.language = language;
}

export function setLanguage(next) {
  if (!supportedLanguages.includes(next)) return false;
  language = next;
  try { if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, next); } catch { /* Optional persistence. */ }
  if (typeof document !== 'undefined') applyTranslations();
  listeners.forEach(listener => listener(next));
  return true;
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
