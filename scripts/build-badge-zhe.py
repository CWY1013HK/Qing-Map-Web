#!/usr/bin/env python3
"""
Build 折 toolbar badges — same cast plate as 遠 (badge-yuan.png), 楷書 glyph.

Uses Kaiti TC Bold when available, else bundled LXGW WenKai Lite (site --font-kaiti).

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
    bright_c = tuple(int(x) for x in np.median(im[bright][:, :3], axis=0)) if bright.any() else (210, 210, 210)
    shadow_c = tuple(int(x) for x in np.median(im[shadow][:, :3], axis=0)) if shadow.any() else (50, 50, 50)
    face_c = tuple(int(round((b + s) / 2)) for b, s in zip(bright_c, shadow_c, strict=True))
    return {"bright": bright_c, "shadow": shadow_c, "face": face_c}


def donor_glyph_mask(rgba: np.ndarray, _blurred: np.ndarray) -> np.ndarray:
    """Only the raised 遠 glyph — leave the cast plate grain intact."""
    r, g, b, a = [rgba[:, :, i].astype(np.float32) for i in range(4)]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    yy, xx = np.ogrid[: rgba.shape[0], : rgba.shape[1]]
    dist = np.sqrt((xx - 512) ** 2 + (yy - 512) ** 2)
    center = dist < 408
    embossed = center & (a > 100) & ((lum > 168) | (lum < 72))
    kernel = np.ones((5, 5), np.uint8)
    return cv2.dilate(embossed.astype(np.uint8), kernel, iterations=1) > 0


def clear_donor_glyph(plate: Image.Image) -> Image.Image:
    a = np.array(plate.convert("RGBA"))
    rgb = a[:, :, :3].astype(np.float32)
    blurred = cv2.GaussianBlur(rgb, (0, 0), 42)
    mask = donor_glyph_mask(a, blurred)
    a[mask, :3] = blurred[mask].astype(np.uint8)
    return Image.fromarray(a)


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
    glyph = render_glyph_mask(GLYPH_SIZE)
    alpha = glyph.split()[3]

    shadow = Image.new("RGBA", (1024, 1024), colors["shadow"] + (0,))
    shadow.putalpha(alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.5))
    shadow = ImageChops.offset(shadow, 13, 17)

    bright = Image.new("RGBA", (1024, 1024), colors["bright"] + (0,))
    bright.putalpha(alpha)

    highlight = ImageChops.offset(bright, -4, -5)
    hi_a = highlight.split()[3].point(lambda p: int(p * 0.42))
    highlight.putalpha(hi_a)

    # Strong stack so 遠 does not ghost through the 折 face.
    cover = Image.new("RGBA", (1024, 1024), colors["bright"] + (0,))
    cover_a = alpha.point(lambda p: min(255, int(p * 1.12)))
    cover.putalpha(cover_a)

    out = plate.convert("RGBA")
    for layer in (shadow, cover, bright, bright, highlight):
        out = Image.alpha_composite(out, layer)
    return out


def build_theme(theme: str) -> None:
    src = ROOT / "assets" / "ui" / theme / DONOR
    if not src.is_file():
        src = ROOT / "public" / "ui" / theme / DONOR
    colors = sample_theme_colors(src)
    plate = clear_donor_glyph(Image.open(src))
    out = composite_emboss(plate, colors)
    for out_dir in (ROOT / "assets" / "ui" / theme, ROOT / "public" / "ui" / theme):
        out_dir.mkdir(parents=True, exist_ok=True)
        out.save(out_dir / "badge-zhe.png", optimize=True)
    print(f"[badge-zhe] {theme} donor={DONOR} colors={colors}")


def main() -> None:
    for theme in ("silver", "bronze"):
        build_theme(theme)


if __name__ == "__main__":
    main()
