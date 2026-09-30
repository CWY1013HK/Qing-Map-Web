#!/usr/bin/env python3
"""Project a modern provincial outline of China onto the Qing map.

Registration (uniform scale, north-up, no rotation):
  - Origin: Xi'an, on the painted 陝西 mark (data/annotations/locations.json).
    The painting labels Shaanxi at its capital, so the province sits around that point.
  - Scale: painted distance from that mark to the Hainan island centroid
    (handi-shibasheng ring) equals the true distance from Xi'an to Hainan.
    Distances and bearings from Shaanxi are azimuthal-equidistant, so the
    overlay is actual geography and the mismatch with the painting is the distortion.

Source: Aliyun DataV 100000_full (provincial boundaries). The nine-dash
feature (100000_JD) is omitted — it is not a coastline, and it is not in
the reference plate.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEOJSON = Path("/tmp/geo/china-full.json")
HANDI = ROOT / "data" / "overlays" / "handi-shibasheng.json"
OUT = ROOT / "data" / "overlays" / "xiandai-zhongguo.json"

# Full scan (assets/tiles/map.dzi). Normalized coords only need the aspect.
MAP_W = 18438
MAP_H = 10516

# Painted 陝西, marked near 西安 / 長安. data/annotations/locations.json
SHAANXI_MAP = (0.4795, 0.37258)
# Xi'an (city seat the painting marks as 陝西).
XIAN = (34.3416, 108.9398)  # lat, lon

# Quantize lon/lat so shared provincial borders stay coincident.
GRID_DEG = 0.02
# Douglas–Peucker tolerance in image pixels (full scan).
DP_PX = 7.0
# Drop islets smaller than this. Keeps Hainan, Taiwan, Hong Kong, and large
# mainland provinces; skips Dongsha / Macau-sized specks.
MIN_AREA_KM2 = 2500.0
# Paracels / Spratlys sit well south of Hainan island (~18.1°N).
MIN_LAT = 17.6
SKIP_NAME_SUBSTR = ("澳門", "澳门")
KEEP_ISLAND_SUBSTR = ("海南", "台灣", "台湾", "香港")

EARTH_R = 6_371_008.8


def aeqd(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    """Azimuthal equidistant: east, north in metres. True distance and bearing from origin."""
    φ1 = math.radians(lat0)
    λ1 = math.radians(lon0)
    φ = math.radians(lat)
    λ = math.radians(lon)
    dλ = λ - λ1
    cos_c = math.sin(φ1) * math.sin(φ) + math.cos(φ1) * math.cos(φ) * math.cos(dλ)
    cos_c = max(-1.0, min(1.0, cos_c))
    c = math.acos(cos_c)
    if c < 1e-12:
        return 0.0, 0.0
    k = c / math.sin(c)
    east = EARTH_R * k * math.cos(φ) * math.sin(dλ)
    north = EARTH_R * k * (
        math.cos(φ1) * math.sin(φ) - math.sin(φ1) * math.cos(φ) * math.cos(dλ)
    )
    return east, north


def ring_metrics(ring: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Equirectangular shoelace. Returns area km², centroid lon, centroid lat."""
    if len(ring) < 4:
        return 0.0, 0.0, 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    mx = 111_320.0 * math.cos(math.radians(lat0))
    my = 110_574.0
    a = cx = cy = 0.0
    pts = ring[:]
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        cross = (x1 * mx) * (y2 * my) - (x2 * mx) * (y1 * my)
        a += cross
        cx += (x1 * mx + x2 * mx) * cross
        cy += (y1 * my + y2 * my) * cross
    if abs(a) < 1:
        return 0.0, 0.0, 0.0
    area = abs(a) / 2.0 / 1e6
    cx = (cx / (3.0 * a)) / mx
    cy = (cy / (3.0 * a)) / my
    return area, cx, cy


