import type { TiledImage, Viewer } from 'openseadragon'
import seaBlocsFile from '../../data/sea-blocs.json'
import { MAP_ASPECT } from '../config'
import { SEA_UNDERLAY_FADE_MS, startSeaUnderlay, type SeaUnderlayHandle } from '../viewer/seaUnderlay'

const LAND_URL = '/land/map-land.webp?v=21'
const WAVE_ORIGINAL = '/patterns/wave-seigaiha.jpg?v=2'
/** Default tile aspect (height / width) for wave-seigaiha.jpg */
const WAVE_TILE_ASPECT = 608 / 704
const DRIFT_MS = 36_000
/**
 * Bitmap ceiling: half the exhibition floor (3536×2400).
 * The canvas CSS box stays full-bleed; the compositor stretches this texture.
 * Size from getBoundingClientRect (after the fit scale), never from clientWidth —
 * clientWidth is the unscaled 3536px layout box.
 */
const MAX_BUFFER_W = 1768
const MAX_BUFFER_H = 1200
const LITE_BANDS = 3

type FadeY = 'both' | 'top' | 'bottom'

type SeaBloc = {
  id: number
  name: string
  x0: number
  y0: number
  x1: number
  y1: number
  tileFrac: number
  tileFracEnd?: number
  wave?: string
  waveAspect?: number
  phase?: number
  drift?: number
  opacity?: number
  fadeY?: FadeY
}

type WaveQuad = {
  texture: WebGLTexture
  tileFrac: number
  patH: number
  originX: number
  phase: number
  drift: number
  opacity: number
  /** 0 none, 1 bottom, 2 top, 3 both */
  fade: number
  y0: number
  y1: number
  vertexOffset: number
}

const BLOCS = seaBlocsFile.blocs as SeaBloc[]

/** Same band split as the wall SVG lite path (3 strips, overlapping fades). */
function expandWavelengthBands(blocs: SeaBloc[], bands: number): SeaBloc[] {
  const OVERLAP = 0.22
  const out: SeaBloc[] = []
  for (const b of blocs) {
    const end = b.tileFracEnd
    if (end == null || Math.abs(end - b.tileFrac) < 1e-9) {
      out.push(b)
      continue
    }
    const span = b.y1 - b.y0
    const step = span / bands
    const pad = step * OVERLAP
    for (let i = 0; i < bands; i++) {
      const t = (i + 0.5) / bands
      const frac = b.tileFrac + (end - b.tileFrac) * t
      const y0 = Math.max(b.y0, b.y0 + i * step - (i > 0 ? pad : 0))
      const y1 = Math.min(b.y1, b.y0 + (i + 1) * step + (i < bands - 1 ? pad : 0))
      const fadeY: FadeY = i === 0 ? 'bottom' : i === bands - 1 ? 'top' : 'both'
      out.push({
        ...b,
        name: `${b.name} ·${i + 1}`,
        y0,
        y1,
        tileFrac: frac,
        tileFracEnd: undefined,
        fadeY,
        opacity: b.opacity,
      })
    }
  }
  return out
}

function waveUrl(name: string | undefined): string {
  if (!name || name === 'wave-seigaiha.jpg') return WAVE_ORIGINAL
  return `/patterns/${name}?v=2`
}

function fadeCode(fade: FadeY | undefined): number {
  if (fade === 'bottom') return 1
  if (fade === 'top') return 2
  if (fade === 'both') return 3
  return 0
}

function bufferSize(host: HTMLElement): { w: number; h: number } | null {
  const rect = host.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w0 = Math.round(rect.width * dpr)
  const h0 = Math.round(rect.height * dpr)
  if (w0 < 2 || h0 < 2) return null
  const scale = Math.min(1, MAX_BUFFER_W / w0, MAX_BUFFER_H / h0)
  return {
    w: Math.max(2, Math.round(w0 * scale)),
    h: Math.max(2, Math.round(h0 * scale)),
  }
}

