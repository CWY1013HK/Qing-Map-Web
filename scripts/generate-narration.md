# Generate narration audio

Reads markdown under `data/narration/<tour>/`, strips `{mnc:…}` for speech (keeps it for captions), bakes MP3s, writes `data/narration/manifest.json`.

```bash
npm run generate-narration -- --tour jiaqing-1812
npm run generate-narration -- --tour jiaqing-1812 --dry-run   # print SSML / text only
```

Requires a TTS backend (default: `edge-tts` on PATH). Install separately:

```bash
pip install edge-tts
```

Voices and Manchu rules: [docs/narration.md](../docs/narration.md).

Commit `public/audio/tours/…` and the updated manifest after listening.
