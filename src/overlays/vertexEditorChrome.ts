/**
 * Shared chrome visibility for the overlay vertex / edge editor.
 * Keeps credits ↔ editor wiring free of a hard import of the full editor module.
 * Default: unavailable / panel hidden until DEV editor mounts and credits toggles it on.
 */

type VisibilityListener = (visible: boolean) => void
type AvailabilityListener = (available: boolean) => void

let available = false
/** Panel chrome visibility — starts off */
let visible = false
/** Click before editor finished mounting */
let pendingVisible: boolean | null = null
const visibilityListeners = new Set<VisibilityListener>()
const availabilityListeners = new Set<AvailabilityListener>()

export function isVertexEditorAvailable(): boolean {
  return available
}

export function markVertexEditorAvailable(on: boolean): void {
  if (available === on) return
  available = on
  if (!on) {
    visible = false
    pendingVisible = null
  } else if (pendingVisible !== null) {
    visible = pendingVisible
    pendingVisible = null
  }
  for (const cb of availabilityListeners) cb(available)
  for (const cb of visibilityListeners) cb(visible)
}

export function isVertexEditorPanelVisible(): boolean {
  return visible
}

export function setVertexEditorPanelVisible(on: boolean): void {
  if (!available) {
    pendingVisible = on
    return
  }
  if (visible === on) return
  visible = on
  for (const cb of visibilityListeners) cb(visible)
}

export function toggleVertexEditorPanel(): boolean {
  const next = !(available ? visible : (pendingVisible ?? false))
  setVertexEditorPanelVisible(next)
  return available ? visible : next
}

export function onVertexEditorPanelVisible(cb: VisibilityListener): () => void {
  visibilityListeners.add(cb)
  return () => {
    visibilityListeners.delete(cb)
  }
}

export function onVertexEditorAvailable(cb: AvailabilityListener): () => void {
  availabilityListeners.add(cb)
  return () => {
    availabilityListeners.delete(cb)
  }
}
