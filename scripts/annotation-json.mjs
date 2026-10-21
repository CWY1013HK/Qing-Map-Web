/**
 * Surgical edits to data/annotations/locations.json.
 * Only the targeted annotation object is rewritten; the rest of the file stays put.
 */
import fs from 'node:fs'
import * as OpenCC from 'opencc-js'

const toHant = OpenCC.Converter({ from: 'cn', to: 'tw' })

function round5(value) {
  const n = Math.round(Number(value) * 100000) / 100000
  if (!Number.isFinite(n)) throw new Error('Bad number')
  return n
}

export function readCollection(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function findSpan(text, id) {
  const token = `"id": "${id}"`
  const idAt = text.indexOf(token)
  if (idAt < 0) throw new Error(`No annotation ${id}`)
  const start = text.lastIndexOf('{', idAt)
  if (start < 0) throw new Error(`No object for ${id}`)
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { start, end: i + 1 }
    }
  }
  throw new Error(`Unbalanced annotation ${id}`)
}

function compactLocale(locale) {
  if (!locale) return null
  const out = {}
  if (locale.title) out.title = locale.title
  if (locale.body) out.body = locale.body
  if (Array.isArray(locale.aka) && locale.aka.length) out.aka = locale.aka
  return Object.keys(out).length ? out : null
}

export function orderAnnotation(annotation) {
  const out = {
    id: String(annotation.id),
    title: String(annotation.title ?? ''),
  }
  if (annotation.body) out.body = String(annotation.body)
  if (Array.isArray(annotation.aka) && annotation.aka.length) out.aka = annotation.aka.map(String)
  const hans = compactLocale(annotation.i18n?.['zh-Hans'])
  const en = compactLocale(annotation.i18n?.en)
  if (hans || en) {
    out.i18n = {}
    if (hans) out.i18n['zh-Hans'] = hans
    if (en) out.i18n.en = en
  }
  if (annotation.chgis?.id && annotation.chgis?.uri) {
    out.chgis = chgisRecord(annotation.chgis)
  }
  if (annotation.chgisCapital?.id && annotation.chgisCapital?.uri) {
    out.chgisCapital = chgisRecord(annotation.chgisCapital)
  }
  out.point = {
    x: round5(annotation.point?.x),
    y: round5(annotation.point?.y),
  }
  if (Array.isArray(annotation.tags) && annotation.tags.length) out.tags = annotation.tags.map(String)
  if (annotation.labelImage) out.labelImage = String(annotation.labelImage)
  if (annotation.labelWidth != null) out.labelWidth = round5(annotation.labelWidth)
  if (annotation.hitWidth != null) out.hitWidth = round5(annotation.hitWidth)
  if (annotation.hitHeight != null) out.hitHeight = round5(annotation.hitHeight)
  return out
}

function formatAnnotation(annotation) {
  const json = JSON.stringify(orderAnnotation(annotation), null, 2).replace(
    /"point": \{\n\s*"x": (-?[0-9.eE+]+),\n\s*"y": (-?[0-9.eE+]+)\n\s*\}/,
    '"point": { "x": $1, "y": $2 }',
  )
  return json
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

export function insertAnnotation(filePath, annotation) {
  const text = fs.readFileSync(filePath, 'utf8')
  const marker = '\n  ]'
  const at = text.lastIndexOf(marker)
  if (at < 0) throw new Error('annotations array not found')
  if (text.includes(`"id": "${annotation.id}"`)) throw new Error(`Annotation ${annotation.id} already exists`)
  let head = text.slice(0, at)
  if (!/,\s*$/.test(head)) {
    head = head.replace(/[ \t]*$/, '')
    if (head.endsWith('}')) head += ','
    head += '\n'
  } else if (!head.endsWith('\n')) {
    head += '\n'
  }
  fs.writeFileSync(filePath, head + formatAnnotation(annotation) + text.slice(at), 'utf8')
}

export function replaceAnnotation(filePath, id, annotation) {
  const text = fs.readFileSync(filePath, 'utf8')
  const { start, end } = findSpan(text, id)
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const prefix = text.slice(lineStart, start)
  const from = /^[ \t]*$/.test(prefix) ? lineStart : start
  fs.writeFileSync(filePath, text.slice(0, from) + formatAnnotation(annotation) + text.slice(end), 'utf8')
}

export function deleteAnnotation(filePath, id) {
  const text = fs.readFileSync(filePath, 'utf8')
  const { start, end } = findSpan(text, id)
  const after = text.slice(end)
  const commaAfter = after.match(/^[ \t]*,/)
  if (commaAfter) {
    let removeEnd = end + commaAfter[0].length
    if (text[removeEnd] === '\n') removeEnd += 1
    fs.writeFileSync(filePath, text.slice(0, start) + text.slice(removeEnd), 'utf8')
    return
  }
  const before = text.slice(0, start)
  const commaBefore = before.match(/,[ \t]*\n[ \t]*$/)
  if (commaBefore) {
    const cut = start - commaBefore[0].length
    const tail = text.slice(end).replace(/^\n/, '')
    fs.writeFileSync(filePath, `${text.slice(0, cut)}\n${tail}`, 'utf8')
    return
  }
  fs.writeFileSync(filePath, text.slice(0, start) + text.slice(end), 'utf8')
}

function chgisRecord(chgis) {
  const name = String(chgis.name ?? '')
  const nameHant = String(chgis.nameHant ?? '').trim() || toHant(name)
  const record = {
    id: String(chgis.id),
    uri: String(chgis.uri),
    name,
  }
  if (nameHant && nameHant !== name) record.nameHant = nameHant
  if (chgis.transcription) record.transcription = String(chgis.transcription)
  return record
}

function patchChgisField(filePath, id, field, chgis) {
  const text = fs.readFileSync(filePath, 'utf8')
  const { start, end } = findSpan(text, id)
  let region = text.slice(start, end)
  const line = `"${field}": ${JSON.stringify(chgisRecord(chgis))}`
  const fieldRe = new RegExp(`"${field}": \\{[^}]*\\}`)
  if (fieldRe.test(region)) {
    region = region.replace(fieldRe, line)
  } else if (field === 'chgisCapital' && /"chgis": \{[^}]*\}/.test(region)) {
    region = region.replace(/"chgis": \{[^}]*\}/, (match) => `${match},\n      ${line}`)
  } else if (region.includes('"point":')) {
    region = region.replace('"point":', `${line},\n      "point":`)
  } else {
    throw new Error(`No point to attach CHGIS on ${id}`)
  }
  fs.writeFileSync(filePath, text.slice(0, start) + region + text.slice(end), 'utf8')
}

export function patchChgis(filePath, id, chgis) {
  patchChgisField(filePath, id, 'chgis', chgis)
}

export function patchChgisCapital(filePath, id, chgis) {
  patchChgisField(filePath, id, 'chgisCapital', chgis)
}
