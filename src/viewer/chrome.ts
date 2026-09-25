import type OpenSeadragon from 'openseadragon'
import { UI_THEME } from '../config'
import { t } from '../i18n'

type Viewer = OpenSeadragon.Viewer

export function mountChrome(viewer: Viewer): void {
  const zoomIn = document.querySelector<HTMLButtonElement>('#btn-zoom-in')
  const zoomOut = document.querySelector<HTMLButtonElement>('#btn-zoom-out')
  const home = document.querySelector<HTMLButtonElement>('#btn-home')
  const toggle = document.querySelector<HTMLButtonElement>('#btn-toggle-minimap')
  const hide = document.querySelector<HTMLButtonElement>('#btn-hide-minimap')
  const panel = document.querySelector<HTMLElement>('#minimap-panel')
  const dragRoot = document.querySelector<HTMLElement>('.minimap-drag')
  const app = document.querySelector<HTMLElement>('#app')

  if (!zoomIn || !zoomOut || !home || !toggle || !hide || !panel || !dragRoot || !app) {
    throw new Error('Missing chrome controls')
  }

  // Theme from config only (no end-user toggle)
  app.dataset.uiTheme = UI_THEME

  // 令牌 tablets follow the chrome theme (silver metal vs ebony wood)
  const lingpai: Record<
    typeof UI_THEME,
    { handi: string; zhongguo: string; hailu: string }
  > = {
    silver: {
      handi: '/ui/silver/handi-lingpai.png',
      zhongguo: '/ui/silver/zhongguo-lingpai.png',
      hailu: '/ui/silver/hailu-lingpai.png',
    },
    bronze: {
      handi: '/ui/bronze/handi-lingpai.png',
      zhongguo: '/ui/bronze/zhongguo-lingpai.png',
      hailu: '/ui/bronze/hailu-lingpai.png',
    },
  }
  const handiImg = document.querySelector<HTMLImageElement>('#overlay-seal-handi img')
  const zhongImg = document.querySelector<HTMLImageElement>('#overlay-seal-zhongguo img')
  const hailuImg = document.querySelector<HTMLImageElement>('#overlay-seal-hailu img')
  if (handiImg) handiImg.src = lingpai[UI_THEME].handi
  if (zhongImg) zhongImg.src = lingpai[UI_THEME].zhongguo
  if (hailuImg) hailuImg.src = lingpai[UI_THEME].hailu

  zoomIn.addEventListener('click', () => {
    viewer.viewport.zoomBy(1.25)
    viewer.viewport.applyConstraints()
  })
  zoomOut.addEventListener('click', () => {
    viewer.viewport.zoomBy(0.8)
    viewer.viewport.applyConstraints()
  })
  home.addEventListener('click', () => {
    viewer.viewport.goHome(true)
  })

  let minimapOpen = true
  let animating = false

  const syncNavigatorDisplay = (visible: boolean) => {
    const nav = viewer.navigator
    if (nav?.element) {
      nav.element.style.display = visible ? '' : 'none'
    }
  }

  const setToggleState = (visible: boolean) => {
    toggle.setAttribute('aria-pressed', visible ? 'true' : 'false')
    toggle.title = visible ? t('toolbar.minimapHide') : t('toolbar.minimapShow')
  }

  const waitForAnimation = (className: string) =>
    new Promise<void>((resolve) => {
      const done = () => {
        panel.removeEventListener('animationend', done)
        resolve()
      }
      panel.addEventListener('animationend', done)
      // Fallback if animationend is missed
      window.setTimeout(done, 700)
      panel.classList.add(className)
    })

  const setMinimapVisible = async (visible: boolean) => {
    if (animating || visible === minimapOpen) return
    animating = true
    panel.classList.add('is-animating')
    panel.classList.remove('is-unfolding', 'is-folding', 'is-folded')

    if (visible) {
      panel.hidden = false
      syncNavigatorDisplay(true)
      await waitForAnimation('is-unfolding')
      panel.classList.remove('is-unfolding')
      minimapOpen = true
      setToggleState(true)
      window.dispatchEvent(new Event('resize'))
    } else {
      await waitForAnimation('is-folding')
      panel.classList.remove('is-folding')
      panel.classList.add('is-folded')
      panel.hidden = true
      syncNavigatorDisplay(false)
      minimapOpen = false
      setToggleState(false)
    }

    panel.classList.remove('is-animating')
    animating = false
  }

  const playMinimapEntrance = () => {
    panel.classList.remove('is-folded')
    panel.classList.add('is-animating', 'is-unfolding')
    const finishEntrance = () => {
      panel.classList.remove('is-unfolding', 'is-animating')
      panel.removeEventListener('animationend', finishEntrance)
    }
    panel.addEventListener('animationend', finishEntrance)
    window.setTimeout(finishEntrance, 700)
  }

  // Minimap stays folded until the intro stamp sequence finishes
  panel.classList.add('is-folded')
  window.addEventListener('qing-map-intro-done', playMinimapEntrance, { once: true })

  toggle.addEventListener('click', () => {
    void setMinimapVisible(!minimapOpen)
  })
  hide.addEventListener('click', () => {
    void setMinimapVisible(false)
  })

  enableEdgeDrag(panel, dragRoot)
}

function enableEdgeDrag(panel: HTMLElement, dragRoot: HTMLElement): void {
  let dragging = false
  let startX = 0
  let startY = 0
  let origLeft = 0
  let origTop = 0
  let activeEl: HTMLElement | null = null

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    if (panel.classList.contains('is-animating')) return
    const target = e.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('minimap-edge')) {
      return
    }
    dragging = true
    activeEl = target
    panel.classList.add('is-dragging')
    const rect = panel.getBoundingClientRect()
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
    panel.style.left = `${rect.left}px`
    panel.style.top = `${rect.top}px`
    origLeft = rect.left
    origTop = rect.top
    startX = e.clientX
    startY = e.clientY
    target.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const maxLeft = window.innerWidth - panel.offsetWidth
    const maxTop = window.innerHeight - panel.offsetHeight
    const nextLeft = Math.min(maxLeft, Math.max(0, origLeft + dx))
    const nextTop = Math.min(maxTop, Math.max(0, origTop + dy))
    panel.style.left = `${nextLeft}px`
    panel.style.top = `${nextTop}px`
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    panel.classList.remove('is-dragging')
    try {
      activeEl?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    activeEl = null
  }

  dragRoot.addEventListener('pointerdown', onPointerDown)
  dragRoot.addEventListener('pointermove', onPointerMove)
  dragRoot.addEventListener('pointerup', onPointerUp)
  dragRoot.addEventListener('pointercancel', onPointerUp)
}
