/**
 * Map décor sprites (fuchuans, Mongols, merchants) — same drift lifecycle as
 * focus clouds, but seeded into sea / northern desert bands.
 *
 * Themes:
 * - `xiangyun` (default): blue-edge / white-interior stamps matching cloud puffs
 * - `reference`: earlier painted/photo-derived cutouts (kept for alternate look)
 */

import { rand, type CloudDriftDir, type CloudHeadSide } from './clouds'
import seaLanesJson from '../../data/decor/sea-lanes.json'

export type DecorKind = 'fuchuan' | 'mongol' | 'merchant'
export type DecorTheme = 'xiangyun' | 'reference'

export type DecorAsset = {
  src: string
  kind: DecorKind
  theme: DecorTheme
  /** Side the subject faces in the native PNG (before CSS flip). */
  headSide: CloudHeadSide
  /** Native width / height. */
  aspect: number
}

/** Normalized [0,1] axis-aligned band on the map image. */
export type DecorRegion = {
  x0: number
  x1: number
  y0: number
  y1: number
}

export type NormPoint = { x: number; y: number }

/** Polyline ships follow through the white wave corridors. */
export type SeaLane = {
  id: string
  points: readonly NormPoint[]
}

/**
 * Southern / eastern seas (wave fields) — keep clear of mainland & far-east colophon text.
 * Used for bounce clamp of non-lane décor; fuchuans prefer SEA_LANES.
 */
const SEA_REGIONS: readonly DecorRegion[] = [
  { x0: 0.40, x1: 0.72, y0: 0.78, y1: 0.95 },
  { x0: 0.66, x1: 0.84, y0: 0.58, y1: 0.90 },
  { x0: 0.72, x1: 0.86, y0: 0.40, y1: 0.62 },
]

/**
 * Northern desert / steppe frontier (Xinjiang–Mongolia band north of Handi).
 */
const DESERT_REGIONS: readonly DecorRegion[] = [
  { x0: 0.08, x1: 0.42, y0: 0.05, y1: 0.22 },
  { x0: 0.28, x1: 0.58, y0: 0.04, y1: 0.18 },
  { x0: 0.10, x1: 0.32, y0: 0.18, y1: 0.30 },
]

/** Active map theme — cloud-puff blue/white counterparts. */
export const ACTIVE_DECOR_THEME: DecorTheme = 'xiangyun'

export const SEA_LANES: readonly SeaLane[] = (
  seaLanesJson as { lanes: SeaLane[] }
).lanes

export const DECOR_ASSETS: readonly DecorAsset[] = [
  // —— Xiangyun (cloud style) ——
  {
    src: '/decor/xiangyun/xiangyun-fuchuan-a.png',
    kind: 'fuchuan',
    theme: 'xiangyun',
    headSide: 'left',
    aspect: 1125 / 854,
  },
  {
    src: '/decor/xiangyun/xiangyun-fuchuan-b.png',
    kind: 'fuchuan',
    theme: 'xiangyun',
    headSide: 'right',
    aspect: 1152 / 864,
  },
  {
    src: '/decor/xiangyun/xiangyun-fuchuan-c.png',
    kind: 'fuchuan',
    theme: 'xiangyun',
    headSide: 'left',
    aspect: 1024 / 1024,
  },
  {
    src: '/decor/xiangyun/xiangyun-mongol-a.png',
    kind: 'mongol',
    theme: 'xiangyun',
    headSide: 'left',
    aspect: 1149 / 850,
  },
  {
    src: '/decor/xiangyun/xiangyun-mongol-b.png',
    kind: 'mongol',
    theme: 'xiangyun',
    headSide: 'left',
    aspect: 482 / 842,
  },
  {
    src: '/decor/xiangyun/xiangyun-mongol-c.png',
    kind: 'mongol',
    theme: 'xiangyun',
    headSide: 'left',
    aspect: 1143 / 844,
  },
  {
    src: '/decor/xiangyun/xiangyun-merchant-a.png',
    kind: 'merchant',
    theme: 'xiangyun',
    headSide: 'right',
    aspect: 1166 / 597,
  },
  {
    src: '/decor/xiangyun/xiangyun-merchant-b.png',
    kind: 'merchant',
    theme: 'xiangyun',
    headSide: 'right',
    aspect: 1169 / 599,
  },
  {
    src: '/decor/xiangyun/xiangyun-merchant-c.png',
    kind: 'merchant',
    theme: 'xiangyun',
    headSide: 'left',
    aspect: 1166 / 597,
  },

  // —— Reference theme (painted / photo-derived; kept separately) ——
  {
    src: '/decor/reference/decor-fuchuan-a.png',
    kind: 'fuchuan',
    theme: 'reference',
    headSide: 'left',
    aspect: 635 / 817,
  },
  {
    src: '/decor/reference/decor-fuchuan-b.png',
    kind: 'fuchuan',
    theme: 'reference',
    headSide: 'right',
    aspect: 811 / 843,
  },
  {
    src: '/decor/reference/decor-mongol-a.png',
    kind: 'mongol',
    theme: 'reference',
    headSide: 'right',
    aspect: 1260 / 695,
  },
  {
    src: '/decor/reference/decor-mongol-b.png',
    kind: 'mongol',
    theme: 'reference',
    headSide: 'left',
    aspect: 612 / 704,
  },
  {
    src: '/decor/reference/decor-merchant-a.png',
    kind: 'merchant',
    theme: 'reference',
    headSide: 'right',
    aspect: 1094 / 629,
  },
  {
    src: '/decor/reference/decor-merchant-b.png',
    kind: 'merchant',
    theme: 'reference',
    headSide: 'left',
    aspect: 1093 / 750,
  },
] as const

