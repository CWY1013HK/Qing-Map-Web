import OpenSeadragon from 'openseadragon'
import {
  flipXForDrift,
  pickCloudAsset,
  rand,
  randomFocusCloudPx,
  type CloudDriftDir,
  type CloudHeadSide,
} from '../lib/clouds'
import {
  DEFAULT_DECOR_COUNTS,
  buildLaneTracker,
  decorCruiseSpeed,
  pickDecorAsset,
  pickSeaLane,
  randomDecorWidthPx,
  randomInRegion,
  regionForKind,
  sampleLane,
  type DecorCounts,
  type DecorKind,
  type DecorRegion,
  type LaneTracker,
} from '../lib/mapDecor'
import { closeCreditsPopup } from '../popups/credits'
import { closeAnnotationPopup } from '../popups/panel'
import { startSeaUnderlay, type SeaUnderlayHandle } from './seaUnderlay'

type Viewer = OpenSeadragon.Viewer
type TiledImage = OpenSeadragon.TiledImage

const FOCUS_CLOUD_COUNT = 24
const VIEWPORT_AVOID_ZOOM = 2
/** Cursor evade radius as fraction of the *visible* viewport min-dimension. */
const CURSOR_AVOID_FRAC = 0.16
/** Peak vertical flee speed relative to cruise speed (at cursor center). */
const CURSOR_NUDGE = 1.15
/** How quickly vy eases toward the evade target (1/s). */
const CURSOR_VY_LERP = 6
/** Native puff art aspect (width / height) — keeps OSD box from letterboxing. */
const CLOUD_ASPECT = 1354 / 665

type DriftSprite = {
  el: HTMLElement
  inner: HTMLElement
  widthImg: number
  heightImg: number
  vpW: number
  vpH: number
  x: number
  y: number
  speed: number
  dir: CloudDriftDir
  headSide: CloudHeadSide
  src: string
  /** Smoothed vertical velocity (image px / s) for curved evade paths. */
  vy: number
  /** Sticky evade sign: -1 up, +1 down, 0 unset. */
  evadeSign: -1 | 0 | 1
  /** When set, spawn/wrap/clamp stay inside this normalized band. */
  region: DecorRegion | null
  /** Fuchuans: follow a white sea-lane polyline (bounce at ends). */
  lane: LaneTracker | null
  kind: 'cloud' | DecorKind
}

export type FocusCloudsHandle = {
  stop: () => void
}

export type StartFocusCloudsOptions = {
  /** Element used for pointer → image mapping (usually the OSD root). */
  canvas: HTMLElement
  count?: number
  /**
   * Floor / locked-home displays: skip deep-zoom flee (viewport stays at home).
   * Cursor nudge still works if the canvas receives pointers.
   */
  lockedHome?: boolean
  /** Scatter fuchuans / mongols / merchants with the mist. Default true. */
  decor?: boolean | DecorCounts
}

/**
 * Spawn drifting focus mist (and optional map décor) on a viewer.
 * Caller owns enter/exit lifecycle.
 */
