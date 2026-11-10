import type OpenSeadragon from 'openseadragon'
import type { Viewer } from 'openseadragon'
import { placeViewportRectOnWall } from './wallPlacement'
import { wallLabelLayer } from './wallLabelLayer'

/**
 * Label billboard — location-label dots anchor to WALL space, not the sheet.
 *
 * Point labels (誌 dots and text plates) live in a flat layer above the
 * viewer. Every frame their map anchor is projected through the sheet's
 * current pose (projectSheetPoint — mid-transition values included), so a
 * label sits exactly where its anchor projects on the wall but renders
 * upright: no perspective smear, no riding the tilted plane, matching the
 * badges/seals/minimap chrome. Region (area) labels stay on the plane as
 * OSD overlays — they paint a map region and should foreshorten with it.
 *
 * The billboard owns point-label placement in flat mode too (identity
 * projection), so there is one code path and no element hand-off.
 */

type Tracked = {
  el: HTMLElement
  getRect: () => OpenSeadragon.Rect | null
  last: { left: string; top: string; width: string; height: string }
}

export type LabelBillboard = {
  add: (el: HTMLElement, getRect: () => import('openseadragon').Rect | null) => void
  remove: (el: HTMLElement) => void
  onFrame: (cb: () => void) => () => void
}

export function mountLabelBillboard(viewer: Viewer): LabelBillboard {
  const tracked = new Map<HTMLElement, Tracked>()
  const eachFrame = new Set<() => void>()
  let raf = 0
  let lastKey = ''

  const ensureLayer = (): HTMLElement | null => wallLabelLayer(viewer)

  const write = (t: Tracked, left: number, top: number, width: number, height: number) => {
    const next = {
      left: `${left.toFixed(1)}px`,
      top: `${top.toFixed(1)}px`,
      width: `${width.toFixed(1)}px`,
      height: `${height.toFixed(1)}px`,
    }
    const last = t.last
    if (
      next.left === last.left &&
      next.top === last.top &&
      next.width === last.width &&
      next.height === last.height
    ) {
      return
    }
    t.last = next
    const s = t.el.style
    s.left = next.left
    s.top = next.top
    s.width = next.width
    s.height = next.height
  }

  const frame = () => {
    raf = requestAnimationFrame(frame)
    for (const cb of eachFrame) cb()
    if (tracked.size === 0 && eachFrame.size === 0) {
      cancelAnimationFrame(raf)
      raf = 0
      return
    }
    const vp = viewer.viewport
    const center = vp.getCenter(true)
    const zoom = vp.getZoom(true)
    const app = document.getElementById('app')
    let poseKey = ''
    if (app) {
      /* Computed values — the settle transition animates these between inline
         style writes, and the labels must track every animation frame. */
      const cs = getComputedStyle(app)
      poseKey = [
        app.className,
        cs.getPropertyValue('--wall-tilt'),
        cs.getPropertyValue('--wall-yaw'),
        cs.getPropertyValue('--wall-roll'),
        cs.getPropertyValue('--wall-object-lift'),
        cs.getPropertyValue('--wall-object-scale'),
        cs.getPropertyValue('--wall-origin-x'),
        cs.getPropertyValue('--wall-origin-y'),
      ].join('|')
    }
    const key = `${center.x.toFixed(6)},${center.y.toFixed(6)},${zoom.toFixed(6)}|${poseKey}`
    if (key === lastKey) return
    lastKey = key

    for (const t of tracked.values()) {
      const rect = t.getRect()
      if (!rect) continue
      const box = placeViewportRectOnWall(viewer, rect)
      if (!box) continue
      write(t, box.left, box.top, box.width, box.height)
    }
  }

  const start = () => {
    if (!raf) raf = requestAnimationFrame(frame)
  }

  return {
    add(el, getRect) {
      const host = ensureLayer()
      if (!host) return
      if (tracked.has(el)) return
      el.style.position = 'absolute'
      host.appendChild(el)
      tracked.set(el, {
        el,
        getRect,
        last: { left: '', top: '', width: '', height: '' },
      })
      start()
    },
    remove(el) {
      const t = tracked.get(el)
      if (!t) return
      tracked.delete(el)
      el.remove()
    },
    onFrame(cb) {
      eachFrame.add(cb)
      start()
      return () => {
        eachFrame.delete(cb)
      }
    },
  }
}
