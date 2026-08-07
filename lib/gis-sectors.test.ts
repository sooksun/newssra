import assert from "node:assert/strict";
import test from "node:test";
import { GIS_LIMITS } from "./gis";
import {
  cleanSectorConfig,
  cleanSectorElevations,
  deriveSectorMetrics,
  sectorElevationsFromGrid,
  sectorFlagLines,
  sectorFlagVisible,
  SECTOR_RADIUS_M,
  SECTOR_RELIEF_K_M,
} from "./gis-sectors";
import { sectorForBearing } from "./gis-sectors";
import { SECTOR_KEYS } from "./types";
import type { Bbox } from "./map/morphology";
import type { GisSectorElevation } from "./types";

// กริดทดสอบ: 41×41 กว้าง 2,828 ม. (ค่าเดียวกับที่หน้าแผนที่ใช้จริง) → cell ≈ 70.7 ม.
const N = 41;
const WIDTH_M = 2828;
const BBOX: Bbox = { north: 18.01, south: 17.99, west: 98.99, east: 99.01 };

function flatGrid(value: number): Float32Array {
  return new Float32Array(N * N).fill(value);
}

function indexAt(row: number, col: number): number {
  return row * N + col;
}

test("sectorForBearing ตัดขอบ wedge แบบ [ล่าง, บน) — ไม่มี bearing ใดตกสองทิศหรือหลุดทั้งคู่", () => {
  assert.equal(sectorForBearing(0), "N");
  assert.equal(sectorForBearing(22.4), "N");
  assert.equal(sectorForBearing(22.5), "NE"); // ขอบพอดีตกทิศถัดไป
  assert.equal(sectorForBearing(90), "E");
  assert.equal(sectorForBearing(180), "S");
  assert.equal(sectorForBearing(270), "W");
  assert.equal(sectorForBearing(337.5), "N"); // ขอบล่างของ N คือ 337.5 พอดี
  assert.equal(sectorForBearing(337.4), "NW");
  assert.equal(sectorForBearing(-90), "W"); // ค่าติดลบถูก normalize
  assert.equal(sectorForBearing(450), "E"); // เกิน 360 ถูก normalize
});

test("sectorElevationsFromGrid คืนครบ 8 ทิศเสมอ เรียงตามลำดับมาตรฐาน", () => {
  const result = sectorElevationsFromGrid(flatGrid(100), N, WIDTH_M, BBOX, {
    radiusM: SECTOR_RADIUS_M,
    schoolElevationM: 100,
    thresholdM: SECTOR_RELIEF_K_M,
  });
  assert.deepEqual(
    result.map((s) => s.sector),
    [...SECTOR_KEYS],
  );
});

test("หาจุดสูงสุด/ต่ำสุดถูกทิศ — ยอดทางเหนือเข้าทิศ N, แอ่งทางตะวันออกเข้าทิศ E", () => {
  const grid = flatGrid(100);
  const center = (N - 1) / 2;
  grid[indexAt(center - 6, center)] = 480; // row น้อยกว่า center = ทางเหนือ
  grid[indexAt(center, center + 6)] = 12; // col มากกว่า center = ทางตะวันออก

  const result = sectorElevationsFromGrid(grid, N, WIDTH_M, BBOX, {
    radiusM: SECTOR_RADIUS_M,
    schoolElevationM: 100,
    thresholdM: SECTOR_RELIEF_K_M,
  });
  const north = result.find((s) => s.sector === "N") as GisSectorElevation;
  const east = result.find((s) => s.sector === "E") as GisSectorElevation;

  assert.equal(north.highest?.elevationM, 480);
  assert.ok(north.highest && north.highest.lat > BBOX.south, "จุดสูงสุดทิศเหนือต้องอยู่เหนือขอบใต้ของกรอบ");
  assert.equal(east.lowest?.elevationM, 12);
  assert.equal(north.reliefM, 380);
  assert.equal(north.aboveThreshold, true);
});

test("ตัดเซลล์นอกรัศมี — ยอดที่อยู่ไกลกว่ารัศมีไม่ถูกนับ", () => {
  const grid = flatGrid(100);
  const center = (N - 1) / 2;
  // cell ≈ 70.7 ม. → ห่าง 18 เซลล์ ≈ 1,273 ม. เกินรัศมี 1,000 ม.
  grid[indexAt(center - 18, center)] = 2000;

  const result = sectorElevationsFromGrid(grid, N, WIDTH_M, BBOX, {
    radiusM: SECTOR_RADIUS_M,
    schoolElevationM: 100,
    thresholdM: SECTOR_RELIEF_K_M,
  });
  const north = result.find((s) => s.sector === "N") as GisSectorElevation;
  assert.equal(north.highest?.elevationM, 100, "ยอดนอกรัศมีต้องไม่ถูกนับเข้ามา");
});

