import OpenSeadragon, { type Viewer } from 'openseadragon'
import { t } from '../i18n'
import { clearWallBillboardChrome } from './wallBillboardReset'

/**
 * Map rotation for the interactive viewer (regular mode and the ATLab wall).
 * Starts on with `?wallTilt=1` (32°) or `?wallTilt=28` (degrees). Otherwise
 * the pearl beside 淨 and 功, or the 功 settings row, turns it on.
 * Optional `?wallPerspective=2400`.
 * A tap on the pearl toggles the 3D lean. Dragging it sideways spins the map
 * flat, in its own plane, with no stop — across 360° and upside down, even
 * while the 3D lean is off. Dragging down leans it back. Shift-drag turns it
 * laterally. Lean and the lateral turn stay inside ±76.5°, so the back never
 * faces the room. A two-finger twist on the map also spins it flat.
 * Everything spins around the geometric centre of the visible map.
 * The floor viewer is never tilted.
 */

const DEFAULT_DEGREES = 32
const DEFAULT_PERSPECTIVE_PX = 2400
/** 85% of 90° — far enough to feel edge-on, near enough that the sheet stays visible from the sides. */
const MAX_FACE_DEG = 90 * 0.85
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
/** Lean (rotateX) and turn (rotateY) stay inside ±76.5°. In-plane spin (rotateZ) does not. */
let tiltDeg = 0
let yawDeg = 0
let rollDeg = 0
/** Transform pivot in container pixels — the visible map's geometric centre. */
let wallOrigin: Pt | null = null
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
  if (!on && document.getElementById('app')?.classList.contains('byobu-mode')) return rotationEnabled
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
      // The in-plane spin carries over. A flat turn stays visible as the lean arrives.
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
  // The flat spin survives the lean leaving. A twist is not a 3D pose.
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
    if (boundViewer) clearWallBillboardChrome(boundViewer)
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
  syncFlatRoll()
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

  const root = tiltRoot()
  root?.addEventListener('transitionend', (event) => {
    if (event.target !== root || rotationEnabled) return
    if (root.classList.contains('is-wall-tilt') || !root.classList.contains('is-wall-tilt-settle')) {
      return
    }
    const prop = event.propertyName
    if (prop !== '--wall-tilt' && prop !== '--wall-yaw') return
    const cs = getComputedStyle(root)
    const tilt = parseFloat(cs.getPropertyValue('--wall-tilt'))
    const yaw = parseFloat(cs.getPropertyValue('--wall-yaw'))
    if (Math.abs(tilt) > 0.08 || Math.abs(yaw) > 0.08) return
    window.clearTimeout(settleTimer)
    settleTimer = 0
    finishWallTiltSettle(root)
  })

  let last: Pt | null = null
  let lastClient: Pt | null = null
  const trail: { t: number; x: number; y: number }[] = []
  const screenTrail: { t: number; x: number; y: number }[] = []

  const remember = (p: Pt) => {
    last = p
    const t = performance.now()
    trail.push({ t, x: p.x, y: p.y })
    while (trail.length > 1 && t - trail[0]!.t > 140) trail.shift()
  }

  const rememberScreen = (p: Pt) => {
    const t = performance.now()
    screenTrail.push({ t, x: p.x, y: p.y })
    while (screenTrail.length > 1 && t - screenTrail[0]!.t > 140) screenTrail.shift()
  }

  const resetGesture = () => {
    last = null
    lastClient = null
    trail.length = 0
    screenTrail.length = 0
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
      if (client) rememberScreen(client)
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
      if (last && client && lastClient) {
        // Move the sheet with the finger across the screen. A plane delta would
        // slide along the tilted face instead of straight across the wall.
        const moved = localDeltaForScreen(screenDx, screenDy, last)
        event.delta.x = lifting ? 0 : moved.x
        event.delta.y = rotationEnabled && objectScale <= 1.001 ? 0 : moved.y
      }
      if (lifting && screenDy !== 0) nudgeObjectLift(screenDy)
      event.position.x = local.x
      event.position.y = local.y
      if (client) lastClient = client
      if (client) rememberScreen(client)
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
      const flick = flickFromTrail(screenTrail)
      const minSpeed = settings.flickMinSpeed ?? 120
      if (flick && flick.speed >= minSpeed && last) {
        const momentum = settings.flickMomentum ?? 0.25
        const nav = viewer as Viewer & { panHorizontal?: boolean; panVertical?: boolean }
        let screenDx = momentum * flick.speed * Math.cos(flick.direction)
        if (nav.panHorizontal === false) screenDx = 0
        const moved = localDeltaForScreen(screenDx, 0, last)
        const center = viewer.viewport.pixelFromPoint(viewer.viewport.getCenter(true))
        const target = viewer.viewport.pointFromPixel(
          new OpenSeadragon.Point(center.x - moved.x, center.y - moved.y),
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
      const pts = event.gesturePoints
      if (pts.length < 2) return
      const p0 = pts[0]!
      const p1 = pts[1]!
      const midDx = (p0.currentPos.x + p1.currentPos.x - p0.lastPos.x - p1.lastPos.x) / 2
      const midDy = (p0.currentPos.y + p1.currentPos.y - p0.lastPos.y - p1.lastPos.y) / 2
      const distNow = Math.hypot(p0.currentPos.x - p1.currentPos.x, p0.currentPos.y - p1.currentPos.y)
      const distLast = Math.hypot(p0.lastPos.x - p1.lastPos.x, p0.lastPos.y - p1.lastPos.y)
      const zooming = distLast > 12 && Math.abs(distNow / distLast - 1) > 0.05
      const twist = fingerTwist(p0.lastPos, p1.lastPos, p0.currentPos, p1.currentPos)
      if (Math.abs(twist) > 0.2) rollDeg += twist
      if (!rotationEnabled) {
        if (Math.abs(twist) > 0.2) applyOrientation()
      } else if (!zooming) {
        event.preventDefaultPanAction = true
        event.preventDefaultZoomAction = true
        if (midDx !== 0 || midDy !== 0) nudgeRotation(midDx, midDy, true)
        else if (Math.abs(twist) > 0.2) applyOrientation()
      } else if (Math.abs(twist) > 0.2) {
        applyOrientation()
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
  const repin = () => syncWallOrigin()
  viewer.addHandler('open', repin)
  viewer.addHandler('resize', repin)
  viewer.addHandler('animation', repin)
  viewer.addHandler('pan', repin)
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
    finishWallTiltSettle(root)
  }, SETTLE_MS)
}

/** 3D→2D ease-out ended: drop upright clones and show on-map province plates again. */
function finishWallTiltSettle(root: HTMLElement): void {
  root.classList.remove('is-wall-tilt-settle')
  root.classList.remove('is-wall-scale-settle')
  if (boundViewer && !rotationEnabled) {
    clearWallBillboardChrome(boundViewer)
    boundViewer.forceRedraw()
  }
  notifyRotation()
  scheduleWallChrome()
}

/** Move the frame with the sheet while a zoom eases. */
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
  // Up stops when the top meets the wall; down stops when the bottom meets the floor.
  objectLift = clamp(next, -maxObjectRaise(), maxObjectLower())
  tiltRoot()?.style.setProperty('--wall-object-lift', `${objectLift.toFixed(1)}px`)
}

