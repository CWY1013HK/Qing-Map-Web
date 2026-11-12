import byobuConfig from '../../data/byobu.json'
import { MAP_ASPECT } from '../config'
import {
  readVisibleMapWallQuad,
  readWallByobuSync,
  readWallOrientationDegrees,
  type WallByobuSync,
  type WallMapQuad,
} from './wallTilt'

type Mat4 = Float32Array

const VERT = `
attribute vec3 a_pos;
attribute vec2 a_uv;
uniform mat4 u_mvp;
varying vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}
`

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
uniform vec2 u_uvBounds;
uniform float u_frame;
void main() {
  vec2 uv = vec2(mix(u_uvBounds.x, u_uvBounds.y, v_uv.x), v_uv.y);
  vec4 col = texture2D(u_tex, uv);
  float du = min(v_uv.x, 1.0 - v_uv.x) * (u_uvBounds.y - u_uvBounds.x);
  float dv = min(v_uv.y, 1.0 - v_uv.y);
  float edge = min(du, dv);
  if (edge < u_frame) {
    float t = smoothstep(0.0, u_frame, edge);
    col.rgb *= mix(0.35, 1.0, t);
  }
  gl_FragColor = col;
}
`

/** Phased 折 intro: room matte → crease fold → orbit to inspection pose. */
export type ByobuTransitionChannels = {
  /** Master timeline 0–1. */
  timeline: number
  /** Room backdrop + wall matte. */
  room: number
  /** Accordion crease amount. */
  crease: number
  /** Wall pose → 屏風 inspection orbit. */
  orbit: number
  /** 屏風 panel edge / hinge matte (WebGL only). */
  frame: number
}

export type ByobuScreenOptions = {
  onTransition?: (channels: ByobuTransitionChannels) => void
  /** Flat map snapshot at enter (current zoom / wall pose). */
  mapSnapshot?: HTMLCanvasElement | null
}

export type ByobuScreenHandle = {
  stop: () => void
  setOrbitYaw: (deg: number) => void
  snapPearlBaseline: () => void
  animateFold: (target: number, ms?: number) => Promise<void>
}

export const DEFAULT_BYOBU_TRANSITION_MS = 1680

/** Room / matte, then crease, then inspection orbit (no overlap). */
const PHASE_ROOM_END = 0.22
const PHASE_FOLD_END = 0.66

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

export function byobuTransitionChannels(timeline: number): ByobuTransitionChannels {
  const t = clamp01(timeline)
  let room = 0
  let crease = 0
  let orbit = 0
  let frame = 0

  if (t <= PHASE_ROOM_END) {
    const u = t / PHASE_ROOM_END
    const e = easeOutCubic(u)
    room = e
    frame = e
  } else if (t <= PHASE_FOLD_END) {
    room = 1
    frame = 1
    const u = (t - PHASE_ROOM_END) / (PHASE_FOLD_END - PHASE_ROOM_END)
    crease = easeInOutCubic(u)
  } else {
    room = 1
    frame = 1
    crease = 1
    const u = (t - PHASE_FOLD_END) / (1 - PHASE_FOLD_END)
    orbit = easeInOutCubic(u)
  }

  return { timeline: t, room, crease, orbit, frame }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[byobu]', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(url))
    img.src = url
  })
}

/** Column-major 4×4 multiply (WebGL `uniformMatrix4fv` layout). */
function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r]! * b[c * 4 + 0]! +
        a[1 * 4 + r]! * b[c * 4 + 1]! +
        a[2 * 4 + r]! * b[c * 4 + 2]! +
        a[3 * 4 + r]! * b[c * 4 + 3]!
    }
  }
  return o
}

function mat4Ident(): Mat4 {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

function mat4Trans(x: number, y: number, z: number): Mat4 {
  const m = mat4Ident()
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

function mat4Scale(x: number, y: number, z: number): Mat4 {
  const m = mat4Ident()
  m[0] = x
  m[5] = y
  m[10] = z
  return m
}

function mat4RotY(deg: number): Mat4 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const m = mat4Ident()
  m[0] = c
  m[2] = -s
  m[8] = s
  m[10] = c
  return m
}

function mat4RotX(deg: number): Mat4 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const m = mat4Ident()
  m[5] = c
  m[6] = s
  m[9] = -s
  m[10] = c
  return m
}

function mat4RotZ(deg: number): Mat4 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const m = mat4Ident()
  m[0] = c
  m[1] = s
  m[4] = -s
  m[5] = c
  return m
}

/** CSS degrees → scene (WebGL Y-up) — negate so rotateX/Y match `projectOnWall` / the wall sheet. */
function cssDegreesToScene(tilt: number, yaw: number, roll: number): { tilt: number; yaw: number; roll: number } {
  return { tilt: -tilt, yaw: -yaw, roll: -roll }
}

/** Match CSS `rotateX` → `rotateY` → `rotateZ` about the wall transform-origin. Angles are CSS degrees. */
function wallSheetModelRot(
  tilt: number,
  yaw: number,
  roll: number,
  pivotX: number,
  pivotY: number,
): Mat4 {
  const { tilt: rx, yaw: ry, roll: rz } = cssDegreesToScene(tilt, yaw, roll)
  const rot = mat4Mul(mat4RotX(rx), mat4Mul(mat4RotY(ry), mat4RotZ(rz)))
  return mat4Mul(mat4Trans(pivotX, pivotY, 0), mat4Mul(rot, mat4Trans(-pivotX, -pivotY, 0)))
}

function wallPivotInScene(mapW: number, mapH: number, sync: ReturnType<typeof readWallByobuSync>): {
  x: number
  y: number
} {
  if (!sync) return { x: 0, y: 0 }
  return {
    x: (sync.originX / sync.viewerW - 0.5) * mapW,
    y: (0.5 - sync.originY / sync.viewerH) * mapH,
  }
}

type NdcBounds = { minX: number; maxX: number; minY: number; maxY: number }

function ndcFromMvp(mvp: Mat4, x: number, y: number, z: number): { x: number; y: number } | null {
  const w =
    mvp[3]! * x + mvp[7]! * y + mvp[11]! * z + mvp[15]!
  if (!(w > 1e-5)) return null
  return {
    x: (mvp[0]! * x + mvp[4]! * y + mvp[8]! * z + mvp[12]!) / w,
    y: (mvp[1]! * x + mvp[5]! * y + mvp[9]! * z + mvp[13]!) / w,
  }
}

function boundsOfFlatMap(mvp: Mat4, scene: Mat4, mapW: number, mapH: number): NdcBounds | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const corner of [
    [0, 0, 0],
    [mapW, 0, 0],
    [mapW, mapH, 0],
    [0, mapH, 0],
  ] as const) {
    const world = transformPoint(scene, corner[0], corner[1], corner[2])
    const ndc = ndcFromMvp(mvp, world.x, world.y, world.z)
    if (!ndc) continue
    minX = Math.min(minX, ndc.x)
    maxX = Math.max(maxX, ndc.x)
    minY = Math.min(minY, ndc.y)
    maxY = Math.max(maxY, ndc.y)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, maxX, minY, maxY }
}

function ndcRectToScreenFraction(b: NdcBounds): {
  cx: number
  cy: number
  w: number
  h: number
} {
  return {
    cx: (b.minX + b.maxX) * 0.25 + 0.5,
    cy: 0.5 - (b.minY + b.maxY) * 0.25,
    w: (b.maxX - b.minX) * 0.5,
    h: (b.maxY - b.minY) * 0.5,
  }
}

function buildWallSceneAtEnter(
  wall: WallByobuSync | null,
  mapW: number,
  mapH: number,
  layoutScene: Mat4,
): Mat4 {
  if (!wall) return layoutScene
  const pivot = wallPivotInScene(mapW, mapH, wall)
  const wallM = wallSheetModelRot(wall.tilt, wall.yaw, wall.roll, pivot.x, pivot.y)
  return mat4Mul(wallM, layoutScene)
}

function wallLiftInScene(wall: WallByobuSync | null, mapH: number, wallW: number): number {
  if (!wall?.wall3d || wall.viewerH < 1) return 0
  return (-wall.objectLiftPx / wall.viewerH) * mapH * 0.5 * wallW
}

function projectedMapFraction(
  proj: Mat4,
  camDist: number,
  panX: number,
  panY: number,
  liftY: number,
  scene: Mat4,
  mapW: number,
  mapH: number,
): ReturnType<typeof ndcRectToScreenFraction> | null {
  const view = mat4Trans(panX, panY + liftY, -camDist)
  const mvp = mat4Mul(proj, view)
  const bounds = boundsOfFlatMap(mvp, scene, mapW, mapH)
  if (!bounds) return null
  return ndcRectToScreenFraction(bounds)
}

/** Pan in scene units so the flat map matches a screen-space target (same stack as `tick` at orbit 0). */
function solveFlatWallPan(
  proj: Mat4,
  camDist: number,
  scene: Mat4,
  mapW: number,
  mapH: number,
  targetCx: number,
  targetCy: number,
  liftY: number,
  seedPanX: number,
  seedPanY: number,
  fovYRad: number,
  aspect: number,
): { panX: number; panY: number } {
  let panX = seedPanX
  let panY = seedPanY
  const spanX = camDist * Math.tan(fovYRad / 2) * aspect * 2
  const spanY = camDist * Math.tan(fovYRad / 2) * 2
  for (let i = 0; i < 14; i++) {
    const frac = projectedMapFraction(proj, camDist, panX, panY, liftY, scene, mapW, mapH)
    if (!frac) break
    panX += (targetCx - frac.cx) * spanX
    panY -= (targetCy - frac.cy) * spanY
  }
  return { panX, panY }
}

/**
 * Match flat 屏風 projection to the live wall map quad (scale + pan in scene units).
 */
function fitFlatToWallQuad(
  quad: WallMapQuad,
  mapW: number,
  mapH: number,
  layoutScene: Mat4,
  wall: WallByobuSync | null,
  aspect: number,
  fovY: number,
  baseCamDist: number,
): { zoom: number; panX: number; panY: number } {
  const scene = buildWallSceneAtEnter(wall, mapW, mapH, layoutScene)
  const liftY = wallLiftInScene(wall, mapH, 1)
  const targetCx = quad.cx / quad.viewerW
  const targetCy = quad.cy / quad.viewerH
  const targetW = quad.width / quad.viewerW
  const targetH = quad.height / quad.viewerH

  let bestZoom = 1
  let bestPanX = 0
  let bestPanY = 0
  let bestErr = Infinity

  for (let zi = 0; zi < 48; zi++) {
    const zoom = 0.4 + (3.2 * zi) / 47
    const camDist = baseCamDist / zoom
    const view = mat4Trans(0, 0, -camDist)
    const proj = mat4Perspective(fovY, aspect, 0.08, 120)
    const mvp = mat4Mul(proj, view)
    const bounds = boundsOfFlatMap(mvp, scene, mapW, mapH)
    if (!bounds) continue
    const frac = ndcRectToScreenFraction(bounds)
    const errSize = Math.abs(frac.h - targetH) + Math.abs(frac.w - targetW) * 0.35
    if (errSize < bestErr) {
      bestErr = errSize
      bestZoom = zoom
    }
  }

  const camDist = baseCamDist / bestZoom
  let panErr = Infinity
  for (let pi = 0; pi < 32; pi++) {
    for (let pj = 0; pj < 32; pj++) {
      const panX = -mapW * 0.9 + ((mapW * 1.8) * pi) / 31
      const panY = -mapH * 0.9 + ((mapH * 1.8) * pj) / 31
      const view = mat4Trans(panX, panY + liftY, -camDist)
      const proj = mat4Perspective(fovY, aspect, 0.08, 120)
      const mvp = mat4Mul(proj, view)
      const bounds = boundsOfFlatMap(mvp, scene, mapW, mapH)
      if (!bounds) continue
      const frac = ndcRectToScreenFraction(bounds)
      const err = (frac.cx - targetCx) ** 2 + (frac.cy - targetCy) ** 2
      if (err < panErr) {
        panErr = err
        bestPanX = panX
        bestPanY = panY
      }
    }
  }

  const refined = solveFlatWallPan(
    mat4Perspective(fovY, aspect, 0.08, 120),
    camDist,
    scene,
    mapW,
    mapH,
    targetCx,
    targetCy,
    liftY,
    bestPanX,
    bestPanY,
    fovY,
    aspect,
  )

  return { zoom: bestZoom, panX: refined.panX, panY: refined.panY }
}

function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovY / 2)
  const rangeInv = 1 / (near - far)
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (near + far) * rangeInv,
    -1,
    0,
    0,
    near * far * rangeInv * 2,
    0,
  ])
}

/** UV splits; nudges each crease away from u=0.5 by a fixed map-pixel offset. */
function panelBoundaries(
  creases: number[],
  count: number,
  centrePx = 0,
  mapWidthPx = 9219,
): number[] {
  let inner: number[]
  if (creases.length === count - 1) {
    inner = [...creases]
  } else {
    const step = 1 / count
    inner = []
    for (let i = 1; i < count; i++) inner.push(i * step)
  }
  if (centrePx > 0 && mapWidthPx > 0) {
    const du = centrePx / mapWidthPx
    inner = inner
      .map((u) => {
        if (Math.abs(u - 0.5) < 1e-6) return u
        return u + (u < 0.5 ? -du : du)
      })
      .sort((a, b) => a - b)
  }
  return [0, ...inner, 1]
}

type Pt3 = { x: number; y: number; z: number }

const VIEW_FOV_Y_RAD = (42 * Math.PI) / 180
/** Extra inspection pitch on the camera after wall pose leaves the model (0 = keep wall tilt only). */
const VIEW_PITCH_DEG = 0

function transformPoint(m: Mat4, x: number, y: number, z: number): Pt3 {
  return {
    x: m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    y: m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    z: m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  }
}

type FoldedLayout = {
  centre: Pt3
  /** Panel corners after shifting the accordion centroid to the origin. */
  centered: Pt3[]
  scene: Mat4
}

function foldedLayout(
  mapW: number,
  mapH: number,
  bounds: number[],
  signs: readonly number[],
  foldDeg: number,
  panelCount: number,
  /** When set, folds stay pivoted like the flat map instead of chasing the accordion centroid. */
  fixedCentre: Pt3 | null = null,
): FoldedLayout {
  const base = mat4Trans(-mapW / 2, -mapH / 2, 0)
  let chain = mat4Ident()
  const pts: Pt3[] = []

  for (let i = 0; i < panelCount; i++) {
    const u0 = bounds[i]!
    const u1 = bounds[i + 1]!
    const pw = (u1 - u0) * mapW
    if (i > 0) {
      chain = mat4Mul(chain, mat4RotY(signs[i - 1]! * foldDeg))
    }
    const model = mat4Mul(base, chain)
    for (const corner of [
      [0, 0, 0],
      [pw, 0, 0],
      [pw, mapH, 0],
      [0, mapH, 0],
    ] as const) {
      pts.push(transformPoint(model, corner[0], corner[1], corner[2]))
    }
    chain = mat4Mul(chain, mat4Trans(pw, 0, 0))
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  const centre = fixedCentre ?? {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  }
  const scene = mat4Trans(-mapW / 2 - centre.x, -mapH / 2 - centre.y, -centre.z)
  const centered = pts.map((p) => ({
    x: p.x - centre.x,
    y: p.y - centre.y,
    z: p.z - centre.z,
  }))
  return { centre, centered, scene }
}

function cameraDistance(centered: Pt3[], aspect: number, fovYRad: number): number {
  let maxX = 0
  let maxY = 0
  for (const p of centered) {
    maxX = Math.max(maxX, Math.abs(p.x))
    maxY = Math.max(maxY, Math.abs(p.y))
  }
  const tan = Math.tan(fovYRad / 2)
  const distV = maxY / tan
  const distH = maxX / (tan * aspect)
  return Math.max(distV, distH, 0.01) * 1.12
}

/**
 * WebGL eight-panel 屏風. Crease positions come from data/byobu.json
 * (default: equal eighths matching physical fold lines on the scan).
 */
export function startByobuScreen(host: HTMLElement, options?: ByobuScreenOptions): ByobuScreenHandle {
  const root = document.createElement('div')
  root.className = 'byobu-screen'
  root.setAttribute('aria-hidden', 'true')

  const canvas = document.createElement('canvas')
  canvas.className = 'byobu-screen-canvas'
  root.append(canvas)
  host.append(root)

  const cfg = byobuConfig as {
    panelCount: number
    foldDegrees: number
    hingeSigns: number[]
    creases: number[]
    creaseCentrePx?: number
    mapWidthPx?: number
    textureUrl: string
  }
  const creaseCentrePx = cfg.creaseCentrePx ?? 0
  const mapWidthPx = cfg.mapWidthPx ?? 9219

  let gl: WebGLRenderingContext | null = null
  let program: WebGLProgram | null = null
  let texture: WebGLTexture | null = null
  let buffer: WebGLBuffer | null = null
  let uMvp: WebGLUniformLocation | null = null
  let uTex: WebGLUniformLocation | null = null
  let uUvBounds: WebGLUniformLocation | null = null
  let uFrame: WebGLUniformLocation | null = null
  let raf = 0
  let stopped = false
  let orbitYaw = 0
  let panX = 0
  let panY = 0
  let userZoom = 1
  let dragX = 0
  let dragY = 0
  let dragging = false
  let shiftOrbit = false
  let textureReady = false
  let timeline = 0
  let foldAnimFrame = 0
  const clampZoom = (z: number) => Math.max(0.45, Math.min(2.8, z))

  const enterSync: WallByobuSync | null = readWallByobuSync()
  const snap = options?.mapSnapshot
  const mapContentAspect =
    snap && snap.width > 1 && snap.height > 1 ? snap.width / snap.height : MAP_ASPECT
  const hostAspect =
    host.clientWidth > 1 && host.clientHeight > 1
      ? host.clientWidth / host.clientHeight
      : mapContentAspect

  const cfgBounds = panelBoundaries(cfg.creases, cfg.panelCount, creaseCentrePx, mapWidthPx)
  const flatMapH = 2
  const flatMapW = flatMapH * mapContentAspect
  const flatLayout = foldedLayout(
    flatMapW,
    flatMapH,
    cfgBounds,
    cfg.hingeSigns,
    0,
    cfg.panelCount,
  )
  const fitCamBase = cameraDistance(flatLayout.centered, hostAspect, VIEW_FOV_Y_RAD)
  const wallQuad = readVisibleMapWallQuad()
  const wallFit = wallQuad
    ? fitFlatToWallQuad(
        wallQuad,
        flatMapW,
        flatMapH,
        flatLayout.scene,
        enterSync,
        hostAspect,
        VIEW_FOV_Y_RAD,
        fitCamBase,
      )
    : { zoom: 1, panX: 0, panY: 0 }

  const foldedLayout0 = foldedLayout(
    flatMapW,
    flatMapH,
    cfgBounds,
    cfg.hingeSigns,
    (byobuConfig as { foldDegrees: number }).foldDegrees,
    cfg.panelCount,
  )
  const inspectCamBase = cameraDistance(foldedLayout0.centered, hostAspect, VIEW_FOV_Y_RAD)
  const inspectFramingZoom = clampZoom(
    (enterSync?.objectScale ?? 1) * (fitCamBase / inspectCamBase),
  )

  let framingZoom = clampZoom(wallFit.zoom)
  let framingPanX = wallFit.panX
  let framingPanY = wallFit.panY
  let framingRefitted = false
  const pearlEnter = { ...readWallOrientationDegrees() }
  const snapPearlBaseline = () => {
    const p = readWallOrientationDegrees()
    pearlEnter.tilt = p.tilt
    pearlEnter.yaw = p.yaw
    pearlEnter.roll = p.roll
  }
  const enterTilt = enterSync?.tilt ?? pearlEnter.tilt
  const enterYaw = enterSync?.yaw ?? pearlEnter.yaw
  const enterRoll = enterSync?.roll ?? pearlEnter.roll
  /** Flat-map centroid — held through room/fold so creases don’t drag the sheet across the wall. */
  const flatCentreAnchor: Pt3 = { ...flatLayout.centre }

  const publishTimeline = (t: number) => {
    timeline = clamp01(t)
    options?.onTransition?.(byobuTransitionChannels(timeline))
  }
  publishTimeline(0)

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * 0.0012)
    userZoom = clampZoom(userZoom * factor)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    dragging = true
    shiftOrbit = e.shiftKey
    dragX = e.clientX
    dragY = e.clientY
    root.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - dragX
    const dy = e.clientY - dragY
    dragX = e.clientX
    dragY = e.clientY
    if (e.shiftKey || shiftOrbit) {
      orbitYaw += dx * 0.22
      return
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const activeZoom =
      framingZoom + (inspectFramingZoom - framingZoom) * byobuTransitionChannels(timeline).orbit
    const scale = (0.0032 / dpr) * (2 / (activeZoom * userZoom))
    panX += dx * scale
    panY -= dy * scale
  }
  const onPointerUp = (e: PointerEvent) => {
    dragging = false
    shiftOrbit = false
    try {
      root.releasePointerCapture(e.pointerId)
    } catch {
      /* released */
    }
  }

  root.addEventListener('wheel', onWheel, { passive: false })
  root.addEventListener('pointerdown', onPointerDown)
  root.addEventListener('pointermove', onPointerMove)
  root.addEventListener('pointerup', onPointerUp)
  root.addEventListener('pointercancel', onPointerUp)

  const fail = (): ByobuScreenHandle => {
    root.remove()
    return {
      stop: () => {},
      setOrbitYaw: () => {},
      snapPearlBaseline: () => {},
      animateFold: async () => {},
    }
  }

  gl =
    canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
    }) ?? null
  if (!gl) return fail()

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG)
  if (!vert || !frag) return fail()

  program = gl.createProgram()
  if (!program) return fail()
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.bindAttribLocation(program, 0, 'a_pos')
  gl.bindAttribLocation(program, 1, 'a_uv')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[byobu]', gl.getProgramInfoLog(program))
    return fail()
  }

  uMvp = gl.getUniformLocation(program, 'u_mvp')
  uTex = gl.getUniformLocation(program, 'u_tex')
  uUvBounds = gl.getUniformLocation(program, 'u_uvBounds')
  uFrame = gl.getUniformLocation(program, 'u_frame')
  buffer = gl.createBuffer()

  const quadVerts = new Float32Array([
    0, 0, 0, 0, 0,
    1, 0, 0, 1, 0,
    1, 1, 0, 1, 1,
    0, 0, 0, 0, 0,
    1, 1, 0, 1, 1,
    0, 1, 0, 0, 1,
  ])

  const uploadRaster = (source: TexImageSource) => {
    if (stopped || !gl) return
    if (!texture) texture = gl.createTexture()
    if (!texture) return
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    textureReady = true
  }

  if (snap && snap.width > 1 && snap.height > 1) {
    try {
      uploadRaster(snap)
    } catch {
      textureReady = false
    }
  }
  if (!textureReady) {
    void loadImage(cfg.textureUrl)
      .then((img) => {
        if (stopped || textureReady) return
        uploadRaster(img)
      })
      .catch(() => {
        textureReady = false
      })
  }

  const resize = () => {
    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }

  const tick = () => {
    if (stopped || !gl || !program || !buffer) return
    resize()
    const w = canvas.width
    const h = canvas.height
    if (w < 2 || h < 2) {
      raf = requestAnimationFrame(tick)
      return
    }

    gl.viewport(0, 0, w, h)
    gl.enable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12)

    const channels = byobuTransitionChannels(timeline)
    gl.uniform1f(uFrame, 0.009 * channels.frame)

    const aspect = w / h
    const proj = mat4Perspective(VIEW_FOV_Y_RAD, aspect, 0.08, 120)

    const mapH = 2
    const mapW = mapH * mapContentAspect
    const bounds = panelBoundaries(cfg.creases, cfg.panelCount, creaseCentrePx, mapWidthPx)
    const signs = cfg.hingeSigns
    const foldDeg = cfg.foldDegrees * channels.crease
    const orbitT = channels.orbit
    const dynamicLayout = foldedLayout(
      mapW,
      mapH,
      bounds,
      signs,
      foldDeg,
      cfg.panelCount,
      null,
    )
    const anchorCentre: Pt3 = {
      x: flatCentreAnchor.x + (dynamicLayout.centre.x - flatCentreAnchor.x) * orbitT,
      y: flatCentreAnchor.y + (dynamicLayout.centre.y - flatCentreAnchor.y) * orbitT,
      z: flatCentreAnchor.z + (dynamicLayout.centre.z - flatCentreAnchor.z) * orbitT,
    }
    const layout = foldedLayout(
      mapW,
      mapH,
      bounds,
      signs,
      foldDeg,
      cfg.panelCount,
      anchorCentre,
    )
    if (!framingRefitted && wallQuad && enterSync) {
      const refit = fitFlatToWallQuad(
        wallQuad,
        flatMapW,
        flatMapH,
        flatLayout.scene,
        enterSync,
        aspect,
        VIEW_FOV_Y_RAD,
        fitCamBase,
      )
      framingZoom = clampZoom(refit.zoom)
      framingPanX = refit.panX
      framingPanY = refit.panY
      framingRefitted = true
    }

    const activeFramingZoom =
      framingZoom + (inspectFramingZoom - framingZoom) * orbitT
    const framingBounds = orbitT > 0 ? layout.centered : flatLayout.centered
    const camDist =
      cameraDistance(framingBounds, aspect, VIEW_FOV_Y_RAD) / (activeFramingZoom * userZoom)

    const wall = enterSync
    const pivot = wallPivotInScene(mapW, mapH, wall)
    const pearl = readWallOrientationDegrees()
    const wallW = 1 - orbitT
    const glDelta = cssDegreesToScene(
      pearl.tilt - pearlEnter.tilt,
      pearl.yaw - pearlEnter.yaw,
      pearl.roll - pearlEnter.roll,
    )

    let scene = layout.scene
    const liftY = wallLiftInScene(wall, mapH, wallW)

    if (wall && wallW > 0) {
      scene = mat4Mul(
        wallSheetModelRot(enterTilt * wallW, enterYaw * wallW, enterRoll * wallW, pivot.x, pivot.y),
        scene,
      )
    }

    let wallPanX = framingPanX
    let wallPanY = framingPanY
    const atFlatWall = orbitT < 1e-5 && channels.crease < 1e-5
    if (atFlatWall && wallQuad && enterSync) {
      const flatScene = buildWallSceneAtEnter(enterSync, mapW, mapH, flatLayout.scene)
      const targetCx = wallQuad.cx / wallQuad.viewerW
      const targetCy = wallQuad.cy / wallQuad.viewerH
      const solved = solveFlatWallPan(
        proj,
        camDist,
        flatScene,
        mapW,
        mapH,
        targetCx,
        targetCy,
        liftY,
        framingPanX,
        framingPanY,
        VIEW_FOV_Y_RAD,
        aspect,
      )
      wallPanX = solved.panX
      wallPanY = solved.panY
      framingPanX = wallPanX
      framingPanY = wallPanY
    }

    const activePanX = wallPanX + (panX - wallPanX) * orbitT
    const activePanY = wallPanY + (panY - wallPanY) * orbitT

    // Orbit eases wall lean off the sheet; inspection stays upright — pearl deltas only on the camera.
    const viewPitch = VIEW_PITCH_DEG + glDelta.tilt * orbitT
    const viewYaw = (glDelta.yaw + orbitYaw) * orbitT
    const viewRoll = glDelta.roll * orbitT
    const orient = mat4Mul(mat4RotX(viewPitch), mat4Mul(mat4RotY(viewYaw), mat4RotZ(viewRoll)))
    const view = mat4Mul(mat4Trans(activePanX, activePanY + liftY, -camDist), orient)

    if (textureReady && texture) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(uTex, 0)
    }

    let chain = mat4Ident()

    for (let i = 0; i < cfg.panelCount; i++) {
      const u0 = bounds[i]!
      const u1 = bounds[i + 1]!
      const pw = (u1 - u0) * mapW
      if (i > 0) {
        chain = mat4Mul(chain, mat4RotY(signs[i - 1]! * foldDeg))
      }

      const model = mat4Mul(scene, mat4Mul(chain, mat4Scale(pw, mapH, 1)))
      const mvp = mat4Mul(proj, mat4Mul(view, model))
      gl.uniformMatrix4fv(uMvp, false, mvp)
      gl.uniform2f(uUvBounds, u0, u1)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      chain = mat4Mul(chain, mat4Trans(pw, 0, 0))
    }

    raf = requestAnimationFrame(tick)
  }

  const onResize = () => resize()
  window.addEventListener('resize', onResize)
  resize()
  raf = requestAnimationFrame(tick)

  const animateFold = (target: number, ms = DEFAULT_BYOBU_TRANSITION_MS): Promise<void> => {
    const goal = clamp01(target)
    if (prefersReducedMotion() || ms <= 0) {
      publishTimeline(goal)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      if (foldAnimFrame) cancelAnimationFrame(foldAnimFrame)
      const from = timeline
      const start = performance.now()
      const run = (now: number) => {
        const u = Math.min(1, (now - start) / ms)
        publishTimeline(from + (goal - from) * easeInOutCubic(u))
        if (u >= 1) {
          foldAnimFrame = 0
          resolve()
          return
        }
        foldAnimFrame = requestAnimationFrame(run)
      }
      foldAnimFrame = requestAnimationFrame(run)
    })
  }

  return {
    stop: () => {
      stopped = true
      if (foldAnimFrame) cancelAnimationFrame(foldAnimFrame)
      foldAnimFrame = 0
      cancelAnimationFrame(raf)
      raf = 0
      window.removeEventListener('resize', onResize)
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerup', onPointerUp)
      root.removeEventListener('pointercancel', onPointerUp)
      root.remove()
      if (texture && gl) gl.deleteTexture(texture)
      if (buffer && gl) gl.deleteBuffer(buffer)
      if (program && gl) gl.deleteProgram(program)
    },
    setOrbitYaw: (deg: number) => {
      orbitYaw = deg
    },
    snapPearlBaseline,
    animateFold,
  }
}
