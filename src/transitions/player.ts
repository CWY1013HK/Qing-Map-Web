import type { Viewer } from 'openseadragon'
import { applyChromeI18n } from '../i18n/applyChrome'
import { getLocale } from '../i18n'
import { t } from '../i18n/t'
import { getPlaylist } from '../lib/playlist'
import { overlayStore } from '../overlays/store'
import labelsJson from '../../data/overlays/province-labels.json'
import { tweenCameras, type LabelPointLookup } from './camera'
import { hideTourCaption, showTourCaption } from './caption'
import { drawOverlayFeature } from './draw'
import { clearTourFrames, showTourFrames } from './frames'
import {
  captionWithManchu,
  loadNarrationScript,
  playVoiceover,
} from './narration'
import type { TourDefinition, TourStep } from './types'

/** Overlay ids the tour may toggle — always restored to the pre-tour snapshot. */
const TOUR_OVERLAY_IDS = [
  'handi-shibasheng',
  'zhongguo',
  'hailu',
  'xiandai-zhongguo',
] as const

export type RegisterViewerOptions = {
  /**
   * When false, this viewer does not pan/zoom with tour camera steps
   * (ATLab floor: overlays still follow overlayStore).
   */
  camera?: boolean
}

export type TourPlayer = {
  play: (tour: TourDefinition) => Promise<void>
  stop: () => void
  /** Advance past the current dialogue / voiceover beat. */
  skipLine: () => void
  isPlaying: () => boolean
  registerViewer: (viewer: Viewer, opts?: RegisterViewerOptions) => () => void
  onState: (fn: (playingId: string | null) => void) => () => void
}

const labelPoints = new Map(
  (labelsJson as { labels: Array<{ id: string; point: { x: number; y: number } }> })
    .labels.map((l) => [l.id, l.point] as const),
)

const resolveLabel: LabelPointLookup = (id) => labelPoints.get(id) ?? null

function applyOverlays(op: { show?: string[]; hide?: string[] }): void {
  if (op.hide?.length) overlayStore.setGroupVisible(op.hide, false)
  if (op.show?.length) overlayStore.setGroupVisible(op.show, true)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const t = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}

let singleton: TourPlayer | null = null