export type DecorCounts = {
  fuchuan: number
  mongol: number
  merchant: number
}

/**
 * Default “a few” of each kind for focus mist / floor.
 * Mongols & merchants are off for now (counts 0) while we refine their stamps;
 * bump the counts to re-enable.
 */
export const DEFAULT_DECOR_COUNTS: DecorCounts = {
  fuchuan: 5,
  mongol: 0,
  merchant: 0,
}

/** Slightly denser scatter for the large ATLab floor canvas. */
export const FLOOR_DECOR_COUNTS: DecorCounts = {
  fuchuan: 7,
  mongol: 0,
  merchant: 0,
}

export function regionForKind(kind: DecorKind): DecorRegion {
  const pool = kind === 'fuchuan' ? SEA_REGIONS : DESERT_REGIONS
  return pool[Math.floor(Math.random() * pool.length)]!
}

export function pickDecorAsset(
  kind: DecorKind,
  theme: DecorTheme = ACTIVE_DECOR_THEME,
): DecorAsset {
  const list = DECOR_ASSETS.filter((a) => a.kind === kind && a.theme === theme)
  if (list.length === 0) {
    throw new Error(`No décor assets for kind=${kind} theme=${theme}`)
  }
  return list[Math.floor(Math.random() * list.length)]!
}

export function pickSeaLane(): SeaLane {
  if (SEA_LANES.length === 0) {
    throw new Error('No sea lanes loaded')
  }
  // Length-weighted so ships prefer long coastal trunks over short spurs.
  const lengths = SEA_LANES.map((lane) => {
    let len = 0
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1]!
      const b = lane.points[i]!
      len += Math.hypot(b.x - a.x, b.y - a.y)
    }
    return Math.max(len, 1e-6)
  })
  const total = lengths.reduce((s, n) => s + n, 0)
  let r = Math.random() * total
  for (let i = 0; i < SEA_LANES.length; i++) {
    r -= lengths[i]!
    if (r <= 0) return SEA_LANES[i]!
  }
  return SEA_LANES[SEA_LANES.length - 1]!
}

/** Image-pixel point inside a normalized region. */
export function randomInRegion(
  region: DecorRegion,
  size: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: rand(region.x0, region.x1) * size.x,
    y: rand(region.y0, region.y1) * size.y,
  }
}

export type LaneTracker = {
  /** Image-pixel polyline. */
  points: { x: number; y: number }[]
  /** Cumulative length at each vertex (image px). */
  cum: number[]
  total: number
  /** Distance along path (image px). */
  s: number
  /** Travel sense along the polyline. */
  pathDir: 1 | -1
}

export function buildLaneTracker(
  lane: SeaLane,
  size: { x: number; y: number },
  startFrac = Math.random(),
): LaneTracker {
  const points = lane.points.map((p) => ({
    x: p.x * size.x,
    y: p.y * size.y,
  }))
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const total = cum[cum.length - 1] || 1
  return {
    points,
    cum,
    total,
    s: clamp01(startFrac) * total,
    pathDir: Math.random() < 0.5 ? 1 : -1,
  }
}

export function sampleLane(
  lane: LaneTracker,
  s: number,
): { x: number; y: number; tx: number; ty: number } {
  const pts = lane.points
  const cum = lane.cum
  if (pts.length === 0) return { x: 0, y: 0, tx: 1, ty: 0 }
  if (pts.length === 1) return { x: pts[0]!.x, y: pts[0]!.y, tx: 1, ty: 0 }

  const t = Math.max(0, Math.min(lane.total, s))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1]! < t) i++
  const s0 = cum[i]!
  const s1 = cum[i + 1]!
  const a = pts[i]!
  const b = pts[i + 1]!
  const seg = Math.max(1e-6, s1 - s0)
  const u = (t - s0) / seg
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return {
    x: a.x + dx * u,
    y: a.y + dy * u,
    tx: dx / len,
    ty: dy / len,
  }
}

/**
 * Image-pixel width.
 * Fuchuans are tiny stamps along sea lanes; horsemen/merchants stay compact.
 */
export function randomDecorWidthPx(kind: DecorKind): number {
  if (kind === 'fuchuan') {
    // Way smaller than before (~220–620) — read as map flecks on the lanes
    const roll = Math.random()
    if (roll < 0.45) return rand(55, 80)
    if (roll < 0.85) return rand(80, 110)
    return rand(110, 140)
  }
  const roll = Math.random()
  if (roll < 0.4) return rand(70, 100)
  if (roll < 0.85) return rand(100, 140)
  return rand(140, 180)
}

/**
 * Cruise speed in image px / s. Figurative décor drifts slower than mist so
 * ships and riders stay readable. `dir` reserved for future asymmetric bias.
 */
export function decorCruiseSpeed(
  kind: DecorKind,
  mapWidthPx: number,
  _dir: CloudDriftDir,
): number {
  if (kind === 'fuchuan') {
    // Slightly slower along winding lanes
    return (mapWidthPx * rand(0.06, 0.12)) / rand(100, 150)
  }
  return (mapWidthPx * rand(0.07, 0.13)) / rand(100, 150)
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
