#!/usr/bin/env python3
"""
Build 現代中國 令牌 tablets (silver + bronze) from Zhongguo templates.

Do NOT use diffusion / GenerateImage for these — AI softens glyph edges and
mismatches Kai faces. Follow assets/ui/lingpai-protocol.md:

  1. Recolor gold accent → pink (ribbon + inset border only)
  2. Wipe glyph column; refill from clean metal gutters
  3. Paint 現代中國 with system Kaiti TC Bold, hard mask + shadow stack
  4. Install to assets/ + public/; bump cache-bust separately

Usage:
  python3 scripts/build-xiandai-lingpai.py
"""
from __future__ import annotations

import colorsys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]

# macOS MobileAsset Kaiti.ttc — index 4 = Kaiti TC Bold
KAITI_TTC = (
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/"
    "54a2ad3dac6cac875ad675d7d273dc425010a877.asset/AssetData/Kaiti.ttc"
)
FONT_INDEX = 4
TITLE = "現代中國"

# Zhongguo 4-char vertical band midpoints (575×1510 silver).
CHAR_MIDS_Y = (445, 664, 883, 1096)
BODY_CX = 287
# Sibling chars are ~170–180px tall — was 300 (too big / too bright flat fill).
GLYPH_SIZE = 215

# Wipe / inpaint column covering all four glyph boxes + face interior.
WIPE_X0, WIPE_X1 = 130, 450
WIPE_Y0, WIPE_Y1 = 300, 1320
GUTTER_X0, GUTTER_X1 = 95, 135  # unused; wipe uses bottom face metal


def sample_sibling_silver(path: Path) -> tuple[np.ndarray, tuple[int, int, int]]:
    """Return (Nx3 RGB samples, median RGB) from low-sat bright glyph cores."""
    a = np.array(Image.open(path).convert("RGBA"))
    r, g, b, al = [a[:, :, i].astype(np.float32) for i in range(4)]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.zeros_like(mx)
    pos = mx > 0
    sat[pos] = (mx - mn)[pos] / mx[pos]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    m = (al > 200) & (sat < 0.12) & (lum > 155) & (lum < 240)
    m[:, :160] = False
    m[:, 430:] = False
    m[:350] = False
    m[1200:] = False
    samples = np.stack([r[m], g[m], b[m]], axis=1)
    med = tuple(int(round(x)) for x in np.median(samples, axis=0))
    return samples, med  # type: ignore[return-value]

def recolor_gold_to_pink(rgba: np.ndarray, *, sat_scale: float = 0.92) -> np.ndarray:
    """Hue-shift gold ribbon/border pixels to magenta; leave metal/glyphs alone."""
    out = rgba.copy()
    r = out[:, :, 0].astype(np.float32)
    g = out[:, :, 1].astype(np.float32)
    b = out[:, :, 2].astype(np.float32)
    al = out[:, :, 3].astype(np.float32)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.zeros_like(mx)
    pos = mx > 0
    sat[pos] = (mx - mn)[pos] / mx[pos]
    gold = (al > 20) & (sat > 0.40) & (r > g) & (g > b + 5) & (r > 70)
    ys, xs = np.where(gold)
    for y, x in zip(ys, xs):
        hh, ss, vv = colorsys.rgb_to_hsv(
            out[y, x, 0] / 255.0, out[y, x, 1] / 255.0, out[y, x, 2] / 255.0
        )
        nr, ng, nb = colorsys.hsv_to_rgb(328 / 360.0, min(1.0, ss * sat_scale), vv)
        out[y, x, :3] = (nr * 255.0, ng * 255.0, nb * 255.0)
    return out


