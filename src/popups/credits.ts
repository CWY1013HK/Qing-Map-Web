import { CREDITS_SHOW_DEV_TOOLS } from '../config'
import {
  getLocale,
  LOCALES,
  registerLocaleRefresh,
  setLocale,
  t,
  type Locale,
} from '../i18n'
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
  if (!edgeEditBtn) return

  const available = isVertexEditorAvailable()
  edgeEditBtn.hidden = !available
  edgeEditBtn.disabled = !available
  if (!available) {
    edgeEditBtn.setAttribute('aria-pressed', 'false')
    edgeEditBtn.title = t('credits.edgeUnavailable')
    return
  }

  const shown = isVertexEditorPanelVisible()
  edgeEditBtn.setAttribute('aria-pressed', shown ? 'true' : 'false')
  edgeEditBtn.title = shown ? t('credits.edgeHide') : t('credits.edgeShow')
  edgeEditBtn.textContent = shown ? t('credits.edgeOn') : t('credits.edgeOff')
}

function toolsRowHtml(): string {
  const edgeBtn = CREDITS_SHOW_DEV_TOOLS
    ? `
        <button
          type="button"
          class="credits-popup-tool-btn"
          id="credits-toggle-edge-edit"
          aria-pressed="false"
          title=""
          hidden
        ></button>`
    : ''
  return `
      <div class="credits-popup-tools" id="credits-popup-tools">
        <div class="credits-lang" id="credits-lang" role="group" aria-label="">
          <button type="button" class="credits-lang-btn" data-locale="zh-Hant" aria-pressed="false"></button>
          <button type="button" class="credits-lang-btn" data-locale="zh-Hans" aria-pressed="false"></button>
          <button type="button" class="credits-lang-btn" data-locale="en" aria-pressed="false"></button>
        </div>
        ${edgeBtn}
      </div>
  `
}

function applyCreditsCopy(): void {
  if (!panelEl) return

  const setText = (sel: string, value: string) => {
    const el = panelEl!.querySelector(sel)
    if (el) el.textContent = value
  }

  closeBtn?.setAttribute('title', t('popup.close'))
  closeBtn?.setAttribute('aria-label', t('popup.closeAria'))

  setText('#credits-popup-title', t('credits.title'))
  setText('[data-i18n="credits.design"]', t('credits.design'))
  setText('[data-i18n="credits.designName"]', t('credits.designName'))
  setText('[data-i18n="credits.supervision"]', t('credits.supervision'))
  setText('[data-i18n="credits.supervisionNames"]', t('credits.supervisionNames'))
  setText('[data-i18n="credits.support"]', t('credits.support'))
  setText('[data-i18n="credits.supportName"]', t('credits.supportName'))
  setText('[data-i18n="credits.fonts"]', t('credits.fonts'))
  setText('[data-i18n="credits.fontsMap"]', t('credits.fontsMap'))
  setText('[data-i18n="credits.fontsPopup"]', t('credits.fontsPopup'))
  setText('[data-i18n="credits.music"]', t('credits.music'))
  setText('[data-i18n="credits.trackMist"]', t('credits.trackMist'))
  setText('[data-i18n="credits.trackChao"]', t('credits.trackChao'))
  setText('[data-i18n="credits.trackJing"]', t('credits.trackJing'))

  const fontsCont = panelEl.querySelector<HTMLElement>('[data-i18n-aria="credits.fontsContAria"]')
  fontsCont?.setAttribute('aria-label', t('credits.fontsContAria'))

  const langGroup = panelEl.querySelector<HTMLElement>('#credits-lang')
  langGroup?.setAttribute('aria-label', t('credits.langAria'))

  const locale = getLocale()
  for (const btn of panelEl.querySelectorAll<HTMLButtonElement>('.credits-lang-btn')) {
    const loc = btn.dataset.locale as Locale | undefined
    if (!loc || !LOCALES.includes(loc)) continue
    btn.setAttribute('aria-pressed', loc === locale ? 'true' : 'false')
    if (loc === 'zh-Hant') btn.textContent = t('credits.langHant')
    else if (loc === 'zh-Hans') btn.textContent = t('credits.langHans')
    else btn.textContent = t('credits.langEn')
  }

  syncEdgeEditButton()
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
    <button type="button" class="annotation-popup-close badge-btn" id="credits-popup-close" title="" aria-label=""></button>
    <div class="annotation-popup-paper">
      <h2 class="annotation-popup-title" id="credits-popup-title"></h2>
      <table class="annotation-popup-table" id="credits-popup-table">
        <tbody>
          <tr>
            <th scope="row" data-i18n="credits.design"></th>
            <td data-i18n="credits.designName"></td>
          </tr>
          <tr>
            <th scope="row" data-i18n="credits.supervision"></th>
            <td data-i18n="credits.supervisionNames"></td>
          </tr>
          <tr>
            <th scope="row" data-i18n="credits.support"></th>
            <td data-i18n="credits.supportName"></td>
          </tr>
          <tr>
            <th scope="row" data-i18n="credits.fonts"></th>
            <td data-i18n="credits.fontsMap"></td>
          </tr>
          <tr>
            <th scope="row" data-i18n-aria="credits.fontsContAria"></th>
            <td data-i18n="credits.fontsPopup"></td>
          </tr>
        </tbody>
      </table>
      <div class="annotation-popup-body credits-popup-music">
        <p class="credits-popup-music-heading" data-i18n="credits.music"></p>
        <ul class="credits-popup-music-list">
          <li>
            <span class="credits-track" data-i18n="credits.trackMist"></span>
            <a href="https://www.youtube.com/watch?v=Me8y6EKQcYk" target="_blank" rel="noopener noreferrer">YouTube</a>
          </li>
          <li>
            <span class="credits-track" data-i18n="credits.trackChao"></span>
            <a href="https://www.youtube.com/watch?v=0JSjMvkaS8Q" target="_blank" rel="noopener noreferrer">YouTube</a>
          </li>
          <li>
            <span class="credits-track" data-i18n="credits.trackJing"></span>
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

  panel.querySelector('#credits-lang')?.addEventListener('click', (e) => {
    const target = e.target
    if (!(target instanceof HTMLButtonElement)) return
    const loc = target.dataset.locale
    if (loc !== 'zh-Hant' && loc !== 'zh-Hans' && loc !== 'en') return
    setLocale(loc)
  })

  if (CREDITS_SHOW_DEV_TOOLS) {
    onVertexEditorPanelVisible(() => syncEdgeEditButton())
    onVertexEditorAvailable(() => syncEdgeEditButton())
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) void closeCreditsPopup()
  })

  applyCreditsCopy()
  registerLocaleRefresh(applyCreditsCopy)

  return panel
}

export async function openCreditsPopup(): Promise<void> {
  const panel = ensurePanel()
  if (animating || open) return

  open = true
  animating = true
  applyCreditsCopy()
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
  btn.title = pressed ? t('toolbar.creditsHide') : t('toolbar.creditsShow')
}

/** Wire #btn-credits (功) to the credits popup. */
export function mountCreditsToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-credits')
  if (!btn) throw new Error('Missing #btn-credits')

  btn.setAttribute('aria-pressed', 'false')
  btn.title = t('toolbar.creditsShow')

  btn.addEventListener('click', () => {
    void toggleCreditsPopup()
  })

  // Prefetch panel so language + edge-edit wiring is ready before first open.
  ensurePanel()
}