/** How far the sheet can rise before its top edge meets the wall. */
function maxObjectRaise(): number {
  const el = boundViewer?.element
  const pose = readSheetPose()
  if (!el || !pose) return 0
  const w = el.clientWidth
  const h = el.clientHeight
  const topL = projectOnWall(0, 0, w, h, objectScale, pose.tilt, pose.yaw, pose.roll).y
  const topR = projectOnWall(w, 0, w, h, objectScale, pose.tilt, pose.yaw, pose.roll).y
  return Math.max(0, Math.min(topL, topR))
}

/** How far the sheet can drop before its bottom edge meets the floor seam. */
function maxObjectLower(): number {
  const el = boundViewer?.element
  const pose = readSheetPose()
  if (!el || !pose) return 0
  const w = el.clientWidth
  const h = el.clientHeight
  const bottomL = projectOnWall(0, h, w, h, objectScale, pose.tilt, pose.yaw, pose.roll).y
  const bottomR = projectOnWall(w, h, w, h, objectScale, pose.tilt, pose.yaw, pose.roll).y
  return Math.max(0, h - Math.max(bottomL, bottomR))
}

/** True while province / decor use the upright wall billboard (3D lean or flat spin). */
export function isWallLabelBillboardMode(): boolean {
  if (rotationEnabled) return true
  const app = document.getElementById('app')
  // 3D→2D ease-out: sheet still perspective-transformed until settle ends.
  if (app?.classList.contains('is-wall-tilt-settle') && !app.classList.contains('is-wall-tilt')) {
    return true
  }
  return !!document.getElementById('viewer')?.classList.contains('is-wall-roll-2d')
}

/** Live wall pose plus framing the 折 WebGL transition should match. */
export type WallByobuSync = {
  tilt: number
  yaw: number
  roll: number
  wall3d: boolean
  objectScale: number
  objectLiftPx: number
  originX: number
  originY: number
  viewerW: number
  viewerH: number
}