function waitForImgElement(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) {
    return img.decode?.().catch(() => undefined) ?? Promise.resolve()
  }
  return new Promise((resolve) => {
    const done = () => {
      void (img.decode?.().catch(() => undefined) ?? Promise.resolve()).then(() => resolve())
    }
    img.addEventListener('load', done, { once: true })
    img.addEventListener('error', () => resolve(), { once: true })
  })
}

const VERT = `
attribute vec2 a_map;
varying vec2 v_map;
void main() {
  v_map = a_map;
  gl_Position = vec4(a_map.x * 2.0 - 1.0, 1.0 - a_map.y * 2.0, 0.0, 1.0);
}
`

const FRAG = `
precision mediump float;
varying vec2 v_map;
uniform sampler2D u_tex;
uniform float u_tileFrac;
uniform float u_patH;
uniform float u_originX;
uniform float u_phase;
uniform float u_opacity;
uniform float u_fade;
uniform float u_y0;
uniform float u_y1;

float bandFade(float t, float mode) {
  if (mode < 0.5) return 1.0;
  if (mode < 1.5) return 1.0 - clamp((t - 0.78) / 0.22, 0.0, 1.0);
  if (mode < 2.5) return clamp(t / 0.22, 0.0, 1.0);
  float topIn = clamp(t / 0.18, 0.0, 1.0);
  float botIn = clamp((1.0 - t) / 0.18, 0.0, 1.0);
  return min(topIn, botIn);
}

void main() {
  float u = fract((v_map.x - u_originX) / u_tileFrac - u_phase);
  float v = fract(v_map.y / u_patH);
  vec3 rgb = texture2D(u_tex, vec2(u, v)).rgb;
  float t = (v_map.y - u_y0) / max(0.0001, u_y1 - u_y0);
  float a = bandFade(clamp(t, 0.0, 1.0), u_fade) * u_opacity;
  gl_FragColor = vec4(rgb * a, a);
}
`

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[atlab floor] wave shader', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(url))
    img.src = url
  })
}

/**
 * Floor ocean only. Draws each sea bloc into a small WebGL bitmap and lets CSS
 * stretch it across the 3536×2400 band. The wall keeps {@link startSeaUnderlay}.
 * If the context cannot be created, the floor falls back to that SVG path.
 */
