/**
 * Dev-only Vite middleware: POST /__dev/overlays/save
 * Writes overlay JSON (and hailu → sea-lanes sync) to data/ on disk.
 * Invalidates Vite's module graph so the next full page load sees new data,
 * but does NOT trigger a live reload (that was wiping in-progress edits).
 */
import fs from 'node:fs'
import path from 'node:path'
import { cropNormalizedRect } from './dzi-crop.mjs'
import { chooseCapital, searchRanked } from './chgis-match.mjs'
import { fillLocales } from './translate-annotation.mjs'
import {
  deleteAnnotation,
  insertAnnotation,
  orderAnnotation,
  readCollection,
  replaceAnnotation,
} from './annotation-json.mjs'

const ALLOWED = new Set([
  'handi-shibasheng',
  'zhongguo',
  'xiandai-zhongguo',
  'hailu',
  'province-labels',
])

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/** hailu overlay rings[] → sea-lanes.json lanes[] for ship travel */
function hailuToSeaLanes(collection) {
  const feature = collection.overlays?.[0]
  const rings = feature?.rings ?? []
  return {
    version: 16,
    mapId: collection.mapId ?? 'qing-map',
    source: 'vertex-editor',
    lanes: rings.map((points, i) => ({
      id: `hailu-${i}`,
      points,
    })),
  }
}

