#!/usr/bin/env python3
"""
Build a land plate with transparent seas for 淨-mode wave underlay.

Seas 1 & 2 are traced from the pink/green annotation
(data/sea-guides/seas-annotated.png), including the circled islands.
Sea 3 uses the same coastline rule on the rest of the map: light-blue
scallop wash, stop on dark indigo, punch islands and sea labels.

Bloc boxes only choose wave size / debug numbers.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT / "public" / "map-preview.jpg"
ANN_PATH = ROOT / "data" / "sea-guides" / "seas-annotated.png"
OUT_DIR = ROOT / "assets" / "land"
PUBLIC_DIR = ROOT / "public" / "land"
BLOCS_PATH = ROOT / "data" / "sea-blocs.json"

SERVE_SCALE = 0.5
TITLE_X = 0.948  # solid ground under 大清萬年…

FORCE_LAND_BOXES: list[tuple[float, float, float, float]] = [
    (0.370, 0.455, 0.402, 0.555),  # centre white blank
    (0.700, 0.325, 0.755, 0.385),  # Tsingtao / 青島 white corner
    (TITLE_X, 0.052, 1.0, 0.375),
]


def apply_force_land(sea: np.ndarray, h: int, w: int) -> None:
    for x0, y0, x1, y1 in FORCE_LAND_BOXES:
        sea[int(y0 * h) : int(y1 * h), int(x0 * w) : int(x1 * w)] = False


def load_blocs() -> list[dict]:
    return list(json.loads(BLOCS_PATH.read_text())["blocs"])


def _colors(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    lum = rgb.mean(axis=2)
    return r, g, b, lum


def pale_wash(r: np.ndarray, g: np.ndarray, b: np.ndarray, lum: np.ndarray) -> np.ndarray:
    return (
        (r > 55)
        & (r < 165)
        & (g > 115)
        & (b > 145)
        & ((g - r) > 25)
        & ((g - r) < 90)
        & (b + 10 >= g)
        & (lum < 190)
    )


def seaish_wash(r: np.ndarray, g: np.ndarray, b: np.ndarray, lum: np.ndarray) -> np.ndarray:
    return (
        (g >= 105)
        & (b >= 135)
        & (b + 8 >= g)
        & (g > r + 6)
        & (lum > 85)
        & (lum < 220)
    )


def dark_land(r: np.ndarray, g: np.ndarray, lum: np.ndarray) -> np.ndarray:
    return (g < 100) & (r < 50) & (lum < 110)


def grow_wash(
    seed: np.ndarray,
    guide: np.ndarray,
    seaish: np.ndarray,
    dark: np.ndarray,
    lum: np.ndarray,
    steps: int = 24,
    *,
    allow_bright: bool = True,
) -> np.ndarray:
    """Grow light-blue wash inside `guide`, never into dark indigo."""
    grown = seed & guide & ~dark
    for _ in range(steps):
        nxt = ndimage.binary_dilation(grown, iterations=1)
        nxt &= guide & ~dark
        if allow_bright:
            nxt &= seaish | grown | (lum >= 160)
        else:
            # Faithful to painted scallop only — no bright-lum frame creep.
            nxt &= seaish | grown
        if int(nxt.sum()) == int(grown.sum()):
            break
        grown = nxt
    # Fill scallop troughs; leave dark island holes alone.
    holes = ndimage.binary_fill_holes(grown) & ~grown & guide
    hlab, hn = ndimage.label(holes)
    if hn:
        hsz = np.bincount(hlab.ravel())
        dfrac = ndimage.mean(dark.astype(np.float32), hlab, index=np.arange(hn + 1))
        add = (hsz < 100_000) & (dfrac < 0.30)
        add[0] = False
        grown = grown | add[hlab]
    return grown & guide & ~dark


def sea_labels(sea: np.ndarray, lum: np.ndarray, dark: np.ndarray) -> np.ndarray:
    """White cartouches floating in the sea (島 labels, 荷蘭國, …)."""
    labels = np.zeros_like(sea)
    bright = (lum >= 195) & ndimage.binary_dilation(sea, iterations=2) & ~dark
    blab, bn = ndimage.label(bright)
    if not bn:
        return labels
    bsz = np.bincount(blab.ravel())
    structs = ndimage.generate_binary_structure(2, 1)
    for i, slc in enumerate(ndimage.find_objects(blab), start=1):
        if slc is None:
            continue
        area = int(bsz[i])
        if area < 140 or area > 20_000:
            continue
        sy, sx = slc
        bh = sy.stop - sy.start
        bw = sx.stop - sx.start
        if bh > 170 or bw > 240 or area / float(bh * bw) < 0.16:
            continue
        pad = 4
        y0 = max(0, sy.start - pad)
        y1 = min(sea.shape[0], sy.stop + pad)
        x0 = max(0, sx.start - pad)
        x1 = min(sea.shape[1], sx.stop + pad)
        local = blab[y0:y1, x0:x1] == i
        ring = ndimage.binary_dilation(local, structure=structs, iterations=3) & ~local
        if ring.any() and float(sea[y0:y1, x0:x1][ring].mean()) >= 0.45:
            labels[y0:y1, x0:x1] |= local
    if labels.any():
        labels = ndimage.binary_dilation(labels, iterations=3)
        labels = ndimage.binary_fill_holes(labels)
    return labels


def dark_islands(sea: np.ndarray, dark: np.ndarray) -> np.ndarray:
    """Dark land components whose perimeter is mostly open sea."""
    islands = np.zeros_like(sea)
    cand = dark & ndimage.binary_dilation(sea, iterations=4)
    ilab, inn = ndimage.label(cand)
    if not inn:
        return islands
    isz = np.bincount(ilab.ravel())
    structs = ndimage.generate_binary_structure(2, 1)
    for i, slc in enumerate(ndimage.find_objects(ilab), start=1):
        if slc is None:
            continue
        area = int(isz[i])
        if area < 100 or area > 250_000:
            continue
        sy, sx = slc
        bh = sy.stop - sy.start
        bw = sx.stop - sx.start
        if bh > sea.shape[0] * 0.22 or bw > sea.shape[1] * 0.22:
            continue
        pad = 3
        y0 = max(0, sy.start - pad)
        y1 = min(sea.shape[0], sy.stop + pad)
        x0 = max(0, sx.start - pad)
        x1 = min(sea.shape[1], sx.stop + pad)
        local = ilab[y0:y1, x0:x1] == i
        ring = ndimage.binary_dilation(local, structure=structs, iterations=2) & ~local
        if ring.any() and float(sea[y0:y1, x0:x1][ring].mean()) >= 0.55:
            islands[y0:y1, x0:x1] |= local
    return islands


def expand_pink_islands(
    seeds: np.ndarray,
    pale: np.ndarray,
    seaish: np.ndarray,
) -> np.ndarray:
    """Grow pink island outlines into the full non-wash cartouche bodies."""
    if not seeds.any():
        return seeds
    wash = pale | seaish
    core = ndimage.binary_fill_holes(ndimage.binary_dilation(seeds, iterations=2))
    halo = ndimage.binary_dilation(core, iterations=35)
    expanded = core.copy()
    for _ in range(40):
        nxt = ndimage.binary_dilation(expanded, iterations=1)
        nxt &= halo & (~wash | expanded)
        if int(nxt.sum()) == int(expanded.sum()):
            break
        expanded = nxt
    expanded = ndimage.binary_fill_holes(expanded)
    lab, n = ndimage.label(expanded)
    if not n:
        return core
    sizes = np.bincount(lab.ravel())
    keep = sizes >= 80
    keep[0] = False
    return keep[lab]


def parse_annotation(ann: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Pink/green strokes → sea1 guide, sea1 islands, sea2 guide (ann resolution)."""
    h, w = ann.shape[:2]
    r, g, b = [ann[:, :, i].astype(np.int16) for i in range(3)]
    pink = (r > 200) & (g < 100) & (b > 80) & (r > g + 80)
    green = (g > 180) & (r < 120) & (b < 140) & (g > r + 60)

    lab, n = ndimage.label(pink)
    sizes = np.bincount(lab.ravel())
    outer = np.zeros_like(pink)
    island_stroke = np.zeros_like(pink)
    sea2_pink = np.zeros_like(pink)
    for i in range(1, n + 1):
        m = lab == i
        yy, xx = np.where(m)
        cx = float(xx.mean()) / w
        if cx > 0.5:
            sea2_pink |= m
        elif sizes[i] > 500:
            outer |= m
        else:
            island_stroke |= m

    # Sea 1: fill BETWEEN the left & right pink strokes (exact outline).
    # Never from x=0 — that invented sea past the artist's left border.
    sea1 = np.zeros((h, w), dtype=bool)
    yy, xx = np.where(outer)
    if len(yy):
        for y in range(int(yy.min()), int(yy.max()) + 1):
            xs = np.where(outer[y])[0]
            if len(xs) == 0:
                continue
            xl, xr = int(xs.min()), int(xs.max())
            sea1[y, xl : xr + 1] = True
        sea1_left = float(xx.min()) / w
        sea1_right = float(xx.max()) / w
        print(
            f"    sea1 pink border x∈[{sea1_left:.4f}, {sea1_right:.4f}] "
            f"(fraction of map width)"
        )

    islands = np.zeros((h, w), dtype=bool)
    ilab, inn = ndimage.label(island_stroke)
    for i in range(1, inn + 1):
        stroke = ilab == i
        # Close open pink circles, then fill the island interior.
        closed = ndimage.binary_closing(stroke, structure=np.ones((5, 5)))
        closed = ndimage.binary_dilation(closed, iterations=2)
        filled = ndimage.binary_fill_holes(closed)
        if filled.sum() <= stroke.sum() + 5:
            yy, xx = np.where(stroke)
            pad = 3
            filled = np.zeros_like(stroke)
            filled[
                max(0, int(yy.min()) - pad) : int(yy.max()) + 1 + pad,
                max(0, int(xx.min()) - pad) : int(xx.max()) + 1 + pad,
            ] = True
        islands |= filled
    sea1 &= ~islands

    # Sea 2: green is a rough corner outline. Fill the INTERIOR only
    # (not the full bbox — that swallowed the adjacent coast). Seal the
    # open top/right against the stroke extrema so fill_holes works.
    sea2 = np.zeros((h, w), dtype=bool)
    if green.any():
        yy, xx = np.where(green)
        y0, y1 = int(yy.min()), int(yy.max())
        x0, x1 = int(xx.min()), int(xx.max())
        row = np.zeros((h, w), dtype=bool)
        for y in range(y0, y1 + 1):
            xs = np.where(green[y])[0]
            if len(xs) == 0:
                continue
            xl, xr = int(xs.min()), int(xs.max())
            if xr - xl >= 3:
                row[y, xl : xr + 1] = True
            else:
                # Single stroke (usually the bottom edge) — span to the
                # outline's right extreme so the open bay stays enclosed.
                row[y, xl : x1 + 1] = True
        sealed = green.copy()
        sealed[0, x0 : x1 + 1] = True
        sealed[y0 : y1 + 1, x1] = True
        filled = ndimage.binary_fill_holes(ndimage.binary_dilation(sealed, iterations=2))
        sea2 = (filled | row)
        sea2[:, :x0] = False
        sea2[:, x1 + 1 :] = False
        sea2[y1 + 1 :, :] = False
        if sea2_pink.any():
            sea2 |= ndimage.binary_fill_holes(sea2_pink) | sea2_pink

    return sea1, islands, sea2


