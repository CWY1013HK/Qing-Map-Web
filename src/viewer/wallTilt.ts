import OpenSeadragon, { type Viewer } from 'openseadragon'
import { t } from '../i18n'

/**
 * Map rotation for the interactive viewer (regular mode and the ATLab wall).
 * Starts on with `?wallTilt=1` (32°) or `?wallTilt=28` (degrees). Otherwise
 * turn it on from the 功 settings row. Optional `?wallPerspective=2400`.
 * Two-finger drag, or the metal sphere beside 淨 and 功, turns the sheet.
 * Tilt and yaw stay inside ±89° so the back never faces the room.
 * The floor viewer is never tilted.
 */

const DEFAULT_DEGREES = 32
const DEFAULT_PERSPECTIVE_PX = 2400
/** Short of 90° so the sheet cannot flip onto its back. */
const MAX_FACE_DEG = 89
const MIN_PERSPECTIVE_PX = 400
/** Screen pixels of a drag that equal one degree. */
const DEG_PER_PX = 0.32
/** Run before label / tour handlers that read canvas-click position. */
const HANDLER_PRIORITY = 100
/**
 * How large the tilted sheet may grow. The wall clips the rest.
 * Intro focuses at 3.6× home, so the cap stays above that.
 */
const MIN_OBJECT_SCALE = 1
const MAX_OBJECT_SCALE = 8

export type WallTilt = {
  degrees: number
  perspectivePx: number
}

type Pt = { x: number; y: number }

let host: HTMLElement | null = null
let probes: HTMLElement[] | null = null
let boundViewer: Viewer | null = null
/** Sheet size relative to the home framing. The OSD spring stays at home. */
let objectScale = 1
/** Lean back (rotateX) and turn (rotateY), degrees. Both stay in ±MAX_FACE_DEG. */
let tiltDeg = 0
let yawDeg = 0
let rotationEnabled = false
let pendingEnable = false
let choseAngle = false
let perspectivePx = DEFAULT_PERSPECTIVE_PX
let baseVisibility = 1
let passZoomTo: OpenSeadragon.Viewport['zoomTo'] | null = null

/**
 * Read the launch query before OpenSeadragon builds the viewer.
 * Absent flag leaves rotation off until the settings toggle.
 */
export function prepareWallTilt(
  params: URLSearchParams = new URLSearchParams(window.location.search),
): WallTilt | null {
  const pRaw = params.get('wallPerspective')
  if (pRaw) {
    const n = Number(pRaw)
    if (Number.isFinite(n) && n >= MIN_PERSPECTIVE_PX) perspectivePx = n
  }

  if (!params.has('wallTilt')) {
    pendingEnable = false
    return null
  }

  const raw = params.get('wallTilt') ?? ''
  let degrees = DEFAULT_DEGREES
  if (raw !== '' && raw !== '1') {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) {
      pendingEnable = false
      return null
    }
    degrees = Math.min(MAX_FACE_DEG, n)
  }

  tiltDeg = degrees
  yawDeg = 0
  choseAngle = true
  pendingEnable = true
  return { degrees, perspectivePx }
}

export function isWallRotationEnabled(): boolean {
  return rotationEnabled
}

/** Settings toggle. Remembers the last angle, and leans to 32° the first time. */
export function setWallRotationEnabled(on: boolean): boolean {
  if (!boundViewer || !passZoomTo) return rotationEnabled
  if (on === rotationEnabled) return rotationEnabled

  const viewport = boundViewer.viewport
  const home = viewport.getHomeZoom()

  if (on) {
    if (!choseAngle && tiltDeg === 0 && yawDeg === 0) {
      tiltDeg = DEFAULT_DEGREES
      choseAngle = true
    }
    const current = viewport.getZoom(true)
    const nextScale = home > 0 ? clamp(current / home, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE) : 1
    rotationEnabled = true
    objectScale = 1
    markTiltRoot(true)
    if (home > 0) viewport.zoomTo(home * nextScale, undefined, true)
    else applyOrientation()
    return true
  }

  const logical = home > 0 ? home * objectScale : viewport.getZoom(true)
  const center = viewport.getCenter(true)
  rotationEnabled = false
  objectScale = 1
  markTiltRoot(false)
  const vp = viewport as OpenSeadragon.Viewport & { visibilityRatio: number }
  vp.visibilityRatio = baseVisibility
  passZoomTo(logical, undefined, true)
  viewport.panTo(center, true)
  boundViewer.navigator?.update(viewport)
  return false
}

