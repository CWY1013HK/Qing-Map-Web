/**
 * Draggable white-framed tour images — corner placements with light jitter.
 * Cleared when the dialogue line / tour ends (no leftover chrome).
 */

import type { TourFrameSpec } from './types'

type Corner = 'tl' | 'tr' | 'bl' | 'br'

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']

function jitter(max = 0.035): number {
  return (Math.random() * 2 - 1) * max
}

function cornerStyle(corner: Corner, index: number): { left?: string; right?: string; top?: string; bottom?: string } {
  const edge = 3.2 + Math.random() * 2.4
  const along = 3.0 + Math.random() * 3.5 + index * 1.2
  const j = jitter(1.8)
  switch (corner) {
    case 'tl':
      return { left: `${edge + j}%`, top: `${along}%` }
    case 'tr':
      return { right: `${edge + j}%`, top: `${along}%` }
    case 'bl':
      return { left: `${edge + j}%`, bottom: `${along + 4}%` }
    case 'br':
      return { right: `${edge + j}%`, bottom: `${along + 4}%` }
  }
}

/** Pick distinct corners for n frames (spread upper/lower). */
function pickCorners(n: number): Corner[] {
  const shuffled = [...CORNERS].sort(() => Math.random() - 0.5)
  if (n <= 4) return shuffled.slice(0, n)
  const out: Corner[] = []
  for (let i = 0; i < n; i++) out.push(shuffled[i % 4]!)
  return out
}

let layer: HTMLElement | null = null
const live = new Set<HTMLElement>()

function ensureLayer(): HTMLElement | null {
  if (layer?.isConnected) return layer
  const app = document.querySelector<HTMLElement>('#app')
  if (!app) return null
  layer = document.createElement('div')
  layer.id = 'tour-frames'
  layer.className = 'tour-frames'
  layer.setAttribute('aria-hidden', 'false')
  app.appendChild(layer)
  return layer
}

function bindDrag(frame: HTMLElement): void {
  let dragging = false
  let px = 0
  let py = 0
  let ox = 0
  let oy = 0
  let moved = false

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragging = true
    moved = false
    frame.setPointerCapture(e.pointerId)
    const rect = frame.getBoundingClientRect()
    px = e.clientX
    py = e.clientY
    ox = rect.left
    oy = rect.top
    frame.classList.add('is-dragging')
    frame.style.left = `${ox}px`
    frame.style.top = `${oy}px`
    frame.style.right = 'auto'
    frame.style.bottom = 'auto'
  }

  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    e.preventDefault()
    e.stopPropagation()
    const dx = e.clientX - px
    const dy = e.clientY - py
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
    frame.style.left = `${ox + dx}px`
    frame.style.top = `${oy + dy}px`
  }

  const onUp = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    frame.classList.remove('is-dragging')
    try {
      frame.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    e.stopPropagation()
    if (moved) {
      // Swallow the click that follows a drag so tour skip-line does not fire.
      const swallow = (ev: Event) => {
        ev.preventDefault()
        ev.stopPropagation()
        frame.removeEventListener('click', swallow, true)
      }
      frame.addEventListener('click', swallow, true)
    }
  }

  frame.addEventListener('pointerdown', onDown)
  frame.addEventListener('pointermove', onMove)
  frame.addEventListener('pointerup', onUp)
  frame.addEventListener('pointercancel', onUp)
}

/**
 * Show framed images for a stop. Returns a disposer that removes them.
 */
export function showTourFrames(specs: readonly TourFrameSpec[]): () => void {
  clearTourFrames()
  const host = ensureLayer()
  if (!host || specs.length === 0) return () => undefined

  const corners = pickCorners(specs.length)
  const created: HTMLElement[] = []

  specs.forEach((spec, i) => {
    const frame = document.createElement('figure')
    frame.className = 'tour-frame'
    frame.dataset.corner = corners[i]!
    Object.assign(frame.style, cornerStyle(corners[i]!, i))

    const img = document.createElement('img')
    img.src = spec.src
    img.alt = spec.alt ?? ''
    img.draggable = false
    frame.appendChild(img)

    bindDrag(frame)
    host.appendChild(frame)
    live.add(frame)
    created.push(frame)

    requestAnimationFrame(() => {
      frame.classList.add('is-visible')
    })
  })

  return () => {
    for (const el of created) {
      el.classList.remove('is-visible')
      live.delete(el)
      window.setTimeout(() => el.remove(), 280)
    }
  }
}

export function clearTourFrames(): void {
  for (const el of [...live]) {
    live.delete(el)
    el.remove()
  }
  if (layer && layer.childElementCount === 0) {
    layer.remove()
    layer = null
  }
}