/** Visible map on the wall after the live CSS sheet transform (container pixels). */
export type WallMapQuad = {
  left: number
  top: number
  right: number
  bottom: number
  cx: number
  cy: number
  width: number
  height: number
  viewerW: number
  viewerH: number
}

export function readVisibleMapWallQuad(): WallMapQuad | null {
  const viewer = boundViewer
  if (!viewer || viewer.world.getItemCount() < 1) return null
  const el = viewer.element
  const viewerW = el.clientWidth
  const viewerH = el.clientHeight
  if (viewerW < 2 || viewerH < 2) return null
  const item = viewer.world.getItemAt(0)
  if (!item) return null
  const b = item.getBounds()
  const corners = [
    new OpenSeadragon.Point(b.x, b.y),
    new OpenSeadragon.Point(b.x + b.width, b.y),
    new OpenSeadragon.Point(b.x + b.width, b.y + b.height),
    new OpenSeadragon.Point(b.x, b.y + b.height),
  ]
  const projected: Pt[] = []
  for (const p of corners) {
    const px = viewer.viewport.pixelFromPoint(p, true)
    const q = projectSheetPoint(px.x, px.y)
    if (q) projected.push(q)
  }
  if (projected.length < 4) return null
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const p of projected) {
    left = Math.min(left, p.x)
    right = Math.max(right, p.x)
    top = Math.min(top, p.y)
    bottom = Math.max(bottom, p.y)
  }
  if (!(right > left) || !(bottom > top)) return null
  return {
    left,
    top,
    right,
    bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
    viewerW,
    viewerH,
  }
}

export function readWallByobuSync(): WallByobuSync | null {
  const pose = readWallSheetPose()
  if (!pose) return null
  const root = tiltRoot()
  const el = boundViewer?.element
  if (!root || !el) return null
  const wall3d =
    root.classList.contains('is-wall-tilt') || root.classList.contains('is-wall-tilt-settle')
  const style = getComputedStyle(root)
  const num = (name: string, fallback: number): number => {
    const v = parseFloat(style.getPropertyValue(name))
    return Number.isFinite(v) ? v : fallback
  }
  const w = el.clientWidth
  const h = el.clientHeight
  if (w < 2 || h < 2) return null
  return {
    ...pose,
    wall3d,
    objectScale: num('--wall-object-scale', objectScale),
    objectLiftPx: num('--wall-object-lift', objectLift),
    originX: num('--wall-origin-x', w / 2),
    originY: num('--wall-origin-y', wall3d ? h : h / 2),
    viewerW: w,
    viewerH: h,
  }
}

/** Live pearl / wall orientation in CSS degrees (same as `--wall-tilt` / `--wall-yaw` / `--wall-roll`). */
export function readWallOrientationDegrees(): { tilt: number; yaw: number; roll: number } {
  return { tilt: tiltDeg, yaw: yawDeg, roll: rollDeg }
}

/** Push `tiltDeg` / `yawDeg` / `rollDeg` to CSS (e.g. before handing 屏風 back to the wall). */
export function publishWallOrientation(): void {
  applyOrientation()
}

/** CSS angle easing (`#app.is-wall-tilt-settle`). */
export function wallAngleSettleMs(): number {
  return prefersReducedMotion() ? 0 : 440
}

/** Before 折: upright map in the viewer — yaw/roll off; keep default 3D lean only when entering from 3D. */
export function prepareWallForByobuEnter(keep3dLean: boolean): void {
  yawDeg = 0
  rollDeg = 0
  objectLift = 0
  if (keep3dLean) {
    if (tiltDeg === 0 && !choseAngle) {
      tiltDeg = DEFAULT_DEGREES
      choseAngle = true
    }
  } else {
    tiltDeg = 0
  }
  applyOrientation()
}

/** After leaving 屏風: neutral turn/spin; flat wall or standard default 3D lean. */
export function applyStandardWallExit(exitTo3d: boolean): void {
  yawDeg = 0
  rollDeg = 0
  objectLift = 0
  if (exitTo3d) {
    tiltDeg = DEFAULT_DEGREES
    choseAngle = true
  } else {
    tiltDeg = 0
  }
  applyOrientation()
  boundViewer?.forceRedraw()
}

