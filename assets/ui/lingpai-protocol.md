# 令牌 (lingpai) tablet protocol

Reference when adding or regenerating an overlay tablet. Canonical canvas: **575×1510** (Handi height). Copy into both `assets/ui/{silver,bronze}/` and `public/ui/{silver,bronze}/`.

## Do not use AI image generation

**Never** use diffusion / `GenerateImage` / Midjourney / etc. for 令牌 tablets. Models soft-bleed glyph edges, mix Kai faces, and invent distorted 國/疆 strokes. Build programmatically from an existing sibling PNG.

Canonical builder for 現代中國:

```bash
python3 scripts/build-xiandai-lingpai.py
```

Then bump `?v=` on the PNG URL in `index.html`, `atlab.html`, and `src/viewer/chrome.ts`.

## What to change

| Keep | Change |
|---|---|
| Dark metal / ebony body, eyelet, knot, swallowtail | Title text |
| Same glyph scale & vertical band slots as Zhongguo/Handi | Accent only: ribbon + inset border |
| Transparent background (no map scenery) | Cache-bust `?v=` on the new PNG in `chrome.ts` / HTML |

Fewer characters ⇒ more empty metal below. Never shorten the PNG.

## Recipe (any new tablet)

1. **Base** — start from the closest sibling (4-char → `zhongguo-lingpai.png`; 5-char → `handi-lingpai.png`). Canvas must stay **575×1510**.
2. **Accent** — hue-shift only the saturated ribbon + inset border (gold→pink/cyan/…). Leave metal alone.
3. **Wipe** — clear the old glyph column by sampling **clean face metal below the last character** (not side gutters — ribbons contaminate them). Feather the wipe edges.
4. **Smooth metal** — after refill, keep the face continuous: match sibling mid-tone luma (~75), light vertical blend, small Gaussian smooth, only *fine* grain. Avoid coarse noise or tiled strips (they read as segmented blotches). Never darken the plate when painting shadows.
5. **Glyphs** — system **Kaiti TC Bold** (`Kaiti.ttc` index **4**), not LXGW. Hard-threshold the mask (no soft outer halo on the body). Glyph size ≈ Zhongguo (~215px at 575 width), not oversized.
6. **Shadow stack** (overlay-only; paint order):
   - soft all-sided ambient (Gaussian blur, modest alpha)
   - **straight-down** under-cast (x offset = 0; heavier blur + farther y)
   - far soft bloom further below
   - **no** hard SE contact strip / no bottom-right skew
   - solid silver (or bronze-red) body last
7. Center on Zhongguo body centre. Opaque body covers the cast overlap so only the under-shadow shows.
8. Install to `assets/ui/{theme}/` **and** `public/ui/{theme}/`; bump cache-bust.

Bronze: same stack; body ≈ dark red; shadows near-black. Normalize to 575×1510 (width-lock, top-align).

### Shadow / metal pitfalls

- Side-gutter donors pick up pink/gold ribbon → purple blotches in the column.
- Soft-blending over leftover Zhongguo strokes → glyph ghosts.
- Baking shadows into the plate (multiply / `apply_dark`) → segmented dark panels.
- Hard SE rims at UI scale → text looks stamped; prefer soft bottom-only casts.

## Pressed / CSS

Seal pressed state = **depth only** (drop-shadow for the tablet, slight brightness).  
Never add a colored bloom on glyph rims on click — that reads as glowing word edges.

## Checklist

- [ ] 575×1510, ribbon uncropped
- [ ] Accent = ribbon + border only; metal continuous & smooth (matches sibling luma)
- [ ] Hard glyph edges; soft **bottom-only** under-shadows (overlay layer)
- [ ] No wipe stripes / no ribbon color in the text column / no glyph ghosts
- [ ] Pressed CSS has no colored rim bloom
- [ ] Installed under `assets/` + `public/`; cache-bust bumped
- [ ] Built via script / PIL — **not** an image model
