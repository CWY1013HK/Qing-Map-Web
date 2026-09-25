import OpenSeadragon from 'openseadragon'
import { FLOOR_DECOR_COUNTS } from '../lib/mapDecor'
import { mountOverlaysOnViewer } from '../overlays/manager'
import { mountProvinceLabels } from '../overlays/provinceLabels'
import { startFocusClouds, type FocusCloudsHandle } from '../viewer/focusMode'
import { startSeaUnderlay, type SeaUnderlayHandle } from '../viewer/seaUnderlay'

const PREVIEW_URL = '/map-preview.jpg'
const TILE_SOURCE = '/tiles/map.dzi'
/** Floor is a large canvas — a few more puffs than wall focus. */
const FLOOR_CLOUD_COUNT = 32

/**
 * Floor map: full-bleed fitted map, no chrome / interaction.
 * Permanently runs focus-mode mist. Vector overlays attach via OSD (same store as wall).
 */
export function bootFloorViewer(): OpenSeadragon.Viewer {
  const el = document.querySelector<HTMLElement>('#floor-viewer')
  const preview = document.querySelector<HTMLImageElement>('#floor-preview')
  if (!el) throw new Error('Missing #floor-viewer')

  let mist: FocusCloudsHandle | null = null
  let sea: SeaUnderlayHandle | null = null

  const viewer = OpenSeadragon({
    element: el,
    prefixUrl: '/osd-images/',
    tileSources: {
      type: 'image',
      url: PREVIEW_URL,
    },
    placeholderFillStyle: 'transparent',
    showNavigationControl: false,
    showNavigator: false,
    animationTime: 0,
    blendTime: 0.35,
    immediateRender: true,
    imageLoaderLimit: 6,
    visibilityRatio: 1,
    minZoomImageRatio: 1,
    maxZoomPixelRatio: 3,
    homeFillsViewer: true,
    panHorizontal: false,
    panVertical: false,
    gestureSettingsMouse: {
      dragToPan: false,
      scrollToZoom: false,
      clickToZoom: false,
      dblClickToZoom: false,
    },
    gestureSettingsTouch: {
      dragToPan: false,
      pinchToZoom: false,
      dblClickToZoom: false,
    },
  })

  const fitHome = () => {
    viewer.viewport.goHome(true)
    const homeZoom = viewer.viewport.getHomeZoom()
    ;(viewer as unknown as { minZoomLevel: number }).minZoomLevel = homeZoom
    ;(viewer as unknown as { maxZoomLevel: number }).maxZoomLevel = homeZoom
  }

  const hidePreview = () => {
    if (preview) preview.hidden = true
  }

  const ensureMist = () => {
    if (!viewer.world.getItemAt(0)) return
    if (!sea) sea = startSeaUnderlay(viewer)
    if (!mist) {
      mist = startFocusClouds(viewer, {
        canvas: el,
        count: FLOOR_CLOUD_COUNT,
        lockedHome: true,
        decor: FLOOR_DECOR_COUNTS,
      })
    }
  }

  mountOverlaysOnViewer(viewer)
  mountProvinceLabels(viewer)

  viewer.addHandler('open', () => {
    fitHome()
    hidePreview()
    ensureMist()
    const base = viewer.world.getItemAt(0)
    if (!base) return
    const bounds = base.getBounds()
    viewer.addTiledImage({
      tileSource: TILE_SOURCE,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      success: () => {
        fitHome()
        ensureMist()
      },
      error: () => {
        /* preview-only is fine on floor */
      },
    })
    window.dispatchEvent(new Event('resize'))
  })

  viewer.addHandler('resize', () => {
    fitHome()
  })

  viewer.addHandler('open-failed', () => {
    if (preview) preview.hidden = false
  })

  return viewer
}
