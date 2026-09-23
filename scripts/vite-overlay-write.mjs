/**
 * Dev-only Vite middleware: POST /__dev/overlays/save
 * Writes overlay JSON (and hailu → sea-lanes sync) to data/ on disk.
 * Invalidates Vite's module graph so the next full page load sees new data,
 * but does NOT trigger a live reload (that was wiping in-progress edits).
 */
import fs from 'node:fs'
import path from 'node:path'

const ALLOWED = new Set(['handi-shibasheng', 'zhongguo', 'hailu'])

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

export function overlayWriteApi(projectRoot) {
  const overlaysDir = path.join(projectRoot, 'data', 'overlays')
  const seaLanesPath = path.join(projectRoot, 'data', 'decor', 'sea-lanes.json')

  return {
    name: 'overlay-write-api',
    configureServer(server) {
      // Don't live-reload when the editor writes these files.
      server.watcher.unwatch(overlaysDir)
      server.watcher.unwatch(seaLanesPath)

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || req.url?.split('?')[0] !== '/__dev/overlays/save') {
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
          const collection = body.collection
          if (!collection || !Array.isArray(collection.overlays)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Missing collection.overlays' }))
            return
          }

          const outPath = path.join(overlaysDir, `${fileKey}.json`)
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
