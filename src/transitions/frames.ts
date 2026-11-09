/**
 * Draggable white-framed tour images.
 * Placement is relative to the letterboxed map content rectangle (MAP_ASPECT
 * fitted inside #app) so on wide screens frames sit near the map, not the
 * far viewport corners.
 */

import { MAP_ASPECT } from '../config'
import type { TourFrameSpec } from './types'

/** Corner / edge slots around the map rect. */
type Slot = 'tl' | 'tr' | 'bl' | 'br' | 'tl2' | 'tr2' | 'bl2' | 'br2'

const SLOT_ORDER: Slot[] = ['tl', 'br', 'tr', 'bl', 'tl2', 'br2', 'tr2', 'bl2']

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Largest MAP_ASPECT rectangle centered in the host — same geometry as
 * `object-fit: contain` on the map preview.
 */
function fitMapRect(
  containerW: number,
  containerH: number,
): { x: number; y: number; w: number; h: number } {
  if (containerW / containerH > MAP_ASPECT) {
    const h = containerH
    const w = h * MAP_ASPECT
    return { x: (containerW - w) / 2, y: 0, w, h }
  }
  const w = containerW
  const h = w / MAP_ASPECT
  return { x: 0, y: (containerH - h) / 2, w, h }
}

function layoutMapStage(stage: HTMLElement): void {
  const parent = stage.parentElement
  if (!parent) return
  const { x, y, w, h } = fitMapRect(parent.clientWidth, parent.clientHeight)
  stage.style.left = `${x}px`
  stage.style.top = `${y}px`
  stage.style.width = `${w}px`
  stage.style.height = `${h}px`
}

/** Percent placement inside the map stage, with light jitter. */
function slotStyle(slot: Slot, index: number): Record<string, string> {
  const edge = rand(2.2, 5.5)
  const along = rand(3.5, 9) + (index % 2) * rand(2, 6)
  const j = rand(-1.6, 1.6)
  switch (slot) {
    case 'tl':
      return { left: `${edge + j}%`, top: `${along}%`, right: 'auto', bottom: 'auto' }
    case 'tr':
      return { right: `${edge + j}%`, top: `${along}%`, left: 'auto', bottom: 'auto' }
    case 'bl':
      return { left: `${edge + j}%`, bottom: `${along + 5}%`, right: 'auto', top: 'auto' }
    case 'br':
      return { right: `${edge + j}%`, bottom: `${along + 5}%`, left: 'auto', top: 'auto' }
    case 'tl2':
      return { left: `${edge + 8 + j}%`, top: `${along + 14}%`, right: 'auto', bottom: 'auto' }
    case 'tr2':
      return { right: `${edge + 8 + j}%`, top: `${along + 14}%`, left: 'auto', bottom: 'auto' }
    case 'bl2':
      return { left: `${edge + 8 + j}%`, bottom: `${along + 16}%`, right: 'auto', top: 'auto' }
    case 'br2':
      return { right: `${edge + 8 + j}%`, bottom: `${along + 16}%`, left: 'auto', top: 'auto' }
  }
}

function pickSlots(n: number): Slot[] {
  const base = [...SLOT_ORDER]
  // Mild shuffle of primary four, keep secondary pair order stable-ish
  const primary = base.slice(0, 4).sort(() => Math.random() - 0.5)
  const secondary = base.slice(4)
  const ordered = [...primary, ...secondary]
  const out: Slot[] = []
  for (let i = 0; i < n; i++) out.push(ordered[i % ordered.length]!)
  return out
}

let stage: HTMLElement | null = null
const live = new Set<HTMLElement>()
let onResize: (() => void) | null = null

function ensureStage(): HTMLElement | null {
  if (stage?.isConnected) {
    layoutMapStage(stage)
    return stage
  }
  const app = document.querySelector<HTMLElement>('#app')
  if (!app) return null
  stage = document.createElement('div')
  stage.id = 'tour-frames'
  stage.className = 'tour-frames'
  stage.setAttribute('aria-hidden', 'false')
  app.appendChild(stage)
  layoutMapStage(stage)

  onResize = () => {
    if (stage?.isConnected) layoutMapStage(stage)
  }
  window.addEventListener('resize', onResize)
  return stage
}

function bindDrag(frame: HTMLElement, host: HTMLElement): void {
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
    const fr = frame.getBoundingClientRect()
    const hr = host.getBoundingClientRect()
    px = e.clientX
    py = e.clientY
    ox = fr.left - hr.left
    oy = fr.top - hr.top
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
  const host = ensureStage()
  if (!host || specs.length === 0) return () => undefined

  const slots = pickSlots(specs.length)
  const created: HTMLElement[] = []

  specs.forEach((spec, i) => {
    const frame = document.createElement('figure')
    frame.className = 'tour-frame'
    frame.dataset.corner = slots[i]!
    Object.assign(frame.style, slotStyle(slots[i]!, i))

    const img = document.createElement('img')
    img.src = spec.src
    img.alt = spec.alt ?? ''
    img.draggable = false
    if (spec.objectPosition) {
      img.style.objectPosition = spec.objectPosition
    }
    frame.appendChild(img)

    bindDrag(frame, host)
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
  if (stage) {
    stage.remove()
    stage = null
  }
  if (onResize) {
    window.removeEventListener('resize', onResize)
    onResize = null
  }
}
