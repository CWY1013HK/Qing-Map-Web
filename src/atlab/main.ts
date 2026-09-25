import '../styles/fonts.css'
import '../styles/viewer.css'
import '../styles/atlab.css'
import '../styles/overlays.css'
import '../styles/popups.css'
import { ATLAB } from '../config'
import { bootInteractiveViewer } from '../viewer/bootViewer'
import { bootFloorViewer } from './bootFloor'

/**
 * Fixed ATLab pixel frame (3536 × 3208).
 * Always scale to fit the browser so both wall + floor are visible
 * (native 1:1 when the window is at least that large).
 * Pass ?nofit=1 to scroll the raw pixel canvas instead.
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

  const noFit = new URLSearchParams(window.location.search).has('nofit')
  if (noFit) {
    document.body.style.overflow = 'auto'
    root.style.transform = ''
    return
  }

  document.body.style.overflow = 'hidden'
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

bootInteractiveViewer()
bootFloorViewer()

/* After first paint / scale, force OSD to remeasure both displays */
requestAnimationFrame(() => {
  window.dispatchEvent(new Event('resize'))
})
