import OpenSeadragon from 'openseadragon'
import { INTRO_FOCUS } from '../config'
import { pickCloudSrc, rand } from '../lib/clouds'
import { getPlaylist } from '../lib/playlist'
import { wallObjectZoom } from './wallTilt'

type Viewer = OpenSeadragon.Viewer

const SCATTER_MS = 10000
const INTRO_ZOOM_OUT_MS = 8500
/** Default (non-ATLab) veil budget; ATLab uses its own denser grid. */
const VEIL_CLOUD_COUNT = 40

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function smoothZoomHome(viewer: Viewer, durationMs: number): void {
  const vp = viewer.viewport
  const startZoom = wallObjectZoom(viewer) ?? vp.getZoom(true)
  const startCenter = vp.getCenter(true)
  const endZoom = vp.getHomeZoom()
  const endCenter = vp.getHomeBounds().getCenter()

  viewer.setMouseNavEnabled(false)
  const t0 = performance.now()

  const step = (now: number) => {
    const u = Math.min(1, (now - t0) / durationMs)
    const e = easeInOutCubic(u)
    const z = startZoom + (endZoom - startZoom) * e
    const cx = startCenter.x + (endCenter.x - startCenter.x) * e
    const cy = startCenter.y + (endCenter.y - startCenter.y) * e
    const center = new OpenSeadragon.Point(cx, cy)
    vp.zoomTo(z, center, true)
    vp.panTo(center, true)
    if (u < 1) {
      requestAnimationFrame(step)
    } else {
      vp.goHome(true)
      viewer.setMouseNavEnabled(true)
    }
  }
  requestAnimationFrame(step)
}

export function focusIntroRegion(viewer: Viewer, immediate = true): void {
  const item = viewer.world.getItemAt(0)
  if (!item) {
    viewer.viewport.goHome(true)
    return
  }

  const size = item.getContentSize()
  const vpPoint = item.imageToViewportCoordinates(
    size.x * INTRO_FOCUS.x,
    size.y * INTRO_FOCUS.y,
  )
  const homeZoom = viewer.viewport.getHomeZoom()
  const zoom = homeZoom * INTRO_FOCUS.zoomFactor

  viewer.viewport.panTo(vpPoint, immediate)
  viewer.viewport.zoomTo(zoom, vpPoint, immediate)
  ;(viewer as unknown as { minZoomLevel: number }).minZoomLevel = homeZoom
}

export function mountIntro(viewer: Viewer): void {
  const intro = document.querySelector<HTMLElement>('#intro')
  const seal = document.querySelector<HTMLButtonElement>('#intro-seal')
  const veilRoot = document.querySelector<HTMLElement>('#intro-veil-clouds')
  const app = document.querySelector<HTMLElement>('#app')

  if (!intro || !seal || !veilRoot || !app) {
    throw new Error('Missing intro elements')
  }

  spawnVeilClouds(veilRoot)
  app.classList.add('intro-active')
  intro.hidden = false
  focusIntroRegion(viewer, true)
  getPlaylist().startIntro()

  let started = false
  const begin = () => {
    if (started) return
    started = true
    seal.disabled = true
    intro.classList.add('is-scattering')
    getPlaylist().enterFromSeal()

    window.setTimeout(() => {
      smoothZoomHome(viewer, INTRO_ZOOM_OUT_MS)
    }, 400)

    window.setTimeout(() => {
      intro.hidden = true
      intro.classList.remove('is-scattering')
      veilRoot.replaceChildren()
      app.classList.remove('intro-active')
      window.dispatchEvent(new Event('qing-map-intro-done'))
      window.dispatchEvent(new Event('resize'))
    }, SCATTER_MS)
  }

  seal.addEventListener('click', begin)
}

/**
 * Cover the screen with oversized existing cloud-puff sprites (no reference JPGs).
 * ATLab wall is ultra-wide / short → denser horizontal grid.
 */
function spawnVeilClouds(root: HTMLElement): void {
  root.replaceChildren()

  const atlab = Boolean(document.getElementById('atlab'))
  const cols = atlab ? 14 : 6
  const rows = atlab ? 4 : 5
  const extra = atlab ? 20 : 12
  const count = atlab ? cols * rows + extra : VEIL_CLOUD_COUNT + extra
  const scaleMain = atlab ? ([1.35, 2.15] as const) : ([1.15, 1.85] as const)
  const scaleBleed = atlab ? ([1.5, 2.4] as const) : ([1.25, 2.0] as const)

  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (i >= count - extra) break
      appendVeilCloud(root, {
        left: ((c + 0.5) / cols) * 100 + rand(atlab ? -4 : -7, atlab ? 4 : 7),
        top: ((r + 0.5) / rows) * 100 + rand(atlab ? -5 : -7, atlab ? 5 : 7),
        scale: rand(scaleMain[0], scaleMain[1]),
        i,
      })
      i++
    }
  }
  while (i < count) {
    appendVeilCloud(root, {
      left: rand(-10, 110),
      top: rand(-12, 112),
      scale: rand(scaleBleed[0], scaleBleed[1]),
      i,
    })
    i++
  }
}

function appendVeilCloud(
  root: HTMLElement,
  opts: { left: number; top: number; scale: number; i: number },
): void {
  const el = document.createElement('span')
  el.className = 'intro-veil-cloud'
  const flip = Math.random() < 0.5 ? 1 : -1
  const dx = flip === 1 ? rand(-55, -25) : rand(25, 55)
  const dy = rand(-35, 35)
  el.style.left = `${opts.left}%`
  el.style.top = `${opts.top}%`
  el.style.backgroundImage = `url('${pickCloudSrc()}')`
  el.style.setProperty('--vc-scale', String(opts.scale))
  el.style.setProperty('--vc-flip', String(flip))
  el.style.setProperty('--vc-rot', `${rand(-18, 18)}deg`)
  el.style.setProperty('--vc-float-dur', `${rand(16, 28)}s`)
  el.style.setProperty('--vc-float-delay', `${-rand(0, 12)}s`)
  el.style.setProperty('--vc-dx', `${dx}%`)
  el.style.setProperty('--vc-dy', `${dy}%`)
  el.style.setProperty('--vc-scatter-dur', `${rand(3.4, 5.2)}s`)
  el.style.setProperty('--vc-scatter-delay', `${rand(0, 0.45)}s`)
  el.style.zIndex = String(1 + (opts.i % 5))
  root.append(el)
}