def wipe_glyph_column(out: np.ndarray, *, bronze: bool = False) -> None:
    """Replace the title-column face with continuous clean metal.

    Builds a luma field from the plate (glyphs ignored), then fills every
    non-pink column pixel from the clean strip below the last character,
    scaled to that field. No glyph ghosts, no rectangular donor patch of a
    different brightness.
    """
    import cv2

    H, W = out.shape[:2]
    y0, y1 = max(0, WIPE_Y0), min(H, WIPE_Y1)
    x0, x1 = max(0, WIPE_X0), min(W, WIPE_X1)
    col_h, col_w = y1 - y0, x1 - x0

    r = out[:, :, 0].astype(np.float32)
    g = out[:, :, 1].astype(np.float32)
    b = out[:, :, 2].astype(np.float32)
    al = out[:, :, 3]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.zeros_like(mx)
    pos = mx > 0
    sat[pos] = (mx - mn)[pos] / mx[pos]
    lum = 0.3 * r + 0.59 * g + 0.11 * b

    pinkish = (al > 20) & (sat > 0.28)
    outside = al < 180
    # Anything that isn't mid-tone face metal must not seed the luma field
    not_metal = pinkish | outside | (al < 200) | (sat > 0.18) | (lum > 125) | (lum < 58)

    lum_u8 = np.clip(lum, 0, 255).astype(np.uint8)
    ignore = not_metal.astype(np.uint8) * 255
    lum_field = cv2.inpaint(lum_u8, ignore, 6, cv2.INPAINT_TELEA).astype(np.float32)
    lum_field = cv2.GaussianBlur(lum_field, (81, 81), 0)

    # Clean donor pixels from below last glyph
    src_y0, src_y1 = min(H, 1240), min(H, 1375)
    d_good = (
        (al[src_y0:src_y1, x0:x1] > 220)
        & (sat[src_y0:src_y1, x0:x1] < 0.15)
        & (lum[src_y0:src_y1, x0:x1] > 55)
        & (lum[src_y0:src_y1, x0:x1] < 115)
    )
    donor = out[src_y0:src_y1, x0:x1, :3].astype(np.float32)
    samples = donor[d_good]
    if len(samples) < 80:
        samples = np.broadcast_to(
            np.array([72.0, 70.0, 71.0], np.float32), (512, 3)
        ).copy()

    rng = np.random.default_rng(37)
    # Feathered full-column replace — wide feather hides the column edge
    feather = 28
    alpha = np.ones((col_h, col_w), np.float32)
    for i in range(feather):
        t = (i + 1) / (feather + 1)
        alpha[i, :] *= t
        alpha[-(i + 1), :] *= t
        alpha[:, i] *= t
        alpha[:, -(i + 1)] *= t
    alpha[pinkish[y0:y1, x0:x1] | outside[y0:y1, x0:x1]] = 0.0

    pick = samples[rng.integers(0, len(samples), size=(col_h, col_w))]
    p_lum = np.maximum(0.3 * pick[:, :, 0] + 0.59 * pick[:, :, 1] + 0.11 * pick[:, :, 2], 1.0)
    target = lum_field[y0:y1, x0:x1]
    target = np.clip(target, 62.0, 88.0)
    target = target * 0.55 + 75.0 * 0.45
    fill = pick * (target / p_lum)[..., None]
    # Match sibling metal grain (Zhongguo face std ≈ 15)
    for _ in range(2):
        fill[1:] = fill[1:] * 0.4 + fill[:-1] * 0.6
    fill += rng.normal(0, 5.5, fill.shape)
    np.clip(fill, 0, 255, out=fill)

    dst = out[y0:y1, x0:x1, :3].astype(np.float32)
    a = alpha[..., None]
    out[y0:y1, x0:x1, :3] = np.clip(dst * (1.0 - a) + fill * a, 0, 255).astype(np.uint8)


