import type { Viewer } from 'openseadragon'
import { wallLabelLayer } from './wallLabelLayer'

/** Drop upright clones so on-map province overlays paint again. */
export function clearWallBillboardChrome(viewer: Viewer): void {
  const app = document.getElementById('app')
  app?.classList.remove('is-province-upright')
  const layer = wallLabelLayer(viewer)
  layer?.classList.remove('is-wall-billboard')
  layer?.querySelectorAll('.province-label-billboard-host, .focus-decor-billboard').forEach((n) =>
    n.remove(),
  )
}
