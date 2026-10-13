# Narration pipeline

Voiceovers are **authored as markdown, baked to MP3, then committed**. The browser never calls a TTS API.

## Layout

```
data/narration/<tour>/
  zh-Hant.md   → spoken as Cantonese (zh-HK)
  zh-Hans.md   → spoken as Mandarin (zh-CN)
  en.md        → English
data/narration/manifest.json   # durations, written by the bake script
public/audio/tours/<tour>/<locale>/<stopId>.mp3
```

Stop headings (`## russia`) must match `narrate` ids in [`data/transitions/`](../data/transitions/).

## Locale → voice

| UI locale | Spoken language | Suggested neural voice |
|---|---|---|
| `zh-Hant` | Formal Cantonese (`zh-HK`; 書面語 / documentary register, not colloquial 口語) | `zh-HK-WanLungNeural` |
| `zh-Hans` | Mandarin (`zh-CN`) | `zh-CN-YunzeNeural` |
| `en` | English | `en-GB-RyanNeural` |

Use a mature male voice, rate about −10% to −20%, slightly lower pitch. Prefer Microsoft neural TTS via `edge-tts` to start; Azure Speech if keys are available.

## Manchu

Wrap asides as `{mnc:Ice Jecen}` (Möllendorff romanization). Keep a Chinese/English gloss in the same sentence.

- The bake script **strips** `{mnc:…}` from TTS input. No pause, no separate Manchu clip.
- Captions **keep** the Manchu romanization so the aside stays visible (including when muted).

Do not feed Manchu words to a Chinese or English voice.

## Markdown shape

```markdown
---
tour: jiaqing-1812
locale: zh-Hant
title: 嘉慶十七年
---

## year
…

## russia
… {mnc:Ice Jecen} …
```

## Bake

```bash
npm run generate-narration -- --tour jiaqing-1812
```

See [scripts/generate-narration.md](../scripts/generate-narration.md). Listen, then commit MP3s + `manifest.json`. Re-run only when a script changes.

## Current scripts

| Tour | Concept |
|---|---|
| [`jiaqing-1812`](../data/narration/jiaqing-1812/) | Jiaqing 17 / 1812 — Napoleon & Russia, War of 1812, Chinese Tartary, tributary order |