def hard_glyph_mask(ch: str, font: ImageFont.FreeTypeFont, box: int = 420) -> Image.Image:
    """Render one character to an L mask, then threshold to a hard silhouette."""
    im = Image.new("L", (box, box), 0)
    dr = ImageDraw.Draw(im)
    # Center in box
    bbox = dr.textbbox((0, 0), ch, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (box - tw) // 2 - bbox[0]
    y = (box - th) // 2 - bbox[1]
    dr.text((x, y), ch, font=font, fill=255)
    # Hard mask — no soft antialias halo on the body
    arr = np.array(im)
    hard = (arr > 140).astype(np.uint8) * 255
    return Image.fromarray(hard, mode="L")


def _glyph_shadow_stack(overlay: Image.Image, mask: Image.Image, x0: int, y0: int) -> None:
    """Paint emboss shadows into the glyph overlay only (never tint the plate).

    Full soft casts are placed first; the opaque silver/bronze body covers the
    overlap, leaving a visible SE under-shadow like Zhongguo/Hailu.
    Tuned ~3× stronger than the first pass so depth reads at UI scale.
    """
    from PIL import ImageChops

    mw, mh = mask.size

    # Soft all-sided ambient halo
    amb = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3.2))
    amb_rgba = np.zeros((mh, mw, 4), np.uint8)
    amb_rgba[:, :, 3] = np.clip(np.array(amb).astype(np.float32) * 0.95, 0, 255).astype(
        np.uint8
    )
    overlay.alpha_composite(Image.fromarray(amb_rgba, "RGBA"), (x0, y0))

    # Heavier SE under-puddle (main cast beneath the strokes)
    puddle = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(2.8))
    pud_rgba = np.zeros((mh, mw, 4), np.uint8)
    pud_rgba[:, :, 3] = np.clip(np.array(puddle).astype(np.float32) * 1.0, 0, 255).astype(
        np.uint8
    )
    # Second pass of the puddle for ~3× depth without washing the plate
    overlay.alpha_composite(Image.fromarray(pud_rgba, "RGBA"), (x0 + 5, y0 + 6))
    overlay.alpha_composite(Image.fromarray(pud_rgba, "RGBA"), (x0 + 7, y0 + 9))

    # Far soft SE bloom
    bloom = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(4.5))
    bloom_rgba = np.zeros((mh, mw, 4), np.uint8)
    bloom_rgba[:, :, 3] = np.clip(np.array(bloom).astype(np.float32) * 0.55, 0, 255).astype(
        np.uint8
    )
    overlay.alpha_composite(Image.fromarray(bloom_rgba, "RGBA"), (x0 + 8, y0 + 11))

    # Hard contact rim
    dil = mask.filter(ImageFilter.MaxFilter(5))
    edge = ImageChops.subtract(dil, mask)
    edge_rgba = np.zeros((mh, mw, 4), np.uint8)
    edge_rgba[:, :, 3] = np.clip(np.array(edge).astype(np.float32) * 1.0, 0, 255).astype(
        np.uint8
    )
    overlay.alpha_composite(Image.fromarray(edge_rgba, "RGBA"), (x0 + 2, y0 + 3))
    overlay.alpha_composite(Image.fromarray(edge_rgba, "RGBA"), (x0 + 3, y0 + 4))


def paint_silver_glyphs(base: Image.Image, font: ImageFont.FreeTypeFont) -> Image.Image:
    """Stamp glyphs onto untouched metal — shadow lives only in the glyph layer."""
    canvas = base.copy()
    W, H = canvas.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    samples, med = sample_sibling_silver(ROOT / "assets/ui/silver/zhongguo-lingpai.png")
    silver = tuple(int(x) for x in med)
    rng = np.random.default_rng(42)

    for ch, cy in zip(TITLE, CHAR_MIDS_Y):
        mask = hard_glyph_mask(ch, font)
        mw, mh = mask.size
        x0 = int(BODY_CX - mw / 2)
        y0 = int(cy - mh / 2)

        _glyph_shadow_stack(overlay, mask, x0, y0)

        # Silver body with sibling colour + light grain
        body = np.zeros((mh, mw, 4), np.uint8)
        m = np.array(mask) > 140
        ys, xs = np.where(m)
        if len(ys):
            idx = rng.integers(0, len(samples), size=len(ys))
            fill = np.array(silver, dtype=np.float32) * 0.72 + samples[idx] * 0.28
            body[ys, xs, 0] = np.clip(fill[:, 0], 0, 255).astype(np.uint8)
            body[ys, xs, 1] = np.clip(fill[:, 1], 0, 255).astype(np.uint8)
            body[ys, xs, 2] = np.clip(fill[:, 2], 0, 255).astype(np.uint8)
            body[ys, xs, 3] = 255
        overlay.alpha_composite(Image.fromarray(body, "RGBA"), (x0, y0))

    return Image.alpha_composite(canvas, overlay)


def paint_bronze_glyphs(base: Image.Image, font: ImageFont.FreeTypeFont) -> Image.Image:
    """Same as silver: glyph-layer shadow only; metal plate stays continuous."""
    canvas = base.copy()
    W, H = canvas.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    scale_y = H / 1510.0
    scale_x = W / 575.0
    mids = tuple(int(y * scale_y) for y in CHAR_MIDS_Y)
    cx = int(BODY_CX * scale_x)
    size = int(GLYPH_SIZE * min(scale_x, scale_y))
    font_scaled = ImageFont.truetype(KAITI_TTC, size, index=FONT_INDEX)
    red = (168, 42, 38)

    for ch, cy in zip(TITLE, mids):
        mask = hard_glyph_mask(ch, font_scaled, box=max(360, size + 80))
        mw, mh = mask.size
        x0 = int(cx - mw / 2)
        y0 = int(cy - mh / 2)

        _glyph_shadow_stack(overlay, mask, x0, y0)

        body = np.zeros((mh, mw, 4), np.uint8)
        m = np.array(mask) > 140
        body[m, 0] = red[0]
        body[m, 1] = red[1]
        body[m, 2] = red[2]
        body[m, 3] = 255
        overlay.alpha_composite(Image.fromarray(body, "RGBA"), (x0, y0))

    return Image.alpha_composite(canvas, overlay)

