import type { Annotation } from '../lib/types'

let openId: string | null = null
let panelEl: HTMLElement | null = null
let titleEl: HTMLElement | null = null
let bodyEl: HTMLElement | null = null
let tableEl: HTMLTableElement | null = null
let closeBtn: HTMLButtonElement | null = null
let animating = false

const UNFOLD_MS = 600
const FOLD_MS = 450

function ensurePanel(): HTMLElement {
  if (panelEl) return panelEl

  const app = document.querySelector<HTMLElement>('#app')
  if (!app) throw new Error('Missing #app for annotation popup')

  const panel = document.createElement('aside')
  panel.id = 'annotation-popup'
  panel.className = 'annotation-popup'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.hidden = true

  panel.innerHTML = `
    <button type="button" class="annotation-popup-close badge-btn" id="annotation-popup-close" title="收 — Close" aria-label="Close"></button>
    <div class="annotation-popup-paper">
      <h2 class="annotation-popup-title" id="annotation-popup-title"></h2>
      <table class="annotation-popup-table" id="annotation-popup-table" hidden>
        <tbody></tbody>
      </table>
      <div class="annotation-popup-body" id="annotation-popup-body"></div>
    </div>
  `

  app.appendChild(panel)
  panelEl = panel
  titleEl = panel.querySelector('#annotation-popup-title')
  bodyEl = panel.querySelector('#annotation-popup-body')
  tableEl = panel.querySelector('#annotation-popup-table')
  closeBtn = panel.querySelector('#annotation-popup-close')

  closeBtn?.addEventListener('click', () => {
    void closeAnnotationPopup()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openId) void closeAnnotationPopup()
  })

  return panel
}

function renderAkaTable(annotation: Annotation): void {
  if (!tableEl) return
  const tbody = tableEl.querySelector('tbody')
  if (!tbody) return
  tbody.replaceChildren()

  const aka = annotation.aka?.filter((n) => n.trim()) ?? []
  if (aka.length === 0) {
    tableEl.hidden = true
    return
  }

  const row = document.createElement('tr')
  const th = document.createElement('th')
  th.scope = 'row'
  th.textContent = '省會'
  const td = document.createElement('td')
  td.textContent = aka.join('、')
  row.append(th, td)
  tbody.appendChild(row)
  tableEl.hidden = false
}

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

export async function openAnnotationPopup(annotation: Annotation): Promise<void> {
  const panel = ensurePanel()
  if (animating) return

  openId = annotation.id
  panel.setAttribute('aria-labelledby', 'annotation-popup-title')
  if (titleEl) titleEl.textContent = annotation.title
  renderAkaTable(annotation)
  if (bodyEl) {
    bodyEl.textContent = annotation.body?.trim() || ''
    bodyEl.hidden = !annotation.body?.trim()
  }
  panel.classList.toggle(
    'annotation-popup--long',
    (annotation.body?.trim().length ?? 0) > 180,
  )

  animating = true
  panel.classList.remove('is-folding', 'is-folded', 'is-open')
  panel.hidden = false
  panel.classList.add('is-animating')
  await waitForAnimation(panel, 'is-unfolding', UNFOLD_MS)
  panel.classList.remove('is-unfolding', 'is-animating')
  panel.classList.add('is-open')
  animating = false
  closeBtn?.focus()
}

export async function closeAnnotationPopup(): Promise<void> {
  if (!panelEl || !openId || animating) return
  const panel = panelEl
  const closingId = openId
  openId = null

  animating = true
  panel.classList.remove('is-open', 'is-unfolding')
  panel.classList.add('is-animating')
  await waitForAnimation(panel, 'is-folding', FOLD_MS)
  // Ignore if reopened during fold
  if (openId && openId !== closingId) {
    panel.classList.remove('is-folding', 'is-animating')
    animating = false
    return
  }
  panel.classList.remove('is-folding', 'is-animating')
  panel.classList.add('is-folded')
  panel.hidden = true
  animating = false
}

export function isAnnotationPopupOpen(id?: string): boolean {
  if (!openId) return false
  return id ? openId === id : true
}
