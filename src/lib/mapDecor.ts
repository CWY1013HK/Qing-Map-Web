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
  /** Source sea-lane id (for endpoint transfers). */
  laneId: string
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
  pathDir?: 1 | -1,
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
    laneId: lane.id,
    points,
    cum,
    total,
    s: clamp01(startFrac) * total,
    pathDir: pathDir ?? (Math.random() < 0.5 ? 1 : -1),
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

type LaneEnd = 'start' | 'end'

/** Hop onto another lane at a fractional arc length (0 = start, 1 = end, mid allowed). */
type LaneTransfer = {
  laneId: string
  /** Fraction along the target lane [0, 1]. */
  sFrac: number
}

/** Spur / cross attachment along a trunk (another lane’s endpoint meets this polyline). */
type MidJunction = {
  /** Fraction along this lane where the hub sits. */
  sFrac: number
  transfers: LaneTransfer[]
}

/** Normalized distance for “almost overlapping” hubs (end↔end or end↔mid). */
const HUB_EPS = 0.01

function endKey(laneId: string, at: LaneEnd): string {
  return `${laneId}:${at}`
}

/** Closest point on a polyline (vertex or segment projection), as arc-length fraction. */
function nearestFracOnLane(
  px: number,
  py: number,
  points: readonly NormPoint[],
): { d: number; sFrac: number } {
  if (points.length === 0) return { d: Infinity, sFrac: 0 }
  if (points.length === 1) {
    const p = points[0]!
    return { d: Math.hypot(p.x - px, p.y - py), sFrac: 0 }
  }

  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const total = Math.max(cum[cum.length - 1]!, 1e-9)

  let bestD = Infinity
  let bestFrac = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy || 1e-12
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const qx = a.x + t * dx
    const qy = a.y + t * dy
    const d = Math.hypot(qx - px, qy - py)
    if (d < bestD) {
      bestD = d
      const s = cum[i - 1]! + t * (cum[i]! - cum[i - 1]!)
      bestFrac = s / total
    }
  }
  return { d: bestD, sFrac: bestFrac }
}

function applyTransfer(
  tracker: LaneTracker,
  transfer: LaneTransfer,
  size: { x: number; y: number },
): boolean {
  const nextLane = LANE_BY_ID.get(transfer.laneId)
  if (!nextLane) return false

  let pathDir: 1 | -1
  if (transfer.sFrac <= 1e-6) pathDir = 1
  else if (transfer.sFrac >= 1 - 1e-6) pathDir = -1
  else pathDir = Math.random() < 0.5 ? 1 : -1

  const next = buildLaneTracker(nextLane, size, transfer.sFrac, pathDir)
  tracker.laneId = next.laneId
  tracker.points = next.points
  tracker.cum = next.cum
  tracker.total = next.total
  tracker.s = next.s
  tracker.pathDir = next.pathDir
  return true
}