/**
 * Zoom level callers should animate from while the wall sheet is scaled.
 * The viewport spring stays at home so the drawer does not also crop;
 * this returns home × sheet scale. Null when this viewer is not the tilted wall.
 */
export function wallObjectZoom(viewer: Viewer): number | null {
  if (!rotationEnabled || viewer !== boundViewer) return null
  const home = viewer.viewport.getHomeZoom()
  if (!(home > 0)) return null
  return home * objectScale
}

/**
 * Screen point → OSD layout pixels (the container's client box).
 * Returns null when the wall tilt is off, so callers keep their flat mapping.
 */
export function viewerPixelFromClient(clientX: number, clientY: number): Pt | null {
  if (!rotationEnabled) return null
  return projectScreenToLocal(clientX, clientY)
}

/**
 * Corner probes + gesture rewrite. Call after the viewer exists and after
 * {@link prepareWallTilt}. In-plane `viewport.setRotation` is left alone;
 * OSD writes `rotate()` onto overlay wrappers and would fight this tilt.
 */
export function bindWallTilt(viewer: Viewer): void {
  const container = viewer.container as HTMLElement | null
  if (!container || boundViewer) return

  host = container
  probes = mountProbes(container)
  bindObjectZoom(viewer)
  mountTurnOrb()
  if (pendingEnable) setWallRotationEnabled(true)

  let last: Pt | null = null
  const trail: { t: number; x: number; y: number }[] = []

  const remember = (p: Pt) => {
    last = p
    const t = performance.now()
    trail.push({ t, x: p.x, y: p.y })
    while (trail.length > 1 && t - trail[0]!.t > 140) trail.shift()
  }

  const resetGesture = () => {
    last = null
    trail.length = 0
  }

  const assignPosition = (position: { x: number; y: number }, client: Pt | null): Pt | null => {
    if (!client) return null
    const local = projectScreenToLocal(client.x, client.y)
    if (!local) return null
    position.x = local.x
    position.y = local.y
    return local
  }

  viewer.addHandler(
    'canvas-press',
    (event) => {
      resetGesture()
      const local = assignPosition(event.position, clientFromEvent(event.originalEvent))
      if (local) remember(local)
    },
    {},
    HANDLER_PRIORITY,
  )

  viewer.addHandler(
    'canvas-drag',
    (event) => {
      const client = clientFromEvent(event.originalEvent)
      const local = client ? projectScreenToLocal(client.x, client.y) : null
      if (!local) return
      if (last) {
        event.delta.x = local.x - last.x
        event.delta.y = local.y - last.y
      }
      event.position.x = local.x
      event.position.y = local.y
      remember(local)
    },
    {},
    HANDLER_PRIORITY,
  )

  viewer.addHandler(
    'canvas-drag-end',
    (event) => {
      if (!rotationEnabled) {
        resetGesture()
        return
      }
      const settings = viewer.gestureSettingsByDeviceType(event.pointerType)
      if (!settings.flickEnabled) {
        resetGesture()
        return
      }
      event.preventDefaultAction = true
      const flick = flickFromTrail(trail)
      const minSpeed = settings.flickMinSpeed ?? 120
      if (flick && flick.speed >= minSpeed) {
        const momentum = settings.flickMomentum ?? 0.25
        const nav = viewer as Viewer & { panHorizontal?: boolean; panVertical?: boolean }
        let ampX = momentum * flick.speed * Math.cos(flick.direction)
        let ampY = momentum * flick.speed * Math.sin(flick.direction)
        if (nav.panHorizontal === false) ampX = 0
        if (nav.panVertical === false) ampY = 0
        const center = viewer.viewport.pixelFromPoint(viewer.viewport.getCenter(true))
        const target = viewer.viewport.pointFromPixel(
          new OpenSeadragon.Point(center.x - ampX, center.y - ampY),
          true,
        )
        viewer.viewport.panTo(target, false)
      }
      viewer.viewport.applyConstraints()
      resetGesture()
    },
    {},
    HANDLER_PRIORITY,
  )

  viewer.addHandler(
    'canvas-scroll',
    (event) => {
      assignPosition(event.position, clientFromEvent(event.originalEvent))
    },
    {},
    HANDLER_PRIORITY,
  )

  viewer.addHandler(
    'canvas-click',
    (event) => {
      assignPosition(event.position, clientFromEvent(event.originalEvent))
    },
    {},
    HANDLER_PRIORITY,
  )

  viewer.addHandler(
    'canvas-double-click',
    (event) => {
      assignPosition(event.position, clientFromEvent(event.originalEvent))
    },
    {},
    HANDLER_PRIORITY,
  )

  viewer.addHandler(
    'canvas-pinch',
    (event) => {
      if (!rotationEnabled) return
      const pts = event.gesturePoints
      if (pts.length < 2) return
      const p0 = pts[0]!
      const p1 = pts[1]!
      const midDx = (p0.currentPos.x + p1.currentPos.x - p0.lastPos.x - p1.lastPos.x) / 2
      const midDy = (p0.currentPos.y + p1.currentPos.y - p0.lastPos.y - p1.lastPos.y) / 2
      const distNow = Math.hypot(p0.currentPos.x - p1.currentPos.x, p0.currentPos.y - p1.currentPos.y)
      const distLast = Math.hypot(p0.lastPos.x - p1.lastPos.x, p0.lastPos.y - p1.lastPos.y)
      const zooming = distLast > 12 && Math.abs(distNow / distLast - 1) > 0.05
      if (!zooming) {
        event.preventDefaultPanAction = true
        event.preventDefaultZoomAction = true
        if (midDx !== 0 || midDy !== 0) nudgeRotation(midDx, midDy)
      }
      const a = pageToLocal(p0.currentPos)
      const b = pageToLocal(p1.currentPos)
      const lastA = pageToLocal(p0.lastPos)
      const lastB = pageToLocal(p1.lastPos)
      if (a && b) {
        event.center.x = (a.x + b.x) / 2
        event.center.y = (a.y + b.y) / 2
      }
      if (lastA && lastB) {
        event.lastCenter.x = (lastA.x + lastB.x) / 2
        event.lastCenter.y = (lastA.y + lastB.y) / 2
      }
    },
    {},
    HANDLER_PRIORITY,
  )

  const checkCorners = () => {
    if (!import.meta.env.DEV || !rotationEnabled || !host || !probes) return
    const w = host.clientWidth
    const h = host.clientHeight
    if (w < 2 || h < 2) return
    const expected: Pt[] = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ]
    probes.forEach((el, i) => {
      const rect = el.getBoundingClientRect()
      const got = projectScreenToLocal(rect.left, rect.top)
      const exp = expected[i]!
      if (!got || Math.hypot(got.x - exp.x, got.y - exp.y) > 1.5) {
        console.warn('[wallTilt] pointer unproject missed a corner', i, got, exp)
      }
    })
  }

  viewer.addHandler('open', checkCorners)
  viewer.addHandler('resize', checkCorners)
}

