import byobuConfig from '../../data/byobu.json'
import { MAP_ASPECT } from '../config'
import { readWallSheetPose } from './wallTilt'

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

export type ByobuScreenHandle = {
  stop: () => void
  setOrbitYaw: (deg: number) => void
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

function panelBoundaries(creases: number[], count: number): number[] {
  if (creases.length === count - 1) return [0, ...creases, 1]
  const step = 1 / count
  const out = [0]
  for (let i = 1; i < count; i++) out.push(i * step)
  out.push(1)
  return out
}

type Pt3 = { x: number; y: number; z: number }

const VIEW_FOV_Y_RAD = (42 * Math.PI) / 180
/** Gentle downward gaze so the 屏風 fills the wall band. */
const VIEW_PITCH_DEG = 5

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
  const centre = {
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
export function startByobuScreen(host: HTMLElement): ByobuScreenHandle {
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
    textureUrl: string
  }

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
  let zoom = 1
  let dragX = 0
  let dragY = 0
  let dragging = false
  let shiftOrbit = false
  let textureReady = false

  const clampZoom = (z: number) => Math.max(0.45, Math.min(2.8, z))

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * 0.0012)
    zoom = clampZoom(zoom * factor)
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
    const scale = (0.0032 / dpr) * (2 / zoom)
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
    return { stop: () => {}, setOrbitYaw: () => {} }
  }

  gl =
    canvas.getContext('webgl', {
      alpha: false,
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

  void loadImage(cfg.textureUrl)
    .then((img) => {
      if (stopped || !gl) return
      texture = gl.createTexture()
      if (!texture) return
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      textureReady = true
    })
    .catch(() => {
      textureReady = false
    })

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
    gl.clearColor(0.77, 0.84, 0.89, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12)
    gl.uniform1f(uFrame, 0.006)

    const aspect = w / h
    const proj = mat4Perspective(VIEW_FOV_Y_RAD, aspect, 0.08, 120)

    const mapH = 2
    const mapW = mapH * MAP_ASPECT
    const bounds = panelBoundaries(cfg.creases, cfg.panelCount)
    const signs = cfg.hingeSigns
    const layout = foldedLayout(
      mapW,
      mapH,
      bounds,
      signs,
      cfg.foldDegrees,
      cfg.panelCount,
    )
    const camDist = cameraDistance(layout.centered, aspect, VIEW_FOV_Y_RAD) / zoom

    const sheet = readWallSheetPose()
    const viewYaw = orbitYaw + (sheet?.yaw ?? 0)
    const viewPitch = VIEW_PITCH_DEG + (sheet?.tilt ?? 0)
    const viewRoll = sheet?.roll ?? 0
    // Same X→Y→Z order as the wall sheet CSS (--wall-tilt / --wall-yaw / --wall-roll).
    const orient = mat4Mul(mat4RotX(viewPitch), mat4Mul(mat4RotY(viewYaw), mat4RotZ(viewRoll)))
    const view = mat4Mul(mat4Trans(panX, panY, -camDist), orient)
    const scene = layout.scene

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
        chain = mat4Mul(chain, mat4RotY(signs[i - 1]! * cfg.foldDegrees))
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

  return {
    stop: () => {
      stopped = true
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
  }
}
