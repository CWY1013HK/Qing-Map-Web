/**
 * Dev-only overlay vertex editor.
 * Drag handles to reshape outlines; province-label mode for drag/scale name plates.
 * Saves JSON to disk via /__dev/overlays/save.
 */
import OpenSeadragon, { type Viewer, type TiledImage } from 'openseadragon'
import type { MapPoint, MapRing, OverlayCollection, OverlayFeature } from '../lib/types'
import { overlayStore } from './store'
import {
  getOverlayManager,
  HANDI_GROUP_ID,
  ZHONGGUO_GROUP_ID,
  HAILU_GROUP_ID,
} from './manager'
import {
  getProvinceLabelCollection,
  updateProvinceLabel,
  type ProvinceLabelsHandle,
} from './provinceLabels'
import {
  isVertexEditorPanelVisible,
  markVertexEditorAvailable,
  onVertexEditorPanelVisible,
} from './vertexEditorChrome'

type DragState = {
  fileKey: string
  featureId: string
  ringIndex: number
  pointIndex: number
}

type ProvinceDragState = {
  labelId: string
}

const FILE_KEYS: { key: string; groupId: string; label: string }[] = [
  { key: 'handi-shibasheng', groupId: HANDI_GROUP_ID, label: '漢地十八省' },
  { key: 'zhongguo', groupId: ZHONGGUO_GROUP_ID, label: '中國疆域' },
  { key: 'hailu', groupId: HAILU_GROUP_ID, label: '海路一覽' },
]

const PROVINCE_FILE_KEY = 'province-labels'

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

async function saveCollection(fileKey: string, collection: unknown): Promise<void> {
  const res = await fetch('/__dev/overlays/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileKey, collection }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Save failed (${res.status})`)
  }
}

export type MountVertexEditorOptions = {
  provinceLabels?: ProvinceLabelsHandle | null
}

/**
 * Mount vertex editor chrome + handles. No-op outside Vite DEV.
 * Mutates the live OverlayManager collections in place (single source of truth),
 * then writes them to disk only when you hit Save.
 */
