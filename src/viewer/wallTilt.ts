import OpenSeadragon, { type Viewer } from 'openseadragon'
import { t } from '../i18n'

/**
 * Map rotation for the interactive viewer (regular mode and the ATLab wall).
 * Starts on with `?wallTilt=1` (32°) or `?wallTilt=28` (degrees). Otherwise
 * the pearl beside 淨 and 功, or the 功 settings row, turns it on.
 * Optional `?wallPerspective=2400`.
 * A tap on the pearl toggles rotation. A drag on it, or two fingers, turns the sheet.
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
/** Movement under this is a tap, which toggles rotation. */
const TAP_PX = 8
/** Matches the CSS angle transition on `#app.is-wall-tilt-settle`. */
const SETTLE_MS = 480
/** Run before label / tour handlers that read canvas-click position. */
const HANDLER_PRIORITY = 100
/**
 * How far the tilted sheet may grow or shrink. Below 1 it lifts off the
 * bottom edge. The wall clips anything past the max.
 * Intro focuses at 3.6× home, so the cap stays above that.
 * Flat mode cannot go below home, so a shrink eases back to 1 on the way out.
 */
const MIN_OBJECT_SCALE = 0.5
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
/** Screen-space lift of the whole sheet, in layout pixels. Negative raises it. */
let objectLift = 0
/** Lean back (rotateX) and turn (rotateY), degrees. Both stay in ±MAX_FACE_DEG. */
let tiltDeg = 0
let yawDeg = 0
let rotationEnabled = false
let pendingEnable = false
let choseAngle = false
let perspectivePx = DEFAULT_PERSPECTIVE_PX
let baseVisibility = 1
let passZoomTo: OpenSeadragon.Viewport['zoomTo'] | null = null
let settleTimer = 0
let orientFrame = 0

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

