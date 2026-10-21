import { registerLocaleRefresh, resolveAnnotation, resolveChgisName, t } from '../i18n'
import type { Annotation, AnnotationChgis } from '../lib/types'

let openId: string | null = null
let openAnnotation: Annotation | null = null
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
    <button type="button" class="annotation-popup-close badge-btn" id="annotation-popup-close" title="" aria-label=""></button>
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

  applyPopupChrome()
  registerLocaleRefresh(() => {
    applyPopupChrome()
    if (openAnnotation) fillAnnotationContent(openAnnotation)
  })

  return panel
}

function applyPopupChrome(): void {
  closeBtn?.setAttribute('title', t('popup.close'))
  closeBtn?.setAttribute('aria-label', t('popup.closeAria'))
}

function appendChgisRow(tbody: HTMLElement, chgis: AnnotationChgis | undefined, label: string): void {
  if (!chgis?.uri) return
  const row = document.createElement('tr')
  const th = document.createElement('th')
  th.scope = 'row'
  th.textContent = label
  const td = document.createElement('td')
  const link = document.createElement('a')
  link.className = 'annotation-popup-chgis'
  link.href = chgis.uri
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = resolveChgisName(chgis) || chgis.id
  td.appendChild(link)
  row.append(th, td)
  tbody.appendChild(row)
}

function renderMetaTable(annotation: Annotation): void {
  if (!tableEl) return
  const tbody = tableEl.querySelector('tbody')
  if (!tbody) return
  tbody.replaceChildren()

  const names = resolveAnnotation(annotation).aka?.filter((n) => n.trim()) ?? []
  if (names.length > 0) {
    const row = document.createElement('tr')
    const th = document.createElement('th')
    th.scope = 'row'
    th.textContent = t('popup.aka')
    const td = document.createElement('td')
    td.textContent = names.join('、')
    row.append(th, td)
    tbody.appendChild(row)
  }

  appendChgisRow(tbody, annotation.chgisCapital, t('popup.chgisCapital'))
  appendChgisRow(tbody, annotation.chgis, names.length > 0 ? t('popup.chgisProvince') : t('popup.chgis'))

  tableEl.hidden = tbody.childElementCount === 0
}

function fillAnnotationContent(annotation: Annotation): void {
  const localized = resolveAnnotation(annotation)
  if (titleEl) titleEl.textContent = localized.title
  renderMetaTable(annotation)
  if (bodyEl) {
    const raw = localized.body ?? ''
    bodyEl.textContent = raw.replace(/[ \t\n]+$/, '')
    bodyEl.hidden = !raw.trim()
  }
  const lines = (localized.body ?? '').split('\n').filter((line) => line.trim().length > 0)
  const unwrapped = lines.length >= 3
  panelEl?.classList.toggle(
    'annotation-popup--long',
    (localized.body?.trim().length ?? 0) > 180,
  )
  panelEl?.classList.toggle('annotation-popup--unwrapped', unwrapped)
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
  openAnnotation = annotation
  panel.setAttribute('aria-labelledby', 'annotation-popup-title')
  fillAnnotationContent(annotation)

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
  openAnnotation = null

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
