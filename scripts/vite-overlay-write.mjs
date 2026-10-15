/**
 * Dev-only Vite middleware: POST /__dev/overlays/save
 * Writes overlay JSON (and hailu → sea-lanes sync) to data/ on disk.
 * Invalidates Vite's module graph so the next full page load sees new data,
 * but does NOT trigger a live reload (that was wiping in-progress edits).
 */
import fs from 'node:fs'
import path from 'node:path'

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

  return {
    name: 'overlay-write-api',
    configureServer(server) {
      // Don't live-reload when the editor writes these files.
      server.watcher.unwatch(overlaysDir)
      server.watcher.unwatch(seaLanesPath)
      server.watcher.unwatch(annotationsPath)

      server.middlewares.use(async (req, res, next) => {
        const urlPath = req.url?.split('?')[0]
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