test("ข้ามเซลล์ NaN — ไม่ถูกตีความเป็น 0 (จะกลายเป็นจุดต่ำสุดปลอม)", () => {
  const grid = flatGrid(100);
  const center = (N - 1) / 2;
  grid[indexAt(center - 3, center)] = Number.NaN;

  const result = sectorElevationsFromGrid(grid, N, WIDTH_M, BBOX, {
    radiusM: SECTOR_RADIUS_M,
    schoolElevationM: 100,
    thresholdM: SECTOR_RELIEF_K_M,
  });
  const north = result.find((s) => s.sector === "N") as GisSectorElevation;
  assert.equal(north.lowest?.elevationM, 100);
  assert.equal(north.reliefM, 0);
});

test("ทิศที่อ่านความสูงไม่ได้เลย → null ทั้งชุด และ aboveThreshold = false", () => {
  const grid = new Float32Array(N * N).fill(Number.NaN);
  const result = sectorElevationsFromGrid(grid, N, WIDTH_M, BBOX, {
    radiusM: SECTOR_RADIUS_M,
    schoolElevationM: 100,
    thresholdM: SECTOR_RELIEF_K_M,
  });
  for (const sector of result) {
    assert.equal(sector.highest, null);
    assert.equal(sector.lowest, null);
    assert.equal(sector.reliefM, null);
    assert.equal(sector.aboveThreshold, false);
  }
});

test("กริดที่ใช้ไม่ได้ (n < 2 หรือความกว้าง ≤ 0) → คืน 8 ทิศว่าง ไม่ throw", () => {
  const result = sectorElevationsFromGrid(new Float32Array(1), 1, WIDTH_M, BBOX, {
    radiusM: SECTOR_RADIUS_M,
    schoolElevationM: null,
    thresholdM: SECTOR_RELIEF_K_M,
  });
  assert.equal(result.length, SECTOR_KEYS.length);
  assert.equal(
    result.every((s) => s.highest === null && s.lowest === null),
    true,
  );
});

test("เกณฑ์ธงวัดจากส่วนต่างกับโรงเรียน ±K — ต่างพอดี ±K ถือว่าถึงเกณฑ์ (เกณฑ์คือ >=)", () => {
  const base: GisSectorElevation[] = [
    {
      sector: "N",
      // +50 พอดี → ปักธง; −50 พอดี → ปักธง (ทั้งสองทางใช้ค่าสัมบูรณ์)
      highest: { lat: 18, lng: 99, elevationM: 150, deltaFromSchoolM: null, meetsThreshold: false },
      lowest: { lat: 18.001, lng: 99.001, elevationM: 50, deltaFromSchoolM: null, meetsThreshold: false },
      reliefM: null,
      aboveThreshold: false,
    },
    {
      sector: "S",
      // ต่าง 49 / 49 → ไม่ถึงเกณฑ์ทั้งคู่ แม้ relief ในทิศจะ 98 ม.
      highest: { lat: 17.99, lng: 99, elevationM: 149, deltaFromSchoolM: null, meetsThreshold: false },
      lowest: { lat: 17.991, lng: 99.001, elevationM: 51, deltaFromSchoolM: null, meetsThreshold: false },
      reliefM: null,
      aboveThreshold: false,
    },
  ];
  const [north, south] = deriveSectorMetrics(base, 100, 50);

  assert.equal(north.highest?.meetsThreshold, true, "+K พอดีต้องถึงเกณฑ์");
  assert.equal(north.lowest?.meetsThreshold, true, "−K พอดีต้องถึงเกณฑ์");
  assert.equal(north.aboveThreshold, true);
  assert.equal(sectorFlagVisible(north.highest), true);
  assert.equal(sectorFlagVisible(north.lowest), true);

  assert.equal(south.highest?.meetsThreshold, false);
  assert.equal(south.lowest?.meetsThreshold, false);
  assert.equal(south.aboveThreshold, false);
  assert.equal(sectorFlagVisible(south.highest), false, "ต่างไม่ถึง ±K ต้องไม่ปักธง");
  assert.equal(sectorFlagVisible(south.lowest), false);
  assert.equal(south.reliefM, 98, "relief ยังคำนวณและเก็บไว้ แม้จะไม่ใช่เกณฑ์ปักธงแล้ว");
});

