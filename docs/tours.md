# Map tours

Tours are JSON scripts under [`data/transitions/`](../data/transitions/). Runtime lives in `src/transitions/` (player not yet wired to seals). Narration markdown lives under [`data/narration/`](../data/narration/); see [narration.md](./narration.md).

The intro seal and zoom-out in [`src/viewer/intro.ts`](../src/viewer/intro.ts) stay separate. Tours start only after `qing-map-intro-done`.

## Tour file shape

```json
{
  "version": 1,
  "id": "jiaqing-1812",
  "title": "嘉慶十七年",
  "narrationDir": "jiaqing-1812",
  "sealTitle": "壬申",
  "steps": [ … ]
}
```

### Step types

| `type` | Role |
|---|---|
| `overlays` | `{ show, hide }` group ids (`zhongguo`, `handi-shibasheng`, `hailu`, `xiandai-zhongguo`) |
| `stop` | Camera + optional caption / narrate / draw / overlays |
| `camera` | Pan/zoom only; `{ home: true }` returns to fit |
| `wait` | Hold `durationMs` |

A **stop** may include:

- `camera` — `{ x, y, zoomFactor, durationMs }` or `{ labelId, zoomFactor, durationMs }` (resolve `labelId` from [`province-labels.json`](../data/overlays/province-labels.json))
- `caption` — short titles per locale (UI chrome)
- `narrate` — stop id matching a `## heading` in the narration markdown
- `music` — optional underscore `{ path, volume? }` (stops with the dialogue line)
- `images` — optional `{ src, alt? }[]` white-framed draggable stills (cleared with the line)
- `draw` — `{ featureId, durationMs }` stroke reveal of an existing overlay
- `waitAfterMs` — pause after narration

On start, the player snapshots overlay visibility and restores it exactly when the tour ends or is cancelled (Esc / seal toggle) so no tour borders linger.

## Current tours

| Id | Seal (working) | Narration |
|---|---|---|
| [`jiaqing-1812`](../data/transitions/jiaqing-1812.json) | 壬申 | 1812 world + Qing Tartary / tribute |

Planned seals (empire / China proper / maritime) can reuse this shape; Jiaqing-1812 is the first authored script.

## UI

A row of **square imperial seals** (`#tour-seals`) **above** the overlay tablets. One seal per tour; pressed = playing. Face text uses 小篆 ([全字庫說文解字](../assets/fonts/LICENSE-TW-Shuowen.txt)); four characters read right column top→bottom, then left (e.g. 寰宇掠影). Rebuild with `python3 scripts/build-tour-seal.py --text …`.

Runtime: [`src/transitions/`](../src/transitions/) — `mountTourSeals` from `bootViewer`.
