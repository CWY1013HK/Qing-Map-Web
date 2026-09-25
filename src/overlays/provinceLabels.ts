/**
 * Province name plates linked to 漢地 / 中國 outline seals.
 * One shared position+scale per province; a styled copy is rendered per attachment.
 */
import OpenSeadragon, { type Viewer, type TiledImage } from 'openseadragon'
import provinceLabelsJson from '../../data/overlays/province-labels.json'
import { registerLocaleRefresh, resolveProvinceTitle } from '../i18n'
import type {
  ProvinceLabel,
  ProvinceLabelAttachment,
  ProvinceLabelCollection,
} from '../lib/types'
import { HANDI_GROUP_ID, ZHONGGUO_GROUP_ID, HAILU_GROUP_ID } from './manager'
import { overlayStore } from './store'

/** Base font size in viewBox units (~1% of map width). */
export const PROVINCE_LABEL_BASE_SIZE = 0.0105

const ATTACH_CLASS: Record<ProvinceLabelAttachment, string> = {
  'handi-shibasheng': 'province-label--handi',
  zhongguo: 'province-label--zhongguo',
  hailu: 'province-label--hailu',
}

const GROUP_FOR: Record<ProvinceLabelAttachment, string> = {
  'handi-shibasheng': HANDI_GROUP_ID,
  zhongguo: ZHONGGUO_GROUP_ID,
  hailu: HAILU_GROUP_ID,
}

/** Live mutable collection (vertex editor mutates in place, Save writes to disk). */
let collection: ProvinceLabelCollection = structuredClone(
  provinceLabelsJson as ProvinceLabelCollection,
)

type LabelListener = () => void
const listeners = new Set<LabelListener>()

function notify(): void {
  for (const cb of listeners) cb()
}

export function getProvinceLabelCollection(): ProvinceLabelCollection {
  return collection
}

export function replaceProvinceLabelCollection(
  next: ProvinceLabelCollection,
): void {
  collection = next
  notify()
}

