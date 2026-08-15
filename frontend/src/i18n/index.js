import { en } from './en';
import { zh } from './zh';

const dictionaries = { en, zh };
const LOCALE_STORAGE_KEY = 'locale';

export function getLocale() {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && dictionaries[stored]) return stored;
  }
  if (typeof navigator !== 'undefined') {
    const lang = (navigator.language || 'en').toLowerCase();
    if (lang.startsWith('zh')) return 'zh';
  }
  return 'en';
}

export function setLocale(locale) {
  if (typeof localStorage !== 'undefined' && dictionaries[locale]) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
}

export function t(path, ...args) {
  const locale = getLocale();
  const dict = dictionaries[locale] || dictionaries.en;
  const segments = path.split('.');
  let cur = dict;
  for (const s of segments) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, s)) {
      cur = cur[s];
    } else {
      cur = null;
      break;
    }
  }
  if (typeof cur === 'function') return cur(...args);
  return cur || path; // fallback to key
}

export function currentDict() {
  return dictionaries[getLocale()] || dictionaries.en;
}
