import '../styles/fonts.css'
import '../styles/viewer.css'
import '../styles/atlab.css'
import '../styles/overlays.css'
import '../styles/popups.css'
import { ATLAB, MAP_ASPECT } from '../config'
import { bootInteractiveViewer } from '../viewer/bootViewer'
import { bindAtlabMultiTouch } from './wallInput'
import { bootFloorViewer } from './bootFloor'

/**
 * Fixed ATLab pixel frame (wall + floor band).
 * The wall shows the whole scan, letterboxed in the short strip.
 * Floor map is laid out at scan aspect then vertically stretched to fill the floor.
 * Always scale to fit the browser so both wall + floor are visible
 * (native 1:1 when the window is at least that large).
 * Pass ?nofit=1 to show the raw pixel canvas without scale-to-fit (page stays fixed).
 * Pass ?wallTilt=1 to start turned, or switch it on from 功 天旋地轉.
 * Pearl shows with 功 天旋地轉 or in 折; two-finger gestures work on the flat wall.
 */
function layoutAtlabFrame(): void {
  const root = document.getElementById('atlab')
  if (!root) return

  const totalH = ATLAB.wallHeight + ATLAB.floorHeight
  root.style.width = `${ATLAB.width}px`
  root.style.height = `${totalH}px`
  root.style.setProperty('--atlab-w', `${ATLAB.width}px`)
  root.style.setProperty('--atlab-wall-h', `${ATLAB.wallHeight}px`)
  root.style.setProperty('--atlab-floor-h', `${ATLAB.floorHeight}px`)
  root.style.setProperty('--floor-native-h', `${ATLAB.floorNativeHeight}px`)
  root.style.setProperty('--map-aspect', String(MAP_ASPECT))

  const noFit = new URLSearchParams(window.location.search).has('nofit')
  if (noFit) {
    root.style.transform = ''
    return
  }
  const sx = window.innerWidth / ATLAB.width
  const sy = window.innerHeight / totalH
  const scale = Math.min(sx, sy)
  root.style.transform = scale < 0.999 ? `scale(${scale})` : ''
}

layoutAtlabFrame()
window.addEventListener('resize', () => {
  layoutAtlabFrame()
  window.dispatchEvent(new Event('qing-atlab-layout'))
})

if (new URLSearchParams(window.location.search).has('floorDebug')) {
  document.getElementById('atlab')?.classList.add('floor-debug')
  console.info(
    '[atlab floorDebug] magenta=bg hole · lime=land mask · orange=wave svg · cyan outline=preview still up',
  )
}

const wallViewer = bootInteractiveViewer()
bindAtlabMultiTouch(wallViewer)
bootFloorViewer()

/* After first paint / scale, force OSD to remeasure both displays */
requestAnimationFrame(() => {
  window.dispatchEvent(new Event('resize'))
})
