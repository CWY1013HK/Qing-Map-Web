import { getPlaylist } from '../lib/playlist'
import { t } from '../i18n'

function syncMusicButton(enabled: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-music')
  if (!btn) return
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false')
  btn.title = enabled ? t('toolbar.musicMute') : t('toolbar.musicEnable')
}

/** Wire #btn-music (音) to mute / unmute the soundtrack. */
export function mountMusicToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-music')
  if (!btn) throw new Error('Missing #btn-music')

  const playlist = getPlaylist()
  syncMusicButton(!playlist.isMuted())

  btn.addEventListener('click', () => {
    const muted = playlist.toggleMuted()
    syncMusicButton(!muted)
  })
}
