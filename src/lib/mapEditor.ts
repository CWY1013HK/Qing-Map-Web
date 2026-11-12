export type EditorSessionMeta = {
  id: string
  label: string
}

let sessionActive = false
let sessionMeta: EditorSessionMeta | null = null

export function isEditorRoute(): boolean {
  const pathOnly = location.pathname.replace(/\/$/, '') || '/'
  return pathOnly === '/editor' || pathOnly.startsWith('/editor/')
}

export function setEditorSessionActive(on: boolean, meta?: EditorSessionMeta): void {
  sessionActive = on
  sessionMeta = on && meta ? meta : null
}

export function isEditorSessionActive(): boolean {
  return sessionActive
}

export function getEditorSessionMeta(): EditorSessionMeta | null {
  return sessionMeta
}

/** Dev server + /editor route + signed-in editor. */
export function canUseMapEditor(): boolean {
  return import.meta.env.DEV && isEditorRoute() && sessionActive
}
