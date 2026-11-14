import { getLocale } from '../i18n'
import type { TourLocaleText } from './types'
import { ensureTourDialogueDock } from './tourDialogueDock'

let root: HTMLElement | null = null
let titleEl: HTMLElement | null = null
let bodyEl: HTMLElement | null = null

function ensure(): void {
  if (root) return
  const host = ensureTourDialogueDock()
  if (!host) return
  root = document.createElement('div')
  root.id = 'tour-caption'
  root.className = 'tour-caption'
  root.hidden = true
  root.innerHTML = `
    <p class="tour-caption-title" id="tour-caption-title"></p>
    <p class="tour-caption-body" id="tour-caption-body"></p>
  `
  host.prepend(root)
  titleEl = root.querySelector('#tour-caption-title')
  bodyEl = root.querySelector('#tour-caption-body')
}

export function showTourCaption(
  caption: TourLocaleText | undefined,
  body: string | undefined,
): void {
  ensure()
  if (!root || !titleEl || !bodyEl) return
  const locale = getLocale()
  const title =
    caption?.[locale] ?? caption?.['zh-Hant'] ?? caption?.en ?? ''
  titleEl.textContent = title
  bodyEl.textContent = body ?? ''
  titleEl.hidden = !title
  bodyEl.hidden = !body
  root.hidden = !title && !body
}

export function hideTourCaption(): void {
  if (!root) return
  root.hidden = true
}

/** True when the dock is showing a title and/or body line. */
export function isTourCaptionVisible(): boolean {
  return Boolean(root && !root.hidden)
}
