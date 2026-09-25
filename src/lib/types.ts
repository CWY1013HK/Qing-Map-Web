/** Shared annotation / overlay shapes — plain JSON under data/, readable by web and TouchDesigner. */

export type MapPoint = {
  /** Normalized X in image space, 0–1 left→right */
  x: number
  /** Normalized Y in image space, 0–1 top→bottom */
  y: number
}

/** Optional locale overlays; flat `title`/`body`/`aka` remain Traditional (zh-Hant). */
export type AnnotationI18nOverlay = {
  title?: string
  body?: string
  aka?: string[]
}

export type Annotation = {
  id: string
  title: string
  body?: string
  /** Alternate place names shown as （又名：…） in the popup */
  aka?: string[]
  /**
   * Localized title/body/aka for Simplified Chinese and English.
   * Canonical Traditional fields above are the zh-Hant source of truth.
   */
  i18n?: {
    'zh-Hans'?: AnnotationI18nOverlay
    en?: AnnotationI18nOverlay
  }
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

/** Overlay seal ids a province label can attach to. */
export type ProvinceLabelAttachment = 'handi-shibasheng' | 'zhongguo' | 'hailu'

/**
 * Shared province name plate — one position/scale, rendered once per attached overlay.
 * Linked attachments share this record so handi + zhongguo stay in sync when edited.
 */
export type ProvinceLabel = {
  id: string
  title: string
  point: MapPoint
  /** Relative font scale (1 = default) */
  scale?: number
  /** Which outline seals show this label (same coords, separate styled copies). */
  attachments: ProvinceLabelAttachment[]
}

export type ProvinceLabelCollection = {
  version: 1
  mapId: string
  labels: ProvinceLabel[]
}