/** Sheet angles driving the wall CSS transform (3D lean and/or flat in-plane spin). */
export function readWallSheetPose(): { tilt: number; yaw: number; roll: number } | null {
  const root = tiltRoot()
  if (!root) return null
  const wall3d =
    root.classList.contains('is-wall-tilt') || root.classList.contains('is-wall-tilt-settle')
  const roll2d = !!document.getElementById('viewer')?.classList.contains('is-wall-roll-2d')
  if (!wall3d && !roll2d) return null
  const style = getComputedStyle(root)
  const tilt = parseFloat(style.getPropertyValue('--wall-tilt'))
  const yaw = parseFloat(style.getPropertyValue('--wall-yaw'))
  const roll = parseFloat(style.getPropertyValue('--wall-roll'))
  const rollVal = Number.isFinite(roll) ? roll : rollDeg
  if (!wall3d) return { tilt: 0, yaw: 0, roll: rollVal }
  return {
    tilt: Number.isFinite(tilt) ? tilt : tiltDeg,
    yaw: Number.isFinite(yaw) ? yaw : yawDeg,
    roll: rollVal,
  }
}

function readSheetPose(): { tilt: number; yaw: number; roll: number } | null {
  const root = tiltRoot()
  if (!root) return null
  const active = root.classList.contains('is-wall-tilt') || root.classList.contains('is-wall-tilt-settle')
  if (!active) return null
  return readWallSheetPose()
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
  roll = 0,
  /** Lift along the sheet’s outward normal before perspective (layout-px scale). */
  zOffset = 0,
): Pt {
  const ox = wallOrigin?.x ?? width / 2
  const oy = wallOrigin?.y ?? height
  const ty = ((scale - 1) * height) / 2
  let px = (x - ox) * scale
  let py = (y - oy) * scale + ty
  const rollR = (roll * Math.PI) / 180
  const cr = Math.cos(rollR)
  const sr = Math.sin(rollR)
  const xr = px * cr - py * sr
  const yr = px * sr + py * cr
  px = xr
  py = yr
  let pz = zOffset * scale
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

/**
 * Container pixel → wall-space pixel for the sheet's CURRENT pose, read from
 * the live CSS variables so mid-transition frames project correctly. Identity
 * when the sheet is flat. UI that anchors to wall space (province billboard)
 * projects through this every frame.
 *
 * @param zOffset Lift along local +Z before perspective (same 3D path as CSS).
 */
export function projectSheetPoint(x: number, y: number, zOffset = 0): Pt | null {
  const el = boundViewer?.element
  const root = tiltRoot()
  if (!el || !root) return null
  const w = el.clientWidth
  const h = el.clientHeight
  if (w < 2 || h < 2) return null
  const tilted =
    root.classList.contains('is-wall-tilt') || root.classList.contains('is-wall-tilt-settle')
  const flatRoll = document.getElementById('viewer')?.classList.contains('is-wall-roll-2d') ?? false
  if (!tilted && !flatRoll) return zOffset === 0 ? { x, y } : { x, y }
  const style = getComputedStyle(root)
  const num = (name: string, fallback: number): number => {
    const v = parseFloat(style.getPropertyValue(name))
    return Number.isFinite(v) ? v : fallback
  }
  const roll = num('--wall-roll', rollDeg)
  if (!tilted) return projectOnWall(x, y, w, h, 1, 0, 0, roll, zOffset)
  const p = projectOnWall(
    x,
    y,
    w,
    h,
    num('--wall-object-scale', objectScale),
    num('--wall-tilt', tiltDeg),
    num('--wall-yaw', yawDeg),
    roll,
    zOffset,
  )
  p.y += num('--wall-object-lift', objectLift)
  return p
}

/** Lift along local +Z before perspective — same units as {@link projectSheetPoint}'s `zOffset`. */
export const SHEET_LABEL_NORMAL_OFFSET = 14

/** Wall-space step per +1 model Z at a container anchor (direction only; length varies with pose). */
export function sheetZWallDelta(containerX: number, containerY: number): Pt | null {
  const p0 = projectSheetPoint(containerX, containerY, 0)
  const p1 = projectSheetPoint(containerX, containerY, 1)
  if (!p0 || !p1) return null
  return { x: p1.x - p0.x, y: p1.y - p0.y }
}

/**
 * Screen px → layout px for a layer (e.g. wall-label-layer). On `/atlab` the
 * root `scale()` shrinks getBoundingClientRect; billboard `left`/`top` use layout.
 */
export function wallLayerLayoutScale(layer: HTMLElement): number {
  const rect = layer.getBoundingClientRect()
  if (!(rect.width > 1) || !(layer.clientWidth > 1)) return 1
  return layer.clientWidth / rect.width
}

/** Layout pixels on the wall for one screen pixel. Ignores the sheet transform. */
function layoutPerScreen(): number {
  const stage = document.getElementById('atlab') ?? host
  if (!stage) return 1
  return wallLayerLayoutScale(stage)
}

/**
 * Screen drag → container-pixel pan whose on-screen result is that same drag.
 * Inverting the sheet's projection keeps the motion across the wall, not along the face.
 */
function localDeltaForScreen(screenDx: number, screenDy: number, at: Pt): Pt {
  const scaleToLayout = layoutPerScreen()
  const lx = screenDx * scaleToLayout
  const ly = screenDy * scaleToLayout
  const pose = readSheetPose()
  const el = host
  if (!pose || !el) return { x: lx, y: ly }
  const w = el.clientWidth
  const h = el.clientHeight
  const eps = 1
  const p = (x: number, y: number) => projectOnWall(x, y, w, h, objectScale, pose.tilt, pose.yaw, pose.roll)
  const origin = p(at.x, at.y)
  const ox = p(at.x + eps, at.y)
  const oy = p(at.x, at.y + eps)
  const j00 = (ox.x - origin.x) / eps
  const j10 = (ox.y - origin.y) / eps
  const j01 = (oy.x - origin.x) / eps
  const j11 = (oy.y - origin.y) / eps
  const det = j00 * j11 - j01 * j10
  if (Math.abs(det) < 1e-4) return { x: lx, y: ly }
  return {
    x: (j11 * lx - j01 * ly) / det,
    y: (-j10 * lx + j00 * ly) / det,
  }
}

/** Change in the angle between two fingers, in degrees. Positive spins the sheet. */
function fingerTwist(
  lastA: { x: number; y: number },
  lastB: { x: number; y: number },
  nowA: { x: number; y: number },
  nowB: { x: number; y: number },
): number {
  const before = Math.atan2(lastB.y - lastA.y, lastB.x - lastA.x)
  const after = Math.atan2(nowB.y - nowA.y, nowB.x - nowA.x)
  let turn = after - before
  if (turn > Math.PI) turn -= Math.PI * 2
  if (turn < -Math.PI) turn += Math.PI * 2
  return (turn * 180) / Math.PI
}

function clampFace(deg: number): number {
  return Math.min(MAX_FACE_DEG, Math.max(-MAX_FACE_DEG, deg))
}

function isByobuChrome(): boolean {
  return document.getElementById('app')?.classList.contains('byobu-mode') ?? false
}

/** Pearl uses lateral turn while 折 is on — yaw/tilt, not in-plane roll on the 屏風. */
function pearlLateralMode(shiftKey: boolean): boolean {
  return shiftKey || (isByobuChrome() && rotationEnabled)
}

/**
 * Drag right spins the map flat, in its own plane. That spin has no stop, so
 * the map turns across 360° and upside down. Drag down leans it back, and
 * Shift-drag turns it laterally. Lean and the lateral turn stop at ±76.5°, so
 * the back never faces the room. The flat spin also works while the 3D lean is off.
 */
function nudgeRotation(dx: number, dy: number, lateral = false): void {
  if (lateral) {
    if (!rotationEnabled) return
    yawDeg = clampFace(yawDeg + dx * DEG_PER_PX)
    tiltDeg = clampFace(tiltDeg + dy * DEG_PER_PX)
  } else {
    rollDeg += dx * DEG_PER_PX
    if (rotationEnabled) tiltDeg = clampFace(tiltDeg + dy * DEG_PER_PX)
  }
  applyOrientation()
}

function applyOrientation(): void {
  const root = tiltRoot()
  if (!root) return
  root.style.setProperty('--wall-tilt', `${tiltDeg.toFixed(2)}deg`)
  root.style.setProperty('--wall-yaw', `${yawDeg.toFixed(2)}deg`)
  root.style.setProperty('--wall-roll', `${rollDeg.toFixed(2)}deg`)
  syncFlatRoll()
  const orb = document.getElementById('wall-tilt-orb')
  if (!orb) return
  const hx = Math.min(68, Math.max(12, 32 - yawDeg * 0.28))
  const hy = Math.min(70, Math.max(10, 26 + tiltDeg * 0.22))
  orb.style.setProperty('--orb-hx', `${hx}%`)
  orb.style.setProperty('--orb-hy', `${hy}%`)
  orb.setAttribute('aria-valuetext', `${Math.round(tiltDeg)}° / ${Math.round(yawDeg)}° / ${Math.round(rollDeg)}°`)
  scheduleWallChrome()
}

/** Geometric centre of the visible map, in container pixels. Every spin pivots there. */
function visibleMapCenter(): Pt | null {
  const viewer = boundViewer
  if (!viewer || viewer.world.getItemCount() < 1) return null
  const item = viewer.world.getItemAt(0)
  if (!item) return null
  const el = viewer.element
  const width = el.clientWidth
  const height = el.clientHeight
  if (width < 2 || height < 2) return null
  const b = item.getBounds()
  const tl = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(b.x, b.y), true)
  const br = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(b.x + b.width, b.y + b.height), true)
  const left = Math.max(0, Math.min(tl.x, br.x))
  const right = Math.min(width, Math.max(tl.x, br.x))
  const top = Math.max(0, Math.min(tl.y, br.y))
  const bottom = Math.min(height, Math.max(tl.y, br.y))
  if (!(right > left) || !(bottom > top)) return { x: width / 2, y: height / 2 }
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

