#!/usr/bin/env python3
"""
Build 折 toolbar badges — same cast plate + sharp rim as 遠 (badge-yuan.png).

Clears only the 遠 glyph (tight mask + Telea inpaint / ring fill), never blurs
the rim. Composites a 楷書 折 with emboss matched to the donor’s mid-grey face.

Usage: python3 scripts/build-badge-zhe.py
"""
from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DONOR = "badge-yuan.png"
CHAR = "折"
# Tuned against silver badge-yuan + 遠 @ 485px (WenKai / Kaiti).
GLYPH_SIZE = 485

KAITI_TTC = (
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/"
    "54a2ad3dac6cac875ad675d7d273dc425010a877.asset/AssetData/Kaiti.ttc"
)
WENKAI = ROOT / "public/fonts/LXGWWenKaiLite-Regular.woff"


def pick_kaiti_font(size: int) -> ImageFont.FreeTypeFont:
    if os.path.isfile(KAITI_TTC):
        try:
            return ImageFont.truetype(KAITI_TTC, size, index=4)
        except OSError:
            pass
    for path in (
        "/System/Library/Fonts/Supplemental/Kaiti.ttc",
        "/System/Library/Fonts/STKaiti.ttf",
    ):
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size, index=0 if path.endswith(".ttc") else 0)
            except OSError:
                continue
    if not WENKAI.is_file():
        raise SystemExit(f"Missing Kai font: {WENKAI}")
    return ImageFont.truetype(str(WENKAI), size)


def sample_theme_colors(path: Path) -> dict[str, tuple[int, int, int]]:
    im = np.array(Image.open(path).convert("RGBA"))
    r, g, b, a = [im[:, :, i] for i in range(4)]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    bright = (a > 200) & (lum > 185)
    shadow = (a > 200) & (lum < 65)
    bright_c = (
        tuple(int(x) for x in np.median(im[bright][:, :3], axis=0))
        if bright.any()
        else (210, 210, 210)
    )
    shadow_c = (
        tuple(int(x) for x in np.median(im[shadow][:, :3], axis=0))
        if shadow.any()
        else (50, 50, 50)
    )
    # Mid face — match weathered mid-grey of other badges (not near-white).
    mid = (a > 200) & (lum > 140) & (lum < 200)
    if mid.any():
        face_c = tuple(int(x) for x in np.median(im[mid][:, :3], axis=0))
    else:
        face_c = tuple(int(round((b + s) / 2)) for b, s in zip(bright_c, shadow_c, strict=True))
    # Pull face slightly toward mid-grey so 折 isn’t brighter than 音/功
    face_c = tuple(int(round(c * 0.88 + 95 * 0.12)) for c in face_c)
    return {"bright": bright_c, "shadow": shadow_c, "face": face_c}


def radial(h: int = 1024, w: int = 1024) -> np.ndarray:
    yy, xx = np.ogrid[:h, :w]
    return np.sqrt((xx - (w - 1) / 2) ** 2 + (yy - (h - 1) / 2) ** 2) / min(w, h) * 2


def donor_glyph_mask(rgba: np.ndarray) -> np.ndarray:
    """Tight mask of the raised 遠 glyph only — leave plate grain + rim untouched."""
    r, g, b, a = [rgba[:, :, i].astype(np.float32) for i in range(4)]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    dist = radial(*rgba.shape[:2])
    # Stay well inside the rim (rim starts ~0.78–0.86 of half-diagonal ≈ r_norm 0.78)
    center = dist < 0.72
    embossed = center & (a > 100) & ((lum > 155) | (lum < 78))
    kernel = np.ones((3, 3), np.uint8)
    # Small dilate for contact-shadow fringe only — do NOT wash toward the rim.
    return cv2.dilate(embossed.astype(np.uint8), kernel, iterations=2) > 0


def clear_donor_glyph(plate: Image.Image) -> Image.Image:
    """Remove 遠 by cloning rotated clean plate into the hole (keeps cast grain)."""
    a = np.array(plate.convert("RGBA"))
    rgb = a[:, :, :3].astype(np.float32)
    mask = donor_glyph_mask(a)
    h, w = a.shape[:2]
    dist = radial(h, w)

    rim_keep = dist >= 0.74
    mask = mask & ~rim_keep
    clean = (a[:, :, 3] > 200) & (dist < 0.72) & ~donor_glyph_mask(a)

    yy, xx = np.mgrid[:h, :w]
    # Source coords for 90° / 180° rotates — move donor glyph away, reuse real grain
    sy1, sx1 = xx, w - 1 - yy
    sy2, sx2 = h - 1 - yy, w - 1 - xx
    clean1 = clean[sy1, sx1]
    clean2 = clean[sy2, sx2]
    use1 = mask & clean1
    use2 = mask & ~clean1 & clean2
    use_ring = mask & ~clean1 & ~clean2

    synth = rgb.copy()
    idx = np.where(use1)
    synth[idx] = rgb[sy1[idx], sx1[idx]]
    idx = np.where(use2)
    synth[idx] = rgb[sy2[idx], sx2[idx]]
    if use_ring.any():
        ring = clean & (dist > 0.50) & (dist < 0.70)
        if not ring.any():
            raise SystemExit("No clean plate ring to sample")
        ring_yx = np.argwhere(ring)
        hole_yx = np.argwhere(use_ring)
        rng = np.random.default_rng(7)
        picks = ring_yx[rng.integers(0, len(ring_yx), size=len(hole_yx))]
        synth[use_ring] = rgb[picks[:, 0], picks[:, 1]]

    # Feather mask only — never blur RGB (that flattens cast-metal grain)
    wgt = mask.astype(np.float32)
    wgt = cv2.GaussianBlur(wgt, (0, 0), 0.5)
    filled = rgb * (1.0 - wgt[..., None]) + synth * wgt[..., None]

    out = a.copy()
    out[:, :, :3] = np.clip(filled, 0, 255).astype(np.uint8)
    out[rim_keep] = a[rim_keep]
    return Image.fromarray(out)


