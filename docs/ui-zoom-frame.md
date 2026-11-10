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

Dragging the map moves it along the screen, horizontally across the display. It does not slide along the tilted plane of the sheet.

## 5. Upside down is allowed. The back is not.

The in-plane spin has no limit, so the sheet can turn upside down and keep going. Lean (tilt) and turn (yaw) stay inside ±89°, so the back of the sheet never faces the room. Twist two fingers, or Shift-drag the pearl sideways, to spin it in its plane.