def upscale_mask(mask: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    w, h = size  # PIL (W, H)
    return (
        np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).resize((w, h), Image.Resampling.NEAREST))
        > 128
    )


def coastline_sea_region(
    rgb: np.ndarray,
    guide: np.ndarray | None = None,
    *,
    allow_bright: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """Trace scallop wash (optionally clipped to guide). Returns sea, islands."""
    r, g, b, lum = _colors(rgb)
    pale = pale_wash(r, g, b, lum)
    seaish = seaish_wash(r, g, b, lum)
    dark = dark_land(r, g, lum)

    lab, _ = ndimage.label(pale)
    sizes = np.bincount(lab.ravel())
    keep = sizes >= 60
    keep[0] = False
    core = keep[lab]
    bridged = ndimage.binary_closing(core, structure=np.ones((9, 9)))
    bridged = ndimage.binary_opening(bridged, structure=np.ones((3, 3)))
    if guide is not None:
        bridged &= guide
        region = guide
    else:
        region = np.ones(pale.shape, dtype=bool)

    sea = grow_wash(
        bridged, region, seaish, dark, lum, steps=20, allow_bright=allow_bright
    )
    # Keep only painted wash — no extension into frame/margin ink.
    sea &= (pale | seaish) & ~dark
    islands = dark_islands(sea, dark)
    labels = sea_labels(sea, lum, dark)
    sea &= ~islands & ~labels
    islands |= labels
    return sea, islands


def build_sea_mask(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    h, w = rgb.shape[:2]
    r, g, b, lum = _colors(rgb)
    pale = pale_wash(r, g, b, lum)
    seaish = seaish_wash(r, g, b, lum)
    dark = dark_land(r, g, lum)

    if not ANN_PATH.is_file():
        print(f"  missing annotation {ANN_PATH}; falling back to full coastline", file=sys.stderr)
        sea, islands = coastline_sea_region(rgb)
        apply_force_land(sea, h, w)
        Image.fromarray((islands.astype(np.uint8) * 255)).save(OUT_DIR / "islands-binary.png")
        return sea, np.zeros((h, w), dtype=bool)

    print(f"  reading {ANN_PATH.relative_to(ROOT)}…")
    ann = np.asarray(Image.open(ANN_PATH).convert("RGB"))
    a1, a_isl, a2 = parse_annotation(ann)
    g1 = upscale_mask(a1, (w, h))
    g2 = upscale_mask(a2, (w, h))
    g_isl = upscale_mask(a_isl, (w, h))
    # Exact pink left border (before pad) — never punch sea left of this.
    a1_xs = np.where(a1.any(axis=0))[0]
    pink_left = float(a1_xs[0]) / a1.shape[1] if len(a1_xs) else 0.0
    pink_left_px = int(round(pink_left * w))
    # Pad sea-1 so the pink stroke itself is included, but do NOT grow
    # past the artist's left border into the frame margin.
    g1 = ndimage.binary_dilation(g1, iterations=3)
    if pink_left_px > 0:
        g1[:, :pink_left_px] = False
    # Grow pink island seeds into non-wash (land + labels) so the full
    # cartouche is opaque — fill_holes alone left waves over the text.
    g_isl = expand_pink_islands(g_isl, pale, seaish)
    # Sea-2 guide stays tight to the green outline; shoreline trim does the coast.

    print("  tracing sea 1 (pink) + islands…")
    print(f"    sea1 exact left border x={pink_left:.6f} ({pink_left_px}px @ full res)")
    seed1 = g1 & pale & ~dark
    sea1 = grow_wash(
        seed1, g1, seaish, dark, lum, steps=28, allow_bright=False
    )
    # Stay inside the pink corridor and on painted wash only.
    sea1 &= g1 & (pale | seaish) & ~dark
    if pink_left_px > 0:
        sea1[:, :pink_left_px] = False
    sea1 &= ~g_isl
    # Also punch any dark blobs the pink loops missed inside the guide.
    sea1 &= ~dark_islands(sea1, dark)
    sea1 &= ~sea_labels(sea1, lum, dark)
    print(f"    sea1 {sea1.mean():.3%}  islands {g_isl.mean():.3%}")

    print("  tracing sea 2 (green outline → shoreline trim)…")
    # Punch the WHOLE green bay except dark indigo. Painted seigaiha must
    # become holes too — wash filters left it half-opaque on the plate.
    g2_guide = ndimage.binary_dilation(g2, iterations=2)
    # Same principle on the right: respect green outline, don't run to x=1.
    a2_xs = np.where(a2.any(axis=0))[0]
    green_right = float(a2_xs[-1]) / a2.shape[1] if len(a2_xs) else 1.0
    green_right_px = int(round(green_right * w))
    g2_guide[:, green_right_px + 1 :] = False
    sea2 = g2_guide & ~dark
    sea2 = ndimage.binary_fill_holes(sea2) & g2_guide & ~dark
    sea2[:, green_right_px + 1 :] = False
    # Keep true dark islets inside the bay opaque.
    sea2 &= ~dark_islands(sea2, dark)
    print(f"    sea2 {sea2.mean():.3%}  green right border x={green_right:.6f}")

    print("  tracing sea 3 (coastline wash only — no frame-edge invent)…")
    reserved = ndimage.binary_dilation(g1 | g2_guide, iterations=2)
    # Same principle as sea1's exact left border: the strip left of the pink
    # outline (within the sea1 y-span) is frame margin — not ocean for sea3.
    a1_ys = np.where(a1.any(axis=1))[0]
    if pink_left_px > 0 and len(a1_ys):
        y0 = int(a1_ys[0] / a1.shape[0] * h)
        y1 = int(a1_ys[-1] / a1.shape[0] * h) + 1
        reserved[y0:y1, :pink_left_px] = True
    # Symmetrically: east of the green outline (sea2 y-span) is not sea3.
    a2_ys = np.where(a2.any(axis=1))[0]
    if len(a2_xs) and len(a2_ys):
        gy0 = int(a2_ys[0] / a2.shape[0] * h)
        gy1 = int(a2_ys[-1] / a2.shape[0] * h) + 1
        reserved[gy0:gy1, green_right_px + 1 :] = True
    # Bay of Bengal (SW): painted scallop starts inset from the frame —
    # same left-cut principle as sea1, using the SW bloc's x0.
    sw_bloc = next((b for b in load_blocs() if "Bay of Bengal" in b.get("name", "")), None)
    bengal_left = float(sw_bloc["x0"]) if sw_bloc else 0.0
    bengal_left_px = int(round(bengal_left * w))
    sw_y0 = int(float(sw_bloc["y0"]) * h) if sw_bloc else int(0.62 * h)
    sw_y1 = int(float(sw_bloc["y1"]) * h) if sw_bloc else h
    if bengal_left_px > 0:
        reserved[sw_y0:sw_y1, :bengal_left_px] = True
        print(f"    SW Bay of Bengal left cut x={bengal_left:.6f} ({bengal_left_px}px)")
    guide3 = ~reserved
    sea3, isl3 = coastline_sea_region(rgb, guide=guide3, allow_bright=False)
    # Drop anything that belongs to 1/2.
    sea3 &= ~g1 & ~g2_guide
    # Same principle as sea1: only painted scallop, never margin ink.
    sea3 &= (pale | seaish) & ~dark
    if pink_left_px > 0 and len(a1_ys):
        y0 = int(a1_ys[0] / a1.shape[0] * h)
        y1 = int(a1_ys[-1] / a1.shape[0] * h) + 1
        sea3[y0:y1, :pink_left_px] = False
    if len(a2_xs) and len(a2_ys):
        sea3[gy0:gy1, green_right_px + 1 :] = False
    if bengal_left_px > 0:
        sea3[sw_y0:sw_y1, :bengal_left_px] = False
    print(f"    sea3 {sea3.mean():.3%}  islands {isl3.mean():.3%}")

    sea = sea1 | sea2 | sea3
    islands = g_isl | isl3 | dark_islands(sea, dark)
    sea &= ~islands
    # sea_labels treats bright seigaiha crests as cartouches — protect sea2.
    sea2_keep = sea2.copy()
    sea &= ~sea_labels(sea, lum, dark)
    sea |= sea2_keep
    # Pink-outlined islands must stay land no matter what later passes did.
    sea &= ~g_isl
    islands |= g_isl

    # Report against bloc boxes (wave-size partitions).
    for bloc in load_blocs():
        region = np.zeros((h, w), dtype=bool)
        region[
            int(bloc["y0"] * h) : int(bloc["y1"] * h),
            int(bloc["x0"] * w) : int(bloc["x1"] * w),
        ] = True
        part = sea & region
        print(f"  bloc {bloc['id']} {bloc['name']}: {part.mean():.2%} of plate")

    # Title FORCE_LAND overlaps the green bay — restore sea2 after it.
    apply_force_land(sea, h, w)
    sea |= sea2_keep
    sea &= ~g_isl
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray((islands.astype(np.uint8) * 255)).save(OUT_DIR / "islands-binary.png")
    return sea, g_isl


def write_debug(rgb: np.ndarray, sea: np.ndarray, rgba: np.ndarray) -> None:
    h, w = sea.shape
    viz = rgb.copy()
    viz[sea] = (viz[sea].astype(np.float32) * 0.35 + np.array([60, 170, 255]) * 0.65).astype(
        np.uint8
    )
    dbg = Image.fromarray(viz[::4, ::4])
    draw = ImageDraw.Draw(dbg)
    for x0, y0, x1, y1 in FORCE_LAND_BOXES:
        draw.rectangle(
            [x0 * w / 4, y0 * h / 4, x1 * w / 4, y1 * h / 4],
            outline=(255, 40, 40),
            width=2,
        )
    for bloc in load_blocs():
        draw.rectangle(
            [
                bloc["x0"] * w / 4,
                bloc["y0"] * h / 4,
                bloc["x1"] * w / 4,
                bloc["y1"] * h / 4,
            ],
            outline=(255, 176, 0),
            width=2,
        )
    dbg.save(OUT_DIR / "debug-sea.jpg", quality=88)

    sm = rgba[::5, ::5]
    hh, ww = sm.shape[:2]
    yy, xx = np.indices((hh, ww))
    chk = ((xx // 32) + (yy // 32)) % 2
    bg = np.repeat(np.where(chk[..., None] == 0, 45, 90).astype(np.uint8), 3, axis=2)
    a = sm[:, :, 3:4].astype(np.float32) / 255.0
    comp = (sm[:, :, :3].astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(
        np.uint8
    )
    Image.fromarray(comp).save(OUT_DIR / "debug-land-plate.png")


def main() -> int:
    if not PREVIEW.is_file():
        print(f"Missing {PREVIEW}", file=sys.stderr)
        return 1

    print(f"Loading {PREVIEW.name}…")
    rgb = np.asarray(Image.open(PREVIEW).convert("RGB"))
    h, w = rgb.shape[:2]
    print(f"  size {w}×{h}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    print("Building sea mask…")
    sea, pink_islands = build_sea_mask(rgb)
    print(f"  sea fraction {sea.mean():.3%}")

    land_mask = Image.fromarray((~sea).astype(np.uint8) * 255)
    alpha = np.asarray(land_mask.filter(ImageFilter.GaussianBlur(radius=1.0)))
    # Blur softens tiny island edges — force pink-island pixels fully opaque.
    if pink_islands.any():
        alpha = alpha.copy()
        alpha[pink_islands] = 255
    else:
        alpha = np.array(alpha, copy=True)

    # Hard vertical left cuts (sea1 / Bay of Bengal): blur otherwise softens the
    # frame margin into a stair-step against wavelength bands.
    for bloc in load_blocs():
        name = str(bloc.get("name", ""))
        if not (bloc.get("id") == 1 or "Bay of Bengal" in name):
            continue
        x_cut = int(round(float(bloc["x0"]) * w))
        y0 = int(float(bloc["y0"]) * h)
        y1 = int(float(bloc["y1"]) * h)
        if x_cut <= 0:
            continue
        alpha[y0:y1, :x_cut] = 255
        near = sea[y0:y1, x_cut : min(w, x_cut + 4)].any(axis=1)
        band = alpha[y0:y1]
        band[near, x_cut] = 0
        alpha[y0:y1] = band

    rgba = np.dstack([rgb, alpha])

    full = Image.fromarray(rgba)
    serve_w = max(1, int(round(w * SERVE_SCALE)))
    serve_h = max(1, int(round(h * SERVE_SCALE)))
    served = full.resize((serve_w, serve_h), Image.Resampling.LANCZOS)

    # Re-assert islands after downscale (LANCZOS can re-soften edges).
    served_a = np.array(served, copy=True)
    if pink_islands.any():
        isl_s = (
            np.asarray(
                Image.fromarray(pink_islands.astype(np.uint8) * 255).resize(
                    (serve_w, serve_h), Image.Resampling.NEAREST
                )
            )
            > 128
        )
        served_a[isl_s, 3] = 255

    # Re-assert hard left cuts at serve resolution.
    sea_s = (
        np.asarray(
            Image.fromarray(sea.astype(np.uint8) * 255).resize(
                (serve_w, serve_h), Image.Resampling.NEAREST
            )
        )
        > 128
    )
    for bloc in load_blocs():
        name = str(bloc.get("name", ""))
        if not (bloc.get("id") == 1 or "Bay of Bengal" in name):
            continue
        x_cut = int(round(float(bloc["x0"]) * serve_w))
        y0 = int(float(bloc["y0"]) * serve_h)
        y1 = int(float(bloc["y1"]) * serve_h)
        if x_cut <= 0:
            continue
        served_a[y0:y1, :x_cut, 3] = 255
        near = sea_s[y0:y1, x_cut : min(serve_w, x_cut + 2)].any(axis=1)
        served_a[y0:y1, x_cut, 3] = np.where(near, 0, served_a[y0:y1, x_cut, 3])
    served = Image.fromarray(served_a)

    webp_path = OUT_DIR / "map-land.webp"
    served.save(webp_path, "WEBP", quality=78, method=4)
    Image.fromarray((sea.astype(np.uint8) * 255)).save(OUT_DIR / "sea-binary.png")
    Image.fromarray(alpha).save(OUT_DIR / "land-alpha.png")
    write_debug(rgb, sea, rgba)

    public_webp = PUBLIC_DIR / "map-land.webp"
    shutil.copy2(webp_path, public_webp)
    print(
        f"Wrote {webp_path.relative_to(ROOT)} "
        f"({serve_w}×{serve_h}, {webp_path.stat().st_size / 1e6:.1f} MB)"
    )
    print(f"Copied → {public_webp.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
