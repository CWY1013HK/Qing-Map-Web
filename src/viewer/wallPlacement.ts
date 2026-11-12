import OpenSeadragon, { type TiledImage, type Viewer } from 'openseadragon'
import {
  readWallSheetPose,
  SHEET_LABEL_NORMAL_OFFSET,
  sheetZWallDelta,
  wallLayerLayoutScale,
} from './wallTilt'

export type WallBox = {
  left: number
  top: number
  width: number
  height: number
  cx: number
  cy: number
}

export function labelContainerAnchor(
  viewer: Viewer,
  src: SVGTextElement,
): { x: number; y: number; w: number; h: number } | null {
  const item = viewer.world.getItemAt(0) as TiledImage | null
  if (!item) return null
  const ax = parseFloat(src.getAttribute('x') ?? '')
  const ay = parseFloat(src.getAttribute('y') ?? '')
  const fontUv = parseFloat(src.getAttribute('font-size') ?? '0.01')
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return null
  const b = item.getBounds()
  const center = viewer.viewport.pixelFromPoint(
    new OpenSeadragon.Point(b.x + ax * b.width, b.y + ay * b.height),
    true,
  )
  let rectWC = Math.max(12, fontUv * b.width * (src.textContent?.length ?? 2) * 0.55)
  let rectHC = Math.max(8, fontUv * b.height * 1.25)
  try {
    const bb = src.getBBox()
    if (bb.width > 0 && bb.height > 0) {
      const tl = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(b.x + bb.x * b.width, b.y + bb.y * b.height),
        true,
      )
      const tr = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(
          b.x + (bb.x + bb.width) * b.width,
          b.y + bb.y * b.height,
        ),
        true,
      )
      const bl = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(
          b.x + bb.x * b.width,
          b.y + (bb.y + bb.height) * b.height,
        ),
        true,
      )
      rectWC = Math.max(4, Math.hypot(tr.x - tl.x, tr.y - tl.y))
      rectHC = Math.max(4, Math.hypot(bl.x - tl.x, bl.y - tl.y))
    }
  } catch {
    /* use estimates */
  }
  return { x: center.x, y: center.y, w: rectWC, h: rectHC }
}

/** On-sheet centre in wall-layer px (CSS 3D truth), plus constant model-Z lift when rotated. */
function uprightBillboardCenter(
  src: SVGTextElement,
  wallLayer: HTMLElement,
  containerX: number,
  containerY: number,
): { x: number; y: number } | null {
  const layerRect = wallLayer.getBoundingClientRect()
  const srcRect = src.getBoundingClientRect()
  if (srcRect.width < 1 || srcRect.height < 1) return null
  const layoutScale = wallLayerLayoutScale(wallLayer)
  const planeX = (srcRect.left + srcRect.width / 2 - layerRect.left) * layoutScale
  const planeY = (srcRect.top + srcRect.height / 2 - layerRect.top) * layoutScale
  if (!readWallSheetPose()) return { x: planeX, y: planeY }
  const dz = sheetZWallDelta(containerX, containerY)
  if (!dz) return { x: planeX, y: planeY }
  return {
    x: planeX + dz.x * SHEET_LABEL_NORMAL_OFFSET,
    y: planeY + dz.y * SHEET_LABEL_NORMAL_OFFSET,
  }
}

/**
 * Upright province plate: position follows tilt; size matches flat 2D at this zoom
 * (viewport pixels from map UV), never the foreshortened on-sheet screen rect.
 */
export function placeUprightLabelBox(
  viewer: Viewer,
  src: SVGTextElement,
  wallLayer: HTMLElement,
): WallBox | null {
  const anchor = labelContainerAnchor(viewer, src)
  if (!anchor) return null
  const pw = anchor.w
  const ph = anchor.h

  const at = uprightBillboardCenter(src, wallLayer, anchor.x, anchor.y)
  if (!at) return null
  return {
    left: at.x - pw / 2,
    top: at.y - ph / 2,
    width: pw,
    height: ph,
    cx: at.x,
    cy: at.y,
  }
}
