import OpenSeadragon, { type TiledImage, type Viewer } from 'openseadragon'
import { wallObjectZoom } from '../viewer/wallTilt'
import type { TourCameraTarget } from './types'

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export type LabelPointLookup = (id: string) => { x: number; y: number } | null

export type ResolvedCameraTarget = {
  startZoom: number
  startCenter: OpenSeadragon.Point
  endZoom: number
  endCenter: OpenSeadragon.Point
  homeZoom: number
}

/** Resolve a tour camera step to the exact viewport pose used by the tween. */
export function resolveCameraTarget(
  viewer: Viewer,
  target: TourCameraTarget,
  resolveLabel: LabelPointLookup,
): ResolvedCameraTarget | null {
  const vp = viewer.viewport
  const item = viewer.world.getItemAt(0)
  if (!item) return null

  const startZoom = wallObjectZoom(viewer) ?? vp.getZoom(true)
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

  return { startZoom, startCenter, endZoom, endCenter, homeZoom }
}

/** The stacked DZI sits above the permanent low-res underlay at index 0. */
function highResLayer(viewer: Viewer): TiledImage | null {
  const world = viewer.world
  if (world.getItemCount() < 2) return null
  return (world.getItemAt(world.getItemCount() - 1) as TiledImage | null) ?? null
}

/**
 * Smooth pan/zoom for tours only. Does not touch intro.ts smoothZoomHome.
 * During the move the high-res layer is hidden so only the low-res scan shows;
 * its tiles keep loading underneath and the old opacity returns on arrival.
 */
export function tweenCamera(
  viewer: Viewer,
  target: TourCameraTarget,
  resolveLabel: LabelPointLookup,
  signal?: AbortSignal,
): Promise<void> {
  const durationMs = Math.max(0, target.durationMs ?? 2400)
  const resolved = resolveCameraTarget(viewer, target, resolveLabel)
  if (!resolved) return Promise.resolve()
  const { startZoom, startCenter, endZoom, endCenter } = resolved
  const vp = viewer.viewport

  if (durationMs === 0) {
    vp.zoomTo(endZoom, endCenter, true)
    vp.panTo(endCenter, true)
    return Promise.resolve()
  }

  /* Mouse nav is locked for the whole tour by the player — not toggled here. */
  const layer = highResLayer(viewer)
  const savedOpacity = layer?.getOpacity() ?? 1
  const savedPreload = layer?.getPreload() ?? false
  let ended = false
  const redraw = () => {
    try {
      viewer.forceRedraw()
    } catch {
      /* ignore */
    }
  }
  const beginTransit = () => {
    if (layer) {
      layer.setPreload(true)
      layer.setOpacity(0)
      redraw()
    }
    document.dispatchEvent(
      new CustomEvent('qing-tour-transit', {
        detail: { active: true, opacity: layer?.getOpacity() ?? null },
      }),
    )
  }
  const endTransit = () => {
    if (ended) return
    ended = true
    if (layer) {
      layer.setOpacity(savedOpacity)
      layer.setPreload(savedPreload)
      redraw()
    }
    document.dispatchEvent(
      new CustomEvent('qing-tour-transit', {
        detail: { active: false, opacity: layer?.getOpacity() ?? null },
      }),
    )
  }

  const t0 = performance.now()

  return new Promise((resolve) => {
    const finish = () => {
      endTransit()
      resolve()
    }
    const step = (now: number) => {
      if (signal?.aborted) {
        finish()
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
      else finish()
    }
    beginTransit()
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
