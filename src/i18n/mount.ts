import { applyChromeI18n } from './applyChrome'
import { subscribeLocale } from './store'

type LocaleRefresh = () => void

const refreshers = new Set<LocaleRefresh>()

/** Register a callback that re-applies locale-dependent UI (beyond chrome). */
export function registerLocaleRefresh(cb: LocaleRefresh): () => void {
  refreshers.add(cb)
  return () => {
    refreshers.delete(cb)
  }
}

/**
 * Apply chrome strings once and keep them (plus registered refreshers) in sync
 * when the locale changes from the credits language toggle.
 */
export function mountI18n(): void {
  applyChromeI18n()
  subscribeLocale(() => {
    applyChromeI18n()
    for (const cb of refreshers) cb()
  })
}