/** Pearl or settings toggle. Remembers the last angle, and leans to 32° the first time. */
export function setWallRotationEnabled(on: boolean, animate = true): boolean {
  if (!boundViewer || !passZoomTo) return rotationEnabled
  if (on === rotationEnabled) return rotationEnabled

  const viewport = boundViewer.viewport
  const home = viewport.getHomeZoom()
  const ease = animate && !prefersReducedMotion()

  if (on) {
    if (!choseAngle && tiltDeg === 0 && yawDeg === 0) {
      tiltDeg = DEFAULT_DEGREES
      choseAngle = true
    }
    const current = viewport.getZoom(true)
    const nextScale = home > 0 ? clamp(current / home, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE) : 1
    rotationEnabled = true
    objectScale = 1
    tiltRoot()?.classList.remove('is-wall-scale-settle')
    markTiltRoot(true)
    if (ease) {
      const root = tiltRoot()
      root?.style.setProperty('--wall-tilt', '0deg')
      root?.style.setProperty('--wall-yaw', '0deg')
      if (root) armSettle(root)
      cancelAnimationFrame(orientFrame)
      orientFrame = requestAnimationFrame(() => {
        orientFrame = 0
        if (rotationEnabled) applyOrientation()
      })
    }
    if (home > 0) viewport.zoomTo(home * nextScale, undefined, true)
    if (!ease) applyOrientation()
    notifyRotation()
    return true
  }

  const fromScale = objectScale
  const belowHome = fromScale < 0.999
  const logical = home > 0 ? home * Math.max(fromScale, 1) : viewport.getZoom(true)
  const center = viewport.getCenter(true)
  rotationEnabled = false
  objectScale = 1
  cancelAnimationFrame(orientFrame)
  orientFrame = 0
  const root = tiltRoot()
  root?.classList.remove('is-wall-scale-settle')
  if (ease && root) {
    // A shrink is not legal once the sheet is flat, so grow it back to the
    // home size while the angles ease to 0. The same CSS shift drops it
    // onto the bottom edge again.
    if (belowHome) root.classList.add('is-wall-scale-settle')
    armSettle(root)
    root.style.setProperty('--wall-tilt', '0deg')
    root.style.setProperty('--wall-yaw', '0deg')
    root.style.setProperty('--wall-object-lift', '0px')
    if (!belowHome) root.style.setProperty('--wall-object-scale', '1')
  } else {
    root?.style.setProperty('--wall-object-scale', '1')
    root?.style.setProperty('--wall-tilt', '0deg')
    root?.style.setProperty('--wall-yaw', '0deg')
    root?.style.setProperty('--wall-object-lift', '0px')
  }
  objectLift = 0
  markTiltRoot(false)
  if (ease && belowHome && root) {
    root.style.setProperty('--wall-object-scale', '1')
    followScaleSettle(root)
  }
  const vp = viewport as OpenSeadragon.Viewport & { visibilityRatio: number }
  vp.visibilityRatio = baseVisibility
  if (!belowHome) {
    passZoomTo(logical, undefined, true)
    viewport.panTo(center, true)
  }
  // Pan and min-zoom ease back into the flat limits while the sheet settles.
  viewport.applyConstraints(!ease)
  boundViewer.navigator?.update(viewport)
  notifyRotation()
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
  if (pendingEnable) setWallRotationEnabled(true, false)
  bindWallChrome(viewer)

  let last: Pt | null = null
  let lastClient: Pt | null = null
  const trail: { t: number; x: number; y: number }[] = []

  const remember = (p: Pt) => {
    last = p
    const t = performance.now()
    trail.push({ t, x: p.x, y: p.y })
    while (trail.length > 1 && t - trail[0]!.t > 140) trail.shift()
  }

  const resetGesture = () => {
    last = null
    lastClient = null
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
      const client = clientFromEvent(event.originalEvent)
      const local = assignPosition(event.position, client)
      if (client) lastClient = client
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
      const screenDx = client && lastClient ? client.x - lastClient.x : 0
      const screenDy = client && lastClient ? client.y - lastClient.y : 0
      const lifting = rotationEnabled && objectScale <= 1.001 && Math.abs(screenDy) >= Math.abs(screenDx)
      if (last) {
        // A vertical drag lifts the whole sheet. Panning it would crop the painting.
        event.delta.x = lifting ? 0 : local.x - last.x
        event.delta.y = rotationEnabled && objectScale <= 1.001 ? 0 : local.y - last.y
      }
      if (lifting && screenDy !== 0) nudgeObjectLift(screenDy)
      event.position.x = local.x
      event.position.y = local.y
      if (client) lastClient = client
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
        let ampY = 0
        if (nav.panHorizontal === false) ampX = 0
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

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function armSettle(root: HTMLElement): void {
  root.classList.add('is-wall-tilt-settle')
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    root.classList.remove('is-wall-tilt-settle')
    root.classList.remove('is-wall-scale-settle')
    scheduleWallChrome()
  }, SETTLE_MS)
}

