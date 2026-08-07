import assert from "node:assert/strict";
import test from "node:test";
import {
  FOREST_NEAR_M,
  FOREST_ZONE_KINDS,
  boundingBox,
  classifyForestOverlay,
  classifyForestZoneKind,
  cleanForestOverlay,
  distancePointToRingM,
  isForestOrProtectedElement,
  overpassForestQuery,
  parseOverpassForestBoundaries,
  type ForestBoundary,
} from "./forestBoundaries";

/** วงสี่เหลี่ยมปิด ~size° รอบ (lat,lng) เป็น geometry Overpass */
function squareGeometry(lat: number, lng: number, size = 0.01) {
  return [
    { lat: lat - size, lon: lng - size },
    { lat: lat - size, lon: lng + size },
    { lat: lat + size, lon: lng + size },
    { lat: lat + size, lon: lng - size },
    { lat: lat - size, lon: lng - size },
  ];
}

function protectedRelation(name: string, lat: number, lng: number, size = 0.01) {
  return {
    type: "relation",
    id: 1,
    tags: { name, boundary: "protected_area", protect_class: "2" },
    members: [{ type: "way", ref: 11, role: "outer", geometry: squareGeometry(lat, lng, size) }],
  };
}

function ringFromSquare(lat: number, lng: number, size = 0.01): [number, number][] {
  // [lng, lat]
  return [
    [lng - size, lat - size],
    [lng + size, lat - size],
    [lng + size, lat + size],
    [lng - size, lat + size],
    [lng - size, lat - size],
  ];
}

test("classifyForestZoneKind จากชื่อไทย — ประเภทหลัก + อื่น ๆ", () => {
  assert.equal(classifyForestZoneKind("อุทยานแห่งชาติดอยอินทนนท์"), "national_park");
  assert.equal(classifyForestZoneKind("เขตรักษาพันธุ์สัตว์ป่าห้วยขาแข้ง"), "wildlife_sanctuary");
  assert.equal(classifyForestZoneKind("เขตห้ามล่าสัตว์ป่า..."), "non_hunting");
  assert.equal(classifyForestZoneKind("ป่าสงวนแห่งชาติแม่ปาย"), "national_reserved_forest");
  assert.equal(classifyForestZoneKind("วนอุทยานแห่งหนึ่ง"), "forest_park");
  assert.equal(classifyForestZoneKind("สวนพฤกษศาสตร์สมเด็จพระนางเจ้าสิริกิติ์"), "botanical_garden");
  assert.equal(classifyForestZoneKind("สวนรุกขชาติแม่ฟ้าหลวง"), "arboretum");
  assert.equal(classifyForestZoneKind("ป่าชุมชนบ้านแม่แมะ"), "community_forest");
  assert.equal(classifyForestZoneKind("ป่าชายเลนสิรินาถ"), "mangrove_forest");
  assert.equal(classifyForestZoneKind("เขตสงวนชีวมณฑลแม่สา-งาว"), "biosphere_reserve");
  assert.equal(classifyForestZoneKind("พื้นที่ชุ่มน้ำแรมซาร์บึงบอระเพ็ด"), "wetland_protected");
  assert.equal(classifyForestZoneKind("ลุ่มน้ำชั้น 1A แม่ปิง"), "watershed_protected");
  assert.equal(classifyForestZoneKind("เขตอนุรักษ์พันธุ์พืช"), "other_protected");
  assert.equal(classifyForestZoneKind("Doi Inthanon National Park"), "national_park");
  assert.equal(classifyForestZoneKind("Huai Kha Khaeng Wildlife Sanctuary"), "wildlife_sanctuary");
});

test("isForestOrProtectedElement: way ชื่อคล้ายป่าแต่ไม่มีแท็กพื้นที่ → ปฏิเสธ", () => {
  assert.equal(isForestOrProtectedElement({}, "ทางหลวงสายป่าสงวนแห่งชาติ", "way"), false);
  assert.equal(isForestOrProtectedElement({ landuse: "forest" }, "ป่าชุมชนบ้าน dummy", "way"), true);
  assert.equal(isForestOrProtectedElement({}, "ป่าสงวนแห่งชาติแม่ปาย", "relation"), true);
});