/** Pin the transform origin to the visible map centre so zoom and pan keep the pivot. */
function syncWallOrigin(): void {
  const app = tiltRoot()
  if (!app) return
  const c = visibleMapCenter()
  if (!c) return
  wallOrigin = c
  app.style.setProperty('--wall-origin-x', `${c.x.toFixed(1)}px`)
  app.style.setProperty('--wall-origin-y', `${c.y.toFixed(1)}px`)
}

/** Keep the 2D flat spin on its own class so it survives the 3D lean toggling off. */
function syncFlatRoll(): void {
  const viewer = document.getElementById('viewer')
  if (!viewer) return
  viewer.classList.toggle('is-wall-roll-2d', !rotationEnabled && Math.abs(rollDeg) > 0.001)
  syncWallOrigin()
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
      if (!rotationEnabled && event.shiftKey) return
      orb.classList.add('is-grabbing')
      releaseSettle()
    }
    if (!rotationEnabled && event.shiftKey) return
    nudgeRotation(dx, dy, pearlLateralMode(event.shiftKey))
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
    const lateral = pearlLateralMode(event.shiftKey)
    if (!rotationEnabled && (event.shiftKey || event.key === 'ArrowUp' || event.key === 'ArrowDown')) return
    const step = event.shiftKey ? 8 : 3
    const px = step / DEG_PER_PX
    if (event.key === 'ArrowLeft') nudgeRotation(-px, 0, lateral)
    else if (event.key === 'ArrowRight') nudgeRotation(px, 0, lateral)
    else if (event.key === 'ArrowUp') nudgeRotation(0, -px, lateral)
    else if (event.key === 'ArrowDown') nudgeRotation(0, px, lateral)
    else return
    event.preventDefault()
  })

  applyOrientation()
}

