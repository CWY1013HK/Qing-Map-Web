import type { Viewer } from 'openseadragon'

const LAYER_ID = 'wall-label-layer'

const layers = new WeakMap<Viewer, HTMLElement>()

/** Flat wall layer (sibling of #viewer) for upright province / décor billboards. */
export function wallLabelLayer(viewer: Viewer): HTMLElement | null {
  let layer = layers.get(viewer)
  if (layer) return layer
  const app = document.getElementById('app')
  const viewerEl = viewer.element
  if (!app || !viewerEl) return null
  layer = document.createElement('div')
  layer.id = LAYER_ID
  layer.className = LAYER_ID
  layer.setAttribute('aria-hidden', 'false')
  viewerEl.insertAdjacentElement('afterend', layer)
  layers.set(viewer, layer)
  return layer
}
