import { getLocale, setLocale, t, type Locale } from '../i18n'

function setText(sel: string, text: string): void {
  document.querySelector<HTMLElement>(sel)?.replaceChildren(document.createTextNode(text))
}

function syncLangButtons(): void {
  const loc = getLocale()
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.editor-lang-btn')) {
    const pressed = btn.dataset.locale === loc
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false')
  }
}

export function applyEditorChrome(): void {
  document.title = t('editor.docTitle')
  setText('#editor-gate-title', t('editor.gateTitle'))
  setText('#editor-gate-blurb', t('editor.gateBlurb'))
  setText('label[for="editor-password"]', t('editor.passwordLabel'))
  setText('#editor-login-btn', t('editor.enter'))
  setText('#editor-logout-btn', t('editor.signOut'))
  document.querySelector('#editor-gate-lang')?.setAttribute('aria-label', t('editor.langAria'))
  setText('#editor-lang-hant', t('credits.langHant'))
  setText('#editor-lang-hans', t('credits.langHans'))
  setText('#editor-lang-en', t('credits.langEn'))
  syncLangButtons()
}

export function mapEditorAuthError(serverMsg: string | undefined): string {
  if (serverMsg === 'Invalid password') return t('editor.error.invalidPassword')
  return serverMsg ?? t('editor.error.signInFailed')
}

export function mountEditorLangToggle(): void {
  const group = document.getElementById('editor-gate-lang')
  group?.addEventListener('click', (e) => {
    const target = e.target
    if (!(target instanceof HTMLButtonElement)) return
    const loc = target.dataset.locale
    if (loc !== 'zh-Hant' && loc !== 'zh-Hans' && loc !== 'en') return
    setLocale(loc as Locale)
  })
}
