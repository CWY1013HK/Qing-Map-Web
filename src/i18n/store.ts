import { DEFAULT_LOCALE, htmlLangFor, isLocale, LOCALE_STORAGE_KEY, type Locale } from './types'

type LocaleListener = (locale: Locale) => void

const listeners = new Set<LocaleListener>()

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(raw)) return raw
  } catch {
    /* private mode / blocked storage */
  }
  return DEFAULT_LOCALE
}

let current: Locale = readStoredLocale()

function applyHtmlLang(locale: Locale): void {
  document.documentElement.lang = htmlLangFor(locale)
}

applyHtmlLang(current)

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
  applyHtmlLang(locale)
  for (const cb of listeners) cb(locale)
}

export function subscribeLocale(cb: LocaleListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Re-apply stored locale to listeners without changing it (first paint). */
export function notifyLocaleListeners(): void {
  for (const cb of listeners) cb(current)
}