def _paste_lighter(dst: Image.Image, src: Image.Image, x: int, y: int) -> Image.Image:
    from PIL import ImageChops

    layer = Image.new("L", dst.size, 0)
    layer.paste(src, (x, y))
    return ImageChops.lighter(dst, layer)


def ImageEval_erode(mask: Image.Image, k: int) -> Image.Image:
    size = k * 2 + 1
    return mask.filter(ImageFilter.MinFilter(size))

def build_silver() -> Image.Image:
    src = Image.open(ROOT / "assets/ui/silver/zhongguo-lingpai.png").convert("RGBA")
    assert src.size == (575, 1510), src.size
    arr = recolor_gold_to_pink(np.array(src))
    wipe_glyph_column(arr)
    base = Image.fromarray(arr, "RGBA")
    font = ImageFont.truetype(KAITI_TTC, GLYPH_SIZE, index=FONT_INDEX)
    return paint_silver_glyphs(base, font)


def build_bronze() -> Image.Image:
    # Prefer bronze Zhongguo (4-char layout); fall back to handi if missing.
    path = ROOT / "assets/ui/bronze/zhongguo-lingpai.png"
    if not path.exists():
        path = ROOT / "assets/ui/bronze/handi-lingpai.png"
    src = Image.open(path).convert("RGBA")
    arr = recolor_gold_to_pink(np.array(src), sat_scale=0.95)
    # Wipe scaled to canvas
    global WIPE_X0, WIPE_X1, WIPE_Y0, WIPE_Y1, GUTTER_X0, GUTTER_X1
    W, H = src.size
    sx, sy = W / 575.0, H / 1510.0
    old = (WIPE_X0, WIPE_X1, WIPE_Y0, WIPE_Y1, GUTTER_X0, GUTTER_X1)
    WIPE_X0, WIPE_X1 = int(130 * sx), int(450 * sx)
    WIPE_Y0, WIPE_Y1 = int(300 * sy), int(1320 * sy)
    GUTTER_X0, GUTTER_X1 = int(95 * sx), int(135 * sx)
    try:
        wipe_glyph_column(arr, bronze=True)
    finally:
        WIPE_X0, WIPE_X1, WIPE_Y0, WIPE_Y1, GUTTER_X0, GUTTER_X1 = old
    base = Image.fromarray(arr, "RGBA")
    font = ImageFont.truetype(KAITI_TTC, GLYPH_SIZE, index=FONT_INDEX)
    return paint_bronze_glyphs(base, font)


def install(img: Image.Image, theme: str) -> None:
    name = "xiandai-lingpai.png"
    for root in (ROOT / "assets/ui" / theme, ROOT / "public/ui" / theme):
        root.mkdir(parents=True, exist_ok=True)
        dest = root / name
        img.save(dest, "PNG")
        print(f"wrote {dest.relative_to(ROOT)} {img.size}")


def main() -> None:
    silver = build_silver()
    install(silver, "silver")
    bronze = build_bronze()
    # Normalize bronze to Handi height if needed (protocol)
    if bronze.size[0] != 575:
        # width-lock to 575, top-align onto 1510 canvas
        w, h = bronze.size
        new_h = int(round(h * (575 / w)))
        bronze = bronze.resize((575, new_h), Image.Resampling.LANCZOS)
    if bronze.size != (575, 1510):
        canvas = Image.new("RGBA", (575, 1510), (0, 0, 0, 0))
        canvas.paste(bronze, (0, 0), bronze)
        bronze = canvas
    install(bronze, "bronze")
    preview = silver.resize((230, 604), Image.Resampling.LANCZOS)
    preview.save("/tmp/xiandai-preview.png")
    print("preview /tmp/xiandai-preview.png")


if __name__ == "__main__":
    main()
