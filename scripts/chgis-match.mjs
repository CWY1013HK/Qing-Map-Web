/**
 * Rank Harvard CHGIS / TGAZ hits for a placename at the 1820 Qing time slice.
 * The live host is chgis.hudci.org (maps.cga.harvard.edu is retired).
 * Search is prefix-based, so a query for 廣州 also returns 廣州府.
 */
import * as OpenCC from 'opencc-js'

const TGAZ = 'https://chgis.hudci.org/tgaz/placename'
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })

const ADMIN_SUFFIXES = ['府', '縣', '县', '州', '廳', '厅', '省']

export function normalizeName(value) {
  return toHans(String(value ?? '')).replace(/\s+/g, '')
}

function parseYears(value) {
  const match = String(value ?? '').match(/(-?\d+)\s*~\s*(-?\d+)/)
  if (!match) return null
  return { begin: Number(match[1]), end: Number(match[2]) }
}

function normalizeHit(raw) {
  const id = String(raw.sys_id ?? '')
  return {
    id,
    uri: raw.uri || (id ? `${TGAZ}/${id}` : ''),
    name: String(raw.name ?? ''),
    transcription: String(raw.transcription ?? ''),
    featureType: String(raw['feature type'] ?? ''),
    years: String(raw.years ?? ''),
    parent: String(raw['parent name'] ?? ''),
    objectType: String(raw['object type'] ?? ''),
  }
}

/** 100 exact, 80 name + admin suffix, 0 otherwise. Bonuses for the 1812–1820 window, a point, and a parent. */
export function rankHit(query, hit) {
  const name = normalizeName(hit.name)
  const q = normalizeName(query)
  if (!q || !name) return 0
  let rank = 0
  if (name === q) rank = 100
  else if (ADMIN_SUFFIXES.some((suffix) => name === q + normalizeName(suffix))) rank = 80
  else return 0
  const years = parseYears(hit.years)
  // The 1820 time slice is stored as 1820~1820, so it does not literally contain 1812.
  if (years && years.begin <= 1820 && years.end >= 1812) rank += 10
  if (hit.objectType.toUpperCase() === 'POINT') rank += 5
  if (hit.parent.trim()) rank += 3
  return rank
}

/** Prefer the published 1820 point when several rows are the same place. */
function sliceScore(hit) {
  let score = 0
  if (hit.objectType.toUpperCase() === 'POINT') score += 4
  if (hit.parent.trim()) score += 2
  const years = parseYears(hit.years)
  if (years && years.begin === 1820 && years.end === 1820) score += 1
  return score
}

function chooseSelected(matches) {
  const groups = new Map()
  for (const hit of matches) {
    const key = normalizeName(hit.name)
    const list = groups.get(key) ?? []
    list.push(hit)
    groups.set(key, list)
  }
  const reps = []
  for (const list of groups.values()) {
    const bestRank = Math.max(...list.map((hit) => hit.rank))
    const top = list.filter((hit) => hit.rank === bestRank)
    const parents = new Set(
      top.map((hit) => normalizeName(hit.parent).replace(/[（(].*$/, '')).filter(Boolean),
    )
    // Same spelling in two provinces is not one place (廣州府 under 江西 and 廣東).
    if (parents.size > 1) continue
    top.sort((a, b) => sliceScore(b) - sliceScore(a) || a.id.localeCompare(b.id))
    if (top.length > 1 && sliceScore(top[0]) === sliceScore(top[1])) continue
    reps.push(top[0])
  }
  reps.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'zh'))
  if (!reps.length || (reps.length > 1 && reps[0].rank === reps[1].rank)) return null
  return reps[0].id
}

function placeCore(value) {
  return normalizeName(value)
    .replace(/[（(].*$/, '')
    .replace(/(?:省|府|州|厅|廳|县|縣)$/u, '')
}

function isPrefecture(hit) {
  return hit.featureType.includes('府') || normalizeName(hit.name).endsWith('府')
}

/**
 * The provincial seat is the 府 whose parent is that province.
 * 廣州府 under 江西 does not count as the capital of 廣東.
 * Returns null when no single prefecture sits under the province.
 */
export function chooseCapital(matches, provinceName) {
  const provinces = String(provinceName ?? '')
    .split(/[,、]/)
    .map((name) => placeCore(name))
    .filter(Boolean)
  if (!provinces.length) return null
  const candidates = matches.filter((hit) => {
    if (!isPrefecture(hit)) return false
    const parent = placeCore(hit.parent)
    return provinces.some((province) => parent === province)
  })
  if (!candidates.length) return null
  const names = new Set(candidates.map((hit) => normalizeName(hit.name)))
  if (names.size > 1) return null
  candidates.sort((a, b) => sliceScore(b) - sliceScore(a) || a.id.localeCompare(b.id))
  if (candidates.length > 1 && sliceScore(candidates[0]) === sliceScore(candidates[1])) return null
  return candidates[0].id
}

export async function searchPlacename(name) {
  const q = String(name ?? '').trim()
  if (!q) return []
  const url = `${TGAZ}?n=${encodeURIComponent(q)}&yr=1820&fmt=json&src=CHGIS`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CHGIS search failed (${res.status})`)
  const data = await res.json()
  let list = data.placenames ?? []
  if (!Array.isArray(list)) list = list ? [list] : []
  return list.map(normalizeHit).filter((hit) => hit.id)
}

/**
 * Search one or more spellings. A hit is preselected only when a single
 * exact or suffix match outranks every other hit — ties stay for the user.
 */
export async function searchRanked(names) {
  const queries = []
  for (const name of names) {
    const q = String(name ?? '').trim()
    if (!q) continue
    queries.push(q)
    const hans = normalizeName(q)
    if (hans && hans !== q) queries.push(hans)
  }
  const byId = new Map()
  for (const q of queries) {
    const hits = await searchPlacename(q)
    for (const hit of hits) {
      const rank = rankHit(q, hit)
      if (rank < 80) continue
      const prev = byId.get(hit.id)
      if (!prev || rank > prev.rank) byId.set(hit.id, { ...hit, rank })
    }
  }
  const matches = [...byId.values()].sort(
    (a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'zh'),
  )
  return { matches, selectedId: chooseSelected(matches) }
}