test("ธงขึ้นทีละจุด — ทิศเดียวอาจปักเฉพาะธงม่วง โดยไม่ปักธงฟ้า", () => {
  const [sector] = deriveSectorMetrics(
    [
      {
        sector: "N",
        highest: { lat: 18, lng: 99, elevationM: 400, deltaFromSchoolM: null, meetsThreshold: false }, // +300
        lowest: { lat: 18.001, lng: 99.001, elevationM: 90, deltaFromSchoolM: null, meetsThreshold: false }, // −10
        reliefM: null,
        aboveThreshold: false,
      },
    ],
    100,
    50,
  );
  assert.equal(sectorFlagVisible(sector.highest), true);
  assert.equal(sectorFlagVisible(sector.lowest), false);
  assert.equal(sector.aboveThreshold, true, "มีธงขึ้นอย่างน้อยหนึ่งอัน");
});

test("ไม่รู้ความสูงโรงเรียน → ยังปักธง (ไม่มีฐานให้ตัดสินว่าต่ำกว่าเกณฑ์)", () => {
  const [sector] = deriveSectorMetrics(
    [
      {
        sector: "N",
        highest: { lat: 18, lng: 99, elevationM: 400, deltaFromSchoolM: null, meetsThreshold: false },
        lowest: { lat: 18.001, lng: 99.001, elevationM: 390, deltaFromSchoolM: null, meetsThreshold: false },
        reliefM: null,
        aboveThreshold: false,
      },
    ],
    null,
    50,
  );
  assert.equal(sector.highest?.meetsThreshold, false);
  assert.equal(sectorFlagVisible(sector.highest), true);
  assert.equal(sectorFlagVisible(sector.lowest), true);
});

test("sectorFlagVisible: จุดที่ไม่มีข้อมูลเลย → ไม่ปักธง", () => {
  assert.equal(sectorFlagVisible(null), false);
});

test("deriveSectorMetrics: ส่วนต่างจากโรงเรียนคิดจากความสูงอ้างอิงที่ส่งเข้ามา (null = ไม่รู้)", () => {
  const base: GisSectorElevation[] = [
    {
      sector: "N",
      highest: { lat: 18, lng: 99, elevationM: 150, deltaFromSchoolM: null, meetsThreshold: false },
      lowest: { lat: 18.001, lng: 99.001, elevationM: 90, deltaFromSchoolM: null, meetsThreshold: false },
      reliefM: null,
      aboveThreshold: false,
    },
  ];
  const [withSchool] = deriveSectorMetrics(base, 120, 50);
  assert.equal(withSchool.highest?.deltaFromSchoolM, 30);
  assert.equal(withSchool.lowest?.deltaFromSchoolM, -30);

  const [withoutSchool] = deriveSectorMetrics(base, null, 50);
  assert.equal(withoutSchool.highest?.deltaFromSchoolM, null);
  assert.equal(withoutSchool.lowest?.deltaFromSchoolM, null);
});

test("cleanSectorElevations ทิ้งจุดที่พิกัด/ความสูงใช้ไม่ได้ และคำนวณค่าที่ derive ได้ใหม่เสมอ", () => {
  const cleaned = cleanSectorElevations(
    [
      {
        sector: "N",
        highest: { lat: 18, lng: 99, elevationM: 300 },
        lowest: { lat: 18.001, lng: 99.001, elevationM: 100 },
        // ค่าปลอมจาก client — ต้องถูกคำนวณทับทั้งหมด
        reliefM: 9999,
        aboveThreshold: false,
      },
      { sector: "E", highest: { lat: 999, lng: 99, elevationM: 300 }, lowest: null },
      { sector: "ไม่ใช่ทิศ", highest: { lat: 18, lng: 99, elevationM: 300 }, lowest: null },
      { sector: "N", highest: { lat: 18, lng: 99, elevationM: 500 }, lowest: null }, // ทิศซ้ำ → ทิ้ง
    ],
    200,
    50,
  );

  assert.equal(cleaned?.length, 2);
  const north = cleaned?.find((s) => s.sector === "N") as GisSectorElevation;
  assert.equal(north.reliefM, 200, "reliefM ต้องมาจากการคำนวณใหม่ ไม่ใช่ค่าที่ client ส่งมา");
  assert.equal(north.aboveThreshold, true);
  assert.equal(north.highest?.deltaFromSchoolM, 100);

  const east = cleaned?.find((s) => s.sector === "E") as GisSectorElevation;
  assert.equal(east.highest, null, "พิกัดนอกช่วงต้องถูกทิ้ง ไม่แทนด้วยค่าอื่น");
  assert.equal(east.reliefM, null);
});

