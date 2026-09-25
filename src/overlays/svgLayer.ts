import OpenSeadragon, { type Viewer, type TiledImage } from 'openseadragon'
import type { OverlayCollection, OverlayFeature, MapRing, MapPoint } from '../lib/types'
import { overlayStore } from './store'

/**
 * SVG paint order (bottom → top): Sea Routes < China Proper < China.
 * Later siblings draw above earlier ones.
 */
const PAINT_ORDER: Record<string, number> = {
  hailu: 0,
  'handi-shibasheng': 1,
  zhongguo: 2,
}

/** Stroke scale vs home zoom: thinner when zoomed out, thicker when zoomed in. */
const STROKE_SCALE_MIN = 0.25
const STROKE_SCALE_MAX = 2.2

export function ringToPathD(ring: MapRing, pathMode: 'closed' | 'open' = 'closed'): string {
  if (ring.length === 0) return ''
  const [first, ...rest] = ring
  let d = `M ${first.x} ${first.y}`
  for (const p of rest) {
    d += ` L ${p.x} ${p.y}`
  }
  if (pathMode !== 'open') d += ' Z'
  return d
}

function styleClassFor(style: OverlayFeature['style']): string {
  if (style === 'yellow-glow') return 'style-yellow-glow'
  if (style === 'cyan-glow') return 'style-cyan-glow'
  return 'style-crimson-glow'
}

function appendStrokePath(
  parent: SVGGElement,
  d: string,
  ringIndex: number,
  kind: 'bleed' | 'body' | 'core',
): void {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  path.setAttribute('data-ring-index', String(ringIndex))
  path.classList.add('overlay-stroke', `overlay-stroke-${kind}`)
  parent.appendChild(path)
}

/**
 * Uniform layered stack (all bleeds → bodies → cores) matching sea-route rendering.
 * Avoids per-ring interleaved opacity bloom at overlaps.
 */
function buildFeatureGroup(feature: OverlayFeature): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('data-overlay-id', feature.id)
  g.classList.add('map-overlay-feature')
  g.classList.add(styleClassFor(feature.style))
  const pathMode = feature.pathMode ?? 'closed'

  const bleedG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const bodyG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const coreG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  bleedG.classList.add('overlay-layer-bleed')
  bodyG.classList.add('overlay-layer-body')
  coreG.classList.add('overlay-layer-core')

  for (let ringIndex = 0; ringIndex < feature.rings.length; ringIndex++) {
    const ring = feature.rings[ringIndex]!
    const d = ringToPathD(ring, pathMode)
    if (!d) continue
    appendStrokePath(bleedG, d, ringIndex, 'bleed')
    appendStrokePath(bodyG, d, ringIndex, 'body')
    appendStrokePath(coreG, d, ringIndex, 'core')
  }

  g.appendChild(bleedG)
  g.appendChild(bodyG)
  g.appendChild(coreG)
  return g
}

function paintRank(featureId: string): number {
  return PAINT_ORDER[featureId] ?? 50
}

function strokeScaleForZoom(viewer: Viewer): number {
  const home = viewer.viewport.getHomeZoom()
  if (!(home > 0)) return 1
  const t = viewer.viewport.getZoom(true) / home
  // At home (t=1) → 1; zoomed out → toward STROKE_SCALE_MIN; zoomed in → toward MAX.
  const scale = 0.25 + 0.75 * t
  return Math.min(STROKE_SCALE_MAX, Math.max(STROKE_SCALE_MIN, scale))
}

export type SvgOverlayLayer = {
  root: HTMLDivElement
  svg: SVGSVGElement
  setActiveIds: (ids: ReadonlySet<string>) => void
  /** Live-update path `d` for a feature after vertex edits. */
  updateFeatureRings: (featureId: string, rings: MapRing[], pathMode?: 'closed' | 'open') => void
  destroy: () => void
}

/**
 * Full-image SVG overlay locked to the map via OpenSeadragon addOverlay.
 * Paths use normalized image coordinates (viewBox 0 0 1 1).
 */
export function attachSvgOverlayLayer(
  viewer: Viewer,
  collection: OverlayCollection,
): SvgOverlayLayer {
  const root = document.createElement('div')
  root.className = 'map-overlay-layer'
  root.setAttribute('aria-hidden', 'true')

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 1 1')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.classList.add('map-overlay-svg')

  const groups = new Map<string, SVGGElement>()
  const sorted = [...collection.overlays].sort(
    (a, b) => paintRank(a.id) - paintRank(b.id),
  )
  for (const feature of sorted) {
    const g = buildFeatureGroup(feature)
    groups.set(feature.id, g)
    svg.appendChild(g)
  }

  root.appendChild(svg)

  const syncStrokeScale = () => {
    svg.style.setProperty(
      '--overlay-stroke-scale',
      String(strokeScaleForZoom(viewer)),
    )
  }

  let attached = false
  const place = () => {
    const item = viewer.world.getItemAt(0) as TiledImage | null
    if (!item) return
    const bounds = item.getBounds()
    const loc = new OpenSeadragon.Rect(bounds.x, bounds.y, bounds.width, bounds.height)
    if (!attached) {
      viewer.addOverlay({
        element: root,
        location: loc,
        checkResize: false,
      })
      attached = true
    } else {
      viewer.updateOverlay(root, loc)
    }
    const wrap = root.parentElement
    if (wrap && wrap !== viewer.element) {
      wrap.classList.add('map-overlay-layer-wrap')
      wrap.style.pointerEvents = 'none'
    }
    syncStrokeScale()
  }

  const onOpen = () => place()
  const onZoomish = () => syncStrokeScale()

  if (viewer.world.getItemAt(0)) {
    place()
  } else {
    viewer.addHandler('open', onOpen)
  }
  viewer.addHandler('animation', onZoomish)
  viewer.addHandler('animation-finish', onZoomish)
  viewer.addHandler('resize', onZoomish)

  const setActiveIds = (ids: ReadonlySet<string>) => {
    let any = false
    for (const [id, g] of groups) {
      const on = ids.has(id)
      g.classList.toggle('is-active', on)
      if (on) any = true
    }
    root.classList.toggle('is-active', any)
  }

  setActiveIds(overlayStore.getVisible())
  syncStrokeScale()

  const updateFeatureRings = (
    featureId: string,
    rings: MapRing[],
    pathMode: 'closed' | 'open' = 'closed',
  ) => {
    const g = groups.get(featureId)
    if (!g) return
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const d = ringToPathD(rings[ringIndex]!, pathMode)
      const paths = g.querySelectorAll(`path[data-ring-index="${ringIndex}"]`)
      paths.forEach((p) => p.setAttribute('d', d))
    }
  }

  const destroy = () => {
    viewer.removeHandler('open', onOpen)
    viewer.removeHandler('animation', onZoomish)
    viewer.removeHandler('animation-finish', onZoomish)
    viewer.removeHandler('resize', onZoomish)
    if (attached) {
      try {
        viewer.removeOverlay(root)
      } catch {
        /* already gone */
      }
      attached = false
    }
    root.remove()
  }

  return { root, svg, setActiveIds, updateFeatureRings, destroy }
}

export type { MapPoint }
