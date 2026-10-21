/**
 * One-time: attach a confident 1820 CHGIS record to existing place annotations.
 * Skips the colophon and the map title. Tries the title, then each aka.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchChgis, patchChgisCapital, readCollection } from './annotation-json.mjs'
import { chooseCapital, searchRanked } from './chgis-match.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'data', 'annotations', 'locations.json')
const SKIP = new Set([
  'tishi-jiaqing',
  'bloc-title',
  // These cartouches share a name with an unrelated Qing county.
  'bloc-heyuan',
  'bloc-vietnam',
])

const collection = readCollection(file)
for (const annotation of collection.annotations) {
  if (SKIP.has(annotation.id) || annotation.chgis) {
    console.log(`skip ${annotation.id}`)
    continue
  }
  const names = [annotation.title, ...(annotation.aka ?? [])]
  let linked = false
  for (const name of names) {
    const { matches, selectedId } = await searchRanked([name])
    const selected = matches.find((hit) => hit.id === selectedId)
    console.log(
      `${annotation.id} · ${name} · ${matches.length} hits · ${
        selected ? `${selected.id} ${selected.name} (${selected.rank})` : 'no unique match'
      }`,
    )
    if (selected) {
      patchChgis(file, annotation.id, {
        id: selected.id,
        uri: selected.uri,
        name: selected.name,
        transcription: selected.transcription || undefined,
      })
      linked = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!linked) console.log(`  left unlinked: ${annotation.id}`)
  await new Promise((resolve) => setTimeout(resolve, 200))
}

console.log('— provincial capitals —')
for (const annotation of readCollection(file).annotations) {
  if (annotation.chgisCapital || !annotation.aka?.length) {
    console.log(`skip capital ${annotation.id}`)
    continue
  }
  const { matches, selectedId } = await searchRanked(annotation.aka)
  const capitalId = chooseCapital(matches, annotation.title)
  const selected = matches.find((hit) => hit.id === capitalId)
  console.log(
    `${annotation.id} · ${annotation.title} · aka ${annotation.aka.join('、')} · ${
      selected ? `${selected.id} ${selected.name} / ${selected.parent}` : `no seat (search ${selectedId ?? 'none'})`
    }`,
  )
  if (!selected || selected.id === annotation.chgis?.id) continue
  patchChgisCapital(file, annotation.id, {
    id: selected.id,
    uri: selected.uri,
    name: selected.name,
    transcription: selected.transcription || undefined,
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
}

readCollection(file)
console.log('locations.json still parses')