/**
 * On the ATLab wall, float chrome in the gutters just outside the scan.
 * Rules are in docs/ui-zoom-frame.md: 2D zoom still expands the frame, and
 * tilt may only contract its width. The pearl stays left of the badges until
 * it meets the wall, then crosses to their right. Normal mode never sets these.
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

/**
 * While zooming in, remember a horizontal contraction so a later step cannot
 * spread the frame wider than that again. Height is never stored here.
 */
let chromeWidthHold: { scale: number; width: number; floor: number; narrowing: boolean; tilt: number; yaw: number; roll: number } | null = null
/** Tallest upright frame while rotated. Zooming out does not shorten it. */
let chromeVerticalHold: { top: number; bottom: number } | null = null

function chromeScale(app: HTMLElement): number {
  if (app.classList.contains('is-wall-scale-settle')) {
    const n = parseFloat(getComputedStyle(app).getPropertyValue('--wall-object-scale'))
    if (Number.isFinite(n) && n > 0) return n
  }
  return rotationEnabled ? objectScale : 1
}

/** Viewer layout pixel → #app layout pixel, ignoring the sheet's CSS tilt. */
function viewerPointToApp(el: HTMLElement, app: HTMLElement, x: number, y: number): Pt {
  let px = x
  let py = y
  let node: HTMLElement | null = el
  while (node && node !== app) {
    px += node.offsetLeft
    py += node.offsetTop
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null
  }
  return { x: px, y: py }
}

/**
 * Home-size scan corners in #app layout pixels, before zoom and tilt.
 */
function sheetCorners(app: HTMLElement): SheetQuad | null {
  const viewer = boundViewer
  if (!viewer || viewer.world.getItemCount() < 1) return null
  const item = viewer.world.getItemAt(0)
  if (!item) return null
  const el = viewer.element
  const width = el.clientWidth
  const height = el.clientHeight
  if (width < 2 || height < 2 || app.clientWidth < 2 || app.clientHeight < 2) return null

  const image = item.getBounds()
  const home = viewer.viewport.getHomeBounds()
  if (!(home.width > 0) || !(home.height > 0)) return null
  const toPixel = (x: number, y: number): Pt => ({
    x: ((x - home.x) / home.width) * width,
    y: ((y - home.y) / home.height) * height,
  })
  const tl = toPixel(image.x, image.y)
  const br = toPixel(image.x + image.width, image.y + image.height)
  return {
    tl,
    tr: { x: br.x, y: tl.y },
    br,
    bl: { x: tl.x, y: br.y },
  }
}

