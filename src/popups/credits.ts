import { CREDITS_SHOW_DEV_TOOLS } from '../config'
import {
  isVertexEditorAvailable,
  isVertexEditorPanelVisible,
  onVertexEditorAvailable,
  onVertexEditorPanelVisible,
  toggleVertexEditorPanel,
} from '../overlays/vertexEditorChrome'

const UNFOLD_MS = 600
const FOLD_MS = 450

let panelEl: HTMLElement | null = null
let closeBtn: HTMLButtonElement | null = null
let edgeEditBtn: HTMLButtonElement | null = null
let open = false
let animating = false

function waitForAnimation(panel: HTMLElement, className: string, fallbackMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      panel.removeEventListener('animationend', onEnd)
      resolve()
    }
    const onEnd = (e: AnimationEvent) => {
      if (e.target !== panel) return
      done()
    }
    panel.addEventListener('animationend', onEnd)
    window.setTimeout(done, fallbackMs)
    panel.classList.add(className)
  })
}

function syncEdgeEditButton(): void {
  const tools = panelEl?.querySelector<HTMLElement>('#credits-popup-tools')
  if (!edgeEditBtn || !tools) return

  const available = isVertexEditorAvailable()
  tools.hidden = !available
  edgeEditBtn.disabled = !available
  if (!available) {
    edgeEditBtn.setAttribute('aria-pressed', 'false')
    edgeEditBtn.title = '邊線 — Edge editor unavailable'
    return
  }

  const shown = isVertexEditorPanelVisible()
  edgeEditBtn.setAttribute('aria-pressed', shown ? 'true' : 'false')
  edgeEditBtn.title = shown ? '邊線 — Hide edge editor' : '邊線 — Show edge editor'
  edgeEditBtn.textContent = shown ? '邊線編輯 · 開' : '邊線編輯 · 關'
}

function toolsRowHtml(): string {
  if (!CREDITS_SHOW_DEV_TOOLS) return ''
  return `
      <div class="credits-popup-tools" id="credits-popup-tools">
        <button
          type="button"
          class="credits-popup-tool-btn"
          id="credits-toggle-edge-edit"
          aria-pressed="false"
          title="邊線 — Show edge editor"
        >邊線編輯 · 關</button>
      </div>
  `
}

function ensurePanel(): HTMLElement {
  if (panelEl) return panelEl

  const app = document.querySelector<HTMLElement>('#app')
  if (!app) throw new Error('Missing #app for credits popup')

  const panel = document.createElement('aside')
  panel.id = 'credits-popup'
  panel.className = 'annotation-popup credits-popup annotation-popup--long'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-labelledby', 'credits-popup-title')
  panel.hidden = true

  panel.innerHTML = `
    <button type="button" class="annotation-popup-close badge-btn" id="credits-popup-close" title="收 — Close" aria-label="Close"></button>
    <div class="annotation-popup-paper">
      <h2 class="annotation-popup-title" id="credits-popup-title">致謝</h2>
      <table class="annotation-popup-table" id="credits-popup-table">
        <tbody>
          <tr>
            <th scope="row">設計</th>
            <td>王譽</td>
          </tr>
          <tr>
            <th scope="row">督導</th>
            <td>王迪安教授、李紀教授</td>
          </tr>
          <tr>
            <th scope="row">支持</th>
            <td>HKU Arts Tech Lab</td>
          </tr>
        </tbody>
      </table>
      <div class="annotation-popup-body credits-popup-music">
        <p class="credits-popup-music-heading">音樂來源</p>
        <ul class="credits-popup-music-list">
          <li>
            <span class="credits-track">Mist Sheng（雾笙）</span>
            <a href="https://www.youtube.com/watch?v=Me8y6EKQcYk" target="_blank" rel="noopener noreferrer">YouTube</a>
          </li>
          <li>
            <span class="credits-track">Chao Tian Zi（朝天子）</span>
            <a href="https://www.youtube.com/watch?v=0JSjMvkaS8Q" target="_blank" rel="noopener noreferrer">YouTube</a>
          </li>
          <li>
            <span class="credits-track">Jing Diao（京調）</span>
            <a href="https://www.youtube.com/watch?v=EMYsu8PvkYk" target="_blank" rel="noopener noreferrer">YouTube</a>
          </li>
        </ul>
      </div>
      ${toolsRowHtml()}
    </div>
  `

  app.appendChild(panel)
  panelEl = panel
  closeBtn = panel.querySelector('#credits-popup-close')
  edgeEditBtn = panel.querySelector('#credits-toggle-edge-edit')

  closeBtn?.addEventListener('click', () => {
    void closeCreditsPopup()
  })

  edgeEditBtn?.addEventListener('click', () => {
    toggleVertexEditorPanel()
    syncEdgeEditButton()
  })

  if (CREDITS_SHOW_DEV_TOOLS) {
    onVertexEditorPanelVisible(() => syncEdgeEditButton())
    onVertexEditorAvailable(() => syncEdgeEditButton())
    syncEdgeEditButton()
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) void closeCreditsPopup()
  })

  return panel
}

export async function openCreditsPopup(): Promise<void> {
  const panel = ensurePanel()
  if (animating || open) return

  open = true
  animating = true
  panel.classList.remove('is-folding', 'is-folded', 'is-open')
  panel.hidden = false
  panel.classList.add('is-animating')
  await waitForAnimation(panel, 'is-unfolding', UNFOLD_MS)
  panel.classList.remove('is-unfolding', 'is-animating')
  panel.classList.add('is-open')
  animating = false
  closeBtn?.focus()
  syncToggle(true)
  syncEdgeEditButton()
}

export async function closeCreditsPopup(): Promise<void> {
  if (!panelEl || !open || animating) return
  const panel = panelEl

  open = false
  animating = true
  panel.classList.remove('is-open', 'is-unfolding')
  panel.classList.add('is-animating')
  await waitForAnimation(panel, 'is-folding', FOLD_MS)
  if (open) {
    panel.classList.remove('is-folding', 'is-animating')
    animating = false
    return
  }
  panel.classList.remove('is-folding', 'is-animating')
  panel.classList.add('is-folded')
  panel.hidden = true
  animating = false
  syncToggle(false)
}

export function isCreditsPopupOpen(): boolean {
  return open
}

export async function toggleCreditsPopup(): Promise<void> {
  if (open) await closeCreditsPopup()
  else await openCreditsPopup()
}

function syncToggle(pressed: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-credits')
  if (!btn) return
  btn.setAttribute('aria-pressed', pressed ? 'true' : 'false')
  btn.title = pressed ? '功 — Hide credits' : '功 — Show credits'
}

/** Wire #btn-credits (功) to the credits popup. */
export function mountCreditsToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-credits')
  if (!btn) throw new Error('Missing #btn-credits')

  btn.setAttribute('aria-pressed', 'false')
  btn.title = '功 — Show credits'

  btn.addEventListener('click', () => {
    void toggleCreditsPopup()
  })

  // Prefetch panel wiring so edge-edit availability syncs once the DEV editor mounts.
  if (CREDITS_SHOW_DEV_TOOLS) ensurePanel()
}