export function startFloorSea(
  viewer: Viewer,
  opts: { host: HTMLElement; onReady?: () => void },
): SeaUnderlayHandle {
  const host = opts.host
  const onReady = opts.onReady
  let svgFallback: SeaUnderlayHandle | null = null
  let stopped = false
  let raf = 0
  let unloadTimer = 0
  let removeTimer = 0
  let listening = false
  let onLayout: (() => void) | null = null
  let onAdd: (() => void) | null = null

  const root = document.createElement('div')
  root.className = 'sea-underlay is-lite is-floor is-pinned is-gpu'
  root.setAttribute('aria-hidden', 'true')

  const canvas = document.createElement('canvas')
  canvas.className = 'sea-underlay-waves-canvas'
  root.append(canvas)

  const land = document.createElement('img')
  land.className = 'sea-underlay-land'
  land.alt = ''
  land.draggable = false
  land.decoding = 'async'
  land.src = LAND_URL
  root.append(land)

  host.prepend(root)

  const gl =
    canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    }) ??
    (canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    }) as WebGLRenderingContext | null)

  const detach = () => {
    cancelAnimationFrame(raf)
    raf = 0
    window.clearTimeout(unloadTimer)
    window.clearTimeout(removeTimer)
    if (!listening || !onLayout || !onAdd) return
    listening = false
    window.removeEventListener('resize', onLayout)
    window.removeEventListener('qing-atlab-layout', onLayout)
    viewer.world.removeHandler('add-item', onAdd)
  }

  const fallback = () => {
    if (stopped || svgFallback) return
    detach()
    root.remove()
    svgFallback = startSeaUnderlay(viewer, {
      lite: true,
      host,
      onReady,
    })
  }

  if (!gl) {
    fallback()
    return {
      stop: () => {
        stopped = true
        svgFallback?.stop()
      },
    }
  }

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG)
  const program = vert && frag ? gl.createProgram() : null
  if (!program || !vert || !frag) {
    fallback()
    return {
      stop: () => {
        stopped = true
        svgFallback?.stop()
      },
    }
  }
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.bindAttribLocation(program, 0, 'a_map')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[atlab floor] wave program', gl.getProgramInfoLog(program))
    fallback()
    return {
      stop: () => {
        stopped = true
        svgFallback?.stop()
      },
    }
  }

  const uTex = gl.getUniformLocation(program, 'u_tex')
  const uTile = gl.getUniformLocation(program, 'u_tileFrac')
  const uPatH = gl.getUniformLocation(program, 'u_patH')
  const uOrigin = gl.getUniformLocation(program, 'u_originX')
  const uPhase = gl.getUniformLocation(program, 'u_phase')
  const uOpacity = gl.getUniformLocation(program, 'u_opacity')
  const uFade = gl.getUniformLocation(program, 'u_fade')
  const uY0 = gl.getUniformLocation(program, 'u_y0')
  const uY1 = gl.getUniformLocation(program, 'u_y1')

  const buffer = gl.createBuffer()
  if (!buffer) {
    fallback()
    return {
      stop: () => {
        stopped = true
        svgFallback?.stop()
      },
    }
  }

  let quads: WaveQuad[] = []
  let driftOrigin = performance.now()
  const preferStill =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const worldOpacities: number[] = []
  const textures = new Map<string, WebGLTexture>()

  const introBusy = () => document.getElementById('app')?.classList.contains('intro-active') === true

  const wrapPhase = (phase: number, drift: number, cycles: number) => {
    let p = (phase + cycles * drift) % 1
    if (p < 0) p += 1
    return p
  }

  const draw = (cycles: number) => {
    const w = canvas.width
    const h = canvas.height
    if (w < 2 || h < 2) return
    gl.viewport(0, 0, w, h)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(uTex, 0)
    gl.activeTexture(gl.TEXTURE0)
    for (const quad of quads) {
      gl.bindTexture(gl.TEXTURE_2D, quad.texture)
      gl.uniform1f(uTile, quad.tileFrac)
      gl.uniform1f(uPatH, quad.patH)
      gl.uniform1f(uOrigin, quad.originX)
      gl.uniform1f(uPhase, wrapPhase(quad.phase, quad.drift, cycles))
      gl.uniform1f(uOpacity, quad.opacity)
      gl.uniform1f(uFade, quad.fade)
      gl.uniform1f(uY0, quad.y0)
      gl.uniform1f(uY1, quad.y1)
      gl.drawArrays(gl.TRIANGLES, quad.vertexOffset, 6)
    }
  }

  const cyclesAt = (now: number) => (preferStill ? 0 : (now - driftOrigin) / DRIFT_MS)

  const applyBufferSize = () => {
    const next = bufferSize(host)
    if (!next) return false
    if (canvas.width === next.w && canvas.height === next.h) return true
    canvas.width = next.w
    canvas.height = next.h
    return true
  }

  const tick = (now: number) => {
    if (stopped || svgFallback) return
    raf = requestAnimationFrame(tick)
    if (preferStill || introBusy()) return
    if (!applyBufferSize()) return
    draw(cyclesAt(now))
  }

  onLayout = () => {
    if (stopped || svgFallback) return
    if (!applyBufferSize()) return
    draw(cyclesAt(performance.now()))
  }

  const fadeWorld = (opacity: number) => {
    const n = viewer.world.getItemCount()
    for (let i = 0; i < n; i++) {
      const item = viewer.world.getItemAt(i) as TiledImage | null
      if (!item) continue
      if (worldOpacities[i] == null) worldOpacities[i] = item.getOpacity()
      item.setOpacity(opacity)
    }
  }

  const restoreWorld = () => {
    const n = viewer.world.getItemCount()
    for (let i = 0; i < n; i++) {
      const item = viewer.world.getItemAt(i) as TiledImage | null
      if (!item) continue
      item.setOpacity(worldOpacities[i] ?? 1)
    }
    try {
      viewer.forceRedraw()
    } catch {
      /* ignore */
    }
  }

  onAdd = () => {
    if (!stopped && worldOpacities.length > 0) fadeWorld(0)
  }
  viewer.world.addHandler('add-item', onAdd)
  window.addEventListener('resize', onLayout)
  window.addEventListener('qing-atlab-layout', onLayout)
  listening = true

  const stopGpu = () => {
    if (stopped) return
    stopped = true
    detach()
    root.classList.remove('is-visible', 'is-settled')
    restoreWorld()
    removeTimer = window.setTimeout(() => {
      root.remove()
      const lose = gl.getExtension('WEBGL_lose_context')
      lose?.loseContext()
    }, SEA_UNDERLAY_FADE_MS)
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    if (!stopped) fallback()
  })

  const bands = expandWavelengthBands(BLOCS, LITE_BANDS)
  const urls = [...new Set(bands.map((bloc) => waveUrl(bloc.wave)))]

  void Promise.all([Promise.all(urls.map(loadImage)), waitForImgElement(land)])
    .then(([images]) => {
      if (stopped || svgFallback) return
      const byUrl = new Map(urls.map((url, i) => [url, images[i]!]))
      const verts: number[] = []
      const built: WaveQuad[] = []

      for (const bloc of bands) {
        const url = waveUrl(bloc.wave)
        let texture = textures.get(url)
        if (!texture) {
          const img = byUrl.get(url)
          if (!img) throw new Error(url)
          const created = gl.createTexture()
          if (!created) throw new Error('texture')
          gl.bindTexture(gl.TEXTURE_2D, created)
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          texture = created
          textures.set(url, created)
        }
        const tileFrac = bloc.tileFrac
        const aspect = bloc.waveAspect ?? WAVE_TILE_ASPECT
        const patH = tileFrac * MAP_ASPECT * aspect
        const vertexOffset = verts.length / 2
        const { x0, y0, x1, y1 } = bloc
        verts.push(x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1)
        built.push({
          texture,
          tileFrac,
          patH,
          originX: bloc.x0,
          phase: bloc.phase ?? 0,
          drift: bloc.drift ?? 1,
          opacity: bloc.opacity ?? 0.95,
          fade: fadeCode(bloc.fadeY),
          y0,
          y1,
          vertexOffset,
        })
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW)
      quads = built
      driftOrigin = performance.now()

      let revealTries = 0
      const reveal = () => {
        if (stopped || svgFallback) return
        if (!applyBufferSize()) {
          revealTries += 1
          if (revealTries < 90) {
            requestAnimationFrame(reveal)
            return
          }
          canvas.width = MAX_BUFFER_W
          canvas.height = MAX_BUFFER_H
        }
        draw(0)
        console.info(`[atlab floor] wave buffer ${canvas.width}×${canvas.height}`)
        root.classList.add('is-visible')
        try {
          onReady?.()
        } catch {
          /* caller errors must not break the underlay */
        }
        window.clearTimeout(unloadTimer)
        unloadTimer = window.setTimeout(() => {
          if (stopped) return
          fadeWorld(0)
          root.classList.add('is-settled')
        }, SEA_UNDERLAY_FADE_MS)
      }

      reveal()

      if (!preferStill) raf = requestAnimationFrame(tick)
    })
    .catch((error) => {
      console.warn('[atlab floor] wave GPU failed, using SVG', error)
      fallback()
    })

  return {
    stop: () => {
      if (svgFallback) {
        stopped = true
        svgFallback.stop()
        return
      }
      stopGpu()
    },
  }
}