/** Flat map rectangle at the current viewport zoom, in #app layout pixels. */
function flatViewportFrame(app: HTMLElement): SheetQuad | null {
  const viewer = boundViewer
  if (!viewer || viewer.world.getItemCount() < 1) return null
  const item = viewer.world.getItemAt(0)
  if (!item) return null
  const image = item.getBounds()
  const toApp = (vx: number, vy: number): Pt => {
    const px = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(vx, vy), true)
    return viewerPointToApp(viewer.element, app, px.x, px.y)
  }
  const tl = toApp(image.x, image.y)
  const br = toApp(image.x + image.width, image.y + image.height)
  if (![tl.x, tl.y, br.x, br.y].every(Number.isFinite)) return null
  return {
    tl,
    tr: { x: br.x, y: tl.y },
    br,
    bl: { x: tl.x, y: br.y },
  }
}

/** Upright sheet at `scale`, before tilt. This is the 2D zoom frame. */
function uprightScaledFrame(home: SheetQuad, app: HTMLElement, scale: number): SheetQuad {
  const w = app.clientWidth
  const h = app.clientHeight
  const p = (pt: Pt) => projectOnWall(pt.x, pt.y, w, h, scale, 0, 0)
  return { tl: p(home.tl), tr: p(home.tr), br: p(home.br), bl: p(home.bl) }
}

/**
 * Pull the upright frame's left and right edges inward to the tilted sheet.
 * Top and bottom stay on the upright zoom frame. The result is never wider
 * than that frame, and a zoom-in that already narrowed it does not spread it.
 */
function contractHorizontally(
  app: HTMLElement,
  home: SheetQuad,
  upright: SheetQuad,
  scale: number,
  pose: { tilt: number; yaw: number; roll: number },
): SheetQuad {
  const w = app.clientWidth
  const h = app.clientHeight
  const rawTop = Math.min(upright.tl.y, upright.bl.y)
  const rawBottom = Math.max(upright.br.y, upright.tr.y)
  if (!chromeVerticalHold) chromeVerticalHold = { top: rawTop, bottom: rawBottom }
  else {
    chromeVerticalHold = {
      top: Math.min(chromeVerticalHold.top, rawTop),
      bottom: Math.max(chromeVerticalHold.bottom, rawBottom),
    }
  }
  const top = chromeVerticalHold.top
  const bottom = chromeVerticalHold.bottom
  const uL = Math.min(upright.tl.x, upright.bl.x)
  const uR = Math.max(upright.tr.x, upright.br.x)
  const uprightWidth = uR - uL
  const full: SheetQuad = {
    tl: { x: uL, y: top },
    tr: { x: uR, y: top },
    br: { x: uR, y: bottom },
    bl: { x: uL, y: bottom },
  }
  if (!(uprightWidth > 1)) return full

  let minX = Infinity
  let maxX = -Infinity
  for (const p of [home.tl, home.tr, home.br, home.bl]) {
    const q = projectOnWall(p.x, p.y, w, h, scale, pose.tilt, pose.yaw, pose.roll)
    if (!Number.isFinite(q.x)) continue
    minX = Math.min(minX, q.x)
    maxX = Math.max(maxX, q.x)
  }
  let left = Number.isFinite(minX) ? Math.max(minX, uL) : uL
  let right = Number.isFinite(maxX) ? Math.min(maxX, uR) : uR
  if (right - left < 1) {
    left = uL
    right = uR
  }

  const rawWidth = right - left
  const prev = chromeWidthHold
  const zoomingIn = prev != null && scale > prev.scale + 0.001
  const zoomingOut = prev != null && scale < prev.scale - 0.001
  const poseChanged =
    prev != null &&
    (Math.abs(pose.tilt - prev.tilt) > 0.4 ||
      Math.abs(pose.yaw - prev.yaw) > 0.4 ||
      Math.abs(pose.roll - prev.roll) > 0.4)
  let narrowing = !poseChanged && (prev?.narrowing ?? false)
  let floor = prev?.floor ?? rawWidth
  let width = rawWidth
  if (!prev || zoomingOut || poseChanged) {
    narrowing = false
    floor = rawWidth
  } else if (zoomingIn) {
    if (rawWidth <= prev.width + 1) {
      narrowing = true
      floor = rawWidth
    } else if (narrowing && rawWidth > floor) {
      width = floor
    } else {
      floor = rawWidth
    }
  } else if (narrowing && rawWidth > floor) {
    width = floor
  } else {
    floor = Math.min(floor, rawWidth)
  }
  width = Math.min(width, uprightWidth)
  chromeWidthHold = { scale, width, floor, narrowing, tilt: pose.tilt, yaw: pose.yaw, roll: pose.roll }

  const mid = (left + right) / 2
  let heldLeft = mid - width / 2
  let heldRight = mid + width / 2
  if (heldRight - heldLeft > uprightWidth) {
    heldLeft = uL
    heldRight = uR
  } else if (heldLeft < uL) {
    heldRight += uL - heldLeft
    heldLeft = uL
  } else if (heldRight > uR) {
    heldLeft -= heldRight - uR
    heldRight = uR
  }
  return {
    tl: { x: heldLeft, y: top },
    tr: { x: heldRight, y: top },
    br: { x: heldRight, y: bottom },
    bl: { x: heldLeft, y: bottom },
  }
}