def painted_hainan() -> tuple[float, float]:
    """Area centroid of the southern island ring on the China Proper outline."""
    data = json.loads(HANDI.read_text())
    best = None
    for ring in data["overlays"][0]["rings"]:
        pts = [(p["x"] * MAP_W, p["y"] * MAP_H) for p in ring]
        a = cx = cy = 0.0
        for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
            cross = x1 * y2 - x2 * y1
            a += cross
            cx += (x1 + x2) * cross
            cy += (y1 + y2) * cross
        if abs(a) < 1:
            continue
        cx /= 3.0 * a
        cy /= 3.0 * a
        xn, yn = cx / MAP_W, cy / MAP_H
        width = max(p["x"] for p in ring) - min(p["x"] for p in ring)
        if yn > 0.78 and width < 0.12:
            best = (xn, yn, abs(a))
    if not best:
        raise SystemExit("Could not find painted Hainan ring")
    print(f"painted Hainan centroid ({best[0]:.5f}, {best[1]:.5f}) area_px={best[2]:.0f}")
    return best[0], best[1]


def qkey(lon: float, lat: float) -> tuple[int, int]:
    return (round(lon / GRID_DEG), round(lat / GRID_DEG))


def key_to_ll(k: tuple[int, int]) -> tuple[float, float]:
    return k[0] * GRID_DEG, k[1] * GRID_DEG


def iter_exteriors(geom: dict):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        if coords:
            yield coords[0]
    elif gtype == "MultiPolygon":
        for poly in coords:
            if poly:
                yield poly[0]


def collect_edges(geo: dict) -> tuple[dict[tuple[int, int], set[tuple[int, int]]], tuple[float, float]]:
    neighbors: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)
    hainan_ll = None
    hainan_area = 0.0
    kept = dropped = 0
    for feat in geo["features"]:
        props = feat.get("properties") or {}
        name = str(props.get("name") or "")
        ad = f"{props.get('adcode') or ''} {props.get('adchar') or ''}"
        if "JD" in name or "JD" in ad:
            print(f"skip {name!r} {ad} (nine-dash)")
            continue
        geom = feat.get("geometry") or {}
        for ring in iter_exteriors(geom):
            ll = [(float(p[0]), float(p[1])) for p in ring]
            area, clon, clat = ring_metrics(ll)
            if any(s in name for s in SKIP_NAME_SUBSTR):
                dropped += 1
                continue
            island_keep = any(s in name for s in KEEP_ISLAND_SUBSTR)
            if (area < MIN_AREA_KM2 and not island_keep) or clat < MIN_LAT:
                dropped += 1
                continue
            kept += 1
            if "海南" in name and area > hainan_area:
                hainan_area = area
                hainan_ll = (clat, clon)
            keys = [qkey(lon, lat) for lon, lat in ll]
            dedup = [keys[0]]
            for k in keys[1:]:
                if k != dedup[-1]:
                    dedup.append(k)
            if len(dedup) >= 2 and dedup[0] == dedup[-1]:
                dedup = dedup[:-1]
            if len(dedup) < 3:
                continue
            for a, b in zip(dedup, dedup[1:] + dedup[:1]):
                if a == b:
                    continue
                neighbors[a].add(b)
                neighbors[b].add(a)
    print(f"polygons kept {kept} dropped {dropped}")
    if not hainan_ll:
        raise SystemExit("Hainan main island not found")
    print(f"Hainan island centroid lat={hainan_ll[0]:.4f} lon={hainan_ll[1]:.4f} area={hainan_area:.0f} km²")
    return neighbors, hainan_ll


def trace_paths(neighbors: dict[tuple[int, int], set[tuple[int, int]]]) -> list[list[tuple[int, int]]]:
    used: set[frozenset[tuple[int, int]]] = set()

    def unused(node: tuple[int, int]) -> list[tuple[int, int]]:
        return [n for n in neighbors[node] if frozenset((node, n)) not in used]

    def walk(start: tuple[int, int], nxt: tuple[int, int]) -> list[tuple[int, int]]:
        path = [start, nxt]
        used.add(frozenset((start, nxt)))
        cur = nxt
        while True:
            nbrs = unused(cur)
            if len(nbrs) != 1:
                break
            n = nbrs[0]
            used.add(frozenset((cur, n)))
            path.append(n)
            cur = n
            if cur == start:
                break
        return path

    paths: list[list[tuple[int, int]]] = []
    junctions = [n for n, nbrs in neighbors.items() if len(nbrs) != 2]
    for s in junctions:
        for n in unused(s):
            path = walk(s, n)
            if len(path) >= 2:
                paths.append(path)
    for s in list(neighbors):
        for n in unused(s):
            path = walk(s, n)
            if len(path) >= 2:
                paths.append(path)
    return paths