/** Keep badges and the stamp on the sheet while a shrink eases back to home. */
function followScaleSettle(root: HTMLElement): void {
  const step = () => {
    if (!root.classList.contains('is-wall-scale-settle')) return
    scheduleWallChrome()
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function releaseSettle(): void {
  window.clearTimeout(settleTimer)
  tiltRoot()?.classList.remove('is-wall-tilt-settle')
}

function notifyRotation(): void {
  const orb = document.getElementById('wall-tilt-orb')
  orb?.setAttribute('aria-pressed', rotationEnabled ? 'true' : 'false')
  document.dispatchEvent(new CustomEvent('qing-rotation-change'))
}

function markTiltRoot(on: boolean): void {
  const root = tiltRoot()
  if (!root) return
  root.classList.toggle('is-wall-tilt', on)
  scheduleWallChrome()
  if (!on) return
  root.style.setProperty('--wall-perspective', `${perspectivePx}px`)
  root.style.setProperty('--wall-object-scale', objectScale.toFixed(4))
}

function paintObjectScale(viewer: Viewer, scale: number): void {
  objectScale = scale
  tiltRoot()?.style.setProperty('--wall-object-scale', scale.toFixed(4))
  const vp = viewer.viewport as OpenSeadragon.Viewport & { visibilityRatio: number }
  // Loosen pan while zoomed in. At full size and below, horizontal limits stay
  // put; vertical lift is allowed separately so the sheet can leave the bottom.
  vp.visibilityRatio = Math.min(baseVisibility, (1 + 1 / scale) / 2)
  viewer.navigator?.update(viewer.viewport)
  scheduleWallChrome()
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

/** Raise or lower the whole sheet. A negative screen delta moves it up, uncropped. */
function nudgeObjectLift(screenDy: number): void {
  const el = boundViewer?.element
  if (!el || !Number.isFinite(screenDy) || screenDy === 0) return
  const rect = el.getBoundingClientRect()
  const layoutPerScreen = rect.height > 1 ? el.clientHeight / rect.height : 1
  const next = objectLift + screenDy * layoutPerScreen
  // Stop once the top of the sheet meets the wall, so the painting is not cut off.
  objectLift = clamp(next, -maxObjectRaise(), 0)
  tiltRoot()?.style.setProperty('--wall-object-lift', `${objectLift.toFixed(1)}px`)
}

/** How far the sheet can rise before its top edge meets the wall. */
function maxObjectRaise(): number {
  const el = boundViewer?.element
  const pose = readSheetPose()
  if (!el || !pose) return 0
  const w = el.clientWidth
  const h = el.clientHeight
  const topL = projectOnWall(0, 0, w, h, objectScale, pose.tilt, pose.yaw).y
  const topR = projectOnWall(w, 0, w, h, objectScale, pose.tilt, pose.yaw).y
  return Math.max(0, Math.min(topL, topR))
}

function readSheetPose(): { tilt: number; yaw: number } | null {
  const root = tiltRoot()
  if (!root) return null
  const active = root.classList.contains('is-wall-tilt') || root.classList.contains('is-wall-tilt-settle')
  if (!active) return null
  const style = getComputedStyle(root)
  const tilt = parseFloat(style.getPropertyValue('--wall-tilt'))
  const yaw = parseFloat(style.getPropertyValue('--wall-yaw'))
  return {
    tilt: Number.isFinite(tilt) ? tilt : tiltDeg,
    yaw: Number.isFinite(yaw) ? yaw : yawDeg,
  }
}

/**
 * Container pixel → wall layout pixel, matching the CSS tilt without the object lift.
 * Chrome uses this so a raised sheet does not drag the controls with it.
 */
function projectOnWall(
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  tilt: number,
  yaw: number,
): Pt {
  const ox = width / 2
  const oy = height
  const ty = ((scale - 1) * height) / 2
  let px = (x - ox) * scale
  let py = (y - oy) * scale + ty
  let pz = 0
  const yawR = (yaw * Math.PI) / 180
  const tiltR = (tilt * Math.PI) / 180
  const cy = Math.cos(yawR)
  const sy = Math.sin(yawR)
  const cx = Math.cos(tiltR)
  const sx = Math.sin(tiltR)
  const x1 = px * cy + pz * sy
  const z1 = -px * sy + pz * cy
  const y2 = py * cx - z1 * sx
  const z2 = py * sx + z1 * cx
  const denom = perspectivePx - z2
  const f = Math.abs(denom) < 1e-3 ? 1 : perspectivePx / denom
  return { x: ox + x1 * f, y: oy + y2 * f }
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
  scheduleWallChrome()
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
  orb.setAttribute('role', 'button')
  orb.setAttribute('aria-pressed', rotationEnabled ? 'true' : 'false')
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

  let drag: { id: number; x: number; y: number; moved: boolean } | null = null

  orb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    try {
      orb.setPointerCapture(event.pointerId)
    } catch {
      /* Synthetic pointers have no capture id. */
    }
    event.preventDefault()
  })

  orb.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < TAP_PX) return
      drag.moved = true
      if (!rotationEnabled) return
      orb.classList.add('is-grabbing')
      releaseSettle()
    }
    if (!rotationEnabled) return
    nudgeRotation(dx, dy)
    drag = { id: drag.id, x: event.clientX, y: event.clientY, moved: true }
  })

  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    const wasTap = !drag.moved
    drag = null
    orb.classList.remove('is-grabbing')
    if (wasTap) setWallRotationEnabled(!rotationEnabled)
  }
  orb.addEventListener('pointerup', endDrag)
  orb.addEventListener('pointercancel', endDrag)

  orb.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      setWallRotationEnabled(!rotationEnabled)
      event.preventDefault()
      return
    }
    if (!rotationEnabled) return
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

