import { getLocale, type Locale } from '../i18n'
import type { NarrationManifest } from './types'

/** Expand {mnc:…} for on-screen captions; keep Manchu visible. */
export function captionWithManchu(text: string): string {
  return text.replace(/\{mnc:([^}]*)\}/g, '$1').trim()
}

function parseStops(md: string): Map<string, string> {
  const map = new Map<string, string>()
  const body = md.replace(/^---[\s\S]*?---\n/, '')
  const re = /^##\s+(\S+)\s*\n([\s\S]*?)(?=^##\s|\s*$)/gm
  let m
  while ((m = re.exec(body))) {
    map.set(m[1]!, m[2]!.trim())
  }
  return map
}

const scriptCache = new Map<string, Map<string, string>>()

export async function loadNarrationScript(
  tourId: string,
  locale: Locale,
): Promise<Map<string, string>> {
  const key = `${tourId}/${locale}`
  const hit = scriptCache.get(key)
  if (hit) return hit

  const { getRawNarration } = await import('./scripts')
  const raw = getRawNarration(tourId, locale)
  if (!raw) {
    if (locale !== 'zh-Hant') return loadNarrationScript(tourId, 'zh-Hant')
    return new Map()
  }
  const map = parseStops(raw)
  scriptCache.set(key, map)
  return map
}

export async function getNarrationCaption(
  tourId: string,
  stopId: string,
): Promise<string> {
  const locale = getLocale()
  const map = await loadNarrationScript(tourId, locale)
  const raw = map.get(stopId) ?? ''
  return captionWithManchu(raw)
}

let manifestCache: NarrationManifest | null = null

export async function loadNarrationManifest(): Promise<NarrationManifest> {
  if (manifestCache) return manifestCache
  try {
    const res = await fetch('/data/narration/manifest.json')
    if (!res.ok) throw new Error(String(res.status))
    manifestCache = (await res.json()) as NarrationManifest
  } catch {
    manifestCache = { version: 1, clips: {} }
  }
  return manifestCache
}

export function estimateSpeechMs(text: string): number {
  // ~4.2 chars/sec for formal Cantonese / Mandarin; English ~14 chars/sec
  const locale = getLocale()
  const cleaned = text.replace(/\s+/g, '')
  const rate = locale === 'en' ? 14 : 4.2
  return Math.max(3500, Math.round((cleaned.length / rate) * 1000) + 800)
}

export type VoiceoverHandle = {
  stop: () => void
  done: Promise<void>
}

/**
 * Play committed MP3 if present; otherwise hold for estimated reading time.
 * Soundtrack ducking is handled by the caller via playlist.
 */
export function playVoiceover(
  tourId: string,
  stopId: string,
  captionText: string,
  signal?: AbortSignal,
): VoiceoverHandle {
  let stopped = false
  let audio: HTMLAudioElement | null = null
  let timer: number | undefined

  const stop = () => {
    stopped = true
    if (timer != null) window.clearTimeout(timer)
    if (audio) {
      audio.pause()
      audio.src = ''
      audio = null
    }
  }

  if (signal) {
    signal.addEventListener('abort', stop, { once: true })
  }

  const done = (async () => {
    const locale = getLocale()
    const manifest = await loadNarrationManifest()
    const clip = manifest.clips[tourId]?.[locale]?.[stopId]
    const fallbackMs = clip?.durationMs || estimateSpeechMs(captionText)

    if (clip?.path) {
      audio = new Audio(clip.path)
      audio.preload = 'auto'
      try {
        await audio.play()
        await new Promise<void>((resolve) => {
          if (!audio) return resolve()
          audio.addEventListener('ended', () => resolve(), { once: true })
          audio.addEventListener('error', () => resolve(), { once: true })
        })
        return
      } catch {
        /* fall through to timed hold */
      }
    }

    await new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, fallbackMs)
    })
  })().finally(() => {
    if (!stopped) stop()
  })

  return { stop, done }
}
