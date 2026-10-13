/** Tour JSON under data/transitions/ — camera paths, overlays, narration. */

export type TourLocaleText = {
  'zh-Hant'?: string
  'zh-Hans'?: string
  en?: string
}

export type TourCameraTarget = {
  x?: number
  y?: number
  /** Resolve point from province-labels.json */
  labelId?: string
  zoomFactor?: number
  durationMs?: number
  home?: boolean
}

export type TourOverlayOp = {
  show?: string[]
  hide?: string[]
}

export type TourDrawOp = {
  featureId: string
  durationMs?: number
}

export type TourStopStep = {
  type: 'stop'
  id?: string
  camera?: TourCameraTarget
  overlays?: TourOverlayOp
  draw?: TourDrawOp
  caption?: TourLocaleText
  /** Narration markdown heading id */
  narrate?: string
  waitAfterMs?: number
}

export type TourOverlaysStep = {
  type: 'overlays'
} & TourOverlayOp

export type TourCameraStep = {
  type: 'camera'
} & TourCameraTarget

export type TourWaitStep = {
  type: 'wait'
  durationMs: number
}

export type TourStep =
  | TourStopStep
  | TourOverlaysStep
  | TourCameraStep
  | TourWaitStep

export type TourDefinition = {
  version: 1
  id: string
  title: string
  i18n?: {
    'zh-Hans'?: { title?: string }
    en?: { title?: string }
  }
  narrationDir?: string
  /** Square seal face text (4 chars typical) */
  sealTitle: string
  steps: TourStep[]
}

export type NarrationClip = {
  path: string
  voice?: string
  durationMs: number
}

export type NarrationManifest = {
  version: 1
  clips: Record<string, Record<string, Record<string, NarrationClip>>>
}
