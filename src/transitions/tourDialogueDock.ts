/** Centres tour subtitles + skip on the viewport (or ATLab wall). */
let dock: HTMLElement | null = null

export function ensureTourDialogueDock(): HTMLElement | null {
  if (dock?.isConnected) return dock
  const app = document.querySelector<HTMLElement>('#app')
  if (!app) return null
  dock = document.createElement('div')
  dock.id = 'tour-dialogue-dock'
  dock.className = 'tour-dialogue-dock'
  app.appendChild(dock)
  const caption = document.getElementById('tour-caption')
  const skip = document.getElementById('tour-skip')
  if (caption && caption.parentElement !== dock) dock.prepend(caption)
  if (skip && skip.parentElement !== dock) dock.appendChild(skip)
  return dock
}