def rdp(points: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    denom = math.hypot(dx, dy)
    best_i = 0
    best_d = -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if denom < 1e-9:
            d = math.hypot(px - ax, py - ay)
        else:
            d = abs(dy * px - dx * py + bx * ay - by * ax) / denom
        if d > best_d:
            best_d = d
            best_i = i
    if best_d > tol:
        left = rdp(points[: best_i + 1], tol)
        right = rdp(points[best_i:], tol)
        return left[:-1] + right
    return [points[0], points[-1]]


LABELS_JSON = ROOT / "data" / "overlays" / "province-labels.json"

# Modern-only plates (ids must not collide with Qing 漢地/疆域 labels).
PROVINCE_META = {
    "北京市": ("xiandai-beijing", "北京", 1.15),
    "天津市": ("xiandai-tianjin", "天津", 1.12),
    "河北省": ("xiandai-hebei", "河北", 1.55),
    "山西省": ("xiandai-shanxi", "山西", 1.5),
    "内蒙古自治区": ("xiandai-neimenggu", "內蒙古", 2.2),
    "辽宁省": ("xiandai-liaoning", "遼寧", 1.45),
    "吉林省": ("xiandai-jilin", "吉林", 1.4),
    "黑龙江省": ("xiandai-heilongjiang", "黑龍江", 1.85),
    "上海市": ("xiandai-shanghai", "上海", 1.1),
    "江苏省": ("xiandai-jiangsu", "江蘇", 1.45),
    "浙江省": ("xiandai-zhejiang", "浙江", 1.4),
    "安徽省": ("xiandai-anhui", "安徽", 1.45),
    "福建省": ("xiandai-fujian", "福建", 1.4),
    "江西省": ("xiandai-jiangxi", "江西", 1.45),
    "山东省": ("xiandai-shandong", "山東", 1.55),
    "河南省": ("xiandai-henan", "河南", 1.5),
    "湖北省": ("xiandai-hubei", "湖北", 1.5),
    "湖南省": ("xiandai-hunan", "湖南", 1.5),
    "广东省": ("xiandai-guangdong", "廣東", 1.55),
    "广西壮族自治区": ("xiandai-guangxi", "廣西", 1.5),
    "海南省": ("xiandai-hainan", "海南", 1.2),
    "重庆市": ("xiandai-chongqing", "重慶", 1.25),
    "四川省": ("xiandai-sichuan", "四川", 1.85),
    "贵州省": ("xiandai-guizhou", "貴州", 1.4),
    "云南省": ("xiandai-yunnan", "雲南", 1.7),
    "西藏自治区": ("xiandai-xizang", "西藏", 2.0),
    "陕西省": ("xiandai-shaanxi", "陝西", 1.45),
    "甘肃省": ("xiandai-gansu", "甘肅", 1.6),
    "青海省": ("xiandai-qinghai", "青海", 1.85),
    "宁夏回族自治区": ("xiandai-ningxia", "寧夏", 1.15),
    "新疆维吾尔自治区": ("xiandai-xinjiang", "新疆", 2.25),
    "台湾省": ("xiandai-taiwan", "臺灣", 1.2),
    "香港特别行政区": ("xiandai-hongkong", "香港", 1.05),
}

# Small visual offsets so municipalities don't stack, and 黑龍江 sits on the scan.
LABEL_NUDGE = {
    "xiandai-beijing": (0.0, -0.014),
    "xiandai-tianjin": (0.016, 0.01),
    "xiandai-hebei": (-0.01, 0.02),
    "xiandai-shanghai": (0.01, 0.012),
    "xiandai-heilongjiang": (0.0, 0.095),
    "xiandai-hongkong": (0.008, 0.008),
}


def write_province_labels(geo: dict, project) -> None:
    """Place a Kai-styled name at each province's largest-polygon centroid."""
    labels: list[dict] = []
    for feat in geo["features"]:
        name = str((feat.get("properties") or {}).get("name") or "")
        meta = PROVINCE_META.get(name)
        if not meta:
            continue
        geom = feat.get("geometry") or {}
        best = None
        for ring in iter_exteriors(geom):
            ll = [(float(p[0]), float(p[1])) for p in ring]
            area, clon, clat = ring_metrics(ll)
            if best is None or area > best[0]:
                best = (area, clon, clat)
        if not best or best[0] < 1:
            continue
        _area, clon, clat = best
        px, py = project(clon, clat)
        lid, title, scale = meta
        nx, ny = LABEL_NUDGE.get(lid, (0.0, 0.0))
        labels.append(
            {
                "id": lid,
                "title": title,
                "point": {
                    "x": round(px / MAP_W + nx, 6),
                    "y": round(py / MAP_H + ny, 6),
                },
                "scale": scale,
                "attachments": ["xiandai-zhongguo"],
            }
        )
    labels.sort(key=lambda L: L["id"])

    existing = json.loads(LABELS_JSON.read_text())
    kept = [
        lab
        for lab in existing.get("labels", [])
        if "xiandai-zhongguo" not in lab.get("attachments", [])
        and not str(lab.get("id", "")).startswith("xiandai-")
    ]
    existing["labels"] = kept + labels
    LABELS_JSON.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(labels)} modern province labels → {LABELS_JSON}")


