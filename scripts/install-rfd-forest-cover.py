#!/usr/bin/env python3
"""แปลงชั้นสภาพพื้นที่ป่าไม้ของกรมป่าไม้ (UTM 47N) → data/forest-status/cells-cover/*.json

ชุดข้อมูล: ข้อมูลสภาพพื้นที่ป่าไม้ ปี 2562 (data.go.th/dataset/forestarea_2562_wgs84)
สัญญาอนุญาต: Creative Commons Attribution — ต้องแสดง attribution ทุกครั้งที่ใช้

⚠️ ชื่อไฟล์ลงท้าย _wgs84 แต่ .prj จริงคือ UTM Zone 47N (EPSG:32647) หน่วยเมตร
   อ่านเป็น lat/lng ตรง ๆ จะเพี้ยนทั้งชุด — ต้องแปลงพิกัดเสมอ

⚠️ ชุดนี้มีฟิลด์เดียวคือ f_code (ค่าเดียวทั้งชุด = พื้นที่ป่า) ไม่มีชนิดป่า
   metadata .shp.xml ของ data.go.th ระบุ ftype_thai/ftype_code ไว้ แต่ไฟล์จริงไม่มี
   จึงห้ามกรอกชนิดป่าเอง — ชั้นชนิดป่า (ชั้น 2 ในสเปก) ยังต้องรอชุดข้อมูลอื่น

เก็บแยกโฟลเดอร์จากชั้นแนวเขตป่าสงวน (cells/) เพราะเป็นคนละความหมาย:
ชั้นนี้ = "ตอนนี้เป็นป่าจริงไหม" ส่วนป่าสงวน = "อยู่ในเขตประกาศตามกฎหมายไหม"
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import shapefile
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHP = ROOT / "data" / "forest-status" / "_download" / "cover2562" / "forestarea_2562_wgs84"
OUT_DIR = ROOT / "data" / "forest-status" / "cells-cover"
MANIFEST = ROOT / "data" / "forest-status" / "manifest.json"

YEAR_BE = 2562
AUTHORITY = "rfd-forest-cover"
LAYER_ROLE = "forest-cover"
DATA_SOURCE = "กรมป่าไม้ — ข้อมูลสภาพพื้นที่ป่าไม้ ปี 2562 (forestarea_2562_wgs84, data.go.th)"
ATTRIBUTION = (
    "กรมป่าไม้ — ข้อมูลสภาพพื้นที่ป่าไม้ ปี พ.ศ. 2562 (data.go.th, Creative Commons Attribution). "
    "เป็นสภาพพื้นที่ป่า ณ ปีชั้นข้อมูล ไม่ใช่แนวเขตตามกฎหมาย และไม่ใช่เอกสารรับรองแนวเขต"
)

# ความละเอียดที่พอสำหรับงานนี้: กริดวิเคราะห์ของแอปละเอียด ~70 ม. อยู่แล้ว
# จึงลดจุดที่ห่างกันน้อยกว่า ~44 ม. ได้โดยไม่กระทบผลวัด % ป่าในรัศมี 1/3/5 กม.
DEFAULT_SIMPLIFY_DEG = 0.0004
# polygon เล็กกว่านี้รวมกันเป็นเพียง 0.04% ของพื้นที่ป่าทั้งประเทศ (วัดจากฟิลด์ km2 ของชุดจริง)
DEFAULT_MIN_KM2 = 0.01


def simplify_ring(pts: list[list[float]], min_step: float) -> list[list[float]]:
    """ลดจุดที่อยู่ชิดกันเกินกว่าที่ความละเอียดปลายทางต้องการ — คงจุดแรก/สุดท้ายและปิดวงเสมอ"""
    if len(pts) <= 5:
        return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        prev = out[-1]
        if abs(p[0] - prev[0]) + abs(p[1] - prev[1]) >= min_step:
            out.append(p)
    out.append(pts[-1])
    if len(out) < 4:
        step = max(1, len(pts) // 200)
        out = pts[::step]
        if out[-1] != pts[-1]:
            out.append(pts[-1])
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def cell_key(lat: float, lng: float, step: float = 0.5) -> str:
    lat_c = math.floor(lat / step) * step
    lng_c = math.floor(lng / step) * step
    if lat_c == -0.0:
        lat_c = 0.0
    if lng_c == -0.0:
        lng_c = 0.0
    return f"{lat_c:.1f}_{lng_c:.1f}"


def write_manifest(feature_count: int, cell_count: int, kept_km2: float, total_km2: float) -> None:
    """เพิ่ม/แทนที่รายการชุดข้อมูลนี้ใน manifest โดยไม่ลบชุดอื่น (ชั้นป่าสงวนต้องอยู่ต่อ)"""
    data = {"datasets": []}
    if MANIFEST.exists():
        try:
            data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    others = [d for d in data.get("datasets", []) if d.get("authority") != AUTHORITY]
    entry = {
        "authority": AUTHORITY,
        "layerRole": LAYER_ROLE,
        "dir": OUT_DIR.name,
        "yearBe": YEAR_BE,
        "dataSource": DATA_SOURCE,
        "attribution": ATTRIBUTION,
        "featureCount": feature_count,
        "cellCount": cell_count,
        "nationwide": True,
        "installedAt": datetime.now(timezone.utc).isoformat(),
        "note": (
            f"nationwide=true เพราะแปลงจาก shapefile ทั้งประเทศ ({total_km2:,.0f} ตร.กม. "
            f"ตรงกับตัวเลขพื้นที่ป่าทางการ) เก็บไว้ {kept_km2:,.0f} ตร.กม. "
            f"({100 * kept_km2 / total_km2:.2f}%) หลังตัด polygon ขนาดเล็กมาก"
        ),
    }
    MANIFEST.write_text(
        json.dumps({"datasets": others + [entry]}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shp", default=str(DEFAULT_SHP), help="path ของ shapefile (ไม่ต้องใส่นามสกุล)")
    ap.add_argument("--simplify", type=float, default=DEFAULT_SIMPLIFY_DEG)
    ap.add_argument("--min-km2", type=float, default=DEFAULT_MIN_KM2)
    args = ap.parse_args()

    to_wgs = Transformer.from_crs("EPSG:32647", "EPSG:4326", always_xy=True)
    r = shapefile.Reader(args.shp, encodingErrors="replace")
    field_names = [f[0] for f in r.fields[1:]]
    print("features", len(r), "fields", field_names)

    by_cell: dict[str, list[dict]] = {}
    kept = 0
    dropped_small = 0
    dropped_geom = 0
    kept_km2 = 0.0
    total_km2 = 0.0

    for i in range(len(r)):
        props = dict(zip(field_names, r.record(i)))
        km2 = float(props.get("km2") or 0.0)
        total_km2 += km2
        if km2 < args.min_km2:
            dropped_small += 1
            continue

        shape = r.shape(i)
        points = shape.points
        parts = list(shape.parts) + [len(points)]
        rings_ll: list[list[list[float]]] = []
        for pi in range(len(parts) - 1):
            part_pts = points[parts[pi] : parts[pi + 1]]
            if len(part_pts) < 4:
                continue
            ring: list[list[float]] = []
            for x, y in part_pts:
                lng, lat = to_wgs.transform(x, y)
                if not (math.isfinite(lat) and math.isfinite(lng)):
                    continue
                if not (5 <= lat <= 21 and 97 <= lng <= 106):
                    continue
                ring.append([round(lng, 5), round(lat, 5)])
            ring = simplify_ring(ring, args.simplify)
            if len(ring) >= 4:
                rings_ll.append(ring)

        if not rings_ll:
            dropped_geom += 1
            continue

        xs = [p[0] for p in rings_ll[0]]
        ys = [p[1] for p in rings_ll[0]]
        key = cell_key(sum(ys) / len(ys), sum(xs) / len(xs))

        # ไม่มีชนิดป่าในชุดนี้ — ปล่อย null ห้ามเดา
        by_cell.setdefault(key, []).append({"rings": rings_ll, "typeCode": None, "typeLabelTh": None})
        kept += 1
        kept_km2 += km2
        if kept % 5000 == 0:
            print("processed", kept)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.json"):
        old.unlink()

    for key, features in by_cell.items():
        doc = {
            "attribution": ATTRIBUTION,
            "dataSource": DATA_SOURCE,
            "yearBe": YEAR_BE,
            "authority": AUTHORITY,
            "gridResolutionM": None,
            "layerRole": LAYER_ROLE,
            "features": features,
        }
        (OUT_DIR / f"{key}.json").write_text(
            json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    write_manifest(kept, len(by_cell), kept_km2, total_km2)

    sizes = sorted(p.stat().st_size for p in OUT_DIR.glob("*.json"))
    print(f"kept {kept} polygons ({kept_km2:,.0f} of {total_km2:,.0f} km2 = {100 * kept_km2 / total_km2:.2f}%)")
    print("dropped: too small", dropped_small, "| no usable geometry", dropped_geom)
    print(
        "cells",
        len(by_cell),
        "total MB",
        round(sum(sizes) / 1e6, 2),
        "max cell MB",
        round(sizes[-1] / 1e6, 2) if sizes else 0,
    )


if __name__ == "__main__":
    main()
