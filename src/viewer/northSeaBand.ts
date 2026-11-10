import OpenSeadragon, { type Viewer } from 'openseadragon'

const PREVIEW_URL = '/map-preview-low.jpg'
/**
 * Mirrored fraction of the map's height carried above its north edge.
 * The CSS mask fades the upper part out, so only the lower stretch reads.
 */
const BAND_FRAC = 0.35

/**
 * North sea band — "no top clip".
 *
 * The wall fits the map height-bound, so the painting's own top edge sits
 * exactly on the canvas's top edge. Lift or tilt the sheet and that edge
 * floats against the wall as a hard slice. This overlay hangs above the
 * map's north edge inside the sheet (it transforms with the container) and
 * shows the map's top strip mirrored, dissolving upward through a gradient
 * mask — the sea carries on and fades into the wall instead of being cut.
 */
export function mountNorthSeaBand(viewer: Viewer): void {
  const band = document.createElement('div')
  band.className = 'wall-north-sea'
  band.setAttribute('aria-hidden', 'true')
  const mirror = document.createElement('div')
  mirror.className = 'wall-north-sea-mirror'
  mirror.style.backgroundImage = `url('${PREVIEW_URL}')`
  mirror.style.backgroundSize = `100% ${100 / BAND_FRAC}%`
  band.append(mirror)

  const place = () => {
    const item = viewer.world.getItemAt(0)
    if (!item) return
    const b = item.getBounds()
    const h = b.height * BAND_FRAC
    viewer.addOverlay({
      element: band,
      location: new OpenSeadragon.Rect(b.x, b.y - h, b.width, h),
      checkResize: false,
    })
  }

  if (viewer.world.getItemCount() > 0) place()
  else viewer.addOnceHandler('open', place)
}
