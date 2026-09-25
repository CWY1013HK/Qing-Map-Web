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

function buildHotspotButton(annotation: Annotation): HTMLButtonElement {
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

  // Native click (works when the overlay sits above the OSD canvas)
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openOrToggle(annotation)
  })

  // OSD MouseTracker so pan/zoom gestures don't steal the press
  new OpenSeadragon.MouseTracker({
    element: btn,
    clickHandler: (event) => {
      const orig = event.originalEvent as Event | undefined
      orig?.preventDefault?.()
      orig?.stopPropagation?.()
      openOrToggle(annotation)
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

/**
 * Mount glowing location-label hotspots from annotations JSON.
 * Visibility is controlled by labelStore (誌 toolbar toggle).
 */
export function mountLocationLabels(viewer: Viewer): () => void {
  const collection = asCollection(locationsJson)
  const item0 = () => viewer.world.getItemAt(0) as TiledImage | null

  const hotspots: LabelHotspot[] = collection.annotations.map((annotation) => ({
    annotation,
    el: buildHotspotButton(annotation),
  }))

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
    if (app?.classList.contains('intro-active') || app?.classList.contains('focus-mode')) {
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
