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
4. **Glyphs** — system **Kaiti TC Bold** (`Kaiti.ttc` index **4**), not LXGW. Hard-threshold the mask (no soft outer halo on the body).
5. **Shadow stack** (paint order):
   - all-sided ambient (dilated + soft) near-black
   - under / SE puddle (heavier + farther) + hard contact strip
   - optional −1,−1 inner bevel highlight *inside* the stroke
   - solid silver (or bronze-red) body last
6. Center on Zhongguo body centre; slight left optical nudge so under-cast does not read as right-shift.
7. Install to `assets/ui/{theme}/` **and** `public/ui/{theme}/`; bump cache-bust.

Bronze: same stack; body ≈ dark red; shadows warm-dark. Normalize to 575×1510 (width-lock, top-align).

## Pressed / CSS

Seal pressed state = **depth only** (drop-shadow for the tablet, slight brightness).  
Never add a colored bloom on glyph rims on click — that reads as glowing word edges.

## Checklist

- [ ] 575×1510, ribbon uncropped
- [ ] Accent = ribbon + border only; metal matches siblings
- [ ] Hard glyph edges; strong all-sided + under-main shadows
- [ ] No wipe stripes / no ribbon color in the text column
- [ ] Pressed CSS has no colored rim bloom
- [ ] Installed under `assets/` + `public/`; cache-bust bumped
- [ ] Built via script / PIL — **not** an image model
