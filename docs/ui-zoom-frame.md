# UI zoom frame

The ATLab controls (badges, plaques, minimap) sit on a frame around the map. These rules are fixed. Tour subtitles and the skip control sit in a dock centred on the screen (viewport or ATLab wall), not on the map frame.

## 1. Zooming expansion stays on in 2D mode

When rotation is off, the frame is the map’s live rectangle. Zooming in expands that rectangle, and the controls move out with it. Zooming out contracts it, and the controls move in with it. Height and width both follow the flat map.

## 2. Only contract the UI horizontally

When rotation is on, the width follows the sheet. Zooming out, tilt, yaw, and in-plane spin may pull the left and right edges inward, and only inward, so the frame is never wider than the upright frame at that zoom.

The height does not shrink while the sheet is rotated. The top and bottom may move outward when zooming in. They do not move inward when zooming out, and tilt does not shorten the frame. A raised sheet does not drag the controls up with it.

After zooming in has made the width smaller, do not spread that width back out on a later zoom-in step. Zooming out follows the sheet again, width included.

## 3. The controls ease into place

When the frame moves, the controls animate to the new place. They do not snap.

## 4. A drag pans across the screen

Dragging the map moves it along the screen, horizontally across the display. It does not slide along the tilted plane of the sheet. The controls shift sideways with that move. Their top and bottom stay put.

## 5. Upside down is allowed. The back is not.

The flat, in-plane spin has no limit. Dragging the pearl sideways spins the map across 360° and upside down, and it keeps going. This spin also works while 3D rotation is off: the map turns in its own flat plane.

The vertical and lateral axes stay locked. Dragging down leans the sheet (tilt), and Shift-dragging turns it laterally (yaw). Both stop inside ±76.5° — 85% of a right angle — so the sheet stays visible from the sides and the back never faces the room. A two-finger twist on the map also spins it flat.

## 6. Spin around the visible centre

Every rotation turns around the geometric centre of the visible map, not the container’s edge. That centre moves as the map is zoomed and panned, and the pivot moves with it.

## 7. Never cut the painting

A raised or turned sheet keeps painting past the wall’s top and sides. The wall does not cut its edges away. Only the floor seam — the wall’s bottom edge — clips it, so the sheet never paints over the floor. The floor band itself paints over any spill past the seam; nothing else clips.

The transformation box (the OSD container) does not clip either: it is `overflow: visible` while rotated. The wall fits the map height-bound, so the painting’s own top edge sits exactly on the container’s top edge. That edge is left alone — no fade, band, feather, or any other treatment at the map’s top, rotated or not.

## 8. 誌 hotspots ride the sheet; province plates stay upright

誌 location dots and text plates are OSD overlays on the map — they stick to the painted surface and foreshorten with the sheet during tilt, spin, and zoom, the same as the red and yellow ink outlines. They are not projected into wall space.

Province name plates and décor stamps still use the upright wall billboard (`src/viewer/overlayUpright.ts`): they render flat in UI space like the badges, seals, and minimap. Plate centres pin to the on-sheet glyph (`getBoundingClientRect` under the live CSS 3D transform), then step `SHEET_LABEL_NORMAL_OFFSET` along local +Z via `sheetZWallDelta` — same perpendicular hover height at every map anchor, near and far.

Region (area) 誌 labels also stay on the sheet as OSD overlays because they paint a map region.
