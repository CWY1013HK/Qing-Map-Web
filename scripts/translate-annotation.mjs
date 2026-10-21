/**
 * Fill empty annotation locales from the single language the editor provided.
 * Traditional ↔ Simplified is offline (OpenCC). English uses MyMemory.
 * A quota failure leaves the typed language in place and reports a warning;
 * the other Chinese script is still filled.
 */
import * as OpenCC from 'opencc-js'

const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })
const toHant = OpenCC.Converter({ from: 'cn', to: 'tw' })

const LOCALES = ['zh-Hant', 'zh-Hans', 'en']

function clean(raw) {
  const aka = Array.isArray(raw?.aka) ? raw.aka : []
  return {
    title: String(raw?.title ?? '').trim(),
    body: String(raw?.body ?? '').replace(/[ \t\n]+$/, ''),
    aka: aka.map((item) => String(item).trim()).filter(Boolean),
  }
}

function hasText(locale) {
  return Boolean(locale.title || locale.body || locale.aka.length)
}

function mapFields(locale, fn) {
  return {
    title: locale.title ? fn(locale.title) : '',
    body: locale.body ? fn(locale.body) : '',
    aka: locale.aka.map((item) => fn(item)),
  }
}

async function mapFieldsAsync(locale, fn) {
  return {
    title: locale.title ? await fn(locale.title) : '',
    body: locale.body ? await fn(locale.body) : '',
    aka: await Promise.all(locale.aka.map((item) => fn(item))),
  }
}

function splitChunks(text) {
  const chunks = []
  let rest = text
  while (rest.length > 450) {
    let cut = rest.lastIndexOf('，', 450)
    if (cut < 80) cut = rest.lastIndexOf('。', 450)
    if (cut < 80) cut = rest.lastIndexOf(', ', 450)
    if (cut < 80) cut = rest.lastIndexOf(' ', 450)
    if (cut < 80) cut = 450
    else cut += 1
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) chunks.push(rest)
  return chunks
}

async function myMemory(text, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Translation failed (${res.status})`)
  const data = await res.json()
  const translated = data.responseData?.translatedText
  if (Number(data.responseStatus) !== 200 || !translated || /MYMEMORY WARNING/i.test(translated)) {
    throw new Error(translated || data.responseDetails || 'Translation failed')
  }
  return translated
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

async function translateText(text, from, to) {
  const lines = String(text).split('\n')
  const out = []
  for (const line of lines) {
    if (!line.trim()) {
      out.push(line)
      continue
    }
    const parts = []
    for (const chunk of splitChunks(line)) parts.push(await myMemory(chunk, from, to))
    out.push(parts.join(''))
  }
  return out.join('\n')
}

/**
 * @param {{ 'zh-Hant'?: object, 'zh-Hans'?: object, en?: object }} input
 * @returns {Promise<{ translated: boolean, warning: string | null, locales: Record<string, { title: string, body: string, aka: string[] }> }>}
 */
export async function fillLocales(input) {
  const locales = {
    'zh-Hant': clean(input?.['zh-Hant']),
    'zh-Hans': clean(input?.['zh-Hans']),
    en: clean(input?.en),
  }
  const provided = LOCALES.filter((locale) => hasText(locales[locale]))
  if (provided.length !== 1) {
    return { translated: false, warning: null, locales }
  }

  const source = provided[0]
  const src = locales[source]
  let warning = null

  if (source === 'zh-Hant') {
    locales['zh-Hans'] = mapFields(src, toHans)
    try {
      locales.en = await mapFieldsAsync(src, (text) => translateText(text, 'zh-TW', 'en'))
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err)
    }
  } else if (source === 'zh-Hans') {
    locales['zh-Hant'] = mapFields(src, toHant)
    try {
      locales.en = await mapFieldsAsync(src, (text) => translateText(text, 'zh-CN', 'en'))
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err)
    }
  } else {
    try {
      locales['zh-Hant'] = await mapFieldsAsync(src, (text) => translateText(text, 'en', 'zh-TW'))
      locales['zh-Hans'] = mapFields(locales['zh-Hant'], toHans)
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err)
    }
  }

  return { translated: warning == null, warning, locales }
}
