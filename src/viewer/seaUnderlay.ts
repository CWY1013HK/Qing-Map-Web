import OpenSeadragon, { type Viewer, type TiledImage } from 'openseadragon'
import seaBlocsFile from '../../data/sea-blocs.json'

const LAND_URL = '/land/map-land.webp?v=20'
/** Canonical seigaiha tile — default for seas 1 & 3. */
const WAVE_ORIGINAL = '/patterns/wave-seigaiha.jpg'
const FADE_MS = 650
const DRIFT_MS = 36_000
/** Default tile aspect (height / width) for wave-seigaiha.jpg */
const WAVE_TILE_ASPECT = 608 / 704
/** Map preview aspect (width / height) — needed for SVG userSpace Y scale */
const MAP_ASPECT = 9219 / 5258

type SeaBloc = {
  id: number
  name: string
  x0: number
  y0: number
  x1: number
  y1: number
  tileFrac: number
  /** If set, wavelength lerps from tileFrac (top) → tileFracEnd (bottom). */
  tileFracEnd?: number
  /** Optional alternate tile; falls back to the original seigaiha. */
  wave?: string
  /** height/width of that tile; defaults to WAVE_TILE_ASPECT */
  waveAspect?: number
  phase?: number
  drift?: number
  opacity?: number
  /** Soft vertical fade for gradient bands: both | top | bottom. */
  fadeY?: 'both' | 'top' | 'bottom'
}

const BLOCS = seaBlocsFile.blocs as SeaBloc[]

