import { overlayStore } from './store'
import {
  getOverlayManager,
  HANDI_GROUP_ID,
  ZHONGGUO_GROUP_ID,
  HAILU_GROUP_ID,
} from './manager'

function mountSealToggle(
  buttonId: string,
  groupId: string,
): void {
  const btn = document.querySelector<HTMLButtonElement>(`#${buttonId}`)
  const app = document.querySelector<HTMLElement>('#app')
  if (!btn) return

  const ids = getOverlayManager().idsForGroup(groupId)

  const syncPressed = () => {
    const on = ids.length > 0 && ids.every((id) => overlayStore.isVisible(id))
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    btn.classList.toggle('is-pressed', on)
  }

  btn.addEventListener('click', () => {
    overlayStore.toggleGroup(ids)
    syncPressed()
  })

  overlayStore.subscribe(() => syncPressed())
  syncPressed()

  btn.hidden = !!app?.classList.contains('intro-active')
  window.addEventListener('qing-map-intro-done', () => {
    btn.hidden = false
  })

  btn.dataset.overlayGroup = groupId
}

/**
 * Bottom-left overlay 令牌 row (漢地十八省 + 中國疆域 + 海路一覽).
 * Hidden while #app.intro-active; revealed after qing-map-intro-done.
 */
export function mountOverlaySealControls(): void {
  // Ensure manager (and JSON) is loaded once
  getOverlayManager()
  mountSealToggle('overlay-seal-handi', HANDI_GROUP_ID)
  mountSealToggle('overlay-seal-zhongguo', ZHONGGUO_GROUP_ID)
  mountSealToggle('overlay-seal-hailu', HAILU_GROUP_ID)
}

/** @deprecated use mountOverlaySealControls */
export function mountHandiSealControl(): void {
  mountOverlaySealControls()
}
