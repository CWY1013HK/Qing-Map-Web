#!/usr/bin/env node
/**
 * Bake tour narration markdown → MP3 + manifest.
 *
 * Strips {mnc:…} from TTS input; captions keep Manchu (see docs/narration.md).
 * Requires `edge-tts` on PATH unless --dry-run.
 */
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const VOICES = {
  'zh-Hant': 'zh-HK-WanLungNeural',
  'zh-Hans': 'zh-CN-YunzeNeural',
  en: 'en-GB-RyanNeural',
}

const LOCALES = ['zh-Hant', 'zh-Hans', 'en']

function parseArgs(argv) {
  const out = { tour: null, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tour') out.tour = argv[++i]
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

/** Strip {mnc:…} for speech; collapse leftover spaces / empty dashes. */
export function stripManchuForSpeech(text) {
  return text
    .replace(/\{mnc:[^}]*\}/g, '')
    // Only collapse a *pair of pairs* left empty (e.g. —— ——), not normal —— pauses.
    .replace(/——\s*——/g, '——')
    .replace(/（\s*）/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Expand {mnc:…} to its contents for on-screen captions (no pause in audio). */
export function captionWithManchu(text) {
  return text.replace(/\{mnc:([^}]*)\}/g, '$1').trim()
}

function parseMarkdown(md) {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fm) throw new Error('Missing YAML front matter')
  const meta = {}
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (m) meta[m[1]] = m[2].trim()
  }
  const body = fm[2]
  const stops = []
  const re = /^##\s+(\S+)\s*\n([\s\S]*?)(?=^##\s|\s*$)/gm
  let m
  while ((m = re.exec(body))) {
    stops.push({ id: m[1], text: m[2].trim() })
  }
  if (stops.length === 0) throw new Error('No ## stop headings found')
  return { meta, stops }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited ${code}`))
    })
  })
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function loadManifest() {
  const p = path.join(root, 'data/narration/manifest.json')
  if (!(await exists(p))) return { version: 1, clips: {} }
  return JSON.parse(await readFile(p, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.tour) {
    console.log(`Usage: node scripts/generate-narration.mjs --tour <id> [--dry-run]`)
    process.exit(args.help ? 0 : 1)
  }

  const tourDir = path.join(root, 'data/narration', args.tour)
  if (!(await exists(tourDir))) {
    console.error(`Missing ${tourDir}`)
    process.exit(1)
  }

  const manifest = await loadManifest()
  if (!manifest.clips[args.tour]) manifest.clips[args.tour] = {}

  for (const locale of LOCALES) {
    const mdPath = path.join(tourDir, `${locale}.md`)
    if (!(await exists(mdPath))) {
      console.warn(`Skip missing ${mdPath}`)
      continue
    }
    const { stops } = parseMarkdown(await readFile(mdPath, 'utf8'))
    const voice = VOICES[locale]
    const outDir = path.join(root, 'public/audio/tours', args.tour, locale)
    await mkdir(outDir, { recursive: true })

    if (!manifest.clips[args.tour][locale]) manifest.clips[args.tour][locale] = {}

    for (const stop of stops) {
      const speech = stripManchuForSpeech(stop.text)
      const caption = captionWithManchu(stop.text)
      const outMp3 = path.join(outDir, `${stop.id}.mp3`)
      console.log(`\n[${locale}] ${stop.id} → ${voice}`)
      console.log(`  speech:  ${speech.slice(0, 120)}${speech.length > 120 ? '…' : ''}`)
      console.log(`  caption: ${caption.slice(0, 120)}${caption.length > 120 ? '…' : ''}`)

      if (args.dryRun) continue

      await run('edge-tts', [
        '--voice',
        voice,
        '--rate',
        '-15%',
        '--text',
        speech,
        '--write-media',
        outMp3,
      ])

      // Duration filled later by ffprobe if available; placeholder 0.
      let durationMs = 0
      try {
        durationMs = await probeDurationMs(outMp3)
      } catch {
        /* optional */
      }
      manifest.clips[args.tour][locale][stop.id] = {
        path: `/audio/tours/${args.tour}/${locale}/${stop.id}.mp3`,
        voice,
        durationMs,
      }
    }
  }

  if (!args.dryRun) {
    const manPath = path.join(root, 'data/narration/manifest.json')
    await writeFile(manPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    console.log(`\nWrote ${manPath}`)
  } else {
    console.log('\n(dry-run: no files written)')
  }
}

function probeDurationMs(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe failed'))
      const sec = parseFloat(buf.trim())
      if (!Number.isFinite(sec)) return reject(new Error('bad duration'))
      resolve(Math.round(sec * 1000))
    })
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