export function startFocusClouds(
  viewer: Viewer,
  opts: StartFocusCloudsOptions,
): FocusCloudsHandle {
  const canvas = opts.canvas
  const count = opts.count ?? FOCUS_CLOUD_COUNT
  const lockedHome = opts.lockedHome === true
  const decorCounts =
    opts.decor === false
      ? null
      : opts.decor === true || opts.decor == null
        ? DEFAULT_DECOR_COUNTS
        : opts.decor

  let sprites: DriftSprite[] = []
  let raf = 0
  let lastTs = 0
  let cursorImg: { x: number; y: number } | null = null
  let running = true
  let preferReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const onMotionPref = (e: MediaQueryListEvent) => {
    preferReducedMotion = e.matches
  }
  const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionMq.addEventListener('change', onMotionPref)

  const applyFacing = (
    inner: HTMLElement,
    headSide: CloudHeadSide,
    dir: CloudDriftDir,
  ) => {
    const flipX = flipXForDrift(headSide, dir)
    inner.style.setProperty('--fc-flip-x', String(flipX))
    inner.style.setProperty('--fc-flip-y', '1')
  }

  const onDrawSprite = (
    position: OpenSeadragon.Point,
    size: OpenSeadragon.Point,
    element: Element,
  ) => {
    const el = element as HTMLElement
    const wrapper = el.parentElement
    const w = Math.max(1, Math.round(size.x))
    const h = Math.max(1, Math.round(size.y))
    if (wrapper) {
      const isDecor = el.classList.contains('focus-decor')
      wrapper.classList.toggle('focus-cloud-overlay', !isDecor)
      wrapper.classList.toggle('focus-decor-overlay', isDecor)
      wrapper.style.left = '0'
      wrapper.style.top = '0'
      wrapper.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`
      wrapper.style.transformOrigin = '0 0'
      wrapper.style.display = 'block'
      wrapper.style.pointerEvents = 'none'
    }
    el.style.display = 'block'
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.style.transform = ''
  }

  const syncOverlay = (sprite: DriftSprite, item: TiledImage) => {
    const topLeft = item.imageToViewportCoordinates(
      sprite.x - sprite.widthImg / 2,
      sprite.y - sprite.heightImg / 2,
    )
    viewer.updateOverlay(
      sprite.el,
      new OpenSeadragon.Rect(topLeft.x, topLeft.y, sprite.vpW, sprite.vpH),
    )
  }

  const yBounds = (sprite: DriftSprite, size: OpenSeadragon.Point) => {
    if (sprite.region) {
      return {
        lo: sprite.region.y0 * size.y,
        hi: sprite.region.y1 * size.y,
      }
    }
    return { lo: size.y * 0.04, hi: size.y * 0.96 }
  }

  const wrapAlongFacing = (sprite: DriftSprite, size: OpenSeadragon.Point) => {
    // Figurative décor: bounce inside their sea/desert band (flip facing).
    if (sprite.region && sprite.kind !== 'cloud') {
      const padX = sprite.widthImg * 0.38
      const padY = sprite.heightImg * 0.38
      const x0 = sprite.region.x0 * size.x + padX
      const x1 = sprite.region.x1 * size.x - padX
      const y0 = sprite.region.y0 * size.y + padY
      const y1 = sprite.region.y1 * size.y - padY
      const minX = Math.min(x0, x1)
      const maxX = Math.max(x0, x1)
      const minY = Math.min(y0, y1)
      const maxY = Math.max(y0, y1)

      if (sprite.x <= minX) {
        sprite.x = minX
        if (sprite.dir !== 1) {
          sprite.dir = 1
          applyFacing(sprite.inner, sprite.headSide, sprite.dir)
        }
      } else if (sprite.x >= maxX) {
        sprite.x = maxX
        if (sprite.dir !== -1) {
          sprite.dir = -1
          applyFacing(sprite.inner, sprite.headSide, sprite.dir)
        }
      }

      if (sprite.y <= minY) {
        sprite.y = minY
        sprite.vy = Math.abs(sprite.vy)
        sprite.evadeSign = 1
      } else if (sprite.y >= maxY) {
        sprite.y = maxY
        sprite.vy = -Math.abs(sprite.vy)
        sprite.evadeSign = -1
      }
      return
    }

    // Clouds still wrap across the full map.
    if (sprite.dir === 1 && sprite.x > size.x + sprite.widthImg * 0.45) {
      sprite.x = -sprite.widthImg * 0.35
      sprite.y = rand(size.y * 0.08, size.y * 0.9)
    } else if (sprite.dir === -1 && sprite.x < -sprite.widthImg * 0.45) {
      sprite.x = size.x + sprite.widthImg * 0.35
      sprite.y = rand(size.y * 0.08, size.y * 0.9)
    }
  }

  const tick = (ts: number) => {
    if (!running) return
    const item = viewer.world.getItemAt(0)
    if (!item) {
      raf = requestAnimationFrame(tick)
      return
    }

    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016
    lastTs = ts

    const size = item.getContentSize()
    const homeZoom = viewer.viewport.getHomeZoom()
    const zoom = viewer.viewport.getZoom(true)
    const deepZoom = !lockedHome && zoom >= homeZoom * VIEWPORT_AVOID_ZOOM
    const speedScale = preferReducedMotion ? 0.2 : 1

    const bounds = viewer.viewport.getBounds(true)
    const vtl = item.viewportToImageCoordinates(bounds.getTopLeft())
    const vbr = item.viewportToImageCoordinates(bounds.getBottomRight())
    // Evade radius in image px must track the *visible* viewport, not the
    // full map — otherwise the on-screen avoid zone balloons when zoomed in.
    const viewW = Math.abs(vbr.x - vtl.x)
    const viewH = Math.abs(vbr.y - vtl.y)
    const cursorR = Math.min(viewW, viewH) * CURSOR_AVOID_FRAC

    for (const sprite of sprites) {
      let spd = sprite.speed * speedScale
      if (deepZoom) {
        const inside =
          sprite.x > vtl.x - sprite.widthImg * 0.1 &&
          sprite.x < vbr.x + sprite.widthImg * 0.1 &&
          sprite.y > vtl.y - sprite.heightImg * 0.1 &&
          sprite.y < vbr.y + sprite.heightImg * 0.1
        if (inside) spd *= 2.2
      }

      // Fuchuans trace white sea lanes; bounce (flip) at lane ends.
      if (sprite.lane && sprite.kind === 'fuchuan') {
        const lane = sprite.lane
        lane.s += lane.pathDir * spd * dt
        if (lane.s <= 0) {
          lane.s = 0
          lane.pathDir = 1
        } else if (lane.s >= lane.total) {
          lane.s = lane.total
          lane.pathDir = -1
        }
        const sample = sampleLane(lane, lane.s)
        sprite.x = sample.x
        sprite.y = sample.y
        const faceDir: CloudDriftDir =
          sample.tx * lane.pathDir >= 0 ? 1 : -1
        if (faceDir !== sprite.dir) {
          sprite.dir = faceDir
          applyFacing(sprite.inner, sprite.headSide, sprite.dir)
        }
        sprite.vy = 0
        syncOverlay(sprite, item)
        continue
      }

      let vx = sprite.dir * spd
      let vyTarget = 0

      if (cursorImg) {
        const dx = sprite.x - cursorImg.x
        const dy = sprite.y - cursorImg.y
        const dCursor = Math.hypot(dx, dy)
        if (dCursor < cursorR && dCursor > 1) {
          const falloff = 1 - dCursor / cursorR
          const strength = falloff * falloff
          if (sprite.evadeSign === 0) {
            sprite.evadeSign = dy >= 0 ? 1 : -1
          }
          vyTarget = sprite.evadeSign * spd * CURSOR_NUDGE * (0.55 + 0.45 * strength)
          vx *= 1 - 0.35 * strength
        } else {
          sprite.evadeSign = 0
        }
      } else {
        sprite.evadeSign = 0
      }

      const blend = 1 - Math.exp(-CURSOR_VY_LERP * dt)
      sprite.vy += (vyTarget - sprite.vy) * blend

      const { lo, hi } = yBounds(sprite, size)
      sprite.x += vx * dt
      sprite.y = clamp(sprite.y + sprite.vy * dt, lo, hi)
      wrapAlongFacing(sprite, size)
      syncOverlay(sprite, item)
    }

    raf = requestAnimationFrame(tick)
  }

  /**
   * Pointer → image coords via the OSD container (what pointFromPixel expects).
   * Divide by CSS scale (ATLab fit) so layout px match _containerInnerSize at any zoom.
   */
  const pointerToImage = (e: PointerEvent): { x: number; y: number } | null => {
    const item = viewer.world.getItemAt(0)
    if (!item) return null
    const el = viewer.container as HTMLElement
    const rect = el.getBoundingClientRect()
    const sx = rect.width / Math.max(1, el.clientWidth)
    const sy = rect.height / Math.max(1, el.clientHeight)
    const pixel = new OpenSeadragon.Point(
      (e.clientX - rect.left) / sx,
      (e.clientY - rect.top) / sy,
    )
    const img = item.viewerElementToImageCoordinates(pixel)
    return { x: img.x, y: img.y }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!running) return
    cursorImg = pointerToImage(e)
  }

  const onPointerLeave = () => {
    cursorImg = null
  }

  const item = viewer.world.getItemAt(0)
  if (!item) {
    motionMq.removeEventListener('change', onMotionPref)
    return {
      stop: () => {
        /* nothing spawned */
      },
    }
  }

  const size = item.getContentSize()
  sprites = []

  const addOverlaySprite = (sprite: DriftSprite) => {
    const topLeft = item.imageToViewportCoordinates(
      sprite.x - sprite.widthImg / 2,
      sprite.y - sprite.heightImg / 2,
    )
    viewer.addOverlay({
      element: sprite.el,
      location: new OpenSeadragon.Rect(topLeft.x, topLeft.y, sprite.vpW, sprite.vpH),
      checkResize: false,
      onDraw: onDrawSprite,
    })
    sprites.push(sprite)
  }

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = 'focus-cloud'
    const inner = document.createElement('div')
    inner.className = 'focus-cloud-inner'
    el.append(inner)

    const asset = pickCloudAsset()
    const dir: CloudDriftDir = Math.random() < 0.5 ? 1 : -1
    applyFacing(inner, asset.headSide, dir)
    inner.style.backgroundImage = `url('${asset.src}')`

    const widthImg = randomFocusCloudPx()
    const heightImg = widthImg / CLOUD_ASPECT
    const vpW = widthImg / size.x
    const vpH = heightImg / size.x
    const x =
      Math.random() < 0.78
        ? rand(size.x * 0.2, size.x * 0.58)
        : rand(size.x * 0.1, size.x * 0.88)
    const y =
      Math.random() < 0.7
        ? rand(size.y * 0.14, size.y * 0.52)
        : rand(size.y * 0.08, size.y * 0.9)
    const speed = (size.x * rand(0.14, 0.24)) / rand(75, 110)

    addOverlaySprite({
      el,
      inner,
      widthImg,
      heightImg,
      vpW,
      vpH,
      x,
      y,
      speed,
      dir,
      headSide: asset.headSide,
      src: asset.src,
      vy: 0,
      evadeSign: 0,
      region: null,
      lane: null,
      kind: 'cloud',
    })
  }

  if (decorCounts) {
    const kinds = Object.entries(decorCounts) as [DecorKind, number][]
    for (const [kind, n] of kinds) {
      for (let i = 0; i < n; i++) {
        const el = document.createElement('div')
        el.className = 'focus-cloud focus-decor'
        el.dataset.decor = kind
        const inner = document.createElement('div')
        inner.className = 'focus-cloud-inner'
        el.append(inner)

        const asset = pickDecorAsset(kind)
        const region = regionForKind(kind)
        let dir: CloudDriftDir = Math.random() < 0.5 ? 1 : -1
        inner.style.backgroundImage = `url('${asset.src}')`

        const widthImg = randomDecorWidthPx(kind)
        const heightImg = widthImg / asset.aspect
        const vpW = widthImg / size.x
        const vpH = heightImg / size.x
        const speed = decorCruiseSpeed(kind, size.x, dir)

        let x: number
        let y: number
        let lane: LaneTracker | null = null

        if (kind === 'fuchuan') {
          try {
            lane = buildLaneTracker(pickSeaLane(), size)
            const sample = sampleLane(lane, lane.s)
            x = sample.x
            y = sample.y
            dir = sample.tx * lane.pathDir >= 0 ? 1 : -1
          } catch {
            const pt = randomInRegion(region, size)
            x = pt.x
            y = pt.y
          }
        } else {
          const pt = randomInRegion(region, size)
          x = pt.x
          y = pt.y
        }

        applyFacing(inner, asset.headSide, dir)

        addOverlaySprite({
          el,
          inner,
          widthImg,
          heightImg,
          vpW,
          vpH,
          x,
          y,
          speed,
          dir,
          headSide: asset.headSide,
          src: asset.src,
          vy: 0,
          evadeSign: 0,
          region: kind === 'fuchuan' ? null : region,
          lane,
          kind,
        })
      }
    }
  }

  requestAnimationFrame(() => {
    for (const s of sprites) s.el.classList.add('is-visible')
  })

  lastTs = 0
  raf = requestAnimationFrame(tick)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)

  return {
    stop: () => {
      if (!running) return
      running = false
      cancelAnimationFrame(raf)
      raf = 0
      cursorImg = null
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      motionMq.removeEventListener('change', onMotionPref)

      for (const s of sprites) s.el.classList.remove('is-visible')

      window.setTimeout(() => {
        for (const s of sprites) {
          try {
            viewer.removeOverlay(s.el)
          } catch {
            /* already removed */
          }
        }
        sprites = []
      }, 650)
    },
  }
}

/** Wall chrome: toggle 淨 focus mist on/off. */
export function mountFocusMode(viewer: Viewer): void {
  const app = document.querySelector<HTMLElement>('#app')
  const btn = document.querySelector<HTMLButtonElement>('#btn-focus')
  const canvas = document.querySelector<HTMLElement>('#viewer')
  if (!app || !btn || !canvas) {
    throw new Error('Missing focus-mode controls')
  }

  let handle: FocusCloudsHandle | null = null
  let sea: SeaUnderlayHandle | null = null

  const enter = () => {
    if (handle) return
    closeAnnotationPopup()
    void closeCreditsPopup()
    app.classList.add('focus-mode')
    btn.setAttribute('aria-pressed', 'true')
    sea = startSeaUnderlay(viewer)
    handle = startFocusClouds(viewer, { canvas })
    if (!viewer.world.getItemAt(0)) {
      handle.stop()
      handle = null
      sea.stop()
      sea = null
      app.classList.remove('focus-mode')
      btn.setAttribute('aria-pressed', 'false')
    }
  }

  const exit = () => {
    if (!handle) return
    btn.setAttribute('aria-pressed', 'false')
    handle.stop()
    handle = null
    sea?.stop()
    sea = null
    window.setTimeout(() => {
      app.classList.remove('focus-mode')
    }, 650)
  }

  btn.addEventListener('click', () => {
    if (handle) exit()
    else enter()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && handle) {
      e.preventDefault()
      exit()
    }
  })
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
