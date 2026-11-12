import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import { overlayWriteApi } from './scripts/vite-overlay-write.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))

const TILE_MIME: Record<string, string> = {
  '.dzi': 'application/xml',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml',
}

/**
 * Vite snapshots `public/` paths at dev-server start. After `prepare-public`
 * replaces `public/tiles/`, map.dzi can miss the whitelist and SPA fallback
 * returns index.html — OpenSeadragon then fails with "#document".
 */
function serveMapTiles(): Plugin {
  const tilesDir = path.join(root, 'public', 'tiles')

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathOnly = (req.url ?? '').split('?')[0] ?? ''
    if (!pathOnly.startsWith('/tiles/')) return next()

    let rel: string
    try {
      rel = decodeURIComponent(pathOnly.slice('/tiles/'.length))
    } catch {
      return next()
    }
    if (!rel || rel.includes('..')) return next()

    const file = path.normalize(path.join(tilesDir, rel))
    if (!file.startsWith(tilesDir)) return next()

    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      return next()
    }
    if (!stat.isFile()) return next()

    const ext = path.extname(file).toLowerCase()
    res.statusCode = 200
    res.setHeader('Content-Type', TILE_MIME[ext] ?? 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    fs.createReadStream(file).pipe(res)
  }

  const mount = (server: { middlewares: { use: (fn: typeof handler) => void } }) => {
    server.middlewares.use(handler)
  }

  return {
    name: 'serve-map-tiles',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}

function htmlPathRewrite(paths: Record<string, string>): Plugin {
  const rewrite = (url: string | undefined) => {
    if (!url) return url
    const pathOnly = url.split('?')[0]
    for (const [route, file] of Object.entries(paths)) {
      if (pathOnly === route || pathOnly === `${route}/`) {
        return url.replace(pathOnly, file)
      }
    }
    return url
  }

  const mount = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, _res, next) => {
      req.url = rewrite(req.url)
      next()
    })
  }

  return {
    name: 'html-path-rewrite',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}

export default defineConfig({
  plugins: [
    serveMapTiles(),
    htmlPathRewrite({
      '/atlab': '/atlab.html',
      '/editor': '/editor.html',
    }),
    overlayWriteApi(root),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        atlab: path.resolve(root, 'atlab.html'),
        editor: path.resolve(root, 'editor.html'),
      },
    },
  },
})