/**
 * 2D: the live map rectangle, so zoom expands and contracts the controls.
 * Rotated: that same upright zoom frame, with only the width pulled inward.
 * A horizontal pan slides the frame with the sheet and leaves its height alone.
 */
function zoomFrame(app: HTMLElement): SheetQuad | null {
  const home = sheetCorners(app)
  if (!home) return null
  const pose = readSheetPose()
  if (!pose) {
    chromeWidthHold = null
    chromeVerticalHold = null
    return flatViewportFrame(app) ?? home
  }
  const scale = chromeScale(app)
  const frame = contractHorizontally(app, home, uprightScaledFrame(home, app, scale), scale, pose)
  const slide = sheetSlideX(app, home, scale, pose)
  if (Math.abs(slide) < 0.5) return frame
  const shift = (p: Pt): Pt => ({ x: p.x + slide, y: p.y })
  return { tl: shift(frame.tl), tr: shift(frame.tr), br: shift(frame.br), bl: shift(frame.bl) }
}

/** How far a pan moves the sheet horizontally, in #app pixels. */
function sheetSlideX(
  app: HTMLElement,
  home: SheetQuad,
  scale: number,
  pose: { tilt: number; yaw: number; roll: number },
): number {
  const viewer = boundViewer
  if (!viewer || viewer.world.getItemCount() < 1) return 0
  const item = viewer.world.getItemAt(0)
  if (!item) return 0
  const image = item.getBounds()
  const origin = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(image.x, image.y), true)
  const dx = origin.x - home.tl.x
  const dy = origin.y - home.tl.y
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return 0
  const w = app.clientWidth
  const h = app.clientHeight
  const project = (x: number, y: number) => projectOnWall(x, y, w, h, scale, pose.tilt, pose.yaw, pose.roll)
  const corners = [home.tl, home.tr, home.br, home.bl]
  let sum = 0
  for (const p of corners) sum += project(p.x + dx, p.y + dy).x - project(p.x, p.y).x
  return sum / corners.length
}

function placeAtlabWallChrome(): void {
  const app = document.getElementById('app')
  if (!app?.closest('.atlab-wall')) return
  const frame = zoomFrame(app)
  if (!frame) return
  const width = app.clientWidth
  const height = app.clientHeight
  const { tl, tr, br, bl } = frame
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

  const toolbar = document.getElementById('toolbar')
  if (toolbar) {
    const barH = toolbar.offsetHeight
    const barW = Math.max(toolbar.offsetWidth, 52)
    const pearlReserve = 54 + 1.85 * rem
    const barTop = clamp(Math.max(tl.y, 0) + rem, 0, Math.max(0, height - barH))
    const edge = outerX(barTop, barTop + barH, tl, bl)
    const outward = edge <= (tl.x + br.x) / 2 ? -1 : 1
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
    const abovePlaques = plaqueH > 0 ? plaqueBottom + plaqueH + 0.75 * rem : height - bl.y + gap
    const bottom = clamp(abovePlaques, gap, Math.max(gap, height - stampH))
    const stampTop = height - bottom - Math.max(stampH, 1)
    const edge = outerX(stampTop, stampTop + Math.max(stampH, 1), tl, bl)
    const outward = edge <= (tl.x + br.x) / 2 ? -1 : 1
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
  if (minimap && !minimap.classList.contains('is-dragging')) {
    const gap = 1.25 * rem
    const elW = minimap.offsetWidth
    const elH = minimap.offsetHeight
    miniBottom = clamp(height - br.y + gap, 0, Math.max(0, height - elH))
    const elTop = height - miniBottom - elH
    const edge = outerX(elTop, elTop + Math.max(elH, 1), tr, br)
    const outward = edge >= centerX ? 1 : -1
    const face = edge + outward * gap
    const left = clamp(outward > 0 ? face : face - elW, 0, Math.max(0, width - elW))
    app.style.setProperty('--wall-minimap-right', `${(width - left - elW).toFixed(1)}px`)
    app.style.setProperty('--wall-minimap-bottom', `${miniBottom.toFixed(1)}px`)
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
