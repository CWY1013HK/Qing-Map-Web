import OpenSeadragon, { type Viewer, type TiledImage } from 'openseadragon'
import type { Annotation, AnnotationCollection } from '../lib/types'
import locationsJson from '../../data/annotations/locations.json'
import { registerLocaleRefresh, resolveAnnotation, t } from '../i18n'
import { labelStore } from './labelStore'
import {
  closeAnnotationPopup,
  isAnnotationPopupOpen,
  openAnnotationPopup,
} from './panel'
import { openCityEditor, type CityEditorSave } from './cityEditor'

const DEFAULT_LABEL_WIDTH = 0.03
/** Hit radius as fraction of image width for canvas-click fallback. */
const CLICK_HIT_FRAC = 0.016

type LabelHotspot = {
  annotation: Annotation
  el: HTMLButtonElement
}

function asCollection(raw: unknown): AnnotationCollection {
  return raw as AnnotationCollection
}

let lastToggleAt = 0
/** Dev editor: move and resize location-label boxes. */
let labelEditing = false
/** Dev editor: capture a city and edit entry text. */
let contentEditing = false

function openOrToggle(annotation: Annotation): void {
  const now = performance.now()
  if (now - lastToggleAt < 280) return
  lastToggleAt = now
  if (isAnnotationPopupOpen(annotation.id)) {
    closeAnnotationPopup()
  } else {
    openAnnotationPopup(annotation)
  }
}

function isAreaHotspot(annotation: Annotation): boolean {
  return annotation.hitWidth != null && annotation.hitHeight != null
}

const ANNOTATION_FIELDS = [
  'title',
  'body',
  'aka',
  'i18n',
  'chgis',
  'chgisCapital',
  'point',
  'tags',
  'labelImage',
  'labelWidth',
  'hitWidth',
  'hitHeight',
] as const

function applyAnnotation(target: Annotation, next: Annotation): void {
  for (const key of ANNOTATION_FIELDS) {
    if (next[key] === undefined) delete target[key]
    else target[key] = next[key] as never
  }
}

function buildHotspotButton(
  annotation: Annotation,
  onEdit?: (annotation: Annotation) => void,
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'map-label-btn'
  btn.dataset.annotationId = annotation.id
  const localized = resolveAnnotation(annotation)
  btn.title = localized.title
  btn.setAttribute('aria-label', localized.title)

  if (isAreaHotspot(annotation)) {
    btn.classList.add('map-label-btn--area')
    // Empty buttons can collapse; keep a hit target for OSD sizing.
    btn.innerHTML = '<span class="map-label-btn-area-fill" aria-hidden="true"></span>'
  } else if (annotation.labelImage) {
    const img = document.createElement('img')
    img.src = annotation.labelImage
    img.alt = ''
    img.draggable = false
    img.className = 'map-label-btn-img'
    btn.appendChild(img)
  } else {
    btn.classList.add('map-label-btn--text')
    btn.textContent = localized.title
  }

  const openUnlessDragged = (e?: Event) => {
    if (btn.dataset.suppressClick === '1') {
      btn.dataset.suppressClick = ''
      e?.preventDefault?.()
      e?.stopPropagation?.()
      return
    }
    if (contentEditing && onEdit) {
      e?.preventDefault?.()
      e?.stopPropagation?.()
      onEdit(annotation)
      return
    }
    if (labelEditing || contentEditing) return
    openOrToggle(annotation)
  }

  // Native click (works when the overlay sits above the OSD canvas)
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openUnlessDragged(e)
  })

  // OSD MouseTracker so pan/zoom gestures don't steal the press
  new OpenSeadragon.MouseTracker({
    element: btn,
    clickHandler: (event) => {
      const orig = event.originalEvent as Event | undefined
      orig?.preventDefault?.()
      orig?.stopPropagation?.()
      openUnlessDragged(orig)
    },
  })

  return btn
}