test("FOREST_ZONE_KINDS ครอบคลุมชนิดไทยทั้งหมด + overpass ดึงชื่อประเภทเพิ่ม", () => {
  assert.ok(FOREST_ZONE_KINDS.includes("forest_park"));
  assert.ok(FOREST_ZONE_KINDS.includes("community_forest"));
  assert.ok(FOREST_ZONE_KINDS.includes("mangrove_forest"));
  assert.ok(FOREST_ZONE_KINDS.includes("watershed_protected"));
  const q = overpassForestQuery(18.8, 98.9, 15_000);
  assert.match(q, /วนอุทยาน|ป่าชุมชน|ป่าชายเลน/);
  assert.match(q, /landuse"="forest"/);
  assert.match(q, /natural"="mangrove"/);
});

test("parseOverpassForestBoundaries แปลง relation ที่มี outer geom", () => {
  const parsed = parseOverpassForestBoundaries({
    elements: [protectedRelation("อุทยานแห่งชาติดอยสุเทพ-ปุย", 18.8, 98.9)],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "อุทยานแห่งชาติดอยสุเทพ-ปุย");
  assert.equal(parsed[0].kind, "national_park");
  assert.ok(parsed[0].rings[0].length >= 4);
});

test("parse รับ relation ชื่อป่าสงวน/ป่าชุมชน แม้ไม่มี protect_class", () => {
  const parsed = parseOverpassForestBoundaries({
    elements: [
      {
        type: "relation",
        id: 2,
        tags: { name: "ป่าสงวนแห่งชาติแม่ปาย", type: "boundary" },
        members: [{ type: "way", role: "outer", geometry: squareGeometry(19.3, 98.4) }],
      },
      {
        type: "relation",
        id: 3,
        tags: { name: "ป่าชุมชนบ้านแม่แมะ" },
        members: [{ type: "way", role: "outer", geometry: squareGeometry(19.2, 98.5) }],
      },
      {
        type: "way",
        id: 4,
        tags: { name: "ป่าชายเลนตัวอย่าง", natural: "mangrove" },
        geometry: squareGeometry(8.5, 98.3),
      },
    ],
  });
  assert.equal(parsed.length, 3);
  assert.equal(parsed.find((p) => p.name.includes("แม่ปาย"))?.kind, "national_reserved_forest");
  assert.equal(parsed.find((p) => p.name.includes("แม่แมะ"))?.kind, "community_forest");
  assert.equal(parsed.find((p) => p.name.includes("ชายเลน"))?.kind, "mangrove_forest");
});

test("parse ทิ้งรายการที่ไม่มีชื่อหรือไม่ใช่ protected", () => {
  const parsed = parseOverpassForestBoundaries({
    elements: [
      {
        type: "relation",
        tags: { boundary: "administrative", name: "อำเภอเมือง" },
        members: [{ type: "way", role: "outer", geometry: squareGeometry(18, 99) }],
      },
      {
        type: "relation",
        tags: { boundary: "protected_area" },
        members: [{ type: "way", role: "outer", geometry: squareGeometry(18, 99) }],
      },
    ],
  });
  assert.equal(parsed.length, 0);
});

test("จุดใน polygon → status in, distance 0", () => {
  const zones: ForestBoundary[] = [
    {
      name: "ป่าทดสอบ",
      kind: "national_park",
      rings: [ringFromSquare(18.8, 98.9, 0.05)],
      labelLat: 18.8,
      labelLng: 98.9,
    },
  ];
  const result = classifyForestOverlay(18.8, 98.9, zones, {
    loaded: true,
    calculatedAt: "2026-08-07T00:00:00.000Z",
  });
  assert.equal(result.status, "in");
  assert.equal(result.nearestDistanceM, 0);
  assert.equal(result.zones[0]?.relation, "in");
});

test("จุดนอก polygon ระยะ ≤ FOREST_NEAR_M → near; เกิน → out", () => {
  // ขอบตะวันออกของสี่เหลี่ยมอยู่ที่ lng+0.01 ≈ 1.11 กม. ที่ lat 0; ใช้ size เล็กและจุดใกล้ขอบ
  const centerLat = 18.8;
  const centerLng = 98.9;
  const size = 0.005; // ~550 ม.
  const zones: ForestBoundary[] = [
    {
      name: "ป่าขอบ",
      kind: "national_reserved_forest",
      rings: [ringFromSquare(centerLat, centerLng, size)],
      labelLat: centerLat,
      labelLng: centerLng,
    },
  ];

  // จุดนอกขอบตะวันออกเล็กน้อย (~200 ม.)
  const nearLng = centerLng + size + 0.0015;
  const near = classifyForestOverlay(centerLat, nearLng, zones, { loaded: true, calculatedAt: "t" });
  assert.equal(near.status, "near");
  assert.ok(near.nearestDistanceM !== null && near.nearestDistanceM <= FOREST_NEAR_M);
  assert.ok(near.nearestDistanceM! > 0);

  // จุดไกล ~5 กม.
  const far = classifyForestOverlay(centerLat, centerLng + 0.05, zones, { loaded: true, calculatedAt: "t" });
  assert.equal(far.status, "out");
  assert.equal(far.zones.length, 0);
  assert.ok(far.nearestDistanceM !== null && far.nearestDistanceM > FOREST_NEAR_M);
});

test("boundary near: ระยะ ≤ FOREST_NEAR_M → near · เกิน → out (ผ่าน classify)", () => {
  // สี่เหลี่ยมเล็ก — วัดจากขอบจริงด้วย classify + ระยะที่คำนวณได้
  const centerLat = 15;
  const centerLng = 100;
  const size = 0.002; // ~220 ม.
  const zones: ForestBoundary[] = [
    {
      name: "ป่าขอบเกณฑ์",
      kind: "national_park",
      rings: [ringFromSquare(centerLat, centerLng, size)],
      labelLat: centerLat,
      labelLng: centerLng,
    },
  ];
  const mPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const edgeLng = centerLng + size;

  const nearLng = edgeLng + (FOREST_NEAR_M - 50) / mPerDegLng;
  const near = classifyForestOverlay(centerLat, nearLng, zones, { loaded: true, calculatedAt: "t" });
  assert.equal(near.status, "near", `expected near got ${near.status} d=${near.nearestDistanceM}`);

  const farLng = edgeLng + (FOREST_NEAR_M + 50) / mPerDegLng;
  const far = classifyForestOverlay(centerLat, farLng, zones, { loaded: true, calculatedAt: "t" });
  assert.equal(far.status, "out", `expected out got ${far.status} d=${far.nearestDistanceM}`);

  // จุดบนขอบด้านนอกใกล้ ๆ ต้องห่างน้อยกว่าจุดไกล
  assert.ok(
    (near.nearestDistanceM ?? 0) < (far.nearestDistanceM ?? 0),
    `near ${near.nearestDistanceM} should be < far ${far.nearestDistanceM}`,
  );
  assert.ok(distancePointToRingM(centerLat, centerLng, zones[0].rings[0]) === 0);
});

test("zones ว่าง + loaded → unknown (ห้าม out ทั้งประเทศ)", () => {
  const r = classifyForestOverlay(18, 99, [], { loaded: true, calculatedAt: "t" });
  assert.equal(r.status, "unknown");
});

test("loaded=false → unknown", () => {
  const r = classifyForestOverlay(18, 99, [], { loaded: false, calculatedAt: "t" });
  assert.equal(r.status, "unknown");
});

test("multi-zone: ทับสองเขต เรียง distance", () => {
  const zones: ForestBoundary[] = [
    {
      name: "ป่า A",
      kind: "national_park",
      rings: [ringFromSquare(18.8, 98.9, 0.05)],
      labelLat: 18.8,
      labelLng: 98.9,
    },
    {
      name: "ป่า B",
      kind: "wildlife_sanctuary",
      rings: [ringFromSquare(18.8, 98.9, 0.08)],
      labelLat: 18.8,
      labelLng: 98.9,
    },
  ];
  const r = classifyForestOverlay(18.8, 98.9, zones, { loaded: true, calculatedAt: "t" });
  assert.equal(r.status, "in");
  assert.equal(r.zones.length, 2);
  assert.ok(r.zones.every((z) => z.relation === "in"));
});

test("cleanForestOverlay clamp + ทิ้ง status แปลก", () => {
  assert.equal(cleanForestOverlay(null), undefined);
  assert.equal(cleanForestOverlay({ status: "maybe" }), undefined);
  const ok = cleanForestOverlay({
    status: "in",
    nearestDistanceM: 0,
    zones: [{ name: "อุทยานทดสอบ", kind: "national_park", relation: "in", distanceM: 0 }],
    dataAuthority: "osm-reference",
    dataSource: "x",
    attribution: "© OSM",
    calculatedAt: "2026-08-07T00:00:00.000Z",
    version: "fo-1",
  });
  assert.ok(ok);
  assert.equal(ok!.status, "in");
  assert.equal(ok!.zones.length, 1);
  assert.equal(ok!.dataAuthority, "osm-reference");
});

test("overpassForestQuery มี protected_area ใน bbox", () => {
  const q = overpassForestQuery(18.8, 98.9, 15_000);
  assert.match(q, /protected_area/);
  assert.match(q, /out geom/);
  const [s, w, n, e] = boundingBox(18.8, 98.9, 15_000);
  assert.ok(s < 18.8 && n > 18.8 && w < 98.9 && e > 98.9);
});
