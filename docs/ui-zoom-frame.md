# UI zoom frame

The ATLab controls (badges, plaques, minimap, tour skip) sit on a frame around the map. These two rules are fixed. Do not replace them with a locked home-size rectangle, and do not shrink the frame’s height because the sheet is tilted.

## 1. Zooming expansion stays on in 2D mode

When rotation is off, the frame is the map’s live rectangle. Zooming in expands that rectangle, and the controls move out with it. Zooming out contracts it, and the controls move in with it. Height and width both follow the flat map.

## 2. Only contract the UI horizontally

When rotation is on, start from that same zoomed frame (the upright sheet at the current zoom, as if it were still flat). Tilt and yaw may pull the left and right edges inward, and only inward, so the frame is never wider than the 2D frame.

Do not move the top or the bottom for tilt or yaw. Do not shorten the frame because the sheet is foreshortened. Vertical size still follows zoom in and zoom out.

After zooming in has made that width smaller, do not spread the width back out on a later zoom-in step. Zooming out follows the sheet again, width included.
