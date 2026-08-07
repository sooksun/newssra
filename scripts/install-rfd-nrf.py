#!/usr/bin/env python3
"""Convert RFD National Reserved Forest shapefile (UTM 47N) → data/forest-status/cells/*.json"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import shapefile
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
EXTRACTED = ROOT / "data" / "forest-status" / "_download" / "extracted"
OUT_DIR = ROOT / "data" / "forest-status" / "cells"


def simplify_ring(pts: list[list[float]], min_step: float = 0.00015) -> list[list[float]]:
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


def main() -> None:
    shps = list(EXTRACTED.rglob("*.shp"))
    if not shps:
        raise SystemExit(f"No .shp under {EXTRACTED}")
    shp = shps[0]
    print("Reading", shp)

    to_wgs = Transformer.from_crs("EPSG:32647", "EPSG:4326", always_xy=True)
    r = shapefile.Reader(str(shp), encodingErrors="replace")
    field_names = [f[0] for f in r.fields[1:]]
    print("features", len(r), "fields", field_names)

    by_cell: dict[str, list[dict]] = {}
    kept = 0
    skipped = 0

    for i in range(len(r)):
        shape = r.shape(i)
        rec = r.record(i)
        props = dict(zip(field_names, rec))
        name = str(props.get("FR_NAME") or props.get("NRF_CODE") or f"NRF-{i}")
        code = str(props.get("NRF_CODE") or "")

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
            ring = simplify_ring(ring)
            if len(ring) >= 4:
                rings_ll.append(ring)

        if not rings_ll:
            skipped += 1
            continue

        xs = [p[0] for p in rings_ll[0]]
        ys = [p[1] for p in rings_ll[0]]
        clng = sum(xs) / len(xs)
        clat = sum(ys) / len(ys)
        key = cell_key(clat, clng)

        feat = {
            "rings": rings_ll,
            "typeCode": "national_reserved_forest",
            "typeLabelTh": f"ป่าสงวนแห่งชาติ {name}".strip(),
            "nrfCode": code,
            "name": name,
        }
        by_cell.setdefault(key, []).append(feat)
        kept += 1
        if kept % 200 == 0:
            print("processed", kept)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.json"):
        old.unlink()

    for key, features in by_cell.items():
        doc = {
            "attribution": (
                "กรมป่าไม้ — แนวเขตป่าสงวนแห่งชาติ (Open Data Common, data.forest.go.th). "
                "เป็นแนวเขตกฎหมายโดยประมาณ ไม่ใช่ชั้นสถานภาพป่าจริง และไม่ใช่เอกสารรับรองแนวเขตทางกฎหมาย"
            ),
            "dataSource": "RFD National Reserved Forest boundary shapefile final_NRF_all_1221 (pack 620108)",
            "yearBe": 2562,
            "authority": "rfd-national-reserved-forest",
            "gridResolutionM": None,
            "layerRole": "legal-reserve-boundary",
            "features": features,
        }
        (OUT_DIR / f"{key}.json").write_text(
            json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    # manifest — คำรับรองว่าติดตั้งครบทั้งประเทศ ซึ่งเป็นเงื่อนไขเดียวที่ทำให้ตัวโหลดแปล
    # "ไม่พบ cell" ว่า "ไม่มีป่าสงวนแถวนั้นจริง" แทน "ข้อมูลยังไม่ครบ" (lib/map/forest-status-load.ts)
    manifest = {
        "datasets": [
            {
                "authority": "rfd-national-reserved-forest",
                "layerRole": "legal-reserve-boundary",
                "yearBe": 2562,
                "dataSource": "RFD National Reserved Forest boundary shapefile final_NRF_all_1221 (pack 620108)",
                "attribution": (
                    "กรมป่าไม้ — แนวเขตป่าสงวนแห่งชาติ (Open Data Common, data.forest.go.th). "
                    "เป็นแนวเขตกฎหมายโดยประมาณ ไม่ใช่ชั้นสถานภาพป่าจริง และไม่ใช่เอกสารรับรองแนวเขตทางกฎหมาย"
                ),
                "featureCount": kept,
                "cellCount": len(by_cell),
                "nationwide": True,
                "installedAt": datetime.now(timezone.utc).isoformat(),
                "note": "nationwide=true เพราะแปลงมาจาก shapefile ป่าสงวนแห่งชาติทั้งชุด (1,221 ป่า)",
            }
        ]
    }
    (OUT_DIR.parent / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    sizes = sorted(p.stat().st_size for p in OUT_DIR.glob("*.json"))
    print("cells", len(by_cell), "features", kept, "skipped", skipped)
    print(
        "cell files",
        len(sizes),
        "total MB",
        round(sum(sizes) / 1e6, 2),
        "max MB",
        round(sizes[-1] / 1e6, 2) if sizes else 0,
    )


if __name__ == "__main__":
    main()
