import OpenSeadragon, { type TiledImage, type Viewer } from 'openseadragon'
import {
  liftAlongSheetNormal,
  projectSheetPoint,
  readWallSheetPose,
  SHEET_LABEL_NORMAL_OFFSET,
} from './wallTilt'

export type WallBox = {
  left: number
  top: number
  width: number
  height: number
  cx: number
  cy: number
}

/** Map a viewport rect through {@link projectSheetPoint} (誌 labels). */
export function placeViewportRectOnWall(
  viewer: Viewer,
  rect: OpenSeadragon.Rect,
): WallBox | null {
  const vp = viewer.viewport
  const tl = vp.pixelFromPoint(rect.getTopLeft(), true)
  const br = vp.pixelFromPoint(rect.getBottomRight(), true)
  const w = br.x - tl.x
  const h = br.y - tl.y
  if (!(w > 0) || !(h > 0)) return null
  const cx = (tl.x + br.x) / 2
  const cy = (tl.y + br.y) / 2
  const pc = projectSheetPoint(cx, cy)
  if (!pc) return null
  const e1 = projectSheetPoint(cx - w / 2, cy, 0)
  const e2 = projectSheetPoint(cx + w / 2, cy, 0)
  const v1 = projectSheetPoint(cx, cy - h / 2, 0)
  const v2 = projectSheetPoint(cx, cy + h / 2, 0)
  const kx =
    e1 && e2 && w > 0.0001 ? Math.hypot(e2.x - e1.x, e2.y - e1.y) / w : 1
  const ky =
    v1 && v2 && h > 0.0001 ? Math.hypot(v2.x - v1.x, v2.y - v1.y) / h : kx
  const pw = w * kx
  const ph = h * ky
  return {
    left: pc.x - pw / 2,
    top: pc.y - ph / 2,
    width: pw,
    height: ph,
    cx: pc.x,
    cy: pc.y,
  }
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

  if (readWallSheetPose()) {
    const lifted = liftAlongSheetNormal(anchor.x, anchor.y, SHEET_LABEL_NORMAL_OFFSET)
    if (lifted) {
      return {
        left: lifted.x - pw / 2,
        top: lifted.y - ph / 2,
        width: pw,
        height: ph,
        cx: lifted.x,
        cy: lifted.y,
      }
    }
  }

  const at = projectSheetPoint(anchor.x, anchor.y, 0)
  if (at) {
    return {
      left: at.x - pw / 2,
      top: at.y - ph / 2,
      width: pw,
      height: ph,
      cx: at.x,
      cy: at.y,
    }
  }

  const layerRect = wallLayer.getBoundingClientRect()
  const srcRect = src.getBoundingClientRect()
  if (srcRect.width < 1 || srcRect.height < 1) return null
  const left = srcRect.left - layerRect.left + (srcRect.width - pw) / 2
  const top = srcRect.top - layerRect.top + (srcRect.height - ph) / 2
  return {
    left,
    top,
    width: pw,
    height: ph,
    cx: left + pw / 2,
    cy: top + ph / 2,
  }
}
