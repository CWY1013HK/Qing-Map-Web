import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { overlayWriteApi } from './scripts/vite-overlay-write.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))

/** Serve `/atlab` as `atlab.html` in dev and preview. */
function atlabRewrite(): Plugin {
  const rewrite = (url: string | undefined) => {
    if (!url) return url
    const pathOnly = url.split('?')[0]
    if (pathOnly === '/atlab' || pathOnly === '/atlab/') {
      return url.replace(pathOnly, '/atlab.html')
    }
    return url
  }

  return {
    name: 'atlab-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = rewrite(req.url)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = rewrite(req.url)
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [atlabRewrite(), overlayWriteApi(root)],
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
      },
    },
  },
})
