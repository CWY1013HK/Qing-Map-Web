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

/** World-space centre of the folded accordion (panel corners). */
function foldedScreenCentre(
  mapW: number,
  mapH: number,
  bounds: number[],
  signs: readonly number[],
  foldDeg: number,
  panelCount: number,
): Pt3 {
  const scene = mat4Trans(-mapW / 2, -mapH / 2, 0)
  let chain = mat4Ident()
  const pts: Pt3[] = []

  const transformPoint = (m: Mat4, x: number, y: number, z: number): Pt3 => ({
    x: m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    y: m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    z: m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  })

  for (let i = 0; i < panelCount; i++) {
    const u0 = bounds[i]!
    const u1 = bounds[i + 1]!
    const pw = (u1 - u0) * mapW
    if (i > 0) {
      chain = mat4Mul(chain, mat4RotY(signs[i - 1]! * foldDeg))
    }
    const model = mat4Mul(scene, chain)
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

  let x = 0
  let y = 0
  let z = 0
  for (const p of pts) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = pts.length || 1
  return { x: x / n, y: y / n, z: z / n }
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
  let dragX = 0
  let dragging = false
  let textureReady = false

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    dragging = true
    dragX = e.clientX
    root.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    orbitYaw += (e.clientX - dragX) * 0.22
    dragX = e.clientX
  }
  const onPointerUp = () => {
    dragging = false
  }

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
    const proj = mat4Perspective((44 * Math.PI) / 180, aspect, 0.08, 120)
    const pose = readWallSheetPose()
    const wallTilt = pose?.tilt ?? 32
    const wallYaw = pose?.yaw ?? 0

    const mapH = 2
    const mapW = mapH * MAP_ASPECT
    const bounds = panelBoundaries(cfg.creases, cfg.panelCount)
    const signs = cfg.hingeSigns
    const centre = foldedScreenCentre(
      mapW,
      mapH,
      bounds,
      signs,
      cfg.foldDegrees,
      cfg.panelCount,
    )

    const view = mat4Mul(
      mat4Mul(
        mat4RotY(orbitYaw + wallYaw * 0.35),
        mat4RotX(12 + wallTilt * 0.22),
      ),
      mat4Trans(0, -0.25, -mapW * 0.72),
    )
    const scene = mat4Mul(
      mat4RotX(wallTilt * 0.38),
      mat4Trans(-mapW / 2 - centre.x, -mapH / 2 - centre.y, -centre.z),
    )

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