/**
 * Zoom scales the tilted sheet (CSS) and keeps the OSD spring at home, so the
 * painting is not also cropped inside a fixed trapezoid. Pan limits loosen to
 * the center 1/scale of that home framing, which is what stays on the wall.
 */
function bindObjectZoom(viewer: Viewer): void {
  boundViewer = viewer
  objectScale = 1
  const viewport = viewer.viewport
  const origZoomTo = viewport.zoomTo.bind(viewport)
  passZoomTo = origZoomTo
  const origApply = viewport.applyConstraints.bind(viewport)
  baseVisibility = (viewport as OpenSeadragon.Viewport & { visibilityRatio?: number }).visibilityRatio ?? 1
  let freezeScale = false

  const nav = viewer.navigator as
    | (OpenSeadragon.Navigator & {
        displayRegion?: HTMLElement
      })
    | null
  if (nav) {
    const origUpdate = nav.update.bind(nav)
    nav.update = (source) => {
      origUpdate(source)
      if (!rotationEnabled) return
      shrinkNavigatorRegion(nav.displayRegion, objectScale)
    }
  }

  viewport.zoomBy = (factor, refPoint, immediately) => {
    const step = typeof factor === 'number' && Number.isFinite(factor) ? factor : 1
    if (!rotationEnabled) {
      const current = viewport.getZoom(false)
      return origZoomTo((current > 0 ? current : 1) * step, refPoint, immediately)
    }
    const home = viewport.getHomeZoom()
    const logical = (home > 0 ? home : 1) * objectScale * step
    return viewport.zoomTo(logical, refPoint, immediately)
  }

  viewport.zoomTo = (zoom, refPoint, immediately) => {
    if (!rotationEnabled) return origZoomTo(zoom, refPoint, immediately)
    const home = viewport.getHomeZoom()
    if (freezeScale) {
      const pin = home > 0 ? home : zoom
      return origZoomTo(pin, undefined, true)
    }
    if (!(home > 0) || typeof zoom !== 'number' || !Number.isFinite(zoom)) {
      return origZoomTo(zoom, refPoint, immediately)
    }

    const next = clamp(zoom / home, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE)
    const anchor = isViewportPoint(refPoint) ? refPoint : viewport.getCenter(true)
    const center = viewport.getCenter(true)
    const ratio = objectScale / next
    const shifted = new OpenSeadragon.Point(
      anchor.x + (center.x - anchor.x) * ratio,
      anchor.y + (center.y - anchor.y) * ratio,
    )
    origZoomTo(home, undefined, true)
    viewport.panTo(shifted, true)
    paintObjectScale(viewer, next)
    return viewport
  }

  viewport.applyConstraints = (immediately) => {
    if (!rotationEnabled) return origApply(immediately)
    freezeScale = true
    try {
      return origApply(true)
    } finally {
      freezeScale = false
    }
  }
}