def graft_rim(face: Image.Image, rim_ref: Image.Image) -> Image.Image:
    """Take bright outer rim from donor so 折 matches 遠 edge crispness exactly."""
    fa = np.array(face.convert("RGBA")).astype(np.float32)
    ra = np.array(rim_ref.convert("RGBA")).astype(np.float32)
    dist = radial()
    # Earlier take-over so soft font/composite fringe never shows at the rim
    t = np.clip((dist - 0.68) / (0.84 - 0.68), 0, 1)
    t = t * t * (3 - 2 * t)
    t = np.where(dist >= 0.84, 1.0, t)
    out = fa * (1 - t[..., None]) + ra * t[..., None]
    out[:, :, 3] = ra[:, :, 3]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def render_glyph_mask(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font = pick_kaiti_font(size)
    bbox = draw.textbbox((0, 0), CHAR, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (1024 - tw) // 2 - bbox[0]
    y = (1024 - th) // 2 - bbox[1] + 6
    draw.text((x, y), CHAR, font=font, fill=(255, 255, 255, 255))
    return canvas


def composite_emboss(plate: Image.Image, colors: dict[str, tuple[int, int, int]]) -> Image.Image:
    """Chiseled emboss approximating the donor’s raised metallic glyph."""
    glyph = render_glyph_mask(GLYPH_SIZE)
    alpha = glyph.split()[3]
    a_np = np.array(alpha)
    # Harden soft font AA into a crisp metal edge, then 1px AA
    a_np = np.where(a_np > 48, 255, 0).astype(np.uint8)
    a_np = cv2.dilate(a_np, np.ones((3, 3), np.uint8), iterations=1)
    a_np = cv2.GaussianBlur(a_np, (0, 0), 0.45)
    alpha = Image.fromarray(a_np)

    # Height map → directional bevel (top-left light) — keep edge hard
    h = a_np.astype(np.float32) / 255.0
    h = cv2.GaussianBlur(h, (0, 0), 0.35)
    gx = cv2.Sobel(h, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(h, cv2.CV_32F, 0, 1, ksize=3)
    # Light from upper-left
    ndot = (-0.55 * gx + -0.65 * gy + 0.85)
    ndot = ndot / (np.sqrt(gx * gx + gy * gy + 1.0) + 1e-5)
    shade = np.clip(0.55 + 0.70 * ndot, 0.28, 1.35)

    face = np.array(colors["face"], dtype=np.float32)
    bright = np.array(colors["bright"], dtype=np.float32)
    shadow_c = np.array(colors["shadow"], dtype=np.float32)
    # Mix face toward bright/shadow by shade
    lit = np.where(
        shade[..., None] >= 1.0,
        face + (bright - face) * np.clip(shade - 1.0, 0, 1)[..., None] * 1.4,
        face * shade[..., None] + shadow_c * (1.0 - shade)[..., None] * 0.25,
    )
    # Micro grain from plate so the glyph isn’t flat plastic
    plate_rgb = np.array(plate.convert("RGB"), dtype=np.float32)
    grain = plate_rgb - cv2.GaussianBlur(plate_rgb, (0, 0), 4.0)
    lit = lit + grain * 0.45

    glyph_rgba = np.zeros((1024, 1024, 4), dtype=np.float32)
    glyph_rgba[:, :, :3] = np.clip(lit, 0, 255)
    glyph_rgba[:, :, 3] = a_np.astype(np.float32)

    # Tight contact shadow (cast metal), not a soft halo
    shadow = Image.new("RGBA", (1024, 1024), tuple(int(x) for x in shadow_c) + (0,))
    shadow.putalpha(alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.4))
    shadow = ImageChops.offset(shadow, 9, 12)
    sh_a = shadow.split()[3].point(lambda p: int(p * 0.78))
    shadow.putalpha(sh_a)

    out = plate.convert("RGBA")
    out = Image.alpha_composite(out, shadow)
    out = Image.alpha_composite(out, Image.fromarray(np.clip(glyph_rgba, 0, 255).astype(np.uint8), "RGBA"))
    return out


def build_theme(theme: str) -> None:
    src = ROOT / "assets" / "ui" / theme / DONOR
    if not src.is_file():
        src = ROOT / "public" / "ui" / theme / DONOR
    donor = Image.open(src)
    colors = sample_theme_colors(src)
    plate = clear_donor_glyph(donor)
    out = composite_emboss(plate, colors)
    out = graft_rim(out, donor)
    for out_dir in (ROOT / "assets" / "ui" / theme, ROOT / "public" / "ui" / theme):
        out_dir.mkdir(parents=True, exist_ok=True)
        out.save(out_dir / "badge-zhe.png", optimize=True)
    print(f"[badge-zhe] {theme} donor={DONOR} colors={colors}")


def main() -> None:
    for theme in ("silver", "bronze"):
        build_theme(theme)


if __name__ == "__main__":
    main()