export function subscribeProvinceLabels(cb: LabelListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function updateProvinceLabel(
  id: string,
  patch: Partial<Pick<ProvinceLabel, 'point' | 'scale'>>,
): void {
  const label = collection.labels.find((l) => l.id === id)
  if (!label) return
  if (patch.point) label.point = patch.point
  if (patch.scale != null) label.scale = patch.scale
  notify()
}

export type ProvinceLabelsHandle = {
  root: HTMLDivElement
  setEditing: (on: boolean) => void
  setSelectedId: (id: string | null) => void
  destroy: () => void
}

/**
 * Full-map SVG of province names. Visibility follows overlay seals;
 * linked attachments share one data record but draw as separate styled nodes.
 */
export function mountProvinceLabels(viewer: Viewer): ProvinceLabelsHandle {
  const root = document.createElement('div')
  root.className = 'province-labels-layer'
  root.setAttribute('aria-hidden', 'true')

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 1 1')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.classList.add('province-labels-svg')

  // Paint order: hailu under handi under zhongguo (matches outline stacking).
  // Hit pads sit on top with no CSS filter — filters inflate SVG hit boxes
  // so the last label (青海) was stealing every drag.
  const hailuG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const handiG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const zhongG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const hitG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  hailuG.classList.add('province-labels-group', 'province-labels-group--hailu')
  handiG.classList.add('province-labels-group', 'province-labels-group--handi')
  zhongG.classList.add('province-labels-group', 'province-labels-group--zhongguo')
  hitG.classList.add('province-labels-hits')
  hailuG.dataset.attachment = HAILU_GROUP_ID
  handiG.dataset.attachment = HANDI_GROUP_ID
  zhongG.dataset.attachment = ZHONGGUO_GROUP_ID
  svg.append(hailuG, handiG, zhongG, hitG)
  root.appendChild(svg)

  const groupEl: Record<ProvinceLabelAttachment, SVGGElement> = {
    hailu: hailuG,
    'handi-shibasheng': handiG,
    zhongguo: zhongG,
  }

  const textByKey = new Map<string, SVGTextElement>()
  const hitById = new Map<string, SVGRectElement>()
  let selectedId: string | null = null
  let editing = false

  const makeText = (
    label: ProvinceLabel,
    attachment: ProvinceLabelAttachment,
  ): SVGTextElement => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    t.classList.add('province-label', ATTACH_CLASS[attachment])
    t.dataset.labelId = label.id
    t.dataset.attachment = attachment
    t.setAttribute('text-anchor', 'middle')
    t.setAttribute('dominant-baseline', 'middle')
    t.setAttribute('pointer-events', 'none')
    t.textContent = resolveProvinceTitle(label.id, label.title)
    return t
  }

  const makeHit = (label: ProvinceLabel): SVGRectElement => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    r.classList.add('province-label-hit')
    r.dataset.labelId = label.id
    r.setAttribute('pointer-events', 'all')
    return r
  }

  const syncSelection = () => {
    for (const t of textByKey.values()) {
      t.classList.toggle('is-selected', editing && t.dataset.labelId === selectedId)
    }
    for (const [id, r] of hitById) {
      r.classList.toggle('is-selected', editing && id === selectedId)
    }
  }

  const layoutHit = (label: ProvinceLabel, r: SVGRectElement) => {
    const size = PROVINCE_LABEL_BASE_SIZE * (label.scale ?? 1)
    // Prefer live glyph bounds so the cyan box == the hit target.
    const displayTitle = resolveProvinceTitle(label.id, label.title)
    let w = size * Math.max(1, displayTitle.length) * 1.05
    let h = size * 1.25
    let cx = label.point.x
    let cy = label.point.y
    for (const att of label.attachments) {
      const t = textByKey.get(`${label.id}:${att}`)
      if (!t || t.closest('.province-labels-group:not(.is-active)')) continue
      try {
        const bb = t.getBBox()
        if (bb.width > 0 && bb.height > 0) {
          w = bb.width
          h = bb.height
          cx = bb.x + bb.width / 2
          cy = bb.y + bb.height / 2
          break
        }
      } catch {
        /* not rendered yet */
      }
    }
    r.setAttribute('x', String(cx - w / 2))
    r.setAttribute('y', String(cy - h / 2))
    r.setAttribute('width', String(w))
    r.setAttribute('height', String(h))
  }

  const syncLocaleTexts = () => {
    for (const label of collection.labels) {
      const title = resolveProvinceTitle(label.id, label.title)
      for (const att of label.attachments) {
        const el = textByKey.get(`${label.id}:${att}`)
        if (el) el.textContent = title
      }
    }
    requestAnimationFrame(() => syncPositions())
  }

  const syncPositions = () => {
    for (const label of collection.labels) {
      const size = PROVINCE_LABEL_BASE_SIZE * (label.scale ?? 1)
      for (const att of label.attachments) {
        const t = textByKey.get(`${label.id}:${att}`)
        if (!t) continue
        t.setAttribute('x', String(label.point.x))
        t.setAttribute('y', String(label.point.y))
        t.setAttribute('font-size', String(size))
      }
      const hit = hitById.get(label.id)
      if (hit) layoutHit(label, hit)
    }
  }

  const syncVisibility = () => {
    const hailuOn = overlayStore.isVisible(HAILU_GROUP_ID)
    const handiOn = overlayStore.isVisible(HANDI_GROUP_ID)
    const zhongOn = overlayStore.isVisible(ZHONGGUO_GROUP_ID)
    const onByGroup: Record<string, boolean> = {
      [HAILU_GROUP_ID]: hailuOn,
      [HANDI_GROUP_ID]: handiOn,
      [ZHONGGUO_GROUP_ID]: zhongOn,
    }
    hailuG.classList.toggle('is-active', hailuOn)
    handiG.classList.toggle('is-active', handiOn)
    zhongG.classList.toggle('is-active', zhongOn)
    root.classList.toggle('is-active', hailuOn || handiOn || zhongOn)

    // Hit pad only when at least one of its attachments is visible (or always while editing).
    for (const label of collection.labels) {
      const hit = hitById.get(label.id)
      if (!hit) continue
      const show =
        editing ||
        label.attachments.some((a) => onByGroup[GROUP_FOR[a]] === true)
      hit.style.display = show ? '' : 'none'
    }
  }

  const syncEditChrome = () => {
    root.classList.toggle('is-editing', editing)
    hitG.classList.toggle('is-editing', editing)
    document.querySelector('#app')?.classList.toggle('province-label-editing', editing)
    const wrap = root.parentElement
    if (wrap && wrap !== viewer.element) {
      wrap.classList.add('province-labels-layer-wrap')
      wrap.classList.toggle('is-editing', editing)
      // While editing, the wrap must accept hits so pads work; empty areas are
      // non-interactive (root/svg are pointer-events:none, only pads are all).
      // Pan is disabled in province edit mode by the vertex editor.
      wrap.style.pointerEvents = editing ? 'auto' : 'none'
    }
    syncVisibility()
    syncSelection()
    requestAnimationFrame(() => syncPositions())
  }

  const rebuild = () => {
    hailuG.replaceChildren()
    handiG.replaceChildren()
    zhongG.replaceChildren()
    hitG.replaceChildren()
    textByKey.clear()
    hitById.clear()
    for (const label of collection.labels) {
      for (const att of label.attachments) {
        const t = makeText(label, att)
        groupEl[att].appendChild(t)
        textByKey.set(`${label.id}:${att}`, t)
      }
      const hit = makeHit(label)
      hitG.appendChild(hit)
      hitById.set(label.id, hit)
    }
    syncPositions()
    syncVisibility()
    syncSelection()
  }

  rebuild()

  const unsubLocale = registerLocaleRefresh(syncLocaleTexts)

  let attached = false
  const place = () => {
    const item = viewer.world.getItemAt(0) as TiledImage | null
    if (!item) return
    const bounds = item.getBounds()
    const loc = new OpenSeadragon.Rect(bounds.x, bounds.y, bounds.width, bounds.height)
    if (!attached) {
      viewer.addOverlay({ element: root, location: loc, checkResize: false })
      attached = true
    } else {
      viewer.updateOverlay(root, loc)
    }
    syncEditChrome()
  }

  const onOpen = () => place()
  if (viewer.world.getItemAt(0)) place()
  else viewer.addHandler('open', onOpen)

  const unsubStore = overlayStore.subscribe(syncVisibility)
  const unsubData = subscribeProvinceLabels(() => {
    syncPositions()
    syncSelection()
    syncLocaleTexts()
  })

  return {
    root,
    setEditing(on) {
      editing = on
      syncEditChrome()
    },
    setSelectedId(id) {
      selectedId = id
      syncSelection()
    },
    destroy() {
      unsubStore()
      unsubData()
      unsubLocale()
      document.querySelector('#app')?.classList.remove('province-label-editing')
      viewer.removeHandler('open', onOpen)
      if (attached) {
        try {
          viewer.removeOverlay(root)
        } catch {
          /* */
        }
        attached = false
      }
      root.remove()
    },
  }
}