function tiltRoot(): HTMLElement | null {
  return document.getElementById('app')
}

function markTiltRoot(on: boolean): void {
  const root = tiltRoot()
  if (!root) return
  root.classList.toggle('is-wall-tilt', on)
  if (!on) return
  root.style.setProperty('--wall-perspective', `${perspectivePx}px`)
  root.style.setProperty('--wall-object-scale', objectScale.toFixed(4))
  applyOrientation()
}

function paintObjectScale(viewer: Viewer, scale: number): void {
  objectScale = scale
  tiltRoot()?.style.setProperty('--wall-object-scale', scale.toFixed(4))
  const vp = viewer.viewport as OpenSeadragon.Viewport & { visibilityRatio: number }
  vp.visibilityRatio = (1 + 1 / scale) / 2
  viewer.navigator?.update(viewer.viewport)
}

function shrinkNavigatorRegion(region: HTMLElement | undefined, scale: number): void {
  if (!region || scale <= 1.001) return
  const left = parseFloat(region.style.left)
  const top = parseFloat(region.style.top)
  const width = parseFloat(region.style.width)
  const height = parseFloat(region.style.height)
  if (![left, top, width, height].every((n) => Number.isFinite(n)) || width < 1 || height < 1) return
  const nextW = width / scale
  const nextH = height / scale
  region.style.left = `${(left + (width - nextW) / 2).toFixed(2)}px`
  region.style.top = `${(top + (height - nextH) / 2).toFixed(2)}px`
  region.style.width = `${Math.round(nextW)}px`
  region.style.height = `${Math.round(nextH)}px`
}

function isViewportPoint(
  p: OpenSeadragon.Point | null | undefined,
): p is OpenSeadragon.Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampFace(deg: number): number {
  return Math.min(MAX_FACE_DEG, Math.max(-MAX_FACE_DEG, deg))
}

/** Drag right turns the sheet; drag down leans it back. Both axes stop before 90°. */
function nudgeRotation(dx: number, dy: number): void {
  if (!rotationEnabled) return
  yawDeg = clampFace(yawDeg + dx * DEG_PER_PX)
  tiltDeg = clampFace(tiltDeg + dy * DEG_PER_PX)
  applyOrientation()
}

function applyOrientation(): void {
  const root = tiltRoot()
  if (!root) return
  root.style.setProperty('--wall-tilt', `${tiltDeg.toFixed(2)}deg`)
  root.style.setProperty('--wall-yaw', `${yawDeg.toFixed(2)}deg`)
  const orb = document.getElementById('wall-tilt-orb')
  if (!orb) return
  const hx = Math.min(68, Math.max(12, 32 - yawDeg * 0.28))
  const hy = Math.min(70, Math.max(10, 26 + tiltDeg * 0.22))
  orb.style.setProperty('--orb-hx', `${hx}%`)
  orb.style.setProperty('--orb-hy', `${hy}%`)
  orb.setAttribute('aria-valuetext', `${Math.round(tiltDeg)}° / ${Math.round(yawDeg)}°`)
}