def main() -> None:
    geo = json.loads(GEOJSON.read_text())
    neighbors, hainan_ll = collect_edges(geo)
    paths = trace_paths(neighbors)
    print(f"raw chains {len(paths)} pts {sum(len(p) for p in paths)}")

    hx, hy = painted_hainan()
    sx = SHAANXI_MAP[0] * MAP_W
    sy = SHAANXI_MAP[1] * MAP_H
    painted = math.hypot((hx - SHAANXI_MAP[0]) * MAP_W, (hy - SHAANXI_MAP[1]) * MAP_H)
    east, north = aeqd(hainan_ll[0], hainan_ll[1], XIAN[0], XIAN[1])
    geo_dist = math.hypot(east, north)
    scale = painted / geo_dist  # px per metre
    print(f"painted px {painted:.1f}  geodesic m {geo_dist:.0f}  scale {scale * 1000:.3f} px/km")
    bearing = math.degrees(math.atan2(east, north))
    print(f"true bearing from Xi'an to Hainan {bearing:.2f}° (0=north, +east)")
    painted_east = (hx - SHAANXI_MAP[0]) * MAP_W
    painted_north = -(hy - SHAANXI_MAP[1]) * MAP_H
    pb = math.degrees(math.atan2(painted_east, painted_north))
    print(f"painted bearing {pb:.2f}°  (scale only; north stays up)")

    def project(lon: float, lat: float) -> tuple[float, float]:
        e, n = aeqd(lat, lon, XIAN[0], XIAN[1])
        px = sx + e * scale
        py = sy - n * scale
        return px, py

    rings = []
    for path in paths:
        pix = [project(*key_to_ll(k)) for k in path]
        simple = rdp(pix, DP_PX)
        if len(simple) < 2:
            continue
        ring = [{"x": round(px / MAP_W, 5), "y": round(py / MAP_H, 5)} for px, py in simple]
        dedup = [ring[0]]
        for p in ring[1:]:
            if p != dedup[-1]:
                dedup.append(p)
        if len(dedup) >= 6:
            rings.append(dedup)

    rings.sort(key=lambda r: -len(r))
    total = sum(len(r) for r in rings)
    print(f"chains {len(rings)} pts {total}")

    # Where the projected Hainan centroid lands, for the preview.
    hpx, hpy = project(hainan_ll[1], hainan_ll[0])
    print(f"projected Hainan ({hpx / MAP_W:.5f}, {hpy / MAP_H:.5f})")
    print(f"painted   Hainan ({hx:.5f}, {hy:.5f})")

    collection = {
        "version": 1,
        "mapId": "qing-object-painting",
        "groupId": "xiandai-zhongguo",
        "title": "現代中國",
        "overlays": [
            {
                "id": "xiandai-zhongguo",
                "title": "現代中國",
                "style": "pink-glow",
                "pathMode": "open",
                "rings": rings,
            }
        ],
    }
    OUT.write_text(json.dumps(collection, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")
    write_province_labels(geo, project)


if __name__ == "__main__":
    main()
