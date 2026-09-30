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
# Keep top padding; empty metal below last char is intentional.
CHAR_MIDS_Y = (445, 664, 883, 1096)
BODY_CX = 287  # slight left of geometric 287.5 so under-cast doesn't read right-shift
GLYPH_SIZE = 300  # ~0.52 of width — matches sibling scale

# Wipe / inpaint column covering all four glyph boxes.
WIPE_X0, WIPE_X1 = 145, 435
WIPE_Y0, WIPE_Y1 = 340, 1220
GUTTER_X0, GUTTER_X1 = 95, 135  # clean metal left of glyphs


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
    """Replace old title column using clean face metal from below the last glyph."""
    H, W = out.shape[:2]
    y0, y1 = max(0, WIPE_Y0), min(H, WIPE_Y1)
    x0, x1 = max(0, WIPE_X0), min(W, WIPE_X1)
    # Bottom empty face — no ribbon, no glyphs (Zhongguo layout).
    by0, by1 = int(H * 0.84), int(H * 0.92)
    bx0, bx1 = int(W * 0.30), int(W * 0.70)
    patch = out[by0:by1, bx0:bx1, :3].astype(np.float32)
    if patch.size == 0:
        raise RuntimeError("empty metal patch")
    ph, pw = patch.shape[:2]

    region = out[y0:y1, x0:x1, :3].astype(np.float32)
    rh, rw = region.shape[:2]
    fill = np.zeros((rh, rw, 3), np.float32)
    for yy in range(0, rh, ph):
        for xx in range(0, rw, pw):
            h = min(ph, rh - yy)
            w = min(pw, rw - xx)
            fill[yy : yy + h, xx : xx + w] = patch[:h, :w]

    feather = 14
    alpha = np.ones((rh, rw), np.float32)
    for i in range(feather):
        t = (i + 1) / feather
        alpha[:, i] *= t
        alpha[:, -1 - i] *= t
        if i < rh:
            alpha[i, :] = np.minimum(alpha[i, :], t)
            alpha[-1 - i, :] = np.minimum(alpha[-1 - i, :], t)

    al = out[y0:y1, x0:x1, 3] > 180
    for c in range(3):
        src = region[:, :, c]
        dst = fill[:, :, c]
        blended = src * (1 - alpha) + dst * alpha
        region[:, :, c] = np.where(al, blended, src)
    out[y0:y1, x0:x1, :3] = region


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


def paint_silver_glyphs(base: Image.Image, font: ImageFont.FreeTypeFont) -> Image.Image:
    """Composite hard silver glyphs with ambient + under-SE shadows onto base."""
    canvas = base.copy()
    W, H = canvas.size
    ambient = Image.new("L", (W, H), 0)
    under = Image.new("L", (W, H), 0)
    body = Image.new("L", (W, H), 0)
    bevel = Image.new("L", (W, H), 0)

    for ch, cy in zip(TITLE, CHAR_MIDS_Y):
        mask = hard_glyph_mask(ch, font)
        mw, mh = mask.size
        x0 = int(BODY_CX - mw / 2)
        y0 = int(cy - mh / 2)

        amb = mask.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(5))
        ambient = _paste_lighter(ambient, amb, x0, y0)

        pud = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3.5))
        under = _paste_lighter(under, pud, x0 + 6, y0 + 10)
        # hard contact strip (1–2px SE)
        contact = mask.filter(ImageFilter.MaxFilter(3))
        under = _paste_lighter(under, contact, x0 + 2, y0 + 3)

        body = _paste_lighter(body, mask, x0, y0)

        # Inner bevel highlight: mask eroded, shifted NW
        eroded = ImageEval_erode(mask, 2)
        bevel = _paste_lighter(bevel, eroded, x0 - 1, y0 - 1)

    rgba = np.array(canvas).astype(np.float32)

    def apply_dark(layer: Image.Image, strength: float) -> None:
        m = np.array(layer).astype(np.float32) / 255.0
        for c, mul in enumerate((0.12, 0.10, 0.10)):
            rgba[:, :, c] *= 1.0 - m * strength * (1.0 - mul)

    apply_dark(ambient, 0.55)
    apply_dark(under, 0.85)

    # Bevel highlight (inside stroke)
    bm = np.array(bevel).astype(np.float32) / 255.0
    body_m = np.array(body).astype(np.float32) / 255.0
    bm *= body_m
    for c, add in enumerate((28, 26, 24)):
        rgba[:, :, c] = np.clip(rgba[:, :, c] + bm * add, 0, 255)

    # Solid silver body last (slightly bright)
    silver = np.array([214, 214, 218], dtype=np.float32)
    for c in range(3):
        rgba[:, :, c] = np.where(body_m > 0.5, silver[c], rgba[:, :, c])

    rgba[:, :, 3] = np.array(canvas)[:, :, 3]
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def paint_bronze_glyphs(base: Image.Image, font: ImageFont.FreeTypeFont) -> Image.Image:
    """Same stack; body ≈ dark red carving to match bronze siblings."""
    canvas = base.copy()
    W, H = canvas.size
    ambient = Image.new("L", (W, H), 0)
    under = Image.new("L", (W, H), 0)
    body = Image.new("L", (W, H), 0)

    scale_y = H / 1510.0
    scale_x = W / 575.0
    mids = tuple(int(y * scale_y) for y in CHAR_MIDS_Y)
    cx = int(BODY_CX * scale_x)
    size = int(GLYPH_SIZE * min(scale_x, scale_y))
    font_scaled = ImageFont.truetype(KAITI_TTC, size, index=FONT_INDEX)

    for ch, cy in zip(TITLE, mids):
        mask = hard_glyph_mask(ch, font_scaled, box=max(360, size + 80))
        mw, mh = mask.size
        x0 = int(cx - mw / 2)
        y0 = int(cy - mh / 2)
        amb = mask.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(5))
        ambient = _paste_lighter(ambient, amb, x0, y0)
        pud = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3.5))
        under = _paste_lighter(under, pud, x0 + 6, y0 + 10)
        contact = mask.filter(ImageFilter.MaxFilter(3))
        under = _paste_lighter(under, contact, x0 + 2, y0 + 3)
        body = _paste_lighter(body, mask, x0, y0)

    rgba = np.array(canvas).astype(np.float32)

    def apply_dark(layer: Image.Image, strength: float) -> None:
        m = np.array(layer).astype(np.float32) / 255.0
        for c, mul in enumerate((0.18, 0.08, 0.06)):
            rgba[:, :, c] *= 1.0 - m * strength * (1.0 - mul)

    apply_dark(ambient, 0.50)
    apply_dark(under, 0.80)

    body_m = np.array(body).astype(np.float32) / 255.0
    red = np.array([168, 42, 38], dtype=np.float32)
    for c in range(3):
        rgba[:, :, c] = np.where(body_m > 0.5, red[c], rgba[:, :, c])

    rgba[:, :, 3] = np.array(canvas)[:, :, 3]
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


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
    WIPE_X0, WIPE_X1 = int(145 * sx), int(435 * sx)
    WIPE_Y0, WIPE_Y1 = int(340 * sy), int(1220 * sy)
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
