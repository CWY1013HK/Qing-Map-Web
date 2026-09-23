/** Shared annotation / overlay shapes — plain JSON under data/, readable by web and TouchDesigner. */

export type MapPoint = {
  /** Normalized X in image space, 0–1 left→right */
  x: number
  /** Normalized Y in image space, 0–1 top→bottom */
  y: number
}

export type Annotation = {
  id: string
  title: string
  body?: string
  /** Alternate place names shown as （又名：…） in the popup */
  aka?: string[]
  /** Anchor on the map (normalized image coordinates) */
  point: MapPoint
  tags?: string[]
  /** Optional cropped map-label image for the hotspot button */
  labelImage?: string
  /** Button width as fraction of map image width (default ~0.03) */
  labelWidth?: number
  /**
   * Optional rectangular hit area (fractions of map image size), centered on `point`.
   * When set, the hotspot covers this text/region block instead of a square label.
   */
  hitWidth?: number
  hitHeight?: number
}

export type AnnotationCollection = {
  version: 1
  mapId: string
  annotations: Annotation[]
}

/** Closed ring of normalized points (first ≈ last optional). */
export type MapRing = MapPoint[]

export type OverlayStyle = 'crimson-glow' | 'yellow-glow' | 'cyan-glow'

export type OverlayFeature = {
  id: string
  title: string
  /** Outer ring first; subsequent rings are holes if needed */
  rings: MapRing[]
  style?: OverlayStyle
  /**
   * `closed` (default): rings are filled outlines closed with Z.
   * `open`: polylines (sea routes) — no Z close.
   */
  pathMode?: 'closed' | 'open'
}

export type OverlayCollection = {
  version: 1
  mapId: string
  /** Optional group id for toggling several features together (e.g. handi-shibasheng) */
  groupId?: string
  title?: string
  overlays: OverlayFeature[]
}
