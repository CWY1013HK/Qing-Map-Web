#!/usr/bin/env python3
"""
Build a square 朱文 tour seal from scratch (transparent PNG).

  python3 scripts/build-tour-seal.py --text 寰宇掠影 \
    --out assets/intro/huanyu-lueying-seal.png

Never reuses another seal's pixel mask (that bleeds old glyph artefacts).
Saturates the inner square with oversized, heavily stroked 小篆.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

try:
    from scipy import ndimage
except ImportError:
    ndimage = None  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
SHUOWEN = ROOT / "assets/fonts/TW-Shuowen-full.ttf"
SEAL_RED = (161, 10, 14)
SIZE = 1024
# Dense face like 世界略覽 backup (~0.44); aim a touch heavier for map underlay
TARGET_INK = 0.40
BORDER_MARGIN = 0.050  # inset of outer edge of border
BORDER_WIDTH = 0.055  # stroke thickness of frame
# Extra clear gutter inside the frame so glyphs don't kiss the border
FACE_GUTTER = 0.036
# Glyph cells — leave room for inter-row gap
CELL = 0.37
# Quadrant centers — more vertical gap between top & bottom rows
CX_R, CX_L = 0.68, 0.32
CY_T, CY_B = 0.300, 0.700
# Global text weight vs saturated v5 (distance-transform scale)
STROKE_SCALE = 0.78
FACE_DILATE = 0
def _cmap() -> dict:
    return TTFont(str(SHUOWEN)).getBestCmap() or {}


def has_glyph(ch: str, cmap: dict | None = None) -> bool:
    cmap = cmap or _cmap()
    return ord(ch) in cmap


def load_shuowen(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(SHUOWEN), size=size)


def dilate(mask: np.ndarray, iterations: int) -> np.ndarray:
    if iterations <= 0:
        return (mask > 0).astype(np.uint8) * 255
    bin_m = (mask > 0).astype(np.uint8)
    if ndimage is not None:
        return ndimage.binary_dilation(bin_m, iterations=iterations).astype(np.uint8) * 255
    img = Image.fromarray(bin_m * 255, "L")
    for _ in range(iterations):
        img = img.filter(ImageFilter.MaxFilter(3))
    return np.array(img)


def scale_stroke_width(mask: np.ndarray, scale: float) -> np.ndarray:
    """Shrink filled stroke width to `scale` of original via distance transform."""
    bin_m = mask > 0
    if not bin_m.any() or scale >= 0.999:
        return bin_m.astype(np.uint8) * 255
    if ndimage is None:
        # Fallback: iterative MinFilter ≈ mild thin
        img = Image.fromarray(bin_m.astype(np.uint8) * 255, "L")
        for _ in range(max(1, int(round((1 - scale) * 4)))):
            img = img.filter(ImageFilter.MinFilter(3))
        return np.array(img)
    dist = ndimage.distance_transform_edt(bin_m)
    # Half-width characteristic; strip outer (1-scale) fraction of radius
    ridge = dist[bin_m]
    r = float(np.percentile(ridge, 92)) if ridge.size else 1.0
    trim = max(1.0, r * (1.0 - scale))
    return (dist > trim).astype(np.uint8) * 255


def paste_max(dst: Image.Image, src: Image.Image, xy: tuple[int, int]) -> None:
    x0, y0 = xy
    w, h = src.size
    # Clip to canvas
    x1, y1 = max(0, x0), max(0, y0)
    x2, y2 = min(dst.size[0], x0 + w), min(dst.size[1], y0 + h)
    if x1 >= x2 or y1 >= y2:
        return
    sx0, sy0 = x1 - x0, y1 - y0
    region = dst.crop((x1, y1, x2, y2))
    piece = src.crop((sx0, sy0, sx0 + (x2 - x1), sy0 + (y2 - y1)))
    blended = Image.fromarray(np.maximum(np.array(region), np.array(piece)), "L")
    dst.paste(blended, (x1, y1))


def _stroke(base: int) -> int:
    return max(2, int(round(base * STROKE_SCALE)))


def _shuowen_tight(ch: str, pt: int, stroke: int) -> Image.Image:
    """Render one 說文 glyph and crop to its ink bbox (no Songti)."""
    if not has_glyph(ch):
        raise SystemExit(f"說文 missing {ch!r} — cannot composite without Songti")
    font = load_shuowen(pt)
    big = Image.new("L", (pt * 2, pt * 2), 0)
    d = ImageDraw.Draw(big)
    bb = d.textbbox((0, 0), ch, font=font, stroke_width=stroke)
    d.text((-bb[0] + 4, -bb[1] + 4), ch, fill=255, font=font, stroke_width=stroke, stroke_fill=255)
    arr = np.array(big)
    ys, xs = np.where(arr > 40)
    if len(xs) == 0:
        raise SystemExit(f"empty glyph render for {ch!r}")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    return Image.fromarray(arr[y0:y1, x0:x1], "L")


def _fit_into(src: Image.Image, max_w: int, max_h: int) -> Image.Image:
    sw, sh = src.size
    s = min(max_w / sw, max_h / sh)
    nw, nh = max(1, int(round(sw * s))), max(1, int(round(sh * s)))
    return src.resize((nw, nh), Image.Resampling.NEAREST)


def composite_掠(box: int, cmap: dict) -> Image.Image:
    """
    說文 only: 手 (left radical) + 京 (right body).
    Clear left/right columns, slight overlap, shared height — one character, not two islands.
    """
    if not (has_glyph("手", cmap) and has_glyph("京", cmap)):
        raise SystemExit("說文 missing 手/京 — required for 掠 composite")

    stroke = _stroke(max(8, box // 32))
    # Extra stroke on 手 so the radical doesn't read as a hairline next to 京
    hand = _shuowen_tight("手", int(box * 0.90), max(stroke, box // 28))
    jing = _shuowen_tight("京", int(box * 0.98), stroke)
    # Pre-thicken radical before fit
    hand = Image.fromarray(dilate(np.array(hand), 1), "L")

    pad = int(box * 0.04)
    inner = box - 2 * pad
    # Wide radical + body with deep overlap — one fused 掠, not two islands
    hand_f = _fit_into(hand, int(box * 0.48), inner)
    jing_f = _fit_into(jing, int(box * 0.66), inner)

    canvas = Image.new("L", (box, box), 0)
    hx = pad - int(box * 0.02)
    hy = pad + (inner - hand_f.size[1]) // 2
    paste_max(canvas, hand_f, (hx, hy))
    jx = pad + int(box * 0.20)  # deep overlap — fuse radical into 京
    jy = pad + (inner - jing_f.size[1]) // 2
    paste_max(canvas, jing_f, (jx, jy))
    return Image.fromarray(((np.array(canvas) > 40).astype(np.uint8) * 255), "L")


def composite_影_body(box: int, cmap: dict) -> Image.Image:
    """景 only (left ~70%). 彡 dashes are drawn separately and re-applied after thin."""
    if not has_glyph("景", cmap):
        raise SystemExit("說文 missing 景 — required for 影 composite")
    stroke = _stroke(max(6, box // 36))
    jing = _shuowen_tight("景", int(box * 0.95), stroke)
    pad = int(box * 0.04)
    inner = box - 2 * pad
    jing_f = _fit_into(jing, int(box * 0.68), inner)
    canvas = Image.new("L", (box, box), 0)
    jx = pad
    jy = pad + (inner - jing_f.size[1]) // 2
    paste_max(canvas, jing_f, (jx, jy))
    return Image.fromarray(((np.array(canvas) > 40).astype(np.uint8) * 255), "L")


def composite_影_dashes(box: int) -> Image.Image:
    """Three clear 彡 dashes — 3× prior hairline weight, reapplied after thin."""
    canvas = Image.new("L", (box, box), 0)
    d = ImageDraw.Draw(canvas)
    # 3× prior hairline, then 90% of that
    w = max(32, int(round((box // 28) * 3 * 0.90)))
    x0 = int(box * 0.68)
    length = int(box * 0.26)
    for y0 in (0.16, 0.42, 0.68):
        y = int(box * y0)
        x1 = x0 + length
        y1 = y + int(box * 0.09)
        d.line((x0, y, x1, y1), fill=255, width=w)
        r = w // 2
        d.ellipse((x0 - r, y - r, x0 + r, y + r), fill=255)
        d.ellipse((x1 - r, y1 - r, x1 + r, y1 + r), fill=255)
    return Image.fromarray(dilate(np.array(canvas), 1), "L")


def render_char_mask(ch: str, box: int, cmap: dict) -> Image.Image:
    if ch == "掠":
        return composite_掠(box, cmap)
    if ch == "影":
        return composite_影_body(box, cmap)  # dashes pasted later
    if ch == "寰" and has_glyph("環", cmap):
        ch = "環"

    if not has_glyph(ch, cmap):
        raise SystemExit(
            f"說文 missing {ch!r} and no composite — refuse Songti for tour seals"
        )

    canvas = Image.new("L", (box, box), 0)
    draw = ImageDraw.Draw(canvas)
    font = load_shuowen(int(box * 1.05))
    stroke = _stroke(max(8, box // 28))
    bbox = draw.textbbox((0, 0), ch, font=font, stroke_width=stroke)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (box - tw) // 2 - bbox[0]
    y = (box - th) // 2 - bbox[1]
    draw.text((x, y), ch, fill=255, font=font, stroke_width=stroke, stroke_fill=255)
    return Image.fromarray(dilate(np.array(canvas), FACE_DILATE), "L")


def fresh_border(rng: np.random.Generator) -> np.ndarray:
    """Clean square frame + mild carved edge jitter. No leftover glyphs."""
    img = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(img)
    m = int(SIZE * BORDER_MARGIN)
    t = int(SIZE * BORDER_WIDTH)
    d.rectangle([m, m, SIZE - 1 - m, SIZE - 1 - m], outline=255, width=t)

    arr = (np.array(img) > 0).astype(np.uint8)
    # Carve irregularity: randomly nibble / grow the border edge only
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    band = (xx >= m - 4) & (xx < SIZE - m + 4) & (yy >= m - 4) & (yy < SIZE - m + 4)
    inner = (xx > m + t + 2) & (xx < SIZE - m - t - 2) & (yy > m + t + 2) & (yy < SIZE - m - t - 2)
    edge_only = band & ~inner
    noise = rng.random((SIZE, SIZE))
    arr[edge_only & (noise < 0.04)] = 0
    arr[edge_only & (noise > 0.97)] = 1
    # Keep interior of frame empty (no speckles inside the face)
    arr[inner] = 0
    # Outside the seal entirely: clear
    outside = (xx < m - 6) | (xx >= SIZE - m + 6) | (yy < m - 6) | (yy >= SIZE - m + 6)
    # Allow a few stamp flecks just outside the frame
    fleck = outside & (noise > 0.995) & (xx > m - 18) & (xx < SIZE - m + 18) & (yy > m - 18) & (
        yy < SIZE - m + 18
    )
    arr[outside] = 0
    arr[fleck] = 1
    return dilate(arr * 255, 1)


def build_face(text: str, cmap: dict) -> tuple[np.ndarray, np.ndarray]:
    """Returns (face, 彡_dashes_overlay). Dashes are reapplied after stroke-scale."""
    face = Image.new("L", (SIZE, SIZE), 0)
    dashes = Image.new("L", (SIZE, SIZE), 0)
    cell = int(SIZE * CELL)
    positions = [
        (text[0], (int(SIZE * CX_R), int(SIZE * CY_T))),  # TR
        (text[1], (int(SIZE * CX_R), int(SIZE * CY_B))),  # BR
        (text[2], (int(SIZE * CX_L), int(SIZE * CY_T))),  # TL
        (text[3], (int(SIZE * CX_L), int(SIZE * CY_B))),  # BL
    ]
    for ch, (cx, cy) in positions:
        xy = (cx - cell // 2, cy - cell // 2)
        paste_max(face, render_char_mask(ch, cell, cmap), xy)
        if ch == "影":
            paste_max(dashes, composite_影_dashes(cell), xy)
    return np.array(face), np.array(dashes)


def clip_face_inside_border(face: np.ndarray, border: np.ndarray) -> np.ndarray:
    """Keep glyphs inside the frame with a clear gutter — no overlap with the border."""
    m = int(SIZE * BORDER_MARGIN)
    t = int(SIZE * BORDER_WIDTH)
    g = int(SIZE * FACE_GUTTER)
    # Past the inner edge of the frame + gutter
    pad = m + t + g
    out = face.copy()
    out[:pad, :] = 0
    out[-pad:, :] = 0
    out[:, :pad] = 0
    out[:, -pad:] = 0
    # Also clear where border already owns pixels (avoid double-edge mush)
    out[border > 0] = 0
    return out


def thicken_to_target(face: np.ndarray, border: np.ndarray) -> np.ndarray:
    face_bin = (face > 40).astype(bool)
    border_bin = border > 40
    best = face_bin
    best_err = 1.0
    best_ink = 0.0
    used = 0
    for it in range(0, 12):
        dilated = dilate(face_bin.astype(np.uint8), it) > 0
        # Re-clip after dilate so border stays clean
        tmp = dilated.astype(np.uint8) * 255
        tmp = clip_face_inside_border(tmp, border)
        dilated = tmp > 0
        ink = float((dilated | border_bin).mean())
        err = abs(ink - TARGET_INK)
        if err < best_err:
            best = dilated
            best_err = err
            best_ink = ink
            used = it
        if ink >= TARGET_INK:
            break
    print(f"  face dilation ×{used} → ink {best_ink:.3f}")
    return best.astype(np.uint8) * 255


def build_seal(text: str, seed: int = 42) -> Image.Image:
    if len(text) != 4:
        raise SystemExit(f"Expected 4 characters, got {len(text)!r}")

    rng = np.random.default_rng(seed)
    cmap = _cmap()
    border = fresh_border(rng)
    face, dashes = build_face(text, cmap)
    face = clip_face_inside_border(face, border)
    dashes = clip_face_inside_border(dashes, border)
    face = scale_stroke_width(face, STROKE_SCALE)
    # Re-apply 彡 dashes after thin so they stay visible (not eaten by DT scale)
    face = np.maximum(face, dashes)
    face = clip_face_inside_border(face, border)
    ink_now = float(((face > 0) | (border > 0)).mean())
    print(f"  stroke scale {STROKE_SCALE:.0%} → ink {ink_now:.3f} (彡 dashes restored)")

    # Hard ink (no mushy blur that looks like leftover artefacts)
    ink = np.maximum(face > 0, border > 0).astype(np.uint8) * 255
    # Tiny edge soften for stamp feel — keep threshold high so no ghost pixels
    soft = Image.fromarray(ink, "L").filter(ImageFilter.GaussianBlur(0.55))
    a = np.array(soft)
    on = ink > 0
    rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    rgba[on, 0] = SEAL_RED[0]
    rgba[on, 1] = SEAL_RED[1]
    rgba[on, 2] = SEAL_RED[2]
    rgba[..., 3] = np.where(on, np.clip(a.astype(np.float32) * 1.2, 0, 255).astype(np.uint8), 0)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default="寰宇掠影")
    ap.add_argument("--out", type=Path, default=ROOT / "assets/intro/huanyu-lueying-seal.png")
    ap.add_argument("--seed", type=int, default=42)
    # Kept for CLI compat; ignored — we never reuse another seal's pixels
    ap.add_argument("--reference", type=Path, default=None, help="ignored (fresh build only)")
    args = ap.parse_args()

    out: Path = args.out if args.out.is_absolute() else ROOT / args.out
    seal = build_seal(args.text, seed=args.seed)
    out.parent.mkdir(parents=True, exist_ok=True)
    seal.save(out)
    pub = ROOT / "public/intro" / out.name
    pub.parent.mkdir(parents=True, exist_ok=True)
    pub.write_bytes(out.read_bytes())

    arr = np.array(seal)
    ink = (arr[..., 3] > 128).mean()
    h, w = arr.shape[:2]
    m = np.zeros((h, w), bool)
    m[int(h * 0.12) : int(h * 0.88), int(w * 0.12) : int(w * 0.88)] = True
    face = ((arr[..., 3] > 128) & m).mean()
    print(f"wrote {out}")
    print(f"wrote {pub}")
    print(f"ink {ink:.3f}  face {face:.3f}  (target ink ≥ {TARGET_INK})")
    if ink < 0.36 or face < 0.16:
        raise SystemExit("QA fail: seal under-saturated — raise stroke / cell / dilate")


if __name__ == "__main__":
    main()
