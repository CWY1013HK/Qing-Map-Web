import OpenSeadragon, { type Point, type TileSource, type Viewer } from 'openseadragon'
import { resolveCameraTarget, type LabelPointLookup } from './camera'
import type { TourCameraTarget } from './types'

/** Caps keep a single camera move from warming unreasonable slices of the pyramid. */
const MAX_TILES_PER_TARGET = 180
const MAX_TILES_PER_PATH_SAMPLE = 48
const MAX_TILES_PER_PATH = 320
const PATH_SAMPLES = 7
const WARM_TIMEOUT_MS = 1200
const MARGIN = 1.25

const warmedUrls = new Set<string>()
const inFlight = new Set<HTMLImageElement>()
const DEBUG = new URLSearchParams(window.location.search).has('tileDebug')

function debug(...args: unknown[]): void {
  if (DEBUG) console.info('[tilePreload]', ...args)
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function highResSource(viewer: Viewer): TileSource | null {
  const world = viewer.world
  for (let i = world.getItemCount() - 1; i >= 0; i--) {
    const source = (world.getItemAt(i) as unknown as { source?: TileSource }).source
    if (
      source &&
      typeof source.getTileUrl === 'function' &&
      typeof source.getNumTiles === 'function' &&
      typeof source.getLevelScale === 'function'
    ) {
      return source
    }
  }
  return null
}

function maxLevelOf(source: TileSource): number {
  let level = 0
  for (let i = 0; i <= 32; i++) {
    const scale = source.getLevelScale(i)
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) break
    level = i
  }
  return level
}

/** Tile URLs covering one viewport pose, expressed relative to the current view. */
function tileUrlsForPose(
  viewer: Viewer,
  source: TileSource,
  poseZoom: number,
  centre: Point,
  currentZoom: number,
  visible: { width: number; height: number },
  cap: number,
): string[] {
  const item = viewer.world.getItemAt(viewer.world.getItemCount() - 1)
  if (!item) return []
  const size = item.getContentSize()
  const centreImage = item.viewportToImageCoordinates(centre)
  const zoomRatio = currentZoom / Math.max(poseZoom, 1e-6)
  const width = Math.min(size.x, visible.width * zoomRatio * MARGIN)
  const height = Math.min(size.y, visible.height * zoomRatio * MARGIN)
  // OSD tile bounds are normalized [0,1] image coordinates.
  const x0 = (centreImage.x - width / 2) / size.x
  const x1 = (centreImage.x + width / 2) / size.x
  const y0 = (centreImage.y - height / 2) / size.y
  const y1 = (centreImage.y + height / 2) / size.y

  const containerW = Math.max(1, viewer.viewport.getContainerSize().x)
  const pxPerImagePx =
    (containerW / visible.width) * (poseZoom / currentZoom)
  const maxLevel = maxLevelOf(source)
  const ideal = maxLevel + Math.round(Math.log2(Math.max(pxPerImagePx, 1e-6)))

  const urls: string[] = []
  for (const level of [ideal - 1, ideal]) {
    if (level < 0 || level > maxLevel) continue
    const count = source.getNumTiles(level)
    for (let y = 0; y < count.y && urls.length < cap; y++) {
      for (let x = 0; x < count.x && urls.length < cap; x++) {
        const bounds = source.getTileBounds(level, x, y)
        if (
          !bounds ||
          bounds.x > x1 ||
          bounds.x + bounds.width < x0 ||
          bounds.y > y1 ||
          bounds.y + bounds.height < y0
        ) {
          continue
        }
        const spec = source.getTileUrl(level, x, y)
        const url = typeof spec === 'string' ? spec : spec?.()
        if (!url || warmedUrls.has(url)) continue
        warmedUrls.add(url)
        urls.push(url)
      }
    }
  }
  return urls
}

function currentView(viewer: Viewer): { zoom: number; centre: Point; visible: { width: number; height: number } } | null {
  const vp = viewer.viewport
  const item = viewer.world.getItemAt(viewer.world.getItemCount() - 1)
  if (!item) return null
  const visible = item.viewportToImageRectangle(vp.getBounds(true), true)
  if (!visible || visible.width <= 0 || visible.height <= 0) return null
  return { zoom: vp.getZoom(true), centre: vp.getCenter(true), visible }
}

function fetchTile(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    inFlight.add(img)
    const done = () => {
      inFlight.delete(img)
      resolve()
    }
    img.onload = done
    img.onerror = done
    img.decoding = 'async'
    img.src = url
  })
}

/** Warm just the destination tiles a camera step will land on. */
export async function preloadCameraTiles(
  viewer: Viewer,
  target: TourCameraTarget,
  resolveLabel: LabelPointLookup,
): Promise<void> {
  const source = highResSource(viewer)
  debug('source', Boolean(source))
  if (!source) return
  const resolved = resolveCameraTarget(viewer, target, resolveLabel)
  const view = currentView(viewer)
  if (!resolved || !view) return
  const urls = tileUrlsForPose(
    viewer,
    source,
    resolved.endZoom,
    resolved.endCenter,
    view.zoom,
    view.visible,
    MAX_TILES_PER_TARGET,
  )
  debug('urls', urls.length, JSON.stringify(target))
  if (urls.length === 0) return

  const loaded = Promise.all(urls.map(fetchTile))
  await Promise.race([
    loaded,
    new Promise<void>((resolve) => window.setTimeout(resolve, WARM_TIMEOUT_MS)),
  ])
}

/**
 * Warm sampled poses along the whole camera path. Run this while the tour is
 * parked at a stop: the tiles arrive during narration, so the move itself has
 * nothing left to fetch. Never awaited, and globally deduplicated.
 */
export function preloadCameraPath(
  viewer: Viewer,
  target: TourCameraTarget,
  resolveLabel: LabelPointLookup,
): void {
  const source = highResSource(viewer)
  if (!source) return
  const resolved = resolveCameraTarget(viewer, target, resolveLabel)
  const view = currentView(viewer)
  if (!resolved || !view || view.zoom <= 0) return

  const urls: string[] = []
  for (let i = 0; i < PATH_SAMPLES && urls.length < MAX_TILES_PER_PATH; i++) {
    const t = ease(i / (PATH_SAMPLES - 1))
    // Geometric zoom interpolation keeps the sampled LODs even.
    const zoom = view.zoom * Math.pow(resolved.endZoom / view.zoom, t)
    const centre = new OpenSeadragon.Point(
      view.centre.x + (resolved.endCenter.x - view.centre.x) * t,
      view.centre.y + (resolved.endCenter.y - view.centre.y) * t,
    )
    urls.push(
      ...tileUrlsForPose(
        viewer,
        source,
        zoom,
        centre,
        view.zoom,
        view.visible,
        Math.min(MAX_TILES_PER_PATH_SAMPLE, MAX_TILES_PER_PATH - urls.length),
      ),
    )
  }
  debug('path urls', urls.length, JSON.stringify(target))
  void Promise.all(urls.map(fetchTile))
}
