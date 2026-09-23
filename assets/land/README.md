# Land plate (淨-mode sea underlay)

| File | Use |
|---|---|
| `map-land.webp` | Preview-resolution map with **transparent seas** (land + islands opaque) |
| `sea-binary.png` | Sea mask debug (white = sea) |
| `land-alpha.png` | Feathered land alpha |
| `debug-*.jpg/png` | Visual QA only — not served |

Rebuild after threshold / ROI tweaks:

```bash
npm run build-land-plate
```

Force-opaque source defects (Tsingtao white corner, centre blank) are set in
`scripts/build-land-plate.py` (`FORCE_LAND_BOXES`).

Served copy: `public/land/map-land.webp`.
