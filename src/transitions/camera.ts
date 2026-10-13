import OpenSeadragon, { type Viewer } from 'openseadragon'
import type { TourCameraTarget } from './types'

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export type LabelPointLookup = (id: string) => { x: number; y: number } | null

/**
 * Smooth pan/zoom for tours only. Does not touch intro.ts smoothZoomHome.
 */
export function tweenCamera(
  viewer: Viewer,
  target: TourCameraTarget,
  resolveLabel: LabelPointLookup,
  signal?: AbortSignal,
): Promise<void> {
  const durationMs = Math.max(0, target.durationMs ?? 2400)
  const vp = viewer.viewport
  const item = viewer.world.getItemAt(0)
  if (!item) return Promise.resolve()

  const startZoom = vp.getZoom(true)
  const startCenter = vp.getCenter(true)
  const homeZoom = vp.getHomeZoom()

  let endZoom = homeZoom
  let endCenter = vp.getHomeBounds().getCenter()

  if (!target.home) {
    let nx = target.x
    let ny = target.y
    if (target.labelId) {
      const pt = resolveLabel(target.labelId)
      if (pt) {
        nx = pt.x
        ny = pt.y
      }
    }
    if (typeof nx === 'number' && typeof ny === 'number') {
      const size = item.getContentSize()
      endCenter = item.imageToViewportCoordinates(size.x * nx, size.y * ny)
      endZoom = homeZoom * (target.zoomFactor ?? 2.5)
    }
  }

  if (durationMs === 0) {
    vp.zoomTo(endZoom, endCenter, true)
    vp.panTo(endCenter, true)
    return Promise.resolve()
  }

  /* Mouse nav is locked for the whole tour by the player — not toggled here. */
  const t0 = performance.now()

  return new Promise((resolve) => {
    const step = (now: number) => {
      if (signal?.aborted) {
        resolve()
        return
      }
      const u = Math.min(1, (now - t0) / durationMs)
      const e = easeInOutCubic(u)
      const z = startZoom + (endZoom - startZoom) * e
      const cx = startCenter.x + (endCenter.x - startCenter.x) * e
      const cy = startCenter.y + (endCenter.y - startCenter.y) * e
      const center = new OpenSeadragon.Point(cx, cy)
      vp.zoomTo(z, center, true)
      vp.panTo(center, true)
      if (u < 1) requestAnimationFrame(step)
      else resolve()
    }
    requestAnimationFrame(step)
  })
}

/** Tween every registered viewer to the same normalized target. */
export function tweenCameras(
  viewers: readonly Viewer[],
  target: TourCameraTarget,
  resolveLabel: LabelPointLookup,
  signal?: AbortSignal,
): Promise<void> {
  if (viewers.length === 0) return Promise.resolve()
  return Promise.all(
    viewers.map((v) => tweenCamera(v, target, resolveLabel, signal)),
  ).then(() => undefined)
}
