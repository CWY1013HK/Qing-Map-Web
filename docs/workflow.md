# Workflow

Proceed in this order. Each stage builds on the previous; leave later folders empty until you reach them.

## 1. Copy source

```bash
npm run copy-source
```

Reads the super-resolution JPG from `20260730_object_painting/High Res/` and writes `assets/source/map-super-res.jpg`. Originals are never modified.

## 2. Generate tiles

See [scripts/generate-tiles.md](../scripts/generate-tiles.md). Produces `assets/tiles/map.dzi` + `map_files/`.

## 3. Pan / zoom viewer

```bash
npm run dev
```

OpenSeadragon loads `/tiles/map.dzi`. Confirm smooth pan and deep zoom before adding UI.

## 4. Overlays

Implement under `src/overlays/`. Store geometry/metadata as JSON in `data/overlays/` (and point annotations in `data/annotations/`) using types from `src/lib/types.ts`.

Handi outline (漢地十八省) and Zhongguo outline (中國 — yellow outer + coastal red):

```bash
npm run extract-overlays
npm run extract-zhongguo
```

Toggles via bottom-left seals (`#overlay-seal-handi`, `#overlay-seal-zhongguo`). Wall + ATLab floor share visibility through `overlayStore`.

## 5. Info pop-ups

Implement under `src/popups/`. Bind clicks/hotspots to annotation records (title, body, tags).

## 6. Tours and narration

- Tour JSON: [`data/transitions/`](../data/transitions/) — see [tours.md](./tours.md).
- Voice scripts: [`data/narration/`](../data/narration/) — see [narration.md](./narration.md).
- Bake audio: `npm run generate-narration -- --tour <id>` ([scripts/generate-narration.md](../scripts/generate-narration.md)).
- Runtime player under `src/transitions/` (camera / overlays / draw / narrate); intro seal stays in `src/viewer/intro.ts`.

## 7. TouchDesigner sync

See [touchdesigner.md](./touchdesigner.md). Start with the same static build + shared JSON; add WebSocket/OSC only when live sync is required.
