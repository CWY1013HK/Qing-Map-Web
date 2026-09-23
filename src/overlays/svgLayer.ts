import OpenSeadragon, { type Viewer, type TiledImage } from 'openseadragon'
import type { OverlayCollection, OverlayFeature, MapRing, MapPoint } from '../lib/types'
import { overlayStore } from './store'

/** Variable-width jagged ink stroke tiles (pre-colored). */
const INK_CRIMSON = '/overlays/ink-stroke-crimson.png'
const INK_GOLD = '/overlays/ink-stroke-gold.png'

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

/** Patterns only — no SVG feTurbulence / displacement (those stall the GPU on long rings). */
function appendInkDefs(svg: SVGSVGElement): void {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')

  const mkPattern = (id: string, href: string, w: number, h: number) => {
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
    pattern.setAttribute('id', id)
    pattern.setAttribute('patternUnits', 'userSpaceOnUse')
    pattern.setAttribute('width', String(w))
    pattern.setAttribute('height', String(h))
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    image.setAttribute('href', href)
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href)
    image.setAttribute('width', String(w))
    image.setAttribute('height', String(h))
    image.setAttribute('preserveAspectRatio', 'none')
    pattern.appendChild(image)
    defs.appendChild(pattern)
  }

  mkPattern('ink-stroke-crimson', INK_CRIMSON, 0.048, 0.012)
  mkPattern('ink-stroke-gold', INK_GOLD, 0.048, 0.012)

  svg.appendChild(defs)
}

function styleClassFor(style: OverlayFeature['style']): string {
  if (style === 'yellow-glow') return 'style-yellow-glow'
  if (style === 'cyan-glow') return 'style-cyan-glow'
  return 'style-crimson-glow'
}

function buildFeatureGroup(feature: OverlayFeature): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('data-overlay-id', feature.id)
  g.classList.add('map-overlay-feature')
  g.classList.add(styleClassFor(feature.style))
  const pathMode = feature.pathMode ?? 'closed'

  for (let ringIndex = 0; ringIndex < feature.rings.length; ringIndex++) {
    const ring = feature.rings[ringIndex]!
    const d = ringToPathD(ring, pathMode)
    if (!d) continue

    for (const kind of ['bleed', 'body', 'core'] as const) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      path.setAttribute('data-ring-index', String(ringIndex))
      path.classList.add('overlay-stroke', `overlay-stroke-${kind}`)
      g.appendChild(path)
    }
  }

  return g
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
  appendInkDefs(svg)

  const groups = new Map<string, SVGGElement>()
  for (const feature of collection.overlays) {
    const g = buildFeatureGroup(feature)
    groups.set(feature.id, g)
    svg.appendChild(g)
  }

  root.appendChild(svg)

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
  }

  const onOpen = () => place()
  if (viewer.world.getItemAt(0)) {
    place()
  } else {
    viewer.addHandler('open', onOpen)
  }

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
