import type OpenSeadragon from 'openseadragon'

type Pt = { x: number; y: number }

let enabled = false

/** Active pointers on the wall viewer (exhibition multi-touch / touch-cursor). */
const activePointers = new Map<number, Pt>()

function touchCentroid(list: TouchList): Pt {
  let x = 0
  let y = 0
  const n = list.length
  for (let i = 0; i < n; i++) {
    const t = list.item(i)!
    x += t.clientX
    y += t.clientY
  }
  return { x: x / n, y: y / n }
}

function pointCentroid(points: Pt[]): Pt {
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  const n = points.length
  return { x: x / n, y: y / n }
}

export function isAtlabMultiTouchInput(): boolean {
  return enabled
}

/**
 * ATLab wall: track every pointer independently so two contacts are not
 * collapsed into one cursor jumping between `touches[0]` indices.
 */
export function bindAtlabMultiTouch(viewer: OpenSeadragon.Viewer): void {
  if (!document.getElementById('atlab')) return
  enabled = true

  const root = (viewer.canvas as HTMLElement | undefined) ?? viewer.element
  root.style.touchAction = 'none'

  const remember = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      activePointers.delete(e.pointerId)
      return
    }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  const release = (e: PointerEvent) => {
    activePointers.delete(e.pointerId)
  }

  root.addEventListener('pointerdown', remember, { capture: true })
  root.addEventListener('pointermove', remember, { capture: true })
  root.addEventListener('pointerup', release, { capture: true })
  root.addEventListener('pointercancel', release, { capture: true })
  root.addEventListener('lostpointercapture', release, { capture: true })

  bindAtlabPageScrollLock()
}

function nestedScrollable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  let node: Element | null = target
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return true
    }
    node = node.parentElement
  }
  return false
}

/** Block rubber-band / wheel scrolling on the exhibition page (not in popups). */
function bindAtlabPageScrollLock(): void {
  const guard = (e: Event) => {
    if (nestedScrollable(e.target)) return
    if (
      e.type === 'wheel' &&
      e.target instanceof Element &&
      e.target.closest('#viewer')
    ) {
      // The wall viewer owns its wheel (OpenSeadragon scrollToZoom).
      // Only page scrolling stays locked here.
      return
    }
    e.preventDefault()
  }
  document.addEventListener('touchmove', guard, { passive: false, capture: true })
  document.addEventListener('wheel', guard, { passive: false, capture: true })
}

/**
 * Map the OSD original event to a stable client point. When enabled, prefers
 * pointer-id tracking and the multi-touch centroid over `touches[0]`.
 * Returns `undefined` when ATLab multi-touch is off (use default mapping).
 */
export function clientPointFromAtlabInput(ev: Event): Pt | undefined {
  if (!enabled) return undefined

  if (activePointers.size >= 2) {
    return pointCentroid([...activePointers.values()])
  }

  if (typeof PointerEvent !== 'undefined' && ev instanceof PointerEvent) {
    const tracked = activePointers.get(ev.pointerId)
    if (tracked) return tracked
    return { x: ev.clientX, y: ev.clientY }
  }

  if (typeof TouchEvent !== 'undefined' && ev instanceof TouchEvent) {
    if (ev.touches.length >= 2) return touchCentroid(ev.touches)
    const t = ev.changedTouches[0] ?? ev.touches[0]
    return t ? { x: t.clientX, y: t.clientY } : undefined
  }

  if ('clientX' in ev && 'clientY' in ev) {
    const e = ev as MouseEvent
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      return { x: e.clientX, y: e.clientY }
    }
  }

  return undefined
}

/** Avoid wiping pan momentum when a second finger joins an active gesture. */
export function shouldResetWallGestureOnPress(ev: Event): boolean {
  if (!enabled) return true

  if (typeof TouchEvent !== 'undefined' && ev instanceof TouchEvent) {
    return ev.touches.length <= 1
  }

  if (typeof PointerEvent !== 'undefined' && ev instanceof PointerEvent) {
    return activePointers.size <= 1
  }

  return activePointers.size <= 1
}