/** Split a bloc with tileFracEnd into overlapping strips for a Y wavelength ramp. */
function expandWavelengthBands(blocs: SeaBloc[]): SeaBloc[] {
  const BANDS = 8
  const OVERLAP = 0.22
  const out: SeaBloc[] = []
  for (const b of blocs) {
    const end = b.tileFracEnd
    if (end == null || Math.abs(end - b.tileFrac) < 1e-9) {
      out.push(b)
      continue
    }
    const span = b.y1 - b.y0
    const step = span / BANDS
    const pad = step * OVERLAP
    for (let i = 0; i < BANDS; i++) {
      const t = (i + 0.5) / BANDS
      const frac = b.tileFrac + (end - b.tileFrac) * t
      const y0 = Math.max(b.y0, b.y0 + i * step - (i > 0 ? pad : 0))
      const y1 = Math.min(b.y1, b.y0 + (i + 1) * step + (i < BANDS - 1 ? pad : 0))
      const fadeY: SeaBloc['fadeY'] =
        i === 0 ? 'bottom' : i === BANDS - 1 ? 'top' : 'both'
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

type DriftPat = {
  el: SVGPatternElement
  tileFrac: number
  phase: number
  drift: number
  /** Pattern origin X — lock to bloc left so scaled bands share one clean cut. */
  originX: number
}

export type SeaUnderlayHandle = {
  stop: () => void
}

function waveUrl(name: string | undefined): string {
  if (!name || name === 'wave-seigaiha.jpg') return WAVE_ORIGINAL
  return `/patterns/${name}`
}

/**
 * Wave underlay split into numbered ocean blocs, plus a land plate with
 * transparent seas. Patterns live in map userSpace so they stay locked while
 * OSD springs the viewport.
 */
export function startSeaUnderlay(viewer: Viewer): SeaUnderlayHandle {
  const root = document.createElement('div')
  root.className = 'sea-underlay'
  root.setAttribute('aria-hidden', 'true')

  const waveSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  waveSvg.setAttribute('viewBox', '0 0 1 1')
  waveSvg.setAttribute('preserveAspectRatio', 'none')
  waveSvg.classList.add('sea-underlay-waves-svg')

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  waveSvg.append(defs)

  const patterns: DriftPat[] = []
  const waveBlocs = expandWavelengthBands(BLOCS)

  waveBlocs.forEach((bloc, i) => {
    const tileFrac = bloc.tileFrac
    const phase = bloc.phase ?? (i * 0.17) % 1
    const drift = bloc.drift ?? 1
    const opacity = bloc.opacity ?? 0.95
    const aspect = bloc.waveAspect ?? WAVE_TILE_ASPECT
    const patH = tileFrac * MAP_ASPECT * aspect
    const primaryUrl = waveUrl(bloc.wave)
    // Anchor tiles at the bloc's left edge so wavelength bands don't stair-step.
    const originX = bloc.x0

    const pid = `sea-wave-pat-${bloc.id}-${i}`
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
    pattern.setAttribute('id', pid)
    pattern.setAttribute('patternUnits', 'userSpaceOnUse')
    pattern.setAttribute('width', String(tileFrac))
    pattern.setAttribute('height', String(patH))
    pattern.setAttribute(
      'patternTransform',
      `translate(${originX + phase * tileFrac} 0)`,
    )

    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    img.setAttribute('href', primaryUrl)
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', primaryUrl)
    img.setAttribute('x', '0')
    img.setAttribute('y', '0')
    img.setAttribute('width', String(tileFrac))
    img.setAttribute('height', String(patH))
    img.setAttribute('preserveAspectRatio', 'none')
    pattern.append(img)
    defs.append(pattern)
    patterns.push({ el: pattern, tileFrac, phase, drift, originX })

    // Second pass: same art, different scale/phase — breaks obvious tiling.
    const useOwnAlt = Boolean(bloc.wave && bloc.wave !== 'wave-seigaiha.jpg')
    const altUrl = useOwnAlt ? primaryUrl : WAVE_ORIGINAL
    const altAspect = useOwnAlt ? aspect : WAVE_TILE_ASPECT
    const altFrac = tileFrac * 1.28
    const altH = altFrac * MAP_ASPECT * altAspect
    const pid2 = `sea-wave-pat2-${bloc.id}-${i}`
    const pattern2 = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
    pattern2.setAttribute('id', pid2)
    pattern2.setAttribute('patternUnits', 'userSpaceOnUse')
    pattern2.setAttribute('width', String(altFrac))
    pattern2.setAttribute('height', String(altH))
    const altPhase = (phase + 0.47) % 1
    pattern2.setAttribute(
      'patternTransform',
      `translate(${originX + altPhase * altFrac} 0)`,
    )
    const img2 = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    img2.setAttribute('href', altUrl)
    img2.setAttributeNS('http://www.w3.org/1999/xlink', 'href', altUrl)
    img2.setAttribute('x', '0')
    img2.setAttribute('y', '0')
    img2.setAttribute('width', String(altFrac))
    img2.setAttribute('height', String(altH))
    img2.setAttribute('preserveAspectRatio', 'none')
    pattern2.append(img2)
    defs.append(pattern2)
    patterns.push({
      el: pattern2,
      tileFrac: altFrac,
      phase: altPhase,
      drift: drift * 0.7,
      originX,
    })

    let maskAttr: string | undefined
    if (bloc.fadeY) {
      const gid = `sea-wave-fade-${bloc.id}-${i}`
      const mid = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient')
      mid.setAttribute('id', gid)
      mid.setAttribute('gradientUnits', 'objectBoundingBox')
      mid.setAttribute('x1', '0')
      mid.setAttribute('y1', '0')
      mid.setAttribute('x2', '0')
      mid.setAttribute('y2', '1')
      const stops =
        bloc.fadeY === 'bottom'
          ? ([
              ['0', '1'],
              ['0.78', '1'],
              ['1', '0'],
            ] as const)
          : bloc.fadeY === 'top'
            ? ([
                ['0', '0'],
                ['0.22', '1'],
                ['1', '1'],
              ] as const)
            : ([
                ['0', '0'],
                ['0.18', '1'],
                ['0.82', '1'],
                ['1', '0'],
              ] as const)
      for (const [off, op] of stops) {
        const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
        stop.setAttribute('offset', off)
        stop.setAttribute('stop-color', '#fff')
        stop.setAttribute('stop-opacity', op)
        mid.append(stop)
      }
      defs.append(mid)
      const midId = `sea-wave-mask-${bloc.id}-${i}`
      const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask')
      mask.setAttribute('id', midId)
      mask.setAttribute('maskUnits', 'userSpaceOnUse')
      const mrect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      mrect.setAttribute('x', String(bloc.x0))
      mrect.setAttribute('y', String(bloc.y0))
      mrect.setAttribute('width', String(bloc.x1 - bloc.x0))
      mrect.setAttribute('height', String(bloc.y1 - bloc.y0))
      mrect.setAttribute('fill', `url(#${gid})`)
      mask.append(mrect)
      defs.append(mask)
      maskAttr = `url(#${midId})`
    }

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(bloc.x0))
    rect.setAttribute('y', String(bloc.y0))
    rect.setAttribute('width', String(bloc.x1 - bloc.x0))
    rect.setAttribute('height', String(bloc.y1 - bloc.y0))
    rect.setAttribute('fill', `url(#${pid})`)
    rect.setAttribute('opacity', String(opacity))
    if (maskAttr) rect.setAttribute('mask', maskAttr)
    waveSvg.append(rect)

    const rect2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect2.setAttribute('x', String(bloc.x0))
    rect2.setAttribute('y', String(bloc.y0))
    rect2.setAttribute('width', String(bloc.x1 - bloc.x0))
    rect2.setAttribute('height', String(bloc.y1 - bloc.y0))
    rect2.setAttribute('fill', `url(#${pid2})`)
    // Sea 3: alt pass nearly off so blue stays saturated.
    const altOpacity =
      bloc.id === 3 ? (useOwnAlt ? 0.02 : 0.025) : useOwnAlt ? 0.18 : 0.2
    rect2.setAttribute('opacity', String(altOpacity))
    if (maskAttr) rect2.setAttribute('mask', maskAttr)
    waveSvg.append(rect2)
  })
  root.append(waveSvg)

  const land = document.createElement('img')
  land.className = 'sea-underlay-land'
  land.src = LAND_URL
  land.alt = ''
  land.draggable = false
  root.append(land)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 1 1')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.classList.add('sea-bloc-debug')
  for (const bloc of BLOCS) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(bloc.x0))
    rect.setAttribute('y', String(bloc.y0))
    rect.setAttribute('width', String(bloc.x1 - bloc.x0))
    rect.setAttribute('height', String(bloc.y1 - bloc.y0))
    rect.setAttribute('fill', 'none')
    rect.setAttribute('stroke', '#ffb000')
    rect.setAttribute('stroke-width', '0.0035')
    svg.append(rect)

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String((bloc.x0 + bloc.x1) / 2))
    label.setAttribute('y', String((bloc.y0 + bloc.y1) / 2))
    label.setAttribute('font-size', '0.06')
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('dominant-baseline', 'middle')
    label.textContent = String(bloc.id)
    svg.append(label)
  }
  root.append(svg)

  let attached = false
  let stopping = false
  let removeTimer = 0
  let raf = 0
  let driftOrigin = performance.now()
  let pauseStarted = 0
  let pauseAccum = 0
  let wavesPaused = false
  const preferStill =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const worldOpacities: number[] = []

  const applyDrift = (t: number) => {
    for (const { el, tileFrac, phase, drift, originX } of patterns) {
      const p = (phase + t * drift) % 1
      el.setAttribute('patternTransform', `translate(${originX + p * tileFrac} 0)`)
    }
  }

  const tickDrift = (now: number) => {
    if (stopping) return
    raf = requestAnimationFrame(tickDrift)
    if (preferStill || wavesPaused) return
    const t = ((now - driftOrigin - pauseAccum) / DRIFT_MS) % 1
    applyDrift(t < 0 ? t + 1 : t)
  }

  const onDraw = (
    position: OpenSeadragon.Point,
    size: OpenSeadragon.Point,
    element: Element,
  ) => {
    const el = element as HTMLElement
    const wrap = el.parentElement
    if (wrap) {
      wrap.classList.add('sea-underlay-wrap')
      wrap.style.left = '0'
      wrap.style.top = '0'
      wrap.style.width = ''
      wrap.style.height = ''
      wrap.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`
      wrap.style.transformOrigin = '0 0'
      wrap.style.pointerEvents = 'none'
      wrap.style.display = 'block'
    }
    el.style.display = 'block'
    el.style.width = `${size.x}px`
    el.style.height = `${size.y}px`
    el.style.transform = ''
  }

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
        onDraw,
      })
      attached = true
    } else {
      viewer.updateOverlay(root, loc)
    }
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
  }

  const setWavePaused = (paused: boolean) => {
    if (paused === wavesPaused) return
    root.classList.toggle('is-moving', paused)
    if (paused) {
      pauseStarted = performance.now()
      wavesPaused = true
    } else {
      pauseAccum += performance.now() - pauseStarted
      wavesPaused = false
    }
  }

  const onAnimation = () => setWavePaused(true)
  const onAnimationFinish = () => setWavePaused(false)

  place()
  raf = requestAnimationFrame(tickDrift)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (stopping) return
      root.classList.add('is-visible')
      fadeWorld(0)
    })
  })

  const onAdd = () => {
    if (!stopping && root.classList.contains('is-visible')) fadeWorld(0)
    place()
  }
  viewer.world.addHandler('add-item', onAdd)
  viewer.addHandler('animation', onAnimation)
  viewer.addHandler('animation-finish', onAnimationFinish)

  return {
    stop: () => {
      if (stopping) return
      stopping = true
      cancelAnimationFrame(raf)
      viewer.world.removeHandler('add-item', onAdd)
      viewer.removeHandler('animation', onAnimation)
      viewer.removeHandler('animation-finish', onAnimationFinish)
      root.classList.remove('is-visible', 'is-moving')
      restoreWorld()
      window.clearTimeout(removeTimer)
      removeTimer = window.setTimeout(() => {
        if (attached) {
          try {
            viewer.removeOverlay(root)
          } catch {
            /* already removed */
          }
          attached = false
        }
        root.remove()
      }, FADE_MS)
    },
  }
}
