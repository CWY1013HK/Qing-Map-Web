import type { Viewer } from 'openseadragon'
import { clearWallBillboardChrome } from './wallBillboardReset'
import { isWallLabelBillboardMode } from './wallTilt'
import { wallLabelLayer } from './wallLabelLayer'
import { placeUprightLabelBox } from './wallPlacement'

const SVG_NS = 'http://www.w3.org/2000/svg'

type ProvinceHost = { root: HTMLDivElement; svg: SVGSVGElement }

function parseTranslatePx(transform: string): { x: number; y: number } | null {
  const m = transform.match(/translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/)
  if (!m) return null
  const x = parseFloat(m[1]!)
  const y = parseFloat(m[2]!)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function viewBoxForText(src: SVGTextElement): string {
  try {
    const bb = src.getBBox()
    if (bb.width > 1e-6 && bb.height > 1e-6) {
      return `${bb.x} ${bb.y} ${bb.width} ${bb.height}`
    }
  } catch {
    /* not laid out yet */
  }
  return '0 0 1 1'
}

function mountClonedText(svg: SVGSVGElement, src: SVGTextElement, viewBox: string): void {
  const prev = svg.getAttribute('viewBox')
  const child = svg.firstElementChild as SVGTextElement | null
  const same =
    prev === viewBox &&
    child &&
    child.textContent === src.textContent &&
    child.className.baseVal === src.className.baseVal
  if (same) return
  svg.replaceChildren()
  svg.classList.add('province-labels-svg')
  svg.setAttribute('viewBox', viewBox)
  // Match province-labels.svg (preserveAspectRatio none) — meet shrinks width on a wide map.
  svg.setAttribute('preserveAspectRatio', 'none')
  const clone = src.cloneNode(true) as SVGTextElement
  svg.appendChild(clone)
}

function ensureProvinceHost(
  layer: HTMLElement,
  key: string,
  pool: Map<string, ProvinceHost>,
): ProvinceHost {
  let host = pool.get(key)
  if (host) return host
  const root = document.createElement('div')
  root.className = 'province-label-billboard-host'
  root.style.position = 'absolute'
  root.style.pointerEvents = 'none'
  root.style.overflow = 'visible'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  root.appendChild(svg)
  layer.appendChild(root)
  host = { root, svg }
  pool.set(key, host)
  return host
}

function syncProvinceBillboard(
  viewer: Viewer,
  layer: HTMLElement,
  pool: Map<string, ProvinceHost>,
): number {
  const seen = new Set<string>()
  let shown = 0
  const texts = viewer.element.querySelectorAll<SVGTextElement>(
    '.province-labels-group.is-active .province-label',
  )

  for (const src of texts) {
    if (src.closest('.province-labels-group:not(.is-active)')) continue
    const key = `${src.dataset.labelId ?? ''}:${src.dataset.attachment ?? ''}`
    if (!key || key === ':') continue
    seen.add(key)

    const box = placeUprightLabelBox(viewer, src, layer)
    if (!box || !(box.width > 0.5) || !(box.height > 0.5)) {
      pool.get(key)?.root.remove()
      pool.delete(key)
      continue
    }

    const host = ensureProvinceHost(layer, key, pool)
    mountClonedText(host.svg, src, viewBoxForText(src))
    const s = host.root.style
    s.display = 'block'
    s.left = `${box.left.toFixed(1)}px`
    s.top = `${box.top.toFixed(1)}px`
    s.width = `${box.width.toFixed(1)}px`
    s.height = `${box.height.toFixed(1)}px`
    shown += 1
  }

  for (const [key, host] of pool) {
    if (!seen.has(key)) {
      host.root.remove()
      pool.delete(key)
    }
  }
  return shown
}

function syncDecorBillboard(viewer: Viewer, layer: HTMLElement): number {
  layer.querySelectorAll('.focus-decor-billboard').forEach((n) => n.remove())
  let shown = 0
  const layerRect = layer.getBoundingClientRect()

  for (const wrap of viewer.element.querySelectorAll<HTMLElement>('.focus-decor-overlay')) {
    const deco = wrap.querySelector<HTMLElement>('.focus-decor')
    const inner = deco?.querySelector<HTMLElement>('.focus-cloud-inner')
    if (!deco || !inner || !deco.classList.contains('is-visible')) continue

    const tr = parseTranslatePx(wrap.style.transform)
    if (!tr) continue
    const w = parseFloat(deco.style.width) || deco.offsetWidth
    const h = parseFloat(deco.style.height) || deco.offsetHeight
    if (w < 1 || h < 1) continue

    const rect = deco.getBoundingClientRect()
    if (rect.width < 1) continue
    const left = rect.left - layerRect.left
    const top = rect.top - layerRect.top

    const flipX = parseFloat(inner.style.getPropertyValue('--fc-flip-x') || '1')
    const stamp = document.createElement('div')
    stamp.className = 'focus-decor-billboard'
    stamp.style.left = `${left.toFixed(1)}px`
    stamp.style.top = `${top.toFixed(1)}px`
    stamp.style.width = `${rect.width.toFixed(1)}px`
    stamp.style.height = `${rect.height.toFixed(1)}px`
    const bg = inner.style.backgroundImage || getComputedStyle(inner).backgroundImage
    if (bg && bg !== 'none') stamp.style.backgroundImage = bg
    stamp.style.transform = `scaleX(${flipX})`
    stamp.style.transformOrigin = 'center center'
    layer.appendChild(stamp)
    shown += 1
  }
  return shown
}

/** Upright province / ship clones on {@link wallLabelLayer} — same SVG styling as the map. */
export function bindOverlayUpright(viewer: Viewer): () => void {
  if (viewer.element.id !== 'viewer') return () => {}

  const provincePool = new Map<string, ProvinceHost>()

  const sync = () => {
    const layer = wallLabelLayer(viewer)
    if (!layer) return

    if (!isWallLabelBillboardMode()) {
      provincePool.forEach((h) => h.root.remove())
      provincePool.clear()
      clearWallBillboardChrome(viewer)
      document.getElementById('app')?.classList.remove('is-province-upright')
      return
    }

    layer.classList.add('is-wall-billboard')
    const n = syncProvinceBillboard(viewer, layer, provincePool) + syncDecorBillboard(viewer, layer)
    const app = document.getElementById('app')
    app?.classList.toggle('is-province-upright', n > 0)
  }

  let raf = 0
  const frame = () => {
    raf = requestAnimationFrame(frame)
    sync()
  }
  raf = requestAnimationFrame(frame)

  const onRotation = () => {
    if (!isWallLabelBillboardMode()) clearWallBillboardChrome(viewer)
    sync()
  }
  document.addEventListener('qing-rotation-change', onRotation)
  viewer.addHandler('animation', sync)
  viewer.addHandler('resize', sync)

  return () => {
    cancelAnimationFrame(raf)
    document.removeEventListener('qing-rotation-change', onRotation)
    viewer.removeHandler('animation', sync)
    viewer.removeHandler('resize', sync)
    provincePool.forEach((h) => h.root.remove())
    provincePool.clear()
    clearWallBillboardChrome(viewer)
    document.getElementById('app')?.classList.remove('is-province-upright')
  }
}
