import OpenSeadragon from 'openseadragon'
import { mountI18n, setStatusMessage } from '../i18n'
import { getPlaylist } from '../lib/playlist'
import { mountOverlaysOnViewer } from '../overlays/manager'
import { mountProvinceLabels } from '../overlays/provinceLabels'
import { mountOverlaySealControls } from '../overlays/sealControl'
import { mountCreditsToggle } from '../popups/credits'
import { mountLabelToggle, mountLocationLabels } from '../popups/labels'
import { mountChrome } from './chrome'
import { focusIntroRegion, mountIntro } from './intro'
import { mountFocusMode } from './focusMode'
import { mountMusicToggle } from './musicToggle'

const PREVIEW_URL = '/map-preview.jpg'
const TILE_SOURCE = '/tiles/map.dzi'

export type BootInteractiveOptions = {
  /** When false, skip intro curtain (useful for kiosk tests). Default true. */
  intro?: boolean
}

/**
 * Boot the full interactive map into the standard #app chrome
 * (#viewer, #preview, toolbar, minimap, intro, focus).
 */
export function bootInteractiveViewer(opts: BootInteractiveOptions = {}): OpenSeadragon.Viewer {
  const withIntro = opts.intro !== false

  mountI18n()

  const previewEl = document.querySelector<HTMLImageElement>('#preview')
  const viewerRoot = document.querySelector<HTMLElement>('#viewer')
  const statusEl = document.querySelector<HTMLElement>('#status')
  const tileStatusEl = document.querySelector<HTMLElement>('#tile-status')

  if (!previewEl || !viewerRoot || !statusEl || !tileStatusEl) {
    throw new Error('Missing required #app elements')
  }

  const preview = previewEl
  const viewerEl = viewerRoot
  const status = statusEl
  const tileStatus = tileStatusEl

  setStatusMessage(status, 'status.loadingPreview')

  function showHtmlPreview(): void {
    status.hidden = true
    preview.hidden = false
    tileStatus.hidden = false
    setStatusMessage(tileStatus, 'status.loadingTiles')
  }

  function showViewer(): void {
    preview.hidden = true
    viewerEl.hidden = false
    viewerEl.classList.add('is-ready')
    viewerEl.removeAttribute('aria-hidden')
    window.dispatchEvent(new Event('resize'))
  }

  function failToHtmlPreview(
    messageKey: 'status.previewLayerMissing' | 'status.tilesFailed' | 'status.openFailed',
  ): void {
    tileStatus.hidden = false
    setStatusMessage(tileStatus, messageKey)
    preview.hidden = false
    viewerEl.hidden = true
    viewerEl.classList.remove('is-ready')
  }

  if (preview.complete && preview.naturalWidth > 0) {
    showHtmlPreview()
  } else {
    preview.addEventListener('load', showHtmlPreview, { once: true })
    preview.addEventListener(
      'error',
      () => {
        setStatusMessage(status, 'status.previewLoadError')
      },
      { once: true },
    )
  }

  viewerEl.hidden = false
  viewerEl.setAttribute('aria-hidden', 'true')

  const viewer = OpenSeadragon({
    element: viewerEl,
    prefixUrl: '/osd-images/',
    tileSources: {
      type: 'image',
      url: PREVIEW_URL,
    },
    placeholderFillStyle: 'transparent',
    showNavigationControl: false,
    showNavigator: true,
    navigatorId: 'map-navigator',
    navigatorPosition: 'ABSOLUTE',
    navigatorSizeRatio: 1,
    navigatorMaintainSizeRatio: false,
    animationTime: 2.4,
    springStiffness: 5.2,
    blendTime: 0.55,
    immediateRender: true,
    imageLoaderLimit: 8,
    constrainDuringPan: true,
    visibilityRatio: 1,
    minZoomImageRatio: 1,
    maxZoomPixelRatio: 3,
    gestureSettingsMouse: {
      clickToZoom: false,
    },
  })

  mountChrome(viewer)
  mountFocusMode(viewer)
  // Warm the land plate so 淨 mode does not wait on an 8MB fetch.
  const landWarm = new Image()
  landWarm.decoding = 'async'
  landWarm.src = '/land/map-land.webp?v=20'
  mountOverlaysOnViewer(viewer)
  mountOverlaySealControls()
  const provinceLabels = mountProvinceLabels(viewer)
  if (import.meta.env.DEV) {
    void import('../overlays/vertexEditor').then(({ mountOverlayVertexEditor }) => {
      mountOverlayVertexEditor(viewer, { provinceLabels })
    })
  }
  mountLocationLabels(viewer)
  mountLabelToggle()
  mountMusicToggle()
  mountCreditsToggle()

  function lockMinZoomToHome(): void {
    const homeZoom = viewer.viewport.getHomeZoom()
    ;(viewer as unknown as { minZoomLevel: number }).minZoomLevel = homeZoom
    if (viewer.viewport.getZoom() < homeZoom) {
      viewer.viewport.zoomTo(homeZoom, undefined, true)
    }
  }

  function stackHighResDirectlyOnPreview(): void {
    const base = viewer.world.getItemAt(0)
    if (!base) {
      failToHtmlPreview('status.previewLayerMissing')
      return
    }

    const bounds = base.getBounds()

    viewer.addTiledImage({
      tileSource: TILE_SOURCE,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      success: () => {
        tileStatus.hidden = true
        setStatusMessage(tileStatus, null)
      },
      error: () => {
        failToHtmlPreview('status.tilesFailed')
      },
    })
  }

  viewer.addHandler('open', () => {
    showViewer()
    lockMinZoomToHome()
    stackHighResDirectlyOnPreview()
    if (withIntro) {
      mountIntro(viewer)
    } else {
      getPlaylist().startAmbientLoop()
    }
    window.dispatchEvent(new Event('resize'))
  })

  viewer.addHandler('resize', () => {
    lockMinZoomToHome()
    if (
      withIntro &&
      document.getElementById('app')?.classList.contains('intro-active')
    ) {
      focusIntroRegion(viewer, true)
    }
  })

  viewer.addHandler('open-failed', () => {
    failToHtmlPreview('status.openFailed')
  })

  return viewer
}
