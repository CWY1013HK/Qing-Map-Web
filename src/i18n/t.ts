import { MESSAGES, type MessageKey } from './messages'
import { getLocale } from './store'
import { DEFAULT_LOCALE } from './types'

export function t(key: MessageKey): string {
  const locale = getLocale()
  return MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key
}