function invalidateFile(server, filePath) {
  const mods = server.moduleGraph.getModulesByFile(filePath)
  if (!mods) return
  for (const mod of mods) {
    server.moduleGraph.invalidateModule(mod)
  }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function fail(res, status, err) {
  sendJson(res, status, { ok: false, error: err instanceof Error ? err.message : String(err) })
}

function localePayload(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const one = (locale) => {
    const item = src[locale] && typeof src[locale] === 'object' ? src[locale] : {}
    const aka = Array.isArray(item.aka) ? item.aka.map((name) => String(name)) : []
    return { title: String(item.title ?? ''), body: String(item.body ?? ''), aka }
  }
  return {
    'zh-Hant': one('zh-Hant'),
    'zh-Hans': one('zh-Hans'),
    en: one('en'),
  }
}

function storedFromLocales(id, locales, extra) {
  const hant = locales['zh-Hant']
  const hans = locales['zh-Hans']
  const en = locales.en
  const title = hant.title || hans.title || en.title
  if (!title.trim()) throw new Error('Title is required')
  return orderAnnotation({
    id,
    title,
    body: hant.body || undefined,
    aka: hant.aka?.length ? hant.aka : undefined,
    i18n: {
      'zh-Hans': hans,
      en,
    },
    chgis: extra.chgis,
    chgisCapital: extra.chgisCapital,
    point: extra.point,
    tags: extra.tags,
    labelImage: extra.labelImage,
    labelWidth: extra.labelWidth,
    hitWidth: extra.hitWidth,
    hitHeight: extra.hitHeight,
  })
}

function readChgis(raw) {
  if (raw == null || raw === false) return undefined
  if (typeof raw !== 'object') throw new Error('Bad CHGIS record')
  const id = String(raw.id ?? '')
  const uri = String(raw.uri ?? '')
  if (!/^hvd_[0-9]+$/.test(id)) throw new Error('Bad CHGIS id')
  if (!uri.startsWith('https://chgis.hudci.org/tgaz/placename/')) throw new Error('Bad CHGIS uri')
  return {
    id,
    uri,
    name: String(raw.name ?? ''),
    transcription: raw.transcription ? String(raw.transcription) : undefined,
  }
}

function finiteOrUndefined(value) {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Bad number')
  return n
}

function fmtCoord(n) {
  const rounded = Math.round(Number(n) * 10000) / 10000
  if (!Number.isFinite(rounded)) throw new Error('Bad coordinate')
  return String(rounded)
}

/** Replace one annotation's point and hit size. Leaves every other byte of the file alone. */
function patchAnnotationBox(filePath, id, x, y, hitWidth, hitHeight) {
  const text = fs.readFileSync(filePath, 'utf8')
  const idToken = `"id": "${id}"`
  const idAt = text.indexOf(idToken)
  if (idAt < 0) throw new Error(`No annotation ${id}`)
  const nextId = text.indexOf('\n      "id":', idAt + idToken.length)
  const sliceEnd = nextId === -1 ? text.length : nextId
  let region = text.slice(idAt, sliceEnd)
  const pointRe = /"point": \{ "x": -?[0-9.]+, "y": -?[0-9.]+ \}/
  if (!pointRe.test(region)) throw new Error(`No point for ${id}`)
  region = region.replace(pointRe, `"point": { "x": ${fmtCoord(x)}, "y": ${fmtCoord(y)} }`)
  if (hitWidth != null) {
    if (!/"hitWidth": -?[0-9.]+/.test(region)) throw new Error(`No hitWidth for ${id}`)
    region = region.replace(/"hitWidth": -?[0-9.]+/, `"hitWidth": ${fmtCoord(hitWidth)}`)
  }
  if (hitHeight != null) {
    if (!/"hitHeight": -?[0-9.]+/.test(region)) throw new Error(`No hitHeight for ${id}`)
    region = region.replace(/"hitHeight": -?[0-9.]+/, `"hitHeight": ${fmtCoord(hitHeight)}`)
  }
  fs.writeFileSync(filePath, text.slice(0, idAt) + region + text.slice(sliceEnd), 'utf8')
}

export function overlayWriteApi(projectRoot) {
  const overlaysDir = path.join(projectRoot, 'data', 'overlays')
  const seaLanesPath = path.join(projectRoot, 'data', 'decor', 'sea-lanes.json')
  const annotationsPath = path.join(projectRoot, 'data', 'annotations', 'locations.json')
  const labelsDir = path.join(projectRoot, 'public', 'ui', 'labels')
  const dziPath = path.join(projectRoot, 'assets', 'tiles', 'map.dzi')
  const tilesDir = path.join(projectRoot, 'assets', 'tiles', 'map_files')

  return {
    name: 'overlay-write-api',
    configureServer(server) {
      // Don't live-reload when the editor writes these files.
      server.watcher.unwatch(overlaysDir)
      server.watcher.unwatch(seaLanesPath)
      server.watcher.unwatch(annotationsPath)
      server.watcher.unwatch(labelsDir)

      server.middlewares.use(async (req, res, next) => {
        const urlPath = req.url?.split('?')[0]
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams

        if (req.method === 'GET' && urlPath === '/__dev/annotations/chgis') {
          try {
            const names = [query.get('n') ?? '', ...(query.get('aka') ?? '').split(',')]
              .map((name) => name.trim())
              .filter(Boolean)
            if (!names.length) throw new Error('Missing placename')
            const ranked = await searchRanked(names)
            const province = query.get('province') ?? ''
            const capital = query.get('capital') === '1'
            const matches = capital
              ? ranked.matches.filter(
                  (hit) => hit.featureType.includes('府') || hit.name.endsWith('府'),
                )
              : ranked.matches
            const selectedId = capital ? chooseCapital(ranked.matches, province) : ranked.selectedId
            sendJson(res, 200, { ok: true, matches, selectedId })
          } catch (err) {
            fail(res, 400, err)
          }
          return
        }

        if (req.method === 'POST' && urlPath === '/__dev/annotations/capture') {
          try {
            const body = await readBody(req)
            const cropped = await cropNormalizedRect({
              dziPath,
              tilesDir,
              x0: body.x0,
              y0: body.y0,
              x1: body.x1,
              y1: body.y1,
            })
            sendJson(res, 200, {
              ok: true,
              pngBase64: cropped.buffer.toString('base64'),
              width: cropped.width,
              height: cropped.height,
              level: cropped.level,
            })
          } catch (err) {
            fail(res, 400, err)
          }
          return
        }

        if (req.method === 'POST' && urlPath === '/__dev/annotations/entry') {
          try {
            const body = await readBody(req)
            const mode = body.mode === 'update' ? 'update' : 'insert'
            const id = String(body.id ?? '')
            if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Bad annotation id')
            const filled = await fillLocales(localePayload(body.locales))
            const collection = readCollection(annotationsPath)
            const existing = collection.annotations.find((item) => item.id === id)
            if (mode === 'insert' && existing) throw new Error(`Annotation ${id} already exists`)
            if (mode === 'update' && !existing) throw new Error(`No annotation ${id}`)

            let labelImage = existing?.labelImage
            if (body.pngBase64) {
              const png = Buffer.from(String(body.pngBase64), 'base64')
              if (png.length < 32) throw new Error('Empty crop')
              fs.mkdirSync(labelsDir, { recursive: true })
              fs.writeFileSync(path.join(labelsDir, `label-${id}.png`), png)
              labelImage = `/ui/labels/label-${id}.png`
            }
            if (mode === 'insert' && !labelImage) throw new Error('Missing crop')

            const tags = mode === 'insert' ? ['city-capture'] : existing?.tags
            if (body.point?.x == null || body.point?.y == null) throw new Error('Missing point')
            const annotation = storedFromLocales(id, filled.locales, {
              chgis: readChgis(body.chgis),
              chgisCapital: readChgis(body.chgisCapital),
              point: {
                x: finiteOrUndefined(body.point?.x),
                y: finiteOrUndefined(body.point?.y),
              },
              tags,
              labelImage,
              labelWidth: finiteOrUndefined(body.labelWidth ?? existing?.labelWidth),
              hitWidth: finiteOrUndefined(body.hitWidth ?? existing?.hitWidth),
              hitHeight: finiteOrUndefined(body.hitHeight ?? existing?.hitHeight),
            })
            if (mode === 'insert') insertAnnotation(annotationsPath, annotation)
            else replaceAnnotation(annotationsPath, id, annotation)
            invalidateFile(server, annotationsPath)
            sendJson(res, 200, {
              ok: true,
              annotation,
              warning: filled.warning,
              translated: filled.translated,
            })
          } catch (err) {
            fail(res, 400, err)
          }
          return
        }

        if (req.method === 'POST' && urlPath === '/__dev/annotations/delete') {
          try {
            const body = await readBody(req)
            const id = String(body.id ?? '')
            if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Bad annotation id')
            const collection = readCollection(annotationsPath)
            const existing = collection.annotations.find((item) => item.id === id)
            if (!existing) throw new Error(`No annotation ${id}`)
            deleteAnnotation(annotationsPath, id)
            let imageDeleted = false
            if (existing.tags?.includes('city-capture')) {
              const file = path.join(labelsDir, `label-${id}.png`)
              if (fs.existsSync(file)) {
                fs.unlinkSync(file)
                imageDeleted = true
              }
            }
            invalidateFile(server, annotationsPath)
            sendJson(res, 200, { ok: true, id, imageDeleted })
          } catch (err) {
            fail(res, 400, err)
          }
          return
        }

        if (req.method === 'POST' && urlPath === '/__dev/annotations/point') {
          try {
            const body = await readBody(req)
            const id = String(body.id ?? '')
            if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Bad annotation id')
            patchAnnotationBox(annotationsPath, id, body.x, body.y, body.hitWidth, body.hitHeight)
            invalidateFile(server, annotationsPath)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: true,
                id,
                x: fmtCoord(body.x),
                y: fmtCoord(body.y),
                hitWidth: body.hitWidth == null ? null : fmtCoord(body.hitWidth),
                hitHeight: body.hitHeight == null ? null : fmtCoord(body.hitHeight),
              }),
            )
          } catch (err) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            )
          }
          return
        }

        if (req.method !== 'POST' || urlPath !== '/__dev/overlays/save') {
          next()
          return
        }
        try {
          const body = await readBody(req)
          const fileKey = String(body.fileKey ?? '')
          if (!ALLOWED.has(fileKey)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: `Unknown fileKey: ${fileKey}` }))
            return
          }

          const outPath = path.join(overlaysDir, `${fileKey}.json`)

          if (fileKey === 'province-labels') {
            const collection = body.collection
            if (!collection || !Array.isArray(collection.labels)) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'Missing collection.labels' }))
              return
            }
            writeJson(outPath, collection)
            invalidateFile(server, outPath)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: true,
                written: outPath,
                seaLanes: null,
                at: new Date().toISOString(),
              }),
            )
            return
          }

          const collection = body.collection
          if (!collection || !Array.isArray(collection.overlays)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Missing collection.overlays' }))
            return
          }

          writeJson(outPath, collection)
          invalidateFile(server, outPath)

          let seaLanes = null
          if (fileKey === 'hailu') {
            seaLanes = hailuToSeaLanes(collection)
            writeJson(seaLanesPath, seaLanes)
            invalidateFile(server, seaLanesPath)
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              ok: true,
              written: outPath,
              seaLanes: seaLanes ? seaLanesPath : null,
              at: new Date().toISOString(),
            }),
          )
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        }
      })
    },
  }
}
