import type { Viewer } from 'openseadragon'
import type { OverlayCollection, OverlayFeature, MapRing } from '../lib/types'
import handiCollection from '../../data/overlays/handi-shibasheng.json'
import zhongguoCollection from '../../data/overlays/zhongguo.json'
import hailuCollection from '../../data/overlays/hailu.json'
import { overlayStore } from './store'
import { attachSvgOverlayLayer, type SvgOverlayLayer } from './svgLayer'

export const HANDI_GROUP_ID = 'handi-shibasheng'
export const ZHONGGUO_GROUP_ID = 'zhongguo'
export const HAILU_GROUP_ID = 'hailu'

export type OverlaySourcePart = {
  fileKey: string
  collection: OverlayCollection
}

export type OverlayManager = {
  collection: OverlayCollection
  /** All feature ids across loaded overlay JSON files */
  featureIds: string[]
  idsForGroup: (groupId: string) => string[]
  getSourceParts: () => OverlaySourcePart[]
  /** Push live ring edits to every attached SVG layer */
  updateFeatureRings: (
    featureId: string,
    rings: MapRing[],
    pathMode?: 'closed' | 'open',
  ) => void
  attach: (viewer: Viewer) => () => void
  destroyAll: () => void
}

let singleton: OverlayManager | null = null

function asCollection(raw: unknown): OverlayCollection {
  return raw as OverlayCollection
}

function mergeCollections(parts: OverlayCollection[]): OverlayCollection {
  const overlays: OverlayFeature[] = []
  for (const part of parts) {
    overlays.push(...part.overlays)
  }
  return {
    version: 1,
    mapId: parts[0]?.mapId ?? 'qing-object-painting',
    overlays,
  }
}

/**
 * Loads overlay JSON once and can attach SVG layers to multiple OSD viewers
 * (wall + ATLab floor) that share overlayStore visibility.
 */
export function getOverlayManager(): OverlayManager {
  if (singleton) return singleton

  const sourceParts: OverlaySourcePart[] = [
    // Load order for data; SVG paint order is enforced in svgLayer (hailu < handi < zhongguo).
    { fileKey: 'hailu', collection: asCollection(hailuCollection) },
    { fileKey: 'handi-shibasheng', collection: asCollection(handiCollection) },
    { fileKey: 'zhongguo', collection: asCollection(zhongguoCollection) },
  ]
  const parts = sourceParts.map((p) => p.collection)
  const collection = mergeCollections(parts)
  const featureIds = collection.overlays.map((o) => o.id)

  const groupMap = new Map<string, string[]>()
  for (const part of parts) {
    const gid = part.groupId ?? part.overlays[0]?.id
    if (!gid) continue
    groupMap.set(
      gid,
      part.overlays.map((o) => o.id),
    )
  }

  const layers: SvgOverlayLayer[] = []
  const unsubs: Array<() => void> = []

  const sync = (visible: ReadonlySet<string>) => {
    for (const layer of layers) layer.setActiveIds(visible)
  }

  unsubs.push(overlayStore.subscribe(sync))

  singleton = {
    collection,
    featureIds,
    idsForGroup(groupId: string) {
      return groupMap.get(groupId) ?? [groupId]
    },
    getSourceParts() {
      return sourceParts
    },
    updateFeatureRings(featureId, rings, pathMode = 'closed') {
      // Mutate merged collection + matching source part
      const feat = collection.overlays.find((o) => o.id === featureId)
      if (feat) {
        feat.rings = rings
        if (pathMode) feat.pathMode = pathMode
      }
      for (const part of sourceParts) {
        const f = part.collection.overlays.find((o) => o.id === featureId)
        if (f) {
          f.rings = rings
          if (pathMode) f.pathMode = pathMode
        }
      }
      for (const layer of layers) layer.updateFeatureRings(featureId, rings, pathMode)
    },
    attach(viewer: Viewer) {
      const layer = attachSvgOverlayLayer(viewer, collection)
      layers.push(layer)
      layer.setActiveIds(overlayStore.getVisible())
      return () => {
        const i = layers.indexOf(layer)
        if (i >= 0) layers.splice(i, 1)
        layer.destroy()
      }
    },
    destroyAll() {
      for (const u of unsubs) u()
      unsubs.length = 0
      for (const layer of layers) layer.destroy()
      layers.length = 0
      singleton = null
    },
  }

  return singleton
}

export function mountOverlaysOnViewer(viewer: Viewer): () => void {
  return getOverlayManager().attach(viewer)
}