test("cleanSectorElevations คืน undefined เมื่อไม่มีจุดใดใช้ได้ (แถวเก่าจะได้ไม่งอก key)", () => {
  assert.equal(cleanSectorElevations(undefined, null, 50), undefined);
  assert.equal(cleanSectorElevations([], null, 50), undefined);
  assert.equal(cleanSectorElevations([{ sector: "N", highest: null, lowest: null }], null, 50), undefined);
  assert.equal(
    cleanSectorElevations([{ sector: "N", highest: { lat: 18, lng: 99, elevationM: 99999 }, lowest: null }], null, 50),
    undefined,
    "ความสูงนอกช่วงที่ยอมรับต้องถูกทิ้ง",
  );
});

test("ช่วงความสูงที่โมดูลนี้ยอมรับต้องตรงกับ GIS_LIMITS.elevationM เสมอ", () => {
  // ประกาศซ้ำใน gis-sectors.ts เพื่อเลี่ยง import วนกัน — ทดสอบนี้คือสิ่งที่บังคับให้สองค่าตรงกัน
  const justInside = cleanSectorElevations(
    [{ sector: "N", highest: { lat: 18, lng: 99, elevationM: GIS_LIMITS.elevationM.max }, lowest: null }],
    null,
    50,
  );
  const justOutside = cleanSectorElevations(
    [{ sector: "N", highest: { lat: 18, lng: 99, elevationM: GIS_LIMITS.elevationM.max + 1 }, lowest: null }],
    null,
    50,
  );
  assert.equal(justInside?.[0].highest?.elevationM, GIS_LIMITS.elevationM.max);
  assert.equal(justOutside, undefined);

  const lowInside = cleanSectorElevations(
    [{ sector: "N", highest: { lat: 18, lng: 99, elevationM: GIS_LIMITS.elevationM.min }, lowest: null }],
    null,
    50,
  );
  const lowOutside = cleanSectorElevations(
    [{ sector: "N", highest: { lat: 18, lng: 99, elevationM: GIS_LIMITS.elevationM.min - 1 }, lowest: null }],
    null,
    50,
  );
  assert.equal(lowInside?.[0].highest?.elevationM, GIS_LIMITS.elevationM.min);
  assert.equal(lowOutside, undefined);
});

test("cleanSectorConfig: ค่าที่ใช้ไม่ได้ถอยไปใช้ค่าคงที่ปัจจุบัน แต่ค่าที่บันทึกไว้ยังชนะ", () => {
  const stored = cleanSectorConfig({
    radiusM: 750,
    thresholdM: 30,
    schoolElevationM: 412.6,
    schoolElevationSource: "grid-center",
  });
  assert.deepEqual(stored, {
    radiusM: 750,
    thresholdM: 30,
    schoolElevationM: 413,
    schoolElevationSource: "grid-center",
  });

  const broken = cleanSectorConfig({ radiusM: -1, thresholdM: "x", schoolElevationM: 99999 });
  assert.deepEqual(broken, {
    radiusM: SECTOR_RADIUS_M,
    thresholdM: SECTOR_RELIEF_K_M,
    schoolElevationM: null,
    schoolElevationSource: "route-profile",
  });

  assert.equal(cleanSectorConfig(null), undefined);
});

test("sectorFlagLines: ไม่มีส่วนต่าง/ไม่มี relief → ไม่ขึ้นบรรทัดนั้น ไม่แทนด้วย 0", () => {
  assert.deepEqual(
    sectorFlagLines(
      "สูงสุดทิศเหนือ",
      { lat: 18, lng: 99, elevationM: 1240, deltaFromSchoolM: 95, meetsThreshold: true },
      168,
    ),
    ["สูงสุดทิศเหนือ", "1,240 ม. (+95 ม.)", "ต่างในทิศ 168 ม."],
  );
  assert.deepEqual(
    sectorFlagLines(
      "ต่ำสุดทิศใต้",
      { lat: 18, lng: 99, elevationM: 1072, deltaFromSchoolM: -73, meetsThreshold: true },
      null,
    ),
    ["ต่ำสุดทิศใต้", "1,072 ม. (−73 ม.)"],
  );
  assert.deepEqual(
    sectorFlagLines(
      "สูงสุดทิศตะวันตก",
      { lat: 18, lng: 99, elevationM: 800, deltaFromSchoolM: null, meetsThreshold: false },
      null,
    ),
    ["สูงสุดทิศตะวันตก", "800 ม."],
  );
});
