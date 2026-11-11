import type { Viewer } from 'openseadragon'
import {
  getOverlayManager,
  HANDI_GROUP_ID,
  HAILU_GROUP_ID,
  XIANDAI_GROUP_ID,
  ZHONGGUO_GROUP_ID,
} from '../overlays/manager'
import { overlayStore } from '../overlays/store'
import { closeCreditsPopup } from '../popups/credits'
import { labelStore } from '../popups/labelStore'
import { applyChromeI18n } from '../i18n/applyChrome'
import { closeAnnotationPopup } from '../popups/panel'
import byobuConfig from '../../data/byobu.json'
import { isWallRotationEnabled, setWallRotationEnabled } from './wallTilt'
import { startByobuScreen, type ByobuScreenHandle } from './byobuScreen'

const OVERLAY_GROUPS = [HANDI_GROUP_ID, ZHONGGUO_GROUP_ID, XIANDAI_GROUP_ID, HAILU_GROUP_ID] as const
const BYOBU_BACKDROP_MS = 620

let active = false
let exiting = false
let roomBackdrop: HTMLElement | null = null

export function isByobuModeActive(): boolean {
  return active
}

function backdropTransitionMs(): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
  return BYOBU_BACKDROP_MS
}

function waitBackdrop(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function ensureRoomBackdrop(app: HTMLElement): HTMLElement {
  if (roomBackdrop?.isConnected) return roomBackdrop
  const url = (byobuConfig as { roomBackdropUrl?: string }).roomBackdropUrl
  const layer = document.createElement('div')
  layer.id = 'byobu-room-backdrop'
  layer.className = 'byobu-room-backdrop'
  layer.setAttribute('aria-hidden', 'true')
  const photo = document.createElement('div')
  photo.className = 'byobu-room-backdrop__photo'
  if (url) photo.style.backgroundImage = `url('${url}')`
  const veil = document.createElement('div')
  veil.className = 'byobu-room-backdrop__veil'
  layer.append(photo, veil)
  const viewer = app.querySelector('#viewer')
  if (viewer) app.insertBefore(layer, viewer)
  else app.prepend(layer)
  roomBackdrop = layer
  return layer
}

function showRoomBackdrop(layer: HTMLElement): void {
  layer.classList.remove('is-visible')
  void layer.offsetWidth
  layer.classList.add('is-visible')
}

/** Wall chrome: toggle 折 — eight-panel 屏風 with annotations off and 3D on. */
export function mountByobuMode(viewer: Viewer): void {
  const app = document.querySelector<HTMLElement>('#app')
  const btn = document.querySelector<HTMLButtonElement>('#btn-byobu')
  const host = document.querySelector<HTMLElement>('#viewer')
  const focusBtn = document.querySelector<HTMLButtonElement>('#btn-focus')
  const labelsBtn = document.querySelector<HTMLButtonElement>('#btn-toggle-labels')
  if (!app || !btn || !host) {
    throw new Error('Missing byobu-mode controls')
  }

  let screen: ByobuScreenHandle | null = null
  let savedLabels = true
  let savedOverlays = new Set<string>()
  let savedRotation = false
  let savedViewport: { center: OpenSeadragon.Point; zoom: number } | null = null

  const hideAllOverlays = () => {
    const mgr = getOverlayManager()
    for (const id of OVERLAY_GROUPS) {
      overlayStore.setGroupVisible(mgr.idsForGroup(id), false)
    }
  }

  const enter = () => {
    if (active) return
    closeAnnotationPopup()
    void closeCreditsPopup()

    if (focusBtn?.getAttribute('aria-pressed') === 'true') {
      focusBtn.click()
    }

    savedLabels = labelStore.isVisible()
    savedOverlays = new Set(overlayStore.getVisible())
    savedRotation = isWallRotationEnabled()

    labelStore.setVisible(false)
    hideAllOverlays()
    if (labelsBtn) labelsBtn.setAttribute('aria-pressed', 'false')

    savedViewport = {
      center: viewer.viewport.getCenter(true).clone(),
      zoom: viewer.viewport.getZoom(true),
    }

    setWallRotationEnabled(true)
    const backdrop = ensureRoomBackdrop(app)
    app.classList.add('byobu-mode')
    btn.setAttribute('aria-pressed', 'true')
    requestAnimationFrame(() => showRoomBackdrop(backdrop))
    screen = startByobuScreen(host)
    active = true
    applyChromeI18n()
    document.dispatchEvent(new CustomEvent('qing-byobu-change'))
  }

  const finishExit = () => {
    labelStore.setVisible(savedLabels)
    if (labelsBtn) labelsBtn.setAttribute('aria-pressed', savedLabels ? 'true' : 'false')

    const mgr = getOverlayManager()
    const allIds = [...mgr.featureIds, ...OVERLAY_GROUPS]
    for (const id of allIds) {
      overlayStore.setVisible(id, savedOverlays.has(id))
    }

    if (!savedRotation) setWallRotationEnabled(false)

    if (savedViewport) {
      const { center, zoom } = savedViewport
      savedViewport = null
      viewer.viewport.panTo(center, true)
      viewer.viewport.zoomTo(zoom, undefined, true)
      viewer.viewport.applyConstraints(true)
      viewer.navigator?.update(viewer.viewport)
    }

    active = false
    exiting = false
    applyChromeI18n()
    document.dispatchEvent(new CustomEvent('qing-byobu-change'))
    viewer.forceRedraw()
  }

  const exit = () => {
    void (async () => {
      if (!active || exiting) return
      exiting = true
      btn.setAttribute('aria-pressed', 'false')
      roomBackdrop?.classList.remove('is-visible')
      await waitBackdrop(backdropTransitionMs())
      screen?.stop()
      screen = null
      app.classList.remove('byobu-mode')
      finishExit()
    })()
  }

  btn.addEventListener('click', () => {
    if (active) exit()
    else enter()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !active) return
    e.preventDefault()
    exit()
  })
}