/**
 * On the ATLab wall, float chrome in the gutters just outside the scan.
 * Badges and the tour stamp follow the upright sheet as it grows, and ignore
 * the tilt. Plaques, the minimap, and tour-skip follow the tilted sheet.
 * A shrink below full size moves only the map; the chrome stays on the full-size frame.
 * The pearl stays left of the badges until it meets the wall, then crosses
 * to their right. Normal mode never sets these.
 */
let chromeFrame = 0

function scheduleWallChrome(): void {
  if (chromeFrame) return
  chromeFrame = requestAnimationFrame(() => {
    chromeFrame = 0
    placeAtlabWallChrome()
  })
}

type SheetQuad = { tl: Pt; tr: Pt; br: Pt; bl: Pt }

/** Interpolated sheet scale while a shrink is easing back to the flat home size. */
function readSettlingScale(app: HTMLElement): number | null {
  if (!app.classList.contains('is-wall-scale-settle')) return null
  const n = parseFloat(getComputedStyle(app).getPropertyValue('--wall-object-scale'))
  return Number.isFinite(n) ? n : null
}

/**
 * Grow the upright sheet the way wall zoom does, without the tilt.
 * Scale is around the bottom center, then the same vertical shift as the CSS.
 * Below 1 that shift lifts the sheet off the bottom edge.
 */
function spreadUpright(quad: SheetQuad, scale: number, width: number, height: number): SheetQuad {
  if (Math.abs(scale - 1) < 0.001) return quad
  const ox = width / 2
  const oy = height
  const ty = ((scale - 1) * height) / 2
  const apply = (p: Pt): Pt => ({
    x: ox + (p.x - ox) * scale,
    y: oy + (p.y - oy) * scale + ty,
  })
  return {
    tl: apply(quad.tl),
    tr: apply(quad.tr),
    br: apply(quad.br),
    bl: apply(quad.bl),
  }
}

/**
 * Scan corners in #app layout pixels.
 * `upright` is the sheet before wall tilt. `tilted` includes the rotation.
 */
function sheetCorners(
  app: HTMLElement,
  visualScale = 1,
): { upright: SheetQuad; tilted: SheetQuad } | null {
  const viewer = boundViewer
  if (!viewer || !probes || probes.length !== 4 || viewer.world.getItemCount() < 1) return null
  const item = viewer.world.getItemAt(0)
  if (!item) return null
  const el = viewer.element
  const cw = el.clientWidth
  const ch = el.clientHeight
  if (cw < 2 || ch < 2) return null

  const bounds = item.getBounds()
  const topLeft = viewer.viewport.pixelFromPoint(bounds.getTopLeft(), true)
  const bottomRight = viewer.viewport.pixelFromPoint(bounds.getBottomRight(), true)
  if (!isViewportPoint(topLeft) || !isViewportPoint(bottomRight)) return null

  const upright: SheetQuad = {
    tl: { x: topLeft.x, y: topLeft.y },
    tr: { x: bottomRight.x, y: topLeft.y },
    br: { x: bottomRight.x, y: bottomRight.y },
    bl: { x: topLeft.x, y: bottomRight.y },
  }

  // Ignore shrink and lift: controls stay on the full resting sheet.
  const pose = readSheetPose()
  if (pose) {
    const scale = Math.max(visualScale, 1)
    const project = (x: number, y: number) => projectOnWall(x, y, cw, ch, scale, pose.tilt, pose.yaw)
    return {
      upright,
      tilted: {
        tl: project(topLeft.x, topLeft.y),
        tr: project(bottomRight.x, topLeft.y),
        br: project(bottomRight.x, bottomRight.y),
        bl: project(topLeft.x, bottomRight.y),
      },
    }
  }

  const screen = probes.map((probe) => {
    const r = probe.getBoundingClientRect()
    return { x: r.left, y: r.top }
  })
  const toScreen = homography(
    [
      { x: 0, y: 0 },
      { x: cw, y: 0 },
      { x: cw, y: ch },
      { x: 0, y: ch },
    ],
    screen,
  )
  if (!toScreen) return null
  const projected = [
    toScreen(topLeft.x, topLeft.y),
    toScreen(bottomRight.x, topLeft.y),
    toScreen(bottomRight.x, bottomRight.y),
    toScreen(topLeft.x, bottomRight.y),
  ]
  if (projected.some((p) => !p)) return null

  const box = app.getBoundingClientRect()
  const width = app.clientWidth
  const height = app.clientHeight
  if (box.width < 2 || box.height < 2 || width < 2 || height < 2) return null
  const toLocal = (p: Pt): Pt => ({
    x: ((p.x - box.left) / box.width) * width,
    y: ((p.y - box.top) / box.height) * height,
  })
  return {
    upright,
    tilted: {
      tl: toLocal(projected[0]!),
      tr: toLocal(projected[1]!),
      br: toLocal(projected[2]!),
      bl: toLocal(projected[3]!),
    },
  }
}

