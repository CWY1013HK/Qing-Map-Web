/**
 * Site / exhibition config — change here (or later from an API) rather than in the UI.
 */
export type UiTheme = 'bronze' | 'silver'

/** Chrome theme: silver (default) or bronze. Not exposed as an end-user control. */
export const UI_THEME: UiTheme = 'silver'

/**
 * Intro zoom target — normalized image coordinates (0–1).
 * Aimed at 陜西（西陝）in Guanzhong, slightly SE of 鳳翔.
 */
export const INTRO_FOCUS = {
  x: 0.48,
  /** Lower on the scan (larger y) than 鳳翔 — sits nearer 西安. */
  y: 0.36,
  /** Multiplier of home zoom while focused (higher = closer). */
  zoomFactor: 3.6,
} as const

/**
 * ATLab dual-canvas layout (wall + floor stacked).
 * Browse at `/atlab` — fixed pixel frame for the exhibition screens.
 */
export const ATLAB = {
  width: 3536,
  wallHeight: 808,
  floorHeight: 2400,
} as const

/**
 * Soundtrack — files in `public/audio/`.
 * Flow: Mist (intro, loops) → Chao Tian Zi on seal → Jing Diao once → Mist ↔ Jing loop.
 */
export const AUDIO = {
  mistSheng: '/audio/mist-sheng.mp3',
  chaoTianZi: '/audio/chao-tian-zi.mp3',
  jingDiao: '/audio/jing-diao.mp3',
  volume: 0.5,
  /** Louder entry hit when the seal is clicked. */
  chaoTianZiVolume: 0.7,
  /** Skip silence so the drum lands during Mist Sheng’s fade-out. */
  chaoTianZiStartAt: 1,
  fadeMs: 800,
} as const

/**
 * Credits panel bottom “tools” row (edge-edit toggle, etc.).
 * Set to `false` for public launch so the row is not rendered at all.
 */
export const CREDITS_SHOW_DEV_TOOLS = true
