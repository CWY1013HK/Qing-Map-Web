export type Locale = 'zh-Hant' | 'zh-Hans' | 'en'

export const LOCALES: readonly Locale[] = ['zh-Hant', 'zh-Hans', 'en'] as const

export const DEFAULT_LOCALE: Locale = 'zh-Hant'

export const LOCALE_STORAGE_KEY = 'qing-map-locale'

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-Hant' || value === 'zh-Hans' || value === 'en'
}

/** Map our locale ids to standard BCP 47 tags for `<html lang>`. */
export function htmlLangFor(locale: Locale): string {
  switch (locale) {
    case 'zh-Hant':
      return 'zh-Hant'
    case 'zh-Hans':
      return 'zh-Hans'
    case 'en':
      return 'en'
  }
}