export function mountOverlayVertexEditor(
  viewer: Viewer,
  opts: MountVertexEditorOptions = {},
): () => void {
  if (!import.meta.env.DEV) return () => {}

  const provinceLabels = opts.provinceLabels ?? null
  const manager = getOverlayManager()
  const parts = manager.getSourceParts()

  const collectionFor = (fileKey: string): OverlayCollection | null =>
    parts.find((p) => p.fileKey === fileKey)?.collection ?? null

  // —— UI panel (hidden until opened from credits 邊線 toggle) ——
  const panel = document.createElement('div')
  panel.className = 'vertex-editor-panel'
  panel.hidden = !isVertexEditorPanelVisible()
  panel.innerHTML = `
    <div class="vertex-editor-row">
      <label class="vertex-editor-toggle">
        <input type="checkbox" id="vertex-edit-enabled" />
        Edit
      </label>
      <label>Mode
        <select id="vertex-edit-mode">
          <option value="vertices">Vertices</option>
          <option value="provinces">Province labels</option>
        </select>
      </label>
      <span class="vertex-editor-hint" id="vertex-edit-hint">E edit · hold D erase · Alt-click delete · dblclick insert</span>
    </div>
    <div class="vertex-editor-row" id="vertex-edit-outline-row">
      <label>Overlay
        <select id="vertex-edit-target">
          ${FILE_KEYS.map((f) => `<option value="${f.key}">${f.label}</option>`).join('')}
        </select>
      </label>
      <label>Ring
        <select id="vertex-edit-ring"></select>
      </label>
    </div>
    <div class="vertex-editor-row" id="vertex-edit-province-row" hidden>
      <span class="vertex-editor-hint">Drag label to move · scroll to scale · linked 漢地/中國 share one position</span>
    </div>
    <div class="vertex-editor-row">
      <span class="vertex-editor-hint">Hold <kbd>D</kbd> + drag to box-erase (vertices mode)</span>
      <button type="button" class="vertex-editor-save" id="vertex-edit-save" disabled>Save</button>
      <span class="vertex-editor-hint">⌘/Ctrl+S</span>
    </div>
    <div class="vertex-editor-row">
      <span class="vertex-editor-status" id="vertex-edit-status">Idle</span>
    </div>
  `
  document.querySelector('#app')?.appendChild(panel)

  const enabledEl = panel.querySelector<HTMLInputElement>('#vertex-edit-enabled')!
  const modeEl = panel.querySelector<HTMLSelectElement>('#vertex-edit-mode')!
  const hintEl = panel.querySelector<HTMLElement>('#vertex-edit-hint')!
  const outlineRow = panel.querySelector<HTMLElement>('#vertex-edit-outline-row')!
  const provinceRow = panel.querySelector<HTMLElement>('#vertex-edit-province-row')!
  const targetEl = panel.querySelector<HTMLSelectElement>('#vertex-edit-target')!
  const ringEl = panel.querySelector<HTMLSelectElement>('#vertex-edit-ring')!
  const saveBtn = panel.querySelector<HTMLButtonElement>('#vertex-edit-save')!
  const statusEl = panel.querySelector<HTMLElement>('#vertex-edit-status')!

  const isProvinceMode = () => modeEl.value === 'provinces'

  /** Hold D to box-erase; release to pan the map again */
  let dHeld = false
  const eraseActive = () => enabledEl.checked && !isProvinceMode() && dHeld

  // —— Handles overlay (same map bounds as ink SVG) ——
  const handleRoot = document.createElement('div')
  handleRoot.className = 'vertex-editor-layer'
  handleRoot.hidden = true

  const handleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  handleSvg.setAttribute('viewBox', '0 0 1 1')
  handleSvg.setAttribute('preserveAspectRatio', 'none')
  handleSvg.classList.add('vertex-editor-svg')

  const handleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  handleGroup.classList.add('vertex-editor-handles')
  handleSvg.appendChild(handleGroup)

  const eraseRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  eraseRect.classList.add('vertex-editor-erase-rect')
  eraseRect.setAttribute('visibility', 'hidden')
  handleSvg.appendChild(eraseRect)

  handleRoot.appendChild(handleSvg)

  let handlesAttached = false
  let drag: DragState | null = null
  let provinceDrag: ProvinceDragState | null = null
  let eraseDrag: { x0: number; y0: number; x1: number; y1: number } | null = null

  const syncEraseCapture = () => {
    const on = eraseActive()
    handleRoot.classList.toggle('is-erase', on)
    const wrap = handleRoot.parentElement
    if (wrap && wrap !== viewer.element) {
      wrap.classList.add('vertex-editor-layer-wrap')
      wrap.classList.toggle('is-erase-capture', on)
    }
    if (enabledEl.checked) {
      viewer.setMouseNavEnabled(!on && !drag && !eraseDrag && !provinceDrag)
    }
  }

  const placeHandles = () => {
    const item = viewer.world.getItemAt(0) as TiledImage | null
    if (!item) return
    const bounds = item.getBounds()
    const loc = new OpenSeadragon.Rect(bounds.x, bounds.y, bounds.width, bounds.height)
    if (!handlesAttached) {
      viewer.addOverlay({ element: handleRoot, location: loc, checkResize: false })
      handlesAttached = true
    } else {
      viewer.updateOverlay(handleRoot, loc)
    }
    const wrap = handleRoot.parentElement
    if (wrap && wrap !== viewer.element) {
      wrap.classList.add('vertex-editor-layer-wrap')
      wrap.classList.toggle('is-erase-capture', eraseActive())
    }
  }

  const onOpen = () => placeHandles()
  if (viewer.world.getItemAt(0)) placeHandles()
  else viewer.addHandler('open', onOpen)

  let saving = false
  const dirtyKeys = new Set<string>()

  const setStatus = (msg: string, kind: 'idle' | 'ok' | 'err' | 'busy' = 'idle') => {
    statusEl.textContent = msg
    statusEl.dataset.kind = kind
  }

  const syncSaveUi = () => {
    const n = dirtyKeys.size
    saveBtn.disabled = n === 0 || saving
    saveBtn.textContent = n > 1 ? `Save (${n})` : 'Save'
    panel.classList.toggle('is-dirty', n > 0)
  }

  const markDirty = (fileKey: string) => {
    dirtyKeys.add(fileKey)
    syncSaveUi()
    if (!saving) setStatus('Unsaved changes', 'busy')
  }

  const saveDirty = async () => {
    if (saving || dirtyKeys.size === 0) return
    saving = true
    syncSaveUi()
    setStatus('Saving…', 'busy')
    const keys = [...dirtyKeys]
    try {
      for (const fileKey of keys) {
        if (fileKey === PROVINCE_FILE_KEY) {
          await saveCollection(fileKey, getProvinceLabelCollection())
        } else {
          const collection = collectionFor(fileKey)
          if (!collection) throw new Error(`No collection for ${fileKey}`)
          await saveCollection(fileKey, collection)
        }
        dirtyKeys.delete(fileKey)
      }
      const hailu = keys.includes('hailu')
      setStatus(
        `Saved ${keys.map((k) => `${k}.json`).join(', ')}${hailu ? ' + sea-lanes.json' : ''}`,
        'ok',
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      saving = false
      syncSaveUi()
    }
  }

  const currentFeature = (): OverlayFeature | null => {
    const collection = collectionFor(targetEl.value)
    return collection?.overlays[0] ?? null
  }

  const refreshRingSelect = () => {
    const feature = currentFeature()
    const rings = feature?.rings ?? []
    const prev = ringEl.value
    ringEl.innerHTML = rings
      .map((_, i) => `<option value="${i}">${i} (${rings[i]!.length} pts)</option>`)
      .join('')
    if (prev && Number(prev) < rings.length) ringEl.value = prev
    else ringEl.value = '0'
  }

  const handleRadii = (): { rx: number; ry: number } => {
    const box = handleSvg.getBoundingClientRect()
    const w = box.width
    const h = box.height
    if (!(w > 1) || !(h > 1)) return { rx: 0.0012, ry: 0.0012 }
    return {
      rx: Math.min(0.0035, Math.max(0.0003, 4 / w)),
      ry: Math.min(0.0035, Math.max(0.0003, 4 / h)),
    }
  }

  const rebuildHandles = () => {
    handleGroup.replaceChildren()
    if (!enabledEl.checked || isProvinceMode()) return

    const feature = currentFeature()
    if (!feature) return
    const ringIndex = Number(ringEl.value) || 0
    const ring = feature.rings[ringIndex]
    if (!ring) return

    const { rx, ry } = handleRadii()
    const pathMode = feature.pathMode ?? 'closed'

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    hit.setAttribute('d', ringToPathDLocal(ring, pathMode))
    hit.classList.add('vertex-editor-hitpath')
    hit.style.pointerEvents = eraseActive() ? 'none' : 'stroke'
    handleGroup.appendChild(hit)

    ring.forEach((pt, pointIndex) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
      c.setAttribute('cx', String(pt.x))
      c.setAttribute('cy', String(pt.y))
      c.setAttribute('rx', String(rx))
      c.setAttribute('ry', String(ry))
      c.classList.add('vertex-editor-handle')
      c.dataset.pointIndex = String(pointIndex)
      c.style.pointerEvents = eraseActive() ? 'none' : 'all'
      handleGroup.appendChild(c)
    })
  }

  const pushLiveUpdate = (feature: OverlayFeature) => {
    manager.updateFeatureRings(feature.id, feature.rings, feature.pathMode ?? 'closed')
  }

  const clientToNorm = (clientX: number, clientY: number): MapPoint | null => {
    const item = viewer.world.getItemAt(0) as TiledImage | null
    if (!item) return null
    const rect = handleSvg.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    }
  }

  const clientToNormOnProvinceSvg = (clientX: number, clientY: number): MapPoint | null => {
    const svg = provinceLabels?.root.querySelector('svg')
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    }
  }

  const updateEraseRect = () => {
    if (!eraseDrag) {
      eraseRect.setAttribute('visibility', 'hidden')
      return
    }
    const x = Math.min(eraseDrag.x0, eraseDrag.x1)
    const y = Math.min(eraseDrag.y0, eraseDrag.y1)
    const w = Math.abs(eraseDrag.x1 - eraseDrag.x0)
    const h = Math.abs(eraseDrag.y1 - eraseDrag.y0)
    eraseRect.setAttribute('x', String(x))
    eraseRect.setAttribute('y', String(y))
    eraseRect.setAttribute('width', String(w))
    eraseRect.setAttribute('height', String(h))
    eraseRect.setAttribute('visibility', 'visible')
  }

  const erasePointsInBox = () => {
    if (!eraseDrag) return
    const feature = currentFeature()
    if (!feature) return
    const ringIndex = Number(ringEl.value) || 0
    const ring = feature.rings[ringIndex]
    if (!ring) return

    const x0 = Math.min(eraseDrag.x0, eraseDrag.x1)
    const x1 = Math.max(eraseDrag.x0, eraseDrag.x1)
    const y0 = Math.min(eraseDrag.y0, eraseDrag.y1)
    const y1 = Math.max(eraseDrag.y0, eraseDrag.y1)
    if (x1 - x0 < 1e-6 && y1 - y0 < 1e-6) return

    const kept = ring.filter((p) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1)
    const removed = ring.length - kept.length
    if (removed === 0) {
      setStatus('No vertices in box', 'idle')
      return
    }
    if (kept.length < 2) {
      setStatus('Keep at least 2 vertices — shrink the box', 'err')
      return
    }

    feature.rings[ringIndex] = kept
    pushLiveUpdate(feature)
    rebuildHandles()
    refreshRingSelect()
    markDirty(targetEl.value)
    setStatus(`Erased ${removed} · path bridged (${kept.length} left)`, 'ok')
  }

  const syncModeUi = () => {
    const prov = isProvinceMode()
    outlineRow.hidden = prov
    provinceRow.hidden = !prov
    hintEl.textContent = prov
      ? 'E edit · drag move · scroll scale · linked 漢地/中國 stay together'
      : 'E edit · hold D erase · Alt-click delete · dblclick insert'
    handleRoot.hidden = !enabledEl.checked || prov
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!enabledEl.checked || isProvinceMode()) return
    e.preventDefault()
    e.stopPropagation()

    if (eraseActive()) {
      const pt = clientToNorm(e.clientX, e.clientY)
      if (!pt) return
      eraseDrag = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }
      updateEraseRect()
      viewer.setMouseNavEnabled(false)
      handleSvg.setPointerCapture?.(e.pointerId)
      return
    }

    const t = e.target as Element | null
    if (!t?.classList.contains('vertex-editor-handle')) return

    const pointIndex = Number((t as SVGEllipseElement).dataset.pointIndex)
    const feature = currentFeature()
    if (!feature) return

    if (e.altKey) {
      const ringIndex = Number(ringEl.value) || 0
      const ring = feature.rings[ringIndex]
      if (!ring || ring.length <= 2) return
      ring.splice(pointIndex, 1)
      pushLiveUpdate(feature)
      rebuildHandles()
      refreshRingSelect()
      markDirty(targetEl.value)
      return
    }

    drag = {
      fileKey: targetEl.value,
      featureId: feature.id,
      ringIndex: Number(ringEl.value) || 0,
      pointIndex,
    }
    viewer.setMouseNavEnabled(false)
    ;(t as Element).setPointerCapture?.(e.pointerId)
    t.classList.add('is-dragging')
  }

  const onProvincePointerDown = (e: PointerEvent) => {
    if (!enabledEl.checked || !isProvinceMode() || !provinceLabels) return
    const t = e.target as Element | null
    if (!t?.classList.contains('province-label-hit')) return
    const labelId = (t as SVGRectElement).dataset.labelId
    if (!labelId) return
    e.preventDefault()
    e.stopPropagation()
    provinceDrag = { labelId }
    provinceLabels.setSelectedId(labelId)
    viewer.setMouseNavEnabled(false)
    ;(t as Element).setPointerCapture?.(e.pointerId)
    setStatus(`Moving ${labelId}`, 'idle')
  }

  const onPointerMove = (e: PointerEvent) => {
    if (provinceDrag) {
      e.preventDefault()
      const pt = clientToNormOnProvinceSvg(e.clientX, e.clientY)
      if (!pt) return
      updateProvinceLabel(provinceDrag.labelId, {
        point: {
          x: Math.round(pt.x * 1e6) / 1e6,
          y: Math.round(pt.y * 1e6) / 1e6,
        },
      })
      return
    }
    if (eraseDrag) {
      e.preventDefault()
      const pt = clientToNorm(e.clientX, e.clientY)
      if (!pt) return
      eraseDrag.x1 = pt.x
      eraseDrag.y1 = pt.y
      updateEraseRect()
      return
    }
    if (!drag) return
    e.preventDefault()
    const pt = clientToNorm(e.clientX, e.clientY)
    if (!pt) return
    const collection = collectionFor(drag.fileKey)
    const feature = collection?.overlays.find((o) => o.id === drag!.featureId)
    const ring = feature?.rings[drag.ringIndex]
    if (!ring?.[drag.pointIndex]) return

    ring[drag.pointIndex] = {
      x: Math.round(pt.x * 1e6) / 1e6,
      y: Math.round(pt.y * 1e6) / 1e6,
    }

    const handle = handleGroup.querySelector(
      `ellipse[data-point-index="${drag.pointIndex}"]`,
    ) as SVGEllipseElement | null
    if (handle) {
      handle.setAttribute('cx', String(ring[drag.pointIndex].x))
      handle.setAttribute('cy', String(ring[drag.pointIndex].y))
    }
    const hit = handleGroup.querySelector('.vertex-editor-hitpath')
    if (hit && feature) {
      hit.setAttribute('d', ringToPathDLocal(ring, feature.pathMode ?? 'closed'))
    }

    pushLiveUpdate(feature!)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (provinceDrag) {
      markDirty(PROVINCE_FILE_KEY)
      provinceDrag = null
      syncEraseCapture()
      return
    }
    if (eraseDrag) {
      erasePointsInBox()
      eraseDrag = null
      updateEraseRect()
      syncEraseCapture()
      return
    }
    if (!drag) return
    const t = e.target as Element | null
    t?.classList.remove('is-dragging')
    markDirty(drag.fileKey)
    drag = null
    syncEraseCapture()
  }

  const onDblClick = (e: MouseEvent) => {
    if (!enabledEl.checked || eraseActive() || isProvinceMode()) return
    const t = e.target as Element | null
    if (!t?.classList.contains('vertex-editor-hitpath')) return
    e.preventDefault()
    e.stopPropagation()
    const pt = clientToNorm(e.clientX, e.clientY)
    if (!pt) return
    const feature = currentFeature()
    if (!feature) return
    const ringIndex = Number(ringEl.value) || 0
    const ring = feature.rings[ringIndex]
    if (!ring || ring.length < 2) return

    let bestI = 0
    let bestD = Infinity
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!
      const b = ring[i + 1]!
      const d = distToSeg(pt, a, b)
      if (d < bestD) {
        bestD = d
        bestI = i
      }
    }
    if ((feature.pathMode ?? 'closed') === 'closed' && ring.length > 2) {
      const a = ring[ring.length - 1]!
      const b = ring[0]!
      const d = distToSeg(pt, a, b)
      if (d < bestD) {
        bestD = d
        bestI = ring.length - 1
      }
    }

    const insertAt = bestI + 1
    ring.splice(insertAt, 0, {
      x: Math.round(pt.x * 1e6) / 1e6,
      y: Math.round(pt.y * 1e6) / 1e6,
    })
    pushLiveUpdate(feature)
    rebuildHandles()
    refreshRingSelect()
    markDirty(targetEl.value)
  }

  const onProvinceWheel = (e: WheelEvent) => {
    if (!enabledEl.checked || !isProvinceMode()) return
    const t = e.target as Element | null
    if (!t?.classList.contains('province-label-hit')) return
    const labelId = (t as SVGRectElement).dataset.labelId
    if (!labelId) return
    e.preventDefault()
    e.stopPropagation()
    const label = getProvinceLabelCollection().labels.find((l) => l.id === labelId)
    if (!label) return
    const cur = label.scale ?? 1
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
    const next = Math.round(Math.min(3, Math.max(0.35, cur * factor)) * 1000) / 1000
    updateProvinceLabel(labelId, { scale: next })
    provinceLabels?.setSelectedId(labelId)
    markDirty(PROVINCE_FILE_KEY)
    setStatus(`${label.title} scale ${next.toFixed(2)}`, 'idle')
  }

  handleSvg.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  handleSvg.addEventListener('dblclick', onDblClick)

  const provinceRoot = provinceLabels?.root
  const provinceHitLayer = provinceRoot?.querySelector(
    '.province-labels-hits',
  ) as SVGGElement | null
  // Listen on the hit layer so we don't depend on bubbling through
  // pointer-events:none ancestors.
  provinceHitLayer?.addEventListener('pointerdown', onProvincePointerDown)
  provinceHitLayer?.addEventListener('wheel', onProvinceWheel, { passive: false })

  const syncEnabled = () => {
    const on = enabledEl.checked
    const prov = isProvinceMode()
    syncModeUi()
    handleRoot.hidden = !on || prov
    handleRoot.classList.toggle('is-enabled', on && !prov)
    panel.classList.toggle('is-editing', on)
    provinceLabels?.setEditing(on && prov)

    if (!on) {
      dHeld = false
      eraseDrag = null
      provinceDrag = null
      updateEraseRect()
      handleGroup.replaceChildren()
      provinceLabels?.setSelectedId(null)
      viewer.setMouseNavEnabled(true)
      setStatus(dirtyKeys.size ? 'Unsaved changes' : 'Idle', dirtyKeys.size ? 'busy' : 'idle')
    } else if (prov) {
      overlayStore.setGroupVisible(manager.idsForGroup(HANDI_GROUP_ID), true)
      overlayStore.setGroupVisible(manager.idsForGroup(ZHONGGUO_GROUP_ID), true)
      handleGroup.replaceChildren()
      // Pan off so the province hit layer can receive pointer events reliably.
      viewer.setMouseNavEnabled(false)
      if (dirtyKeys.size) setStatus('Unsaved changes', 'busy')
      else setStatus('Editing province labels — drag cyan boxes · scroll to scale · uncheck Edit to pan', 'idle')
    } else {
      const meta = FILE_KEYS.find((f) => f.key === targetEl.value)
      if (meta) {
        const ids = manager.idsForGroup(meta.groupId)
        overlayStore.setGroupVisible(ids, true)
      }
      refreshRingSelect()
      rebuildHandles()
      placeHandles()
      syncEraseCapture()
      if (dirtyKeys.size) setStatus('Unsaved changes', 'busy')
      else setStatus('Editing — hold D to erase, Save when ready', 'idle')
    }
    syncSaveUi()
  }

  enabledEl.addEventListener('change', syncEnabled)
  modeEl.addEventListener('change', () => {
    syncEnabled()
  })
  targetEl.addEventListener('change', () => {
    if (isProvinceMode()) return
    const meta = FILE_KEYS.find((f) => f.key === targetEl.value)
    if (meta && enabledEl.checked) {
      overlayStore.setGroupVisible(manager.idsForGroup(meta.groupId), true)
    }
    refreshRingSelect()
    rebuildHandles()
  })
  ringEl.addEventListener('change', rebuildHandles)
  saveBtn.addEventListener('click', () => {
    void saveDirty()
  })

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.target instanceof HTMLSelectElement) return
    if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void saveDirty()
      return
    }
    if (e.key === 'd' || e.key === 'D') {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (!enabledEl.checked || isProvinceMode()) return
      e.preventDefault()
      dHeld = true
      syncEraseCapture()
      rebuildHandles()
      if (dirtyKeys.size === 0) setStatus('Hold D — drag a rectangle to erase', 'idle')
      return
    }
    if (e.key === 'e' || e.key === 'E') {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (panel.hidden) return
      enabledEl.checked = !enabledEl.checked
      syncEnabled()
    }
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== 'd' && e.key !== 'D') return
    if (!dHeld) return
    dHeld = false
    if (eraseDrag) {
      erasePointsInBox()
      eraseDrag = null
      updateEraseRect()
    }
    syncEraseCapture()
    rebuildHandles()
    if (enabledEl.checked && dirtyKeys.size === 0) {
      setStatus(
        isProvinceMode()
          ? 'Editing province labels — drag to move, scroll to scale'
          : 'Editing — hold D to erase, Save when ready',
        'idle',
      )
    } else if (dirtyKeys.size) {
      setStatus('Unsaved changes', 'busy')
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  const onBlur = () => {
    if (!dHeld) return
    dHeld = false
    eraseDrag = null
    updateEraseRect()
    syncEraseCapture()
    rebuildHandles()
  }
  window.addEventListener('blur', onBlur)

  const onAnim = () => {
    if (!enabledEl.checked || isProvinceMode()) return
    const { rx, ry } = handleRadii()
    handleGroup.querySelectorAll('ellipse.vertex-editor-handle').forEach((c) => {
      c.setAttribute('rx', String(rx))
      c.setAttribute('ry', String(ry))
    })
  }
  viewer.addHandler('animation', onAnim)
  viewer.addHandler('resize', onAnim)

  refreshRingSelect()
  syncEnabled()

  const applyChromeVisible = (on: boolean) => {
    panel.hidden = !on
    if (!on && enabledEl.checked) {
      enabledEl.checked = false
      syncEnabled()
    }
  }
  applyChromeVisible(isVertexEditorPanelVisible())
  const unsubChrome = onVertexEditorPanelVisible(applyChromeVisible)
  markVertexEditorAvailable(true)

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (dirtyKeys.size === 0) return
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', onBeforeUnload)

  return () => {
    unsubChrome()
    markVertexEditorAvailable(false)
    provinceLabels?.setEditing(false)
    provinceLabels?.setSelectedId(null)
    provinceHitLayer?.removeEventListener('pointerdown', onProvincePointerDown)
    provinceHitLayer?.removeEventListener('wheel', onProvinceWheel)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('beforeunload', onBeforeUnload)
    viewer.setMouseNavEnabled(true)
    viewer.removeHandler('open', onOpen)
    viewer.removeHandler('animation', onAnim)
    viewer.removeHandler('resize', onAnim)
    if (handlesAttached) {
      try {
        viewer.removeOverlay(handleRoot)
      } catch {
        /* */
      }
    }
    panel.remove()
    handleRoot.remove()
  }
}

function ringToPathDLocal(ring: MapRing, pathMode: 'closed' | 'open'): string {
  if (ring.length === 0) return ''
  const [first, ...rest] = ring
  let d = `M ${first.x} ${first.y}`
  for (const p of rest) d += ` L ${p.x} ${p.y}`
  if (pathMode !== 'open') d += ' Z'
  return d
}

function distToSeg(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1e-12
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = a.x + t * dx
  const qy = a.y + t * dy
  return Math.hypot(p.x - qx, p.y - qy)
}
