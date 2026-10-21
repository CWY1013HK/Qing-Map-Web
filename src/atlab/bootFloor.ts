import OpenSeadragon from 'openseadragon'
import { FLOOR_DECOR_COUNTS } from '../lib/mapDecor'
import { mountOverlaysOnViewer } from '../overlays/manager'
import { mountProvinceLabels } from '../overlays/provinceLabels'
import { startFocusClouds, type FocusCloudsHandle } from '../viewer/focusMode'
import {
  SEA_UNDERLAY_FADE_MS,
  startSeaUnderlay,
  type SeaUnderlayHandle,
} from '../viewer/seaUnderlay'

/** Floor stays at home zoom — low-res single image is enough (no DZI). */
const PREVIEW_URL = '/map-preview-low.jpg'
/** Fewer mist puffs than wall focus; floor is a large but static display. */
const FLOOR_CLOUD_COUNT = 14

type SizeDrawer = {
  _calculateCanvasSize?: () => { x: number; y: number }
}

/**
 * The floor map canvas is hidden; the visible map is the sea underlay.
 * Keep every drawer backing store at 1×1 so a devicePixelRatio change cannot
 * allocate a full-floor WebGL buffer (output + render + clip).
 */
function capDrawerBackingStore(drawer: object | null | undefined): void {
  const sized = drawer as SizeDrawer | null | undefined
  if (!sized || typeof sized._calculateCanvasSize !== 'function') return
  sized._calculateCanvasSize = () => new OpenSeadragon.Point(1, 1)
}

function keepFloorDrawerTiny(viewer: OpenSeadragon.Viewer): void {
  capDrawerBackingStore(viewer.drawer)
  const requestDrawer = viewer.requestDrawer.bind(viewer)
  viewer.requestDrawer = ((candidate, options) => {
    const prev = OpenSeadragon.pixelDensityRatio
    const size = viewer.viewport.getContainerSize()
    const maxDim = Math.max(size.x, size.y, 1)
    OpenSeadragon.pixelDensityRatio = 1 / maxDim
    try {
      const drawer = requestDrawer(candidate, options)
      if (drawer && typeof drawer === 'object') capDrawerBackingStore(drawer)
      return drawer
    } finally {
      OpenSeadragon.pixelDensityRatio = prev
    }
  }) as OpenSeadragon.Viewer['requestDrawer']
  viewer.raiseEvent('resize', {})
}

/**
 * Floor map: full-bleed fitted map, no chrome / interaction.
 * Permanently runs a lite focus-mode mist. Vector overlays attach via OSD
 * (same store as wall) with thinner strokes.
 */
export function bootFloorViewer(): OpenSeadragon.Viewer {
  const el = document.querySelector<HTMLElement>('#floor-viewer')
  const preview = document.querySelector<HTMLImageElement>('#floor-preview')
  if (!el) throw new Error('Missing #floor-viewer')

  let mist: FocusCloudsHandle | null = null
  let sea: SeaUnderlayHandle | null = null
  let previewHoldTimer = 0

  /*
   * Construct the hidden drawer at ~1 device pixel. The viewport still uses
   * the element's CSS size; only the canvas backing store follows this ratio.
   * Restored immediately so the wall viewer is unchanged.
   */
  const layoutW = Math.max(1, el.clientWidth)
  const layoutH = Math.max(1, el.clientHeight)
  const prevDensity = OpenSeadragon.pixelDensityRatio
  OpenSeadragon.pixelDensityRatio = 1 / Math.max(layoutW, layoutH)

  let viewer: OpenSeadragon.Viewer
  try {
    viewer = OpenSeadragon({
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
      blendTime: 0,
      immediateRender: true,
      imageLoaderLimit: 2,
      visibilityRatio: 1,
      minZoomImageRatio: 1,
      maxZoomPixelRatio: 1,
      maxImageCacheCount: 4,
      /** Floor OSD box is aspect-correct; CSS scaleY stretches its overlays to the floor band. */
      autoResize: false,
      homeFillsViewer: false,
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
  } finally {
    OpenSeadragon.pixelDensityRatio = prevDensity
  }
  keepFloorDrawerTiny(viewer)

  const fitHome = () => {
    viewer.viewport.goHome(true)
    const homeZoom = viewer.viewport.getHomeZoom()
    ;(viewer as unknown as { minZoomLevel: number }).minZoomLevel = homeZoom
    ;(viewer as unknown as { maxZoomLevel: number }).maxZoomLevel = homeZoom
  }

  const hidePreview = () => {
    if (preview) preview.hidden = true
  }

  /**
   * Hold the low-res preview under the transparent OSD canvas until the land
   * alpha-mask (map-land.webp) has faded in — otherwise seas flash the floor
   * background through holes in an unready mask.
   */
  const releasePreviewAfterMask = () => {
    window.clearTimeout(previewHoldTimer)
    previewHoldTimer = window.setTimeout(hidePreview, SEA_UNDERLAY_FADE_MS)
  }

  const ensureMist = () => {
    if (!viewer.world.getItemAt(0)) return
    if (!sea) {
      const floorHost =
        document.querySelector<HTMLElement>('#atlab-floor') ?? el
      sea = startSeaUnderlay(viewer, {
        lite: true,
        host: floorHost,
        onReady: releasePreviewAfterMask,
      })
    }
    if (!mist) {
      mist = startFocusClouds(viewer, {
        canvas: el,
        count: FLOOR_CLOUD_COUNT,
        lockedHome: true,
        decor: FLOOR_DECOR_COUNTS,
      })
    }
  }

  mountOverlaysOnViewer(viewer, { lite: true })
  mountProvinceLabels(viewer, { lite: true })
  // Floor follows overlay show/hide via overlayStore, but must not zoom with tours.
  void import('../transitions/player').then(({ getTourPlayer }) => {
    getTourPlayer().registerViewer(viewer, { camera: false })
  })

  viewer.addHandler('open', () => {
    fitHome()
    // Do NOT hide preview here — wait for land mask ready (onReady).
    ensureMist()
  })

  viewer.addHandler('open-failed', () => {
    window.clearTimeout(previewHoldTimer)
    if (preview) preview.hidden = false
  })

  return viewer
}
