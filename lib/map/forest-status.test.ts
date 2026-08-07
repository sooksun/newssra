import assert from "node:assert/strict";
import test from "node:test";
import {
  computeForestStatusLayer,
  distanceToForestCoverM,
  forestPctInRadius,
  forestStatusCellKey,
  forestStatusCellKeysAround,
  parseForestStatusDoc,
  pointInForestCover,
  squareRingLngLat,
  type ForestStatusDoc,
} from "./forest-status";

function docAround(lat: number, lng: number, halfDeg: number, typeLabelTh = "ป่าดิบเขา"): ForestStatusDoc {
  return {
    attribution: "test",
    dataSource: "fixture",
    yearBe: 2568,
    authority: "rfd-forest-cover",
    gridResolutionM: 30,
    features: [
      {
        rings: [squareRingLngLat(lat, lng, halfDeg)],
        typeCode: "hill_evergreen",
        typeLabelTh,
      },
    ],
  };
}

test("parseForestStatusDoc รับ rings [lng,lat] และ yearBe", () => {
  const parsed = parseForestStatusDoc({
    yearBe: 2568,
    attribution: "กรมป่าไม้",
    dataSource: "RFD",
    features: [{ rings: [squareRingLngLat(18.8, 98.9, 0.05)], typeLabelTh: "ป่าดิบเขา" }],
  });
  assert.ok(parsed);
  assert.equal(parsed!.yearBe, 2568);
  assert.equal(parsed!.features.length, 1);
});

test("parse ปฏิเสธ year / features ว่าง", () => {
  assert.equal(parseForestStatusDoc({ yearBe: 2024, features: [] }), null);
  assert.equal(parseForestStatusDoc({ yearBe: 2568, features: [] }), null);
});

test("pointInForestCover + distance 0 เมื่ออยู่กลาง polygon", () => {
  const d = docAround(18.8, 98.9, 0.05);
  assert.equal(pointInForestCover(18.8, 98.9, d.features), true);
  assert.equal(distanceToForestCoverM(18.8, 98.9, d.features), 0);
});

test("จุดนอก polygon ระยะ > 0", () => {
  const d = docAround(18.8, 98.9, 0.01);
  const dist = distanceToForestCoverM(18.8, 99.05, d.features);
  assert.ok(dist > 1000, `expected far got ${dist}`);
});

test("forestPctInRadius: ทั้งวงอยู่ในป่า → ใกล้ 100%", () => {
  // halfSize 0.2° ~ 22 กม. >> 5 กม.
  const d = docAround(18.8, 98.9, 0.2);
  const pct = forestPctInRadius(18.8, 98.9, 1000, d.features);
  assert.ok(pct >= 95, `pct=${pct}`);
});

test("forestPctInRadius: ไม่มีป่าในรัศมี → 0", () => {
  const d = docAround(18.8, 98.9, 0.005);
  const pct = forestPctInRadius(19.5, 99.5, 1000, d.features);
  assert.equal(pct, 0);
});

test("computeForestStatusLayer เติม inside + pct 1/3/5 + authority rfd", () => {
  const layer = computeForestStatusLayer(18.8, 98.9, docAround(18.8, 98.9, 0.15));
  assert.ok(layer);
  assert.equal(layer!.inside, 1);
  assert.equal(layer!.distanceM, 0);
  assert.ok((layer!.pct1km ?? 0) >= 90);
  assert.ok((layer!.pct3km ?? 0) >= 90);
  assert.ok((layer!.pct5km ?? 0) >= 90);
  assert.equal(layer!.authority, "rfd-forest-cover");
  assert.equal(layer!.yearBe, 2568);
});

test("forestStatusCellKey ปัด 0.5°", () => {
  assert.equal(forestStatusCellKey(18.8, 98.9), "18.5_98.5");
  assert.equal(forestStatusCellKey(18.0, 99.0), "18.0_99.0");
});

test("forestStatusCellKeysAround คืนอย่างน้อย 1 key", () => {
  const keys = forestStatusCellKeysAround(18.8, 98.9, 5000);
  assert.ok(keys.includes("18.5_98.5"));
  assert.ok(keys.length >= 1);
});

// ── "ไม่มีป่าสงวนแถวนี้" ต้องแยกจาก "ยังไม่ได้ติดตั้งข้อมูล" ───────────────────
// ชุดข้อมูลป่าสงวนติดตั้งครบทั้งประเทศแล้ว ดังนั้นการที่ไม่มี polygon ในรัศมี = คำตอบจริง
// (โรงเรียนนี้ไม่ได้อยู่ในหรือชิดป่าสงวน) ไม่ใช่ข้อมูลขาด — ถ้าตอบ "ไม่ทราบ" จะทิ้งสัญญาณที่ใช้คัดกรองได้

test("ไม่มี polygon แต่ยืนยันความครอบคลุมแล้ว → ตอบว่าไม่อยู่ในป่า (ไม่ใช่ไม่ทราบ)", () => {
  const layer = computeForestStatusLayer(13.7563, 100.5018, {
    attribution: "กรมป่าไม้",
    dataSource: "RFD NRF",
    yearBe: 2562,
    authority: "rfd-national-reserved-forest",
    coverageConfirmed: true,
    features: [],
  });
  assert.ok(layer, "ต้องได้ชั้นข้อมูล ไม่ใช่ null");
  assert.equal(layer!.inside, 0);
  assert.equal(layer!.pct1km, 0);
  assert.equal(layer!.pct3km, 0);
  assert.equal(layer!.pct5km, 0);
  assert.equal(layer!.distanceM, null, "ไกลเกินขอบเขตที่โหลด — ไม่ใช่ 0");
});

test("ไม่มี polygon และยังไม่ยืนยันความครอบคลุม → ต้องตอบว่าไม่ทราบ (null)", () => {
  const layer = computeForestStatusLayer(13.7563, 100.5018, {
    attribution: "กรมป่าไม้",
    dataSource: "RFD NRF",
    yearBe: 2562,
    authority: "rfd-national-reserved-forest",
    features: [],
  });
  assert.equal(layer, null);
});

test("parseForestStatusDoc อ่าน coverageConfirmed และไม่ยอมรับค่าที่ไม่ใช่ boolean", () => {
  const square = [
    [
      [98.9, 18.8],
      [99.0, 18.8],
      [99.0, 18.9],
      [98.9, 18.9],
      [98.9, 18.8],
    ],
  ];
  const base = {
    attribution: "ก",
    dataSource: "ข",
    yearBe: 2562,
    authority: "rfd-national-reserved-forest",
    features: [{ rings: square }],
  };
  assert.equal(parseForestStatusDoc({ ...base, coverageConfirmed: true })?.coverageConfirmed, true);
  assert.equal(parseForestStatusDoc({ ...base, coverageConfirmed: "yes" })?.coverageConfirmed, undefined);
});

test("ไฟล์ cell ที่ไม่มี polygon เลย ยังต้องถูกปฏิเสธ (ไฟล์เปล่าไม่ใช่หลักฐานว่าไม่มีป่า)", () => {
  const empty = parseForestStatusDoc({
    attribution: "ก",
    dataSource: "ข",
    yearBe: 2562,
    authority: "rfd-national-reserved-forest",
    coverageConfirmed: true,
    features: [],
  });
  assert.equal(empty, null);
});