export function getTourPlayer(): TourPlayer {
  if (singleton) return singleton

  type Registered = { viewer: Viewer; camera: boolean }
  const viewers: Registered[] = []
  const listeners = new Set<(playingId: string | null) => void>()
  let playingId: string | null = null
  let abort: AbortController | null = null
  /** Aborts only the current dialogue beat (not the whole tour). */
  let lineAbort: AbortController | null = null
  /** Exact visibility snapshot at tour start (`null` = nothing to restore). */
  let savedVisible: ReadonlySet<string> | null = null
  let skipBtn: HTMLButtonElement | null = null
  let clearFrames: (() => void) | null = null

  const cameraViewers = () => viewers.filter((v) => v.camera).map((v) => v.viewer)

  const setTourDragging = (enabled: boolean) => {
    for (const v of cameraViewers()) {
      v.setMouseNavEnabled(enabled)
    }
  }

  const emit = () => {
    for (const fn of listeners) fn(playingId)
  }

  const setTourPlayingUi = (playing: boolean) => {
    window.dispatchEvent(
      new CustomEvent('qing-tour-playing', { detail: { playing } }),
    )
    if (skipBtn) skipBtn.hidden = !playing
  }

  const restoreOverlays = () => {
    if (savedVisible == null) return
    const snapshot = savedVisible
    savedVisible = null
    const all = new Set<string>([...TOUR_OVERLAY_IDS, ...snapshot, ...overlayStore.getVisible()])
    for (const id of all) {
      overlayStore.setVisible(id, snapshot.has(id))
    }
  }

  const disposeLineChrome = () => {
    clearFrames?.()
    clearFrames = null
    clearTourFrames()
  }

  const skipLine = () => {
    if (playingId == null || !lineAbort || lineAbort.signal.aborted) return
    lineAbort.abort()
  }

  const stop = (opts?: { keepFocus?: boolean }) => {
    lineAbort?.abort()
    lineAbort = null
    abort?.abort()
    abort = null
    const wasPlaying = playingId != null
    playingId = null
    hideTourCaption()
    disposeLineChrome()
    getPlaylist().setDucked(false)
    restoreOverlays()
    if (wasPlaying) {
      if (!opts?.keepFocus) setTourDragging(true)
      emit()
      if (!opts?.keepFocus) setTourPlayingUi(false)
    }
  }

  const ensureSkipButton = () => {
    if (skipBtn) return skipBtn
    const app = document.querySelector<HTMLElement>('#app')
    if (!app) return null
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'tour-skip'
    btn.className = 'tour-skip'
    btn.hidden = true
    btn.innerHTML =
      '<span class="tour-skip-glyph" aria-hidden="true">»</span>'
    btn.title = t('tour.skip')
    btn.setAttribute('aria-label', t('tour.skipAria'))
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      skipLine()
    })
    app.appendChild(btn)
    skipBtn = btn
    return btn
  }

  const runStep = async (
    tour: TourDefinition,
    step: TourStep,
    signal: AbortSignal,
  ): Promise<void> => {
    if (signal.aborted) return

    if (step.type === 'overlays') {
      applyOverlays(step)
      return
    }

    if (step.type === 'wait') {
      await sleep(step.durationMs, signal)
      return
    }

    if (step.type === 'camera') {
      await tweenCameras(cameraViewers(), step, resolveLabel, signal)
      return
    }

    // stop
    if (step.overlays) applyOverlays(step.overlays)
    if (step.camera) {
      await tweenCameras(cameraViewers(), step.camera, resolveLabel, signal)
    }
    if (signal.aborted) return

    const narrDir = tour.narrationDir ?? tour.id
    let body = ''
    if (step.narrate) {
      const map = await loadNarrationScript(narrDir, getLocale())
      body = captionWithManchu(map.get(step.narrate) ?? '')
    }
    showTourCaption(step.caption, body || undefined)

    lineAbort = new AbortController()
    const lineSignal = lineAbort.signal
    const onTourAbort = () => lineAbort?.abort()
    signal.addEventListener('abort', onTourAbort, { once: true })

    let cue: HTMLAudioElement | null = null
    // Tour stays soft-ducked between stops (see play()); hard-mute only under SFX/anthems.
    const hasMusicCue = Boolean(step.music?.path)
    if (hasMusicCue) getPlaylist().setDucked(true, { hard: true })
    try {
      if (step.images?.length) {
        clearFrames = showTourFrames(step.images)
      }

      if (step.music?.path) {
        cue = new Audio(step.music.path)
        cue.preload = 'auto'
        cue.volume = Math.max(0, Math.min(1, step.music.volume ?? 0.4))
        const startAt = step.music.startAt ?? 0
        const seekCue = () => {
          if (!cue || startAt <= 0) return
          try {
            cue.currentTime = startAt
          } catch {
            /* seek may fail before metadata */
          }
        }
        seekCue()
        cue.addEventListener('loadedmetadata', seekCue, { once: true })
        const stopCue = () => {
          if (!cue) return
          cue.pause()
          cue.src = ''
          cue = null
        }
        lineSignal.addEventListener('abort', stopCue, { once: true })
        void cue.play().then(seekCue).catch(() => {
          stopCue()
        })
      }

      const drawP = step.draw
        ? drawOverlayFeature(step.draw.featureId, step.draw.durationMs, lineSignal)
        : Promise.resolve()

      let voiceP = Promise.resolve()
      if (step.narrate) {
        const vo = playVoiceover(narrDir, step.narrate, body, lineSignal)
        voiceP = vo.done
      }

      await Promise.all([drawP, voiceP])
      if (signal.aborted) return
      if (step.waitAfterMs) await sleep(step.waitAfterMs, lineSignal)
    } finally {
      if (cue) {
        cue.pause()
        cue.src = ''
        cue = null
      }
      // Back to soft tour duck — do NOT restore full bed mid-tour (that was the loud spike).
      if (hasMusicCue && playingId != null) getPlaylist().setDucked(true)
      disposeLineChrome()
      signal.removeEventListener('abort', onTourAbort)
      lineAbort = null
    }
  }

  ensureSkipButton()
  applyChromeI18n()

  const onScreenClick = (e: MouseEvent) => {
    if (playingId == null || !lineAbort || lineAbort.signal.aborted) return
    const target = e.target
    if (!(target instanceof Element)) return
    if (
      target.closest(
        '#tour-skip, .tour-frame, .tour-frames, a, button, input, textarea, select, label',
      )
    ) {
      return
    }
    e.preventDefault()
    skipLine()
  }

  document.addEventListener('click', onScreenClick, true)

  singleton = {
    registerViewer(viewer, opts) {
      const entry: Registered = { viewer, camera: opts?.camera !== false }
      viewers.push(entry)
      return () => {
        const i = viewers.indexOf(entry)
        if (i >= 0) viewers.splice(i, 1)
      }
    },
    onState(fn) {
      listeners.add(fn)
      fn(playingId)
      return () => listeners.delete(fn)
    },
    isPlaying() {
      return playingId != null
    },
    skipLine,
    stop: () => stop(),
    async play(tour) {
      if (playingId === tour.id) {
        stop()
        return
      }
      stop({ keepFocus: true })
      ensureSkipButton()
      savedVisible = overlayStore.getVisible()
      playingId = tour.id
      abort = new AbortController()
      const signal = abort.signal
      setTourDragging(false)
      setTourPlayingUi(true)
      // Soft-duck the bed for the whole tour so camera/transitions don't spike loud.
      getPlaylist().setDucked(true)
      emit()

      try {
        for (const step of tour.steps) {
          if (signal.aborted) break
          await runStep(tour, step, signal)
        }
      } finally {
        if (playingId === tour.id) {
          playingId = null
          lineAbort = null
          hideTourCaption()
          disposeLineChrome()
          getPlaylist().setDucked(false)
          restoreOverlays()
          setTourDragging(true)
          setTourPlayingUi(false)
          emit()
        }
      }
    },
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || playingId == null) return
      e.preventDefault()
      stop()
    },
    true,
  )

  return singleton
}