function placeAtlabWallChrome(): void {
  const app = document.getElementById('app')
  if (!app?.closest('.atlab-wall')) return
  const settlingScale = readSettlingScale(app)
  const visualScale = settlingScale ?? (rotationEnabled ? objectScale : 1)
  const frames = sheetCorners(app, visualScale)
  if (!frames) return
  const { tl, tr, br, bl } = frames.tilted
  const upright = frames.upright
  const width = app.clientWidth
  const height = app.clientHeight
  const centerX = (tl.x + tr.x + br.x + bl.x) / 4
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

  const xAt = (y: number, a: Pt, b: Pt): number => {
    const span = b.y - a.y
    if (Math.abs(span) < 0.5) return (a.x + b.x) / 2
    return a.x + ((b.x - a.x) * (y - a.y)) / span
  }
  /** Edge x furthest from the sheet, so a straight control stays off the slant. */
  const outerX = (y0: number, y1: number, a: Pt, b: Pt): number => {
    const x0 = xAt(y0, a, b)
    const x1 = xAt(y1, a, b)
    return Math.abs(x0 - centerX) >= Math.abs(x1 - centerX) ? x0 : x1
  }

  const chromeScale = Math.max(visualScale, 1)
  const grown =
    chromeScale > 1.001 ? spreadUpright(upright, chromeScale, width, height) : upright

  const toolbar = document.getElementById('toolbar')
  if (toolbar) {
    const barH = toolbar.offsetHeight
    const barW = Math.max(toolbar.offsetWidth, 52)
    const pearlReserve = 54 + 1.85 * rem
    const barTop = clamp(Math.max(grown.tl.y, 0) + rem, 0, Math.max(0, height - barH))
    const edge = outerX(barTop, barTop + barH, grown.tl, grown.bl)
    const outward = edge <= (grown.tl.x + grown.br.x) / 2 ? -1 : 1
    const face = edge + outward * rem
    const rawLeft = outward < 0 ? face - barW : face
    let inward = app.classList.contains('is-pearl-inward')
    if (outward < 0) {
      if (!inward && rawLeft < pearlReserve) inward = true
      if (inward && rawLeft > pearlReserve + 4) inward = false
    } else {
      inward = false
    }
    app.classList.toggle('is-pearl-inward', inward)
    const minLeft = inward || outward > 0 ? rem : pearlReserve
    const barLeft = clamp(rawLeft, minLeft, Math.max(minLeft, width - barW))
    app.style.setProperty('--wall-badge-left', `${barLeft.toFixed(1)}px`)
    app.style.setProperty('--wall-badge-top', `${barTop.toFixed(1)}px`)
  }

  const seals = document.getElementById('overlay-seals')
  let plaqueBottom = 1.25 * rem
  let plaqueH = 0
  if (seals) {
    const gap = 1.25 * rem
    const sealH = seals.offsetHeight
    const sealW = seals.offsetWidth
    plaqueH = sealH
    plaqueBottom = clamp(height - bl.y + gap, 0, Math.max(0, height - sealH))
    const sealTop = height - plaqueBottom - sealH
    const edge = outerX(sealTop, Math.max(sealTop + 1, sealTop + sealH), tl, bl)
    const outward = edge <= centerX ? -1 : 1
    const face = edge + outward * gap
    let cssRight = width - face
    if (sealW > 0) cssRight = clamp(cssRight, 0, Math.max(0, width - sealW))
    else cssRight = clamp(cssRight, 0, width)
    app.style.setProperty('--wall-seal-right', `${cssRight.toFixed(1)}px`)
    app.style.setProperty('--wall-seal-bottom', `${plaqueBottom.toFixed(1)}px`)
  }

  const stamp = document.getElementById('tour-seals')
  if (stamp) {
    const gap = 1.25 * rem
    const stampW = stamp.offsetWidth
    const stampH = stamp.offsetHeight
    const abovePlaques = plaqueH > 0 ? plaqueBottom + plaqueH + 0.75 * rem : height - grown.bl.y + gap
    const bottom = clamp(abovePlaques, gap, Math.max(gap, height - stampH))
    const stampTop = height - bottom - Math.max(stampH, 1)
    const edge = outerX(stampTop, stampTop + Math.max(stampH, 1), grown.tl, grown.bl)
    const outward = edge <= (grown.tl.x + grown.br.x) / 2 ? -1 : 1
    let face = edge + outward * gap
    if (stampW > 0 && outward < 0) face = Math.max(face, gap + stampW)
    let cssRight = width - face
    if (stampW > 0) cssRight = clamp(cssRight, 0, Math.max(0, width - stampW))
    else cssRight = clamp(cssRight, 0, width)
    app.style.setProperty('--wall-stamp-right', `${cssRight.toFixed(1)}px`)
    app.style.setProperty('--wall-stamp-bottom', `${bottom.toFixed(1)}px`)
  }

  const minimap = document.getElementById('minimap-panel')
  let miniBottom = 1.25 * rem
  let miniH = 0
  if (minimap && !minimap.classList.contains('is-dragging')) {
    const gap = 1.25 * rem
    const elW = minimap.offsetWidth
    const elH = minimap.offsetHeight
    miniH = elH
    miniBottom = clamp(height - br.y + gap, 0, Math.max(0, height - elH))
    const elTop = height - miniBottom - elH
    const edge = outerX(elTop, elTop + Math.max(elH, 1), tr, br)
    const outward = edge >= centerX ? 1 : -1
    const face = edge + outward * gap
    const left = clamp(outward > 0 ? face : face - elW, 0, Math.max(0, width - elW))
    app.style.setProperty('--wall-minimap-right', `${(width - left - elW).toFixed(1)}px`)
    app.style.setProperty('--wall-minimap-bottom', `${miniBottom.toFixed(1)}px`)
  }

  const skip = document.getElementById('tour-skip')
  if (skip) {
    const gap = 1.25 * rem
    const elW = Math.max(skip.offsetWidth, rem * 2.35)
    const elH = Math.max(skip.offsetHeight, rem * 2.35)
    const aboveMini = miniH > 0 ? miniBottom + miniH + 0.4 * rem : 1.35 * rem
    const bottom = clamp(aboveMini, 0, Math.max(0, height - elH))
    const elTop = height - bottom - elH
    const edge = outerX(elTop, elTop + elH, tr, br)
    const outward = edge >= centerX ? 1 : -1
    const face = edge + outward * gap
    const left = clamp(outward > 0 ? face : face - elW, 0, Math.max(0, width - elW))
    app.style.setProperty('--wall-skip-right', `${(width - left - elW).toFixed(1)}px`)
    app.style.setProperty('--wall-skip-bottom', `${bottom.toFixed(1)}px`)
  }
}

function bindWallChrome(viewer: Viewer): void {
  if (!document.querySelector('.atlab-wall')) return
  const kick = () => scheduleWallChrome()
  viewer.addHandler('open', kick)
  viewer.addHandler('resize', kick)
  viewer.addHandler('animation', kick)
  window.addEventListener('resize', kick)
  window.addEventListener('qing-atlab-layout', kick)
  scheduleWallChrome()
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