function placeHotspot(
  viewer: Viewer,
  item: TiledImage,
  hotspot: LabelHotspot,
): void {
  const { annotation, el } = hotspot
  const size = item.getContentSize()
  const imgW = size.x
  const imgH = size.y
  const cx = imgW * annotation.point.x
  const cy = imgH * annotation.point.y

  let widthImg: number
  let heightImg: number
  if (isAreaHotspot(annotation)) {
    widthImg = imgW * (annotation.hitWidth as number)
    heightImg = imgH * (annotation.hitHeight as number)
  } else {
    const fracW = annotation.labelWidth ?? DEFAULT_LABEL_WIDTH
    const img = el.querySelector<HTMLImageElement>('img')
    const localizedTitle = resolveAnnotation(annotation).title
    const aspect =
      img && img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : annotation.labelImage
          ? 921 / 980
          : localizedTitle.length >= 2
            ? localizedTitle.length * 0.55
            : 1.2
    widthImg = imgW * fracW
    heightImg = widthImg / aspect
  }

  const topLeft = item.imageToViewportCoordinates(cx - widthImg / 2, cy - heightImg / 2)
  const bottomRight = item.imageToViewportCoordinates(
    cx + widthImg / 2,
    cy + heightImg / 2,
  )
  const loc = new OpenSeadragon.Rect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  )

  if (el.dataset.osdAttached === '1') {
    viewer.updateOverlay(el, loc)
  } else {
    viewer.addOverlay({
      element: el,
      location: loc,
      checkResize: false,
    })
    el.dataset.osdAttached = '1'
  }

  // OSD wraps overlays; force the wrapper to receive pointer events
  const wrap = el.parentElement
  if (wrap && wrap !== viewer.element) {
    wrap.classList.add('map-label-overlay')
    wrap.style.pointerEvents = 'auto'
  }
  el.style.pointerEvents = 'auto'
}

const DRAG_THRESHOLD_PX = 4
const MIN_HIT = 0.008
const HANDLE_EDGES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type HandleEdge = (typeof HANDLE_EDGES)[number]
type BoxEdge = HandleEdge | 'move'

function roundCoord(n: number): number {
  return Math.round(n * 10000) / 10000
}

export type AnnotationEditMode = 'off' | 'labels' | 'annotations'

export type AnnotationEditHandle = {
  setEditing(mode: AnnotationEditMode): void
  save(): Promise<void>
  setOnDirty(fn: (() => void) | null): void
}

let annotationEditHandle: AnnotationEditHandle | null = null

export function getAnnotationEditHandle(): AnnotationEditHandle | null {
  return annotationEditHandle
}

function ensureResizeHandles(el: HTMLButtonElement): void {
  if (el.querySelector('.annot-handle')) return
  for (const edge of HANDLE_EDGES) {
    const handle = document.createElement('span')
    handle.className = `annot-handle annot-handle--${edge}`
    handle.dataset.edge = edge
    el.appendChild(handle)
  }
}

/**
 * Dev-only geometry edits. Active only in the editor's Location labels mode.
 * Drag the box to move it; drag an edge or corner to resize. Save writes locations.json.
 */
