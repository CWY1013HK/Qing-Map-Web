import type { MessageKey } from './messages'
import { t } from './t'

const STATUS_KEY_ATTR = 'data-i18n-status'

/** Set status text and remember the message key for live locale refresh. */
export function setStatusMessage(el: HTMLElement | null, key: MessageKey | null): void {
  if (!el) return
  if (key == null) {
    el.removeAttribute(STATUS_KEY_ATTR)
    el.textContent = ''
    return
  }
  el.setAttribute(STATUS_KEY_ATTR, key)
  el.textContent = t(key)
}

export function refreshStatusMessages(): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${STATUS_KEY_ATTR}]`)) {
    const key = el.getAttribute(STATUS_KEY_ATTR) as MessageKey | null
    if (key) el.textContent = t(key)
  }
}

/**
 * Sync static chrome / seals / intro strings from the active locale.
 * State-dependent toggles read aria-pressed from the DOM.
 */
export function applyChromeI18n(): void {
  document.title = t('doc.title')

  const preview = document.querySelector<HTMLImageElement>('#preview')
  if (preview) preview.alt = t('preview.alt')

  const toolbar = document.querySelector('#toolbar')
  toolbar?.setAttribute('aria-label', t('toolbar.aria'))

  setTitle('#btn-zoom-in', t('toolbar.zoomIn'))
  setTitle('#btn-zoom-out', t('toolbar.zoomOut'))
  setTitle('#btn-home', t('toolbar.home'))
  setTitle('#btn-focus', t('toolbar.focus'))
  setTitle('#btn-hide-minimap', t('toolbar.minimapHideBtn'))

  const minimap = document.querySelector('#minimap-panel')
  minimap?.setAttribute('aria-label', t('toolbar.minimapPanel'))
  const drag = document.querySelector('.minimap-drag')
  drag?.setAttribute('title', t('toolbar.minimapDrag'))

  const minimapBtn = document.querySelector<HTMLButtonElement>('#btn-toggle-minimap')
  if (minimapBtn) {
    const on = minimapBtn.getAttribute('aria-pressed') === 'true'
    minimapBtn.title = on ? t('toolbar.minimapHide') : t('toolbar.minimapShow')
  }

  const labelsBtn = document.querySelector<HTMLButtonElement>('#btn-toggle-labels')
  if (labelsBtn) {
    const on = labelsBtn.getAttribute('aria-pressed') === 'true'
    labelsBtn.title = on ? t('toolbar.labelsHide') : t('toolbar.labelsShow')
  }

  const musicBtn = document.querySelector<HTMLButtonElement>('#btn-music')
  if (musicBtn) {
    const on = musicBtn.getAttribute('aria-pressed') === 'true'
    musicBtn.title = on ? t('toolbar.musicMute') : t('toolbar.musicEnable')
  }

  const creditsBtn = document.querySelector<HTMLButtonElement>('#btn-credits')
  if (creditsBtn) {
    const on = creditsBtn.getAttribute('aria-pressed') === 'true'
    creditsBtn.title = on ? t('toolbar.creditsHide') : t('toolbar.creditsShow')
  }

  const seals = document.querySelector('#overlay-seals')
  seals?.setAttribute('aria-label', t('seals.aria'))

  setSeal('#overlay-seal-handi', 'seals.handi', 'seals.handiAria')
  setSeal('#overlay-seal-zhongguo', 'seals.zhongguo', 'seals.zhongguoAria')
  setSeal('#overlay-seal-hailu', 'seals.hailu', 'seals.hailuAria')

  const intro = document.querySelector('#intro-seal')
  intro?.setAttribute('aria-label', t('intro.enter'))

  refreshStatusMessages()
}

function setTitle(selector: string, title: string): void {
  const el = document.querySelector<HTMLElement>(selector)
  if (el) el.title = title
}

function setSeal(
  selector: string,
  titleKey: MessageKey,
  ariaKey: MessageKey,
): void {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return
  el.title = t(titleKey)
  el.setAttribute('aria-label', t(ariaKey))
}
