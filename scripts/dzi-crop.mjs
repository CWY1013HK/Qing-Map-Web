/**
 * Crop a normalized rectangle out of a Deep Zoom pyramid at the deepest
 * level whose tiles actually exist. vips dzsave overlap: a tile's JPEG
 * includes `overlap` extra pixels on every side that has a neighbour, so
 * tile (col, row) is placed at (col * tileSize - overlap, …) except on the
 * left/top edges where that padding is absent.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

function readDzi(dziPath) {
  const xml = fs.readFileSync(dziPath, 'utf8')
  const attr = (name) => {
    const m = xml.match(new RegExp(`${name}="([^"]+)"`))
    if (!m) throw new Error(`DZI missing ${name}`)
    return m[1]
  }
  const format = attr('Format').toLowerCase()
  const ext = format === 'jpg' ? 'jpeg' : format
  return {
    width: Number(attr('Width')),
    height: Number(attr('Height')),
    tileSize: Number(attr('TileSize')),
    overlap: Number(attr('Overlap')),
    ext,
  }
}

function maxLevel(width, height) {
  return Math.ceil(Math.log2(Math.max(width, height)))
}

function levelSize(full, level, top) {
  return Math.ceil(full / 2 ** (top - level))
}

function tileOrigin(index, tileSize, overlap) {
  return index * tileSize - (index > 0 ? overlap : 0)
}

function tilesFor(x0, y0, x1, y1, tileSize) {
  const col0 = Math.floor(x0 / tileSize)
  const col1 = Math.floor(Math.max(x0, x1 - 1) / tileSize)
  const row0 = Math.floor(y0 / tileSize)
  const row1 = Math.floor(Math.max(y0, y1 - 1) / tileSize)
  const tiles = []
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) tiles.push({ col, row })
  }
  return tiles
}

/**
 * @param {{ dziPath: string, tilesDir: string, x0: number, y0: number, x1: number, y1: number }} opts
 * Normalized edges, 0–1. Returns a PNG buffer of the deepest available tiles.
 */
export async function cropNormalizedRect(opts) {
  const dzi = readDzi(opts.dziPath)
  const nx0 = Math.min(Number(opts.x0), Number(opts.x1))
  const nx1 = Math.max(Number(opts.x0), Number(opts.x1))
  const ny0 = Math.min(Number(opts.y0), Number(opts.y1))
  const ny1 = Math.max(Number(opts.y0), Number(opts.y1))
  if (![nx0, nx1, ny0, ny1].every((n) => Number.isFinite(n))) {
    throw new Error('Crop box is not a number')
  }

  const top = maxLevel(dzi.width, dzi.height)
  const fullX0 = Math.max(0, Math.min(dzi.width - 1, Math.round(nx0 * dzi.width)))
  const fullX1 = Math.max(fullX0 + 1, Math.min(dzi.width, Math.round(nx1 * dzi.width)))
  const fullY0 = Math.max(0, Math.min(dzi.height - 1, Math.round(ny0 * dzi.height)))
  const fullY1 = Math.max(fullY0 + 1, Math.min(dzi.height, Math.round(ny1 * dzi.height)))

  let chosen = null
  for (let level = top; level >= 0; level--) {
    const levelW = levelSize(dzi.width, level, top)
    const levelH = levelSize(dzi.height, level, top)
    const x0 = Math.floor((fullX0 * levelW) / dzi.width)
    const y0 = Math.floor((fullY0 * levelH) / dzi.height)
    const x1 = Math.max(x0 + 1, Math.ceil((fullX1 * levelW) / dzi.width))
    const y1 = Math.max(y0 + 1, Math.ceil((fullY1 * levelH) / dzi.height))
    const tiles = tilesFor(x0, y0, x1, y1, dzi.tileSize)
    const missing = tiles.some(
      ({ col, row }) => !fs.existsSync(path.join(opts.tilesDir, String(level), `${col}_${row}.${dzi.ext}`)),
    )
    if (!missing) {
      chosen = { level, x0, y0, x1, y1, tiles }
      break
    }
  }
  if (!chosen) throw new Error('No tiles cover that region')

  const placed = []
  for (const { col, row } of chosen.tiles) {
    const file = path.join(opts.tilesDir, String(chosen.level), `${col}_${row}.${dzi.ext}`)
    const meta = await sharp(file).metadata()
    placed.push({
      file,
      left: tileOrigin(col, dzi.tileSize, dzi.overlap),
      top: tileOrigin(row, dzi.tileSize, dzi.overlap),
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    })
  }

  const width = chosen.x1 - chosen.x0
  const height = chosen.y1 - chosen.y0
  // Cut each tile down to the crop first. Sharp applies a later extract to the
  // base image before composite, which rejects tiles larger than that crop.
  const pieces = []
  for (const tile of placed) {
    const srcLeft = Math.max(0, chosen.x0 - tile.left)
    const srcTop = Math.max(0, chosen.y0 - tile.top)
    const destLeft = Math.max(0, tile.left - chosen.x0)
    const destTop = Math.max(0, tile.top - chosen.y0)
    const srcWidth = Math.min(tile.width - srcLeft, width - destLeft)
    const srcHeight = Math.min(tile.height - srcTop, height - destTop)
    if (srcWidth <= 0 || srcHeight <= 0) continue
    pieces.push({
      input: await sharp(tile.file)
        .extract({ left: srcLeft, top: srcTop, width: srcWidth, height: srcHeight })
        .toBuffer(),
      left: destLeft,
      top: destTop,
    })
  }
  if (!pieces.length) throw new Error('Crop missed every tile')
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(pieces)
    .png()
    .toBuffer()

  return { buffer, width, height, level: chosen.level }
}