function attachAreaEdit(
  viewer: Viewer,
  item0: () => TiledImage | null,
  hotspot: LabelHotspot,
  markDirty: (id: string) => void,
): void {
  if (!import.meta.env.DEV) return
  const { annotation, el } = hotspot
  if (!isAreaHotspot(annotation)) return
  ensureResizeHandles(el)

  type Drag = {
    pointerId: number
    edge: BoxEdge
    startClientX: number
    startClientY: number
    startImgX: number
    startImgY: number
    left: number
    right: number
    top: number
    bottom: number
    moved: boolean
    navWas: boolean
  }
  let drag: Drag | null = null

  const toImage = (e: PointerEvent) => {
    const item = item0()
    if (!item) return null
    const rect = viewer.element.getBoundingClientRect()
    return item.viewerElementToImageCoordinates(
      new OpenSeadragon.Point(e.clientX - rect.left, e.clientY - rect.top),
    )
  }

  el.addEventListener(
    'pointerdown',
    (e) => {
      if (!labelEditing || e.button !== 0) return
      if (el.classList.contains('is-hidden') || el.classList.contains('is-intro-hidden')) return
      const img = toImage(e)
      if (!img) return
      const target = e.target as HTMLElement | null
      const edge = (target?.dataset.edge as HandleEdge | undefined) ?? 'move'
      e.preventDefault()
      e.stopPropagation()
      el.setPointerCapture(e.pointerId)
      const w = annotation.hitWidth as number
      const h = annotation.hitHeight as number
      drag = {
        pointerId: e.pointerId,
        edge,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startImgX: img.x,
        startImgY: img.y,
        left: annotation.point.x - w / 2,
        right: annotation.point.x + w / 2,
        top: annotation.point.y - h / 2,
        bottom: annotation.point.y + h / 2,
        moved: false,
        navWas: viewer.isMouseNavEnabled(),
      }
      viewer.setMouseNavEnabled(false)
    },
    true,
  )

  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (!drag.moved) {
      const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
      if (dist < DRAG_THRESHOLD_PX) return
      drag.moved = true
      el.classList.add('is-dragging')
      el.dataset.suppressClick = '1'
    }
    const img = toImage(e)
    const item = item0()
    if (!img || !item) return
    const size = item.getContentSize()
    const dx = (img.x - drag.startImgX) / size.x
    const dy = (img.y - drag.startImgY) / size.y
    let left = drag.left
    let right = drag.right
    let top = drag.top
    let bottom = drag.bottom
    const edge = drag.edge
    if (edge === 'move') {
      left += dx
      right += dx
      top += dy
      bottom += dy
    } else {
      if (edge.includes('e')) right += dx
      if (edge.includes('w')) left += dx
      if (edge.includes('s')) bottom += dy
      if (edge.includes('n')) top += dy
    }
    if (right - left < MIN_HIT) {
      if (edge.includes('w')) left = right - MIN_HIT
      else right = left + MIN_HIT
    }
    if (bottom - top < MIN_HIT) {
      if (edge.includes('n')) top = bottom - MIN_HIT
      else bottom = top + MIN_HIT
    }
    annotation.point.x = (left + right) / 2
    annotation.point.y = (top + bottom) / 2
    annotation.hitWidth = right - left
    annotation.hitHeight = bottom - top
    placeHotspot(viewer, item, hotspot)
  })

  const finish = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const moved = drag.moved
    const navWas = drag.navWas
    drag = null
    el.classList.remove('is-dragging')
    viewer.setMouseNavEnabled(navWas)
    if (!moved) return
    annotation.point.x = roundCoord(annotation.point.x)
    annotation.point.y = roundCoord(annotation.point.y)
    annotation.hitWidth = roundCoord(annotation.hitWidth as number)
    annotation.hitHeight = roundCoord(annotation.hitHeight as number)
    const item = item0()
    if (item) placeHotspot(viewer, item, hotspot)
    const title = resolveAnnotation(annotation).title
    el.title = `${title} · ${annotation.point.x}, ${annotation.point.y} · ${annotation.hitWidth}×${annotation.hitHeight}`
    markDirty(annotation.id)
  }

  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', finish)
}

/**
 * Mount glowing location-label hotspots from annotations JSON.
 * Visibility is controlled by labelStore (誌 toolbar toggle).
 */
