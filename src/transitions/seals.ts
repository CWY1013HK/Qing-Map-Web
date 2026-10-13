import type { Viewer } from 'openseadragon'
import { getTourPlayer } from './player'
import { TOURS } from './scripts'
import type { TourDefinition } from './types'

/** Transparent stamp PNGs (intro-seal language), keyed by tour id. */
const SEAL_SRC: Record<string, string> = {
  'jiaqing-1812': '/intro/shijie-luelan-seal.png?v=2',
}

/**
 * Square imperial-style tour seals (transparent 小篆 stamp), row above overlay 令牌.
 * Hidden during intro / 淨; revealed after qing-map-intro-done.
 */
export function mountTourSeals(viewer: Viewer): void {
  const player = getTourPlayer()
  player.registerViewer(viewer)

  const row = document.querySelector<HTMLElement>('#tour-seals')
  if (!row) return

  row.replaceChildren()
  for (const tour of TOURS) {
    row.appendChild(buildSealButton(tour))
  }

  const syncVisibility = () => {
    const app = document.querySelector('#app')
    const intro = app?.classList.contains('intro-active')
    const focus = app?.classList.contains('focus-mode')
    row.hidden = !!(intro || focus)
  }

  syncVisibility()
  window.addEventListener('qing-map-intro-done', () => {
    row.hidden = false
  })

  // If intro already finished (hot reload / no-intro boot)
  if (!document.querySelector('#app')?.classList.contains('intro-active')) {
    row.hidden = false
  }

  player.onState((playingId) => {
    for (const btn of row.querySelectorAll<HTMLButtonElement>('.tour-seal')) {
      const on = btn.dataset.tourId === playingId
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
      btn.classList.toggle('is-pressed', on)
    }
  })
}

function buildSealButton(tour: TourDefinition): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'tour-seal'
  btn.id = `tour-seal-${tour.id}`
  btn.dataset.tourId = tour.id
  btn.title = `${tour.sealTitle} — ${tour.title}`
  btn.setAttribute('aria-label', tour.sealTitle)
  btn.setAttribute('aria-pressed', 'false')

  const img = document.createElement('img')
  img.src = SEAL_SRC[tour.id] ?? '/intro/qing-seal.png'
  img.alt = ''
  img.draggable = false
  btn.appendChild(img)

  btn.addEventListener('click', () => {
    void getTourPlayer().play(tour)
  })
  return btn
}