function mountTurnOrb(): void {
  const toolbar = document.querySelector<HTMLElement>('#toolbar')
  if (!toolbar || document.getElementById('wall-tilt-orb')) {
    applyOrientation()
    return
  }

  const orb = document.createElement('div')
  orb.id = 'wall-tilt-orb'
  orb.className = 'wall-tilt-orb'
  orb.tabIndex = 0
  orb.setAttribute('role', 'group')
  const label = t('toolbar.turn')
  orb.title = label
  orb.setAttribute('aria-label', label)
  const halo = document.createElement('span')
  halo.className = 'wall-tilt-orb-halo'
  halo.setAttribute('aria-hidden', 'true')
  const pearl = document.createElement('span')
  pearl.className = 'wall-tilt-orb-pearl'
  pearl.setAttribute('aria-hidden', 'true')
  orb.append(halo, pearl)
  toolbar.appendChild(orb)

  let drag: { id: number; x: number; y: number } | null = null

  orb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
    orb.classList.add('is-grabbing')
    try {
      orb.setPointerCapture(event.pointerId)
    } catch {
      /* Synthetic pointers have no capture id. */
    }
    event.preventDefault()
  })

  orb.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    nudgeRotation(event.clientX - drag.x, event.clientY - drag.y)
    drag = { id: drag.id, x: event.clientX, y: event.clientY }
  })

  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    drag = null
    orb.classList.remove('is-grabbing')
  }
  orb.addEventListener('pointerup', endDrag)
  orb.addEventListener('pointercancel', endDrag)

  orb.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 8 : 3
    const px = step / DEG_PER_PX
    if (event.key === 'ArrowLeft') nudgeRotation(-px, 0)
    else if (event.key === 'ArrowRight') nudgeRotation(px, 0)
    else if (event.key === 'ArrowUp') nudgeRotation(0, -px)
    else if (event.key === 'ArrowDown') nudgeRotation(0, px)
    else return
    event.preventDefault()
  })

  applyOrientation()
}

function mountProbes(container: HTMLElement): HTMLElement[] {
  const spec = [
    'left:0;top:0',
    'left:100%;top:0',
    'left:100%;top:100%',
    'left:0;top:100%',
  ]
  return spec.map((pos) => {
    const el = document.createElement('span')
    el.className = 'wall-tilt-probe'
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = `position:absolute;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;${pos}`
    container.appendChild(el)
    return el
  })
}

function clientFromEvent(ev: Event): Pt | null {
  if (typeof TouchEvent !== 'undefined' && ev instanceof TouchEvent) {
    const t = ev.changedTouches[0] ?? ev.touches[0]
    return t ? { x: t.clientX, y: t.clientY } : null
  }
  if ('clientX' in ev && 'clientY' in ev) {
    const e = ev as MouseEvent
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      return { x: e.clientX, y: e.clientY }
    }
  }
  return null
}

function pageToLocal(page: { x: number; y: number }): Pt | null {
  return projectScreenToLocal(page.x - window.scrollX, page.y - window.scrollY)
}

function projectScreenToLocal(clientX: number, clientY: number): Pt | null {
  if (!rotationEnabled || !host || !probes || probes.length !== 4) return null
  const w = host.clientWidth
  const h = host.clientHeight
  if (w < 2 || h < 2) return null

  const src = probes.map((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top }
  })
  if (src.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  const span = Math.hypot(src[1]!.x - src[0]!.x, src[1]!.y - src[0]!.y)
  if (span < 1) return null

  const dst: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  const map = homography(src, dst)
  return map ? map(clientX, clientY) : null
}

function flickFromTrail(trail: { t: number; x: number; y: number }[]): {
  speed: number
  direction: number
} | null {
  if (trail.length < 2) return null
  const a = trail[0]!
  const b = trail[trail.length - 1]!
  const dt = b.t - a.t
  if (dt < 8) return null
  const dx = b.x - a.x
  const dy = b.y - a.y
  return {
    speed: (Math.hypot(dx, dy) * 1000) / dt,
    direction: Math.atan2(dy, dx),
  }
}

/** Map four screen corners onto the viewer's layout rectangle. */
function homography(src: Pt[], dst: Pt[]): ((x: number, y: number) => Pt | null) | null {
  const rows: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!
    const { x: u, y: v } = dst[i]!
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  const h = solve8(rows)
  if (!h) return null
  return (x, y) => {
    const w = h[6]! * x + h[7]! * y + 1
    if (Math.abs(w) < 1e-8) return null
    return {
      x: (h[0]! * x + h[1]! * y + h[2]!) / w,
      y: (h[3]! * x + h[4]! * y + h[5]!) / w,
    }
  }
}

function solve8(matrix: number[][]): number[] | null {
  const n = 8
  const a = matrix.map((row) => row.slice())
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r
    }
    const pivotRow = a[pivot]!
    if (Math.abs(pivotRow[col]!) < 1e-10) return null
    a[pivot] = a[col]!
    a[col] = pivotRow
    const div = pivotRow[col]!
    for (let c = col; c <= n; c++) pivotRow[c] = pivotRow[c]! / div
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const row = a[r]!
      const f = row[col]!
      if (f === 0) continue
      for (let c = col; c <= n; c++) row[c] = row[c]! - f * pivotRow[c]!
    }
  }
  return a.map((row) => row[n]!)
}
