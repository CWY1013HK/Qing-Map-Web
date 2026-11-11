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
import { isWallRotationEnabled, setWallRotationEnabled } from './wallTilt'
import { startByobuScreen, type ByobuScreenHandle } from './byobuScreen'

const OVERLAY_GROUPS = [HANDI_GROUP_ID, ZHONGGUO_GROUP_ID, XIANDAI_GROUP_ID, HAILU_GROUP_ID] as const

let active = false

export function isByobuModeActive(): boolean {
  return active
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

    setWallRotationEnabled(true)
    app.classList.add('byobu-mode')
    btn.setAttribute('aria-pressed', 'true')
    screen = startByobuScreen(host)
    active = true
    applyChromeI18n()
    document.dispatchEvent(new CustomEvent('qing-byobu-change'))
  }

  const exit = () => {
    if (!active) return
    btn.setAttribute('aria-pressed', 'false')
    screen?.stop()
    screen = null
    app.classList.remove('byobu-mode')

    labelStore.setVisible(savedLabels)
    if (labelsBtn) labelsBtn.setAttribute('aria-pressed', savedLabels ? 'true' : 'false')

    const mgr = getOverlayManager()
    const allIds = [...mgr.featureIds, ...OVERLAY_GROUPS]
    for (const id of allIds) {
      overlayStore.setVisible(id, savedOverlays.has(id))
    }

    if (!savedRotation) setWallRotationEnabled(false)

    active = false
    applyChromeI18n()
    document.dispatchEvent(new CustomEvent('qing-byobu-change'))
    viewer.forceRedraw()
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