function buildHubGraph(lanes: readonly SeaLane[], eps: number): {
  endpointAdj: Map<string, LaneTransfer[]>
  midByLane: Map<string, MidJunction[]>
} {
  type EndPt = { laneId: string; at: LaneEnd; x: number; y: number }
  const ends: EndPt[] = []
  for (const lane of lanes) {
    if (lane.points.length === 0) continue
    const first = lane.points[0]!
    const last = lane.points[lane.points.length - 1]!
    ends.push({ laneId: lane.id, at: 'start', x: first.x, y: first.y })
    ends.push({ laneId: lane.id, at: 'end', x: last.x, y: last.y })
  }

  const endpointAdj = new Map<string, LaneTransfer[]>()
  const midRaw = new Map<string, { sFrac: number; transfer: LaneTransfer }[]>()

  for (const end of ends) {
    const key = endKey(end.laneId, end.at)
    const fromEnd: LaneTransfer[] = []

    for (const other of lanes) {
      if (other.id === end.laneId) continue
      const hit = nearestFracOnLane(end.x, end.y, other.points)
      if (hit.d > eps) continue

      fromEnd.push({ laneId: other.id, sFrac: hit.sFrac })

      // Reciprocal: ships on `other` at this mid can hop onto this endpoint.
      const list = midRaw.get(other.id) ?? []
      list.push({
        sFrac: hit.sFrac,
        transfer: {
          laneId: end.laneId,
          sFrac: end.at === 'start' ? 0 : 1,
        },
      })
      midRaw.set(other.id, list)
    }

    endpointAdj.set(key, fromEnd)
  }

  // Cluster nearby mid hits on the same lane into one junction.
  const midByLane = new Map<string, MidJunction[]>()
  const clusterEps = eps * 0.5
  for (const [laneId, raw] of midRaw) {
    raw.sort((a, b) => a.sFrac - b.sFrac)
    const clusters: MidJunction[] = []
    for (const item of raw) {
      const last = clusters[clusters.length - 1]
      if (last && Math.abs(item.sFrac - last.sFrac) <= clusterEps) {
        if (
          !last.transfers.some(
            (t) =>
              t.laneId === item.transfer.laneId &&
              Math.abs(t.sFrac - item.transfer.sFrac) < 1e-6,
          )
        ) {
          last.transfers.push(item.transfer)
        }
        last.sFrac =
          (last.sFrac * (last.transfers.length - 1) + item.sFrac) /
          last.transfers.length
      } else {
        clusters.push({ sFrac: item.sFrac, transfers: [item.transfer] })
      }
    }
    midByLane.set(laneId, clusters)
  }

  return { endpointAdj, midByLane }
}

const LANE_BY_ID = new Map(SEA_LANES.map((l) => [l.id, l]))
const { endpointAdj: ENDPOINT_ADJ, midByLane: MID_BY_LANE } = buildHubGraph(
  SEA_LANES,
  HUB_EPS,
)

/**
 * When a ship reaches a lane end: reverse, or jump to a nearly-overlapping
 * point on another route (endpoint or mid-trunk). Equal weight among reverse + transfers.
 * Mutates `tracker` in place (may replace polyline when transferring).
 */
export function resolveLaneEndpoint(
  tracker: LaneTracker,
  size: { x: number; y: number },
): void {
  const at: LaneEnd = tracker.s <= 0 ? 'start' : 'end'
  tracker.s = at === 'start' ? 0 : tracker.total

  const transfers = ENDPOINT_ADJ.get(endKey(tracker.laneId, at)) ?? []
  const choice = Math.floor(Math.random() * (transfers.length + 1))
  if (choice === 0 || transfers.length === 0) {
    tracker.pathDir = at === 'start' ? 1 : -1
    return
  }

  if (!applyTransfer(tracker, transfers[choice - 1]!, size)) {
    tracker.pathDir = at === 'start' ? 1 : -1
  }
}

/**
 * If the ship just crossed a mid-lane hub (spur endpoint meeting this trunk),
 * optionally hop onto that spur. `sBefore` is arc length before this frame’s step.
 * Returns true if a transfer occurred.
 */
export function resolveLaneMidJunction(
  tracker: LaneTracker,
  sBefore: number,
  size: { x: number; y: number },
): boolean {
  const junctions = MID_BY_LANE.get(tracker.laneId)
  if (!junctions || junctions.length === 0) return false

  const lo = Math.min(sBefore, tracker.s)
  const hi = Math.max(sBefore, tracker.s)
  // Tiny pad so slow ships still register thin junctions.
  const pad = Math.max(tracker.total * 1e-4, 0.5)

  for (const j of junctions) {
    const sHub = j.sFrac * tracker.total
    if (sHub < lo - pad || sHub > hi + pad) continue

    // choices = continue (no hop) + each spur transfer
    const choice = Math.floor(Math.random() * (j.transfers.length + 1))
    if (choice === 0) return false
    return applyTransfer(tracker, j.transfers[choice - 1]!, size)
  }
  return false
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