export function mountLocationLabels(viewer: Viewer): () => void {
  const collection = asCollection(locationsJson)
  const item0 = () => viewer.world.getItemAt(0) as TiledImage | null

  let editorOpen = false
  let lastEditAt = 0
  let detachCapture: (() => void) | null = null
  const dirtyIds = new Set<string>()
  let onDirty: (() => void) | null = null

  const setVertexStatus = (message: string, kind: 'ok' | 'err' | 'busy' | 'idle') => {
    const statusEl = document.getElementById('vertex-edit-status')
    if (!statusEl) return
    statusEl.textContent = message
    statusEl.dataset.kind = kind
  }

  async function postEntry(mode: 'insert' | 'update', payload: CityEditorSave) {
    const res = await fetch('/__dev/annotations/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ...payload }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) throw new Error(data.error ?? `Save failed (${res.status})`)
    return {
      annotation: data.annotation as Annotation,
      warning: (data.warning as string | null) ?? null,
    }
  }

  const hotspots: LabelHotspot[] = []

  function placeOne(hotspot: LabelHotspot) {
    const item = item0()
    if (!item) return
    const img = hotspot.el.querySelector<HTMLImageElement>('img')
    if (img && !img.complete) {
      img.addEventListener('load', () => placeHotspot(viewer, item, hotspot), { once: true })
    }
    placeHotspot(viewer, item, hotspot)
  }

  function syncOneVisibility(el: HTMLButtonElement) {
    const on = labelStore.isVisible()
    el.classList.toggle('is-hidden', !on)
    el.tabIndex = on ? 0 : -1
    el.setAttribute('aria-hidden', on ? 'false' : 'true')
    const wrap = el.parentElement
    if (wrap?.classList.contains('map-label-overlay')) {
      wrap.style.pointerEvents = on ? 'auto' : 'none'
    }
  }

  function refreshHotspot(hotspot: LabelHotspot) {
    const localized = resolveAnnotation(hotspot.annotation)
    hotspot.el.title = localized.title
    hotspot.el.setAttribute('aria-label', localized.title)
    if (hotspot.el.classList.contains('map-label-btn--text')) {
      hotspot.el.textContent = localized.title
    }
    placeOne(hotspot)
  }

  function addHotspot(annotation: Annotation) {
    const hotspot: LabelHotspot = {
      annotation,
      el: buildHotspotButton(annotation, requestEdit),
    }
    hotspots.push(hotspot)
    if (import.meta.env.DEV) {
      attachAreaEdit(viewer, item0, hotspot, (id) => {
        dirtyIds.add(id)
        onDirty?.()
      })
    }
    if (labelEditing && isAreaHotspot(annotation)) {
      hotspot.el.classList.add('is-annot-editing')
    }
    if (document.getElementById('app')?.classList.contains('intro-active')) {
      hotspot.el.classList.add('is-intro-hidden')
    }
    placeOne(hotspot)
    syncOneVisibility(hotspot.el)
  }

  function removeHotspot(id: string) {
    const index = hotspots.findIndex((hotspot) => hotspot.annotation.id === id)
    if (index < 0) return
    const { el } = hotspots[index]
    try {
      viewer.removeOverlay(el)
    } catch {
      /* already gone */
    }
    el.remove()
    hotspots.splice(index, 1)
    dirtyIds.delete(id)
    if (isAnnotationPopupOpen(id)) closeAnnotationPopup()
  }

  async function editAnnotation(annotation: Annotation) {
    if (!import.meta.env.DEV || editorOpen) return
    editorOpen = true
    try {
      const result = await openCityEditor({
        mode: 'update',
        annotation,
        onSave: (payload) => postEntry('update', payload),
        onDelete: async () => {
          const res = await fetch('/__dev/annotations/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: annotation.id }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.ok) throw new Error(data.error ?? `Delete failed (${res.status})`)
        },
      })
      if (result.action === 'saved') {
        applyAnnotation(annotation, result.annotation)
        const hotspot = hotspots.find((item) => item.annotation.id === annotation.id)
        if (hotspot) refreshHotspot(hotspot)
        setVertexStatus(
          result.warning ? `Saved. Translation failed: ${result.warning}` : `Saved ${annotation.id}`,
          result.warning ? 'err' : 'ok',
        )
      } else if (result.action === 'deleted') {
        removeHotspot(annotation.id)
        setVertexStatus(`Deleted ${annotation.id}`, 'ok')
      }
    } finally {
      editorOpen = false
    }
  }

  function requestEdit(annotation: Annotation) {
    const now = performance.now()
    if (now - lastEditAt < 280) return
    lastEditAt = now
    void editAnnotation(annotation)
  }

  function clientToNorm(clientX: number, clientY: number) {
    const item = item0()
    if (!item) return null
    const rect = viewer.element.getBoundingClientRect()
    const img = item.viewerElementToImageCoordinates(
      new OpenSeadragon.Point(clientX - rect.left, clientY - rect.top),
    )
    const size = item.getContentSize()
    return {
      x: Math.min(1, Math.max(0, img.x / size.x)),
      y: Math.min(1, Math.max(0, img.y / size.y)),
    }
  }

  async function captureRect(ax: number, ay: number, bx: number, by: number) {
    if (editorOpen) return
    const p0 = clientToNorm(Math.min(ax, bx), Math.min(ay, by))
    const p1 = clientToNorm(Math.max(ax, bx), Math.max(ay, by))
    if (!p0 || !p1) return
    editorOpen = true
    setVertexStatus('Cropping highest-resolution tiles…', 'busy')
    try {
      const res = await fetch('/__dev/annotations/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Crop failed (${res.status})`)
      setVertexStatus('Crop ready. Fill in the city and insert.', 'ok')
      const draft: Annotation = {
        id: '',
        title: '',
        point: {
          x: roundCoord((p0.x + p1.x) / 2),
          y: roundCoord((p0.y + p1.y) / 2),
        },
        labelWidth: roundCoord(Math.abs(p1.x - p0.x)),
        tags: ['city-capture'],
      }
      const result = await openCityEditor({
        mode: 'insert',
        annotation: draft,
        pngBase64: data.pngBase64 as string,
        onSave: (payload) => postEntry('insert', payload),
      })
      if (result.action === 'saved') {
        addHotspot(result.annotation)
        setVertexStatus(
          result.warning
            ? `Inserted. Translation failed: ${result.warning}`
            : `Inserted ${result.annotation.id}`,
          result.warning ? 'err' : 'ok',
        )
      } else {
        setVertexStatus('Capture cancelled', 'idle')
      }
    } catch (err) {
      setVertexStatus(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      editorOpen = false
    }
  }

  function attachCapture(): () => void {
    const band = document.createElement('div')
    band.className = 'annotation-capture-band'
    band.hidden = true
    document.body.appendChild(band)
    const canvas = viewer.canvas as unknown as HTMLElement
    let drag: { pointerId: number; x0: number; y0: number; x1: number; y1: number } | null = null

    const onDown = (event: PointerEvent) => {
      if (!contentEditing || editorOpen || event.button !== 0) return
      if (!canvas.contains(event.target as Node)) return
      drag = {
        pointerId: event.pointerId,
        x0: event.clientX,
        y0: event.clientY,
        x1: event.clientX,
        y1: event.clientY,
      }
      canvas.setPointerCapture(event.pointerId)
    }
    const onMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      drag.x1 = event.clientX
      drag.y1 = event.clientY
      const left = Math.min(drag.x0, drag.x1)
      const top = Math.min(drag.y0, drag.y1)
      band.hidden = false
      band.style.left = `${left}px`
      band.style.top = `${top}px`
      band.style.width = `${Math.abs(drag.x1 - drag.x0)}px`
      band.style.height = `${Math.abs(drag.y1 - drag.y0)}px`
    }
    const finish = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      const box = drag
      drag = null
      band.hidden = true
      if (Math.abs(box.x1 - box.x0) < 12 || Math.abs(box.y1 - box.y0) < 12) return
      void captureRect(box.x0, box.y0, box.x1, box.y1)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', finish)
    canvas.addEventListener('pointercancel', finish)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', finish)
      canvas.removeEventListener('pointercancel', finish)
      band.remove()
    }
  }

  for (const annotation of collection.annotations) addHotspot(annotation)

  const setEditing = (mode: AnnotationEditMode) => {
    labelEditing = mode === 'labels'
    contentEditing = mode === 'annotations'
    const app = document.getElementById('app')
    app?.classList.toggle('label-editing', labelEditing)
    app?.classList.toggle('annotation-editing', contentEditing)
    if (labelEditing || contentEditing) {
      labelStore.setVisible(true)
      closeAnnotationPopup()
    }
    for (const hotspot of hotspots) {
      if (!isAreaHotspot(hotspot.annotation)) continue
      hotspot.el.classList.toggle('is-annot-editing', labelEditing)
    }
  }
  if (import.meta.env.DEV) {
    detachCapture = attachCapture()
    annotationEditHandle = {
      setEditing,
      setOnDirty(fn) {
        onDirty = fn
      },
      async save() {
        const ids = [...dirtyIds]
        for (const id of ids) {
          const hotspot = hotspots.find((h) => h.annotation.id === id)
          if (!hotspot) continue
          const { annotation } = hotspot
          const res = await fetch('/__dev/annotations/point', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              x: annotation.point.x,
              y: annotation.point.y,
              hitWidth: annotation.hitWidth,
              hitHeight: annotation.hitHeight,
            }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error ?? `Save failed (${res.status})`)
          }
          dirtyIds.delete(id)
        }
      },
    }
  }

  const syncHotspotLocale = () => {
    for (const { annotation, el } of hotspots) {
      const localized = resolveAnnotation(annotation)
      el.title = localized.title
      el.setAttribute('aria-label', localized.title)
      if (el.classList.contains('map-label-btn--text')) {
        el.textContent = localized.title
      }
    }
  }

  registerLocaleRefresh(syncHotspotLocale)

  const syncVisibility = () => {
    const on = labelStore.isVisible()
    for (const { el } of hotspots) {
      el.classList.toggle('is-hidden', !on)
      el.tabIndex = on ? 0 : -1
      el.setAttribute('aria-hidden', on ? 'false' : 'true')
      const wrap = el.parentElement
      if (wrap?.classList.contains('map-label-overlay')) {
        wrap.style.pointerEvents = on ? 'auto' : 'none'
      }
    }
    if (!on) closeAnnotationPopup()
  }

  const placeAll = () => {
    const item = item0()
    if (!item) return
    for (const hotspot of hotspots) {
      const img = hotspot.el.querySelector<HTMLImageElement>('img')
      if (img && !img.complete) {
        img.addEventListener('load', () => placeHotspot(viewer, item, hotspot), {
          once: true,
        })
      }
      placeHotspot(viewer, item, hotspot)
    }
    syncVisibility()
  }

  const onOpen = () => placeAll()
  if (item0()) placeAll()
  else viewer.addHandler('open', onOpen)

  viewer.world.addHandler('add-item', placeAll)

  // Canvas-click fallback: hit-test annotation points in image space
  const onCanvasClick = (event: OpenSeadragon.CanvasClickEvent) => {
    if (!labelStore.isVisible()) return
    if (!event.quick) return
    const item = item0()
    if (!item) return
    const app = document.getElementById('app')
    if (
      labelEditing ||
      contentEditing ||
      app?.classList.contains('intro-active') ||
      app?.classList.contains('focus-mode')
    ) {
      return
    }

    const imgPt = item.viewerElementToImageCoordinates(event.position)
    const size = item.getContentSize()
    const hitR = size.x * CLICK_HIT_FRAC

    let best: { annotation: Annotation; dist: number } | null = null
    for (const { annotation, el } of hotspots) {
      if (el.classList.contains('is-hidden') || el.classList.contains('is-intro-hidden')) {
        continue
      }
      const ax = size.x * annotation.point.x
      const ay = size.y * annotation.point.y
      if (isAreaHotspot(annotation)) {
        const halfW = size.x * (annotation.hitWidth as number) * 0.5
        const halfH = size.y * (annotation.hitHeight as number) * 0.5
        if (
          imgPt.x >= ax - halfW &&
          imgPt.x <= ax + halfW &&
          imgPt.y >= ay - halfH &&
          imgPt.y <= ay + halfH
        ) {
          const dist = Math.hypot(imgPt.x - ax, imgPt.y - ay)
          if (!best || dist < best.dist) best = { annotation, dist }
        }
        continue
      }
      const dx = imgPt.x - ax
      const dy = imgPt.y - ay
      const dist = Math.hypot(dx, dy)
      if (dist <= hitR && (!best || dist < best.dist)) {
        best = { annotation, dist }
      }
    }
    if (best) {
      event.preventDefaultAction = true
      openOrToggle(best.annotation)
    }
  }
  viewer.addHandler('canvas-click', onCanvasClick)

  const unsub = labelStore.subscribe(syncVisibility)
  syncVisibility()

  const app = document.querySelector<HTMLElement>('#app')
  const rootClass = 'labels-ready'
  if (app?.classList.contains('intro-active')) {
    app.classList.remove(rootClass)
    for (const { el } of hotspots) el.classList.add('is-intro-hidden')
    window.addEventListener(
      'qing-map-intro-done',
      () => {
        for (const { el } of hotspots) el.classList.remove('is-intro-hidden')
        app.classList.add(rootClass)
        syncVisibility()
      },
      { once: true },
    )
  } else {
    app?.classList.add(rootClass)
  }

  return () => {
    if (annotationEditHandle?.setEditing === setEditing) {
      annotationEditHandle.setEditing('off')
      annotationEditHandle = null
    }
    detachCapture?.()
    unsub()
    viewer.removeHandler('open', onOpen)
    viewer.removeHandler('canvas-click', onCanvasClick)
    viewer.world.removeHandler('add-item', placeAll)
    for (const { el } of hotspots) {
      try {
        viewer.removeOverlay(el)
      } catch {
        /* already gone */
      }
      el.remove()
    }
    closeAnnotationPopup()
  }
}

/** Wire #btn-toggle-labels (誌) to labelStore. */
export function mountLabelToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-toggle-labels')
  if (!btn) return

  const sync = () => {
    const on = labelStore.isVisible()
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    btn.title = on ? t('toolbar.labelsHide') : t('toolbar.labelsShow')
    btn.classList.toggle('is-pressed', on)
  }

  btn.addEventListener('click', () => {
    labelStore.toggle()
    sync()
  })

  labelStore.subscribe(sync)
  sync()
}
