import type { Viewer } from 'openseadragon'
import { getLocale } from '../i18n'
import { getPlaylist } from '../lib/playlist'
import { overlayStore } from '../overlays/store'
import labelsJson from '../../data/overlays/province-labels.json'
import { tweenCameras, type LabelPointLookup } from './camera'
import { hideTourCaption, showTourCaption } from './caption'
import { drawOverlayFeature } from './draw'
import {
  captionWithManchu,
  loadNarrationScript,
  playVoiceover,
} from './narration'
import type { TourDefinition, TourStep } from './types'

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
  let savedVisible: string[] = []

  const cameraViewers = () => viewers.filter((v) => v.camera).map((v) => v.viewer)

  const emit = () => {
    for (const fn of listeners) fn(playingId)
  }

  const setTourPlayingUi = (playing: boolean) => {
    window.dispatchEvent(
      new CustomEvent('qing-tour-playing', { detail: { playing } }),
    )
  }

  const restoreOverlays = () => {
    if (!savedVisible.length) return
    const all = new Set([
      ...savedVisible,
      'handi-shibasheng',
      'zhongguo',
      'hailu',
      'xiandai-zhongguo',
    ])
    for (const id of all) {
      overlayStore.setVisible(id, savedVisible.includes(id))
    }
  }

  const stop = (opts?: { keepFocus?: boolean }) => {
    abort?.abort()
    abort = null
    const wasPlaying = playingId != null
    playingId = null
    hideTourCaption()
    getPlaylist().setDucked(false)
    restoreOverlays()
    if (wasPlaying) emit()
    if (wasPlaying && !opts?.keepFocus) setTourPlayingUi(false)
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

    const drawP = step.draw
      ? drawOverlayFeature(step.draw.featureId, step.draw.durationMs, signal)
      : Promise.resolve()

    let voiceP = Promise.resolve()
    if (step.narrate) {
      getPlaylist().setDucked(true)
      const vo = playVoiceover(narrDir, step.narrate, body, signal)
      voiceP = vo.done.finally(() => getPlaylist().setDucked(false))
    }

    await Promise.all([drawP, voiceP])
    if (signal.aborted) return
    if (step.waitAfterMs) await sleep(step.waitAfterMs, signal)
  }

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
    stop: () => stop(),
    async play(tour) {
      if (playingId === tour.id) {
        stop()
        return
      }
      stop({ keepFocus: true })
      savedVisible = [...overlayStore.getVisible()]
      playingId = tour.id
      abort = new AbortController()
      const signal = abort.signal
      setTourPlayingUi(true)
      emit()

      try {
        for (const step of tour.steps) {
          if (signal.aborted) break
          await runStep(tour, step, signal)
        }
      } finally {
        if (playingId === tour.id) {
          playingId = null
          hideTourCaption()
          getPlaylist().setDucked(false)
          restoreOverlays()
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
