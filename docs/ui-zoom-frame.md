# UI zoom frame

The ATLab controls (badges, plaques, minimap, tour skip) sit on a frame around the map. These rules are fixed.

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
