import '../styles/fonts.css'
import '../styles/viewer.css'
import '../styles/overlays.css'
import '../styles/popups.css'
import '../styles/editor.css'
import { bootInteractiveViewer } from '../viewer/bootViewer'
import { setEditorSessionActive, type EditorSessionMeta } from '../lib/mapEditor'

type SessionOk = { ok: true; editor: EditorSessionMeta }
type SessionFail = { ok: false; error?: string }
type SessionResponse = SessionOk | SessionFail

async function fetchSession(): Promise<SessionResponse | null> {
  const res = await fetch('/__dev/editor/session', { credentials: 'same-origin' })
  if (res.status === 401) return null
  return (await res.json()) as SessionResponse
}

async function login(password: string): Promise<SessionResponse> {
  const res = await fetch('/__dev/editor/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  return (await res.json()) as SessionResponse
}

function showSignedIn(meta: EditorSessionMeta): void {
  const bar = document.getElementById('editor-signed-in')
  const label = document.getElementById('editor-signed-in-label')
  const gate = document.getElementById('editor-gate')
  if (label) label.textContent = meta.label
  bar?.removeAttribute('hidden')
  gate?.setAttribute('hidden', '')
}

function showGate(): void {
  document.getElementById('editor-signed-in')?.setAttribute('hidden', '')
  document.getElementById('editor-gate')?.removeAttribute('hidden')
  setEditorSessionActive(false)
}

function startViewer(): void {
  bootInteractiveViewer({ editor: true, intro: true })
}

async function bootAfterAuth(meta: EditorSessionMeta): Promise<void> {
  setEditorSessionActive(true, meta)
  showSignedIn(meta)
  startViewer()
}

function wireLoginForm(): void {
  const form = document.getElementById('editor-login-form')
  const errorEl = document.getElementById('editor-gate-error')
  const submitBtn = document.getElementById('editor-login-btn') as HTMLButtonElement | null
  const passwordInput = document.getElementById('editor-password') as HTMLInputElement | null

  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!passwordInput) return
    const password = passwordInput.value
    if (!password.trim()) return
    errorEl?.setAttribute('hidden', '')
    if (submitBtn) submitBtn.disabled = true
    try {
      const result = await login(password)
      if (!result.ok) {
        if (errorEl) {
          errorEl.textContent = result.error ?? 'Sign-in failed'
          errorEl.removeAttribute('hidden')
        }
        return
      }
      if ('editor' in result && result.editor) await bootAfterAuth(result.editor)
    } finally {
      if (submitBtn) submitBtn.disabled = false
    }
  })
}

function wireLogout(): void {
  document.getElementById('editor-logout-btn')?.addEventListener('click', async () => {
    await fetch('/__dev/editor/logout', { method: 'POST', credentials: 'same-origin' })
    location.reload()
  })
}

async function main(): Promise<void> {
  if (!import.meta.env.DEV) {
    document.body.textContent = 'Editor is only available with npm run dev.'
    return
  }

  wireLoginForm()
  wireLogout()

  const session = await fetchSession()
  if (session?.ok && session.editor) {
    await bootAfterAuth(session.editor)
    return
  }

  showGate()
}

void main()
