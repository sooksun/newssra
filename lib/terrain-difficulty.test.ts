// เทสต์เกณฑ์ความยากลำบากของพื้นที่ 5 ระดับ
// นิยามระดับมาจากข้อกำหนดของผู้ใช้งาน — ห้ามแก้ระดับ/ป้ายโดยไม่แก้ spec

import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFICULTY_LEVEL_LABELS,
  TD_RUGGED_MIN_POINTS,
  assessTerrainDifficulty,
  ruggedPointCount,
  terrainDifficultyFromGis,
  type TerrainDifficultyInput,
} from "./terrain-difficulty";
import { SECTOR_RELIEF_K_M, deriveSectorMetrics } from "./gis-sectors";
import { SECTOR_KEYS, type GisAnalysis, type GisRouteAnalysis, type GisSectorElevation } from "./types";

/** ธง 8 ทิศ: กำหนดจำนวนทิศที่มียอด/หุบต่างระดับเกิน 50 ม. จากโรงเรียน */
function sectors(schoolElevationM: number, highCount: number, lowCount: number): GisSectorElevation[] {
  const raw = SECTOR_KEYS.map((sector, i) => ({
    sector,
    highest: {
      lat: 18 + i * 0.001,
      lng: 98 + i * 0.001,
      elevationM: schoolElevationM + (i < highCount ? 180 : 5),
      deltaFromSchoolM: null,
      meetsThreshold: false,
    },
    lowest: {
      lat: 18 - i * 0.001,
      lng: 98 - i * 0.001,
      elevationM: schoolElevationM - (i < lowCount ? 180 : 5),
      deltaFromSchoolM: null,
      meetsThreshold: false,
    },
    reliefM: null,
    aboveThreshold: false,
  }));
  return deriveSectorMetrics(raw, schoolElevationM, SECTOR_RELIEF_K_M);
}

const BASE: TerrainDifficultyInput = {
  schoolElevationM: 300,
  provinceAvgElev: 200,
  innerSlopePct: 2,
  sectors: sectors(300, 0, 0),
  popDensityPerKm2: 1200,
  roadCircuityRatio: 1.1,
  averageSpeedKmh: 70,
  travelTimeRatio: 1.05,
  elevationGainM: 50,
  roadDistanceKm: 30,
  routeMountainPct: 0,
  forestSource: null,
  forestInside: 0,
  forestPct1km: 0,
  forestPct3km: 0,
};

function input(patch: Partial<TerrainDifficultyInput>): TerrainDifficultyInput {
  return { ...BASE, ...patch };
}

// ── นิยาม "สลับซับซ้อน" ตามข้อกำหนด: ยอดเขา/หุบเขาต่างระดับเกิน 50 ม. มากกว่า 5 แห่ง ในรัศมี 1 กม. ──

test("นับจุดยอด/หุบที่ต่างระดับเกิน 50 ม. จากธง 8 ทิศ (สูงสุด 16 จุด)", () => {
  assert.equal(ruggedPointCount(sectors(800, 4, 4)), 8);
  assert.equal(ruggedPointCount(sectors(800, 8, 8)), 16);
  assert.equal(ruggedPointCount(sectors(800, 0, 0)), 0);
});

test("เกณฑ์สลับซับซ้อนคือมากกว่า 5 จุด — 5 จุดพอดียังไม่ใช่", () => {
  assert.equal(TD_RUGGED_MIN_POINTS, 6);
  assert.equal(
    assessTerrainDifficulty(input({ schoolElevationM: 900, popDensityPerKm2: 200, sectors: sectors(900, 3, 2) }))
      .rugged,
    false,
  );
  assert.equal(
    assessTerrainDifficulty(input({ schoolElevationM: 900, popDensityPerKm2: 200, sectors: sectors(900, 3, 3) }))
      .rugged,
    true,
  );
});

test("ธง 8 ทิศไม่ครบ → บอกว่ายังตัดสินความสลับซับซ้อนไม่ได้ ไม่ใช่ตอบว่าไม่สลับซับซ้อน", () => {
  const result = assessTerrainDifficulty(input({ schoolElevationM: 900, popDensityPerKm2: 200, sectors: null }));
  assert.equal(result.rugged, null);
  assert.ok(result.missing.some((m) => m.includes("8 ทิศ")));
});

// ── ระดับ 1–5 ตามข้อกำหนด ────────────────────────────────────────────────────

test("ระดับ 1: พื้นที่ราบ ชุมชนใหญ่ = ไม่ยากลำบาก", () => {
  const result = assessTerrainDifficulty(BASE);
  assert.equal(result.level, 1);
  assert.equal(result.difficultyLabelTh, DIFFICULTY_LEVEL_LABELS[1]);
  assert.match(result.areaLabelTh, /พื้นที่ราบ/);
  assert.match(result.areaLabelTh, /ชุมชนใหญ่/);
});

test("ระดับ 2: ภูเขาสูง ราบกว้างบนภูเขา ชุมชนใหญ่ = ยากลำบากเล็กน้อย", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 1050,
      innerSlopePct: 3,
      sectors: sectors(1050, 0, 0),
      popDensityPerKm2: 900,
      elevationGainM: 700,
    }),
  );
  assert.equal(result.level, 2);
  assert.match(result.areaLabelTh, /ราบกว้างบนภูเขา/);
});

test("ระดับ 3: ภูเขาสูง ชนบท ถนนยังพอไปได้ = ยากลำบาก", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 900,
      innerSlopePct: 14,
      sectors: sectors(900, 2, 1),
      popDensityPerKm2: 250,
      roadCircuityRatio: 1.2,
      averageSpeedKmh: 60,
      elevationGainM: 400,
      roadDistanceKm: 60,
      routeMountainPct: 40,
    }),
  );
  assert.equal(result.level, 3);
});

test("ระดับ 4: ภูเขาสูง ชุมชนชนบท เข้าถึงยากหลายด้าน = ยากลำบากมาก", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 900,
      innerSlopePct: 18,
      sectors: sectors(900, 2, 1),
      popDensityPerKm2: 120,
      roadCircuityRatio: 2.2,
      averageSpeedKmh: 25,
      travelTimeRatio: 2.1,
      elevationGainM: 900,
      roadDistanceKm: 150,
      routeMountainPct: 70,
    }),
  );
  assert.equal(result.level, 4);
});

test("ระดับ 5: ภูเขาสูงสลับซับซ้อน ชุมชนชนบท = ยากลำบากที่สุด", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 1100,
      innerSlopePct: 22,
      sectors: sectors(1100, 5, 4),
      popDensityPerKm2: 80,
      roadCircuityRatio: 2.4,
      averageSpeedKmh: 20,
      travelTimeRatio: 2.6,
      elevationGainM: 1200,
      roadDistanceKm: 180,
      routeMountainPct: 90,
    }),
  );
  assert.equal(result.level, 5);
  assert.match(result.areaLabelTh, /สลับซับซ้อน/);
  assert.equal(result.difficultyLabelTh, "ยากลำบากที่สุด");
});

test("สลับซับซ้อนแต่ชุมชนใหญ่ ต้องไม่ขึ้นถึงระดับ 5 (ระดับ 5 สงวนไว้ให้ชุมชนชนบท)", () => {
  const result = assessTerrainDifficulty(
    input({ schoolElevationM: 1100, innerSlopePct: 22, sectors: sectors(1100, 5, 4), popDensityPerKm2: 3000 }),
  );
  assert.ok(result.level !== null && result.level < 5, `ได้ระดับ ${result.level}`);
});

// ── ป่าไม้เป็นสัญญาณประกอบ ไม่ใช่ประตูตัดสินเดี่ยว ────────────────────────────

test("อยู่ในเขตป่าและป่ารอบตัวหนา ดันระดับขึ้นได้ 1 ขั้นสำหรับโรงเรียนบนที่สูงชนบท", () => {
  const noForest = input({
    schoolElevationM: 900,
    innerSlopePct: 14,
    sectors: sectors(900, 2, 1),
    popDensityPerKm2: 250,
    roadCircuityRatio: 1.2,
    averageSpeedKmh: 60,
    elevationGainM: 400,
    roadDistanceKm: 60,
    routeMountainPct: 40,
  });
  const withForest = {
    ...noForest,
    forestSource: "cover" as const,
    forestInside: 1 as const,
    forestPct1km: 100,
    forestPct3km: 95,
  };
  const before = assessTerrainDifficulty(noForest);
  const after = assessTerrainDifficulty(withForest);
  assert.equal(before.level, 3);
  assert.equal(after.level, 4);
  assert.ok(after.forestSupports, "ต้องบันทึกว่าป่าเป็นตัวหนุน");
});

test("ป่าอย่างเดียวยกระดับโรงเรียนพื้นราบชุมชนใหญ่ไม่ได้", () => {
  const result = assessTerrainDifficulty(
    input({ forestSource: "cover", forestInside: 1, forestPct1km: 100, forestPct3km: 100 }),
  );
  assert.equal(result.level, 1);
  assert.equal(result.forestSupports, false);
});

test("ป่าดันได้มากสุด 1 ขั้น และไม่ทำให้ข้ามไประดับ 5 (ระดับ 5 ต้องมาจากความสลับซับซ้อนจริง)", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 900,
      innerSlopePct: 18,
      sectors: sectors(900, 2, 1),
      popDensityPerKm2: 120,
      roadCircuityRatio: 2.2,
      averageSpeedKmh: 25,
      travelTimeRatio: 2.1,
      elevationGainM: 900,
      roadDistanceKm: 150,
      routeMountainPct: 70,
      forestSource: "cover",
      forestInside: 1,
      forestPct1km: 100,
      forestPct3km: 100,
    }),
  );
  assert.equal(result.level, 4, "ระดับ 4 ต้องไม่ถูกป่าดันขึ้นเป็น 5");
});

// ── ความซื่อสัตย์ต่อข้อมูล ───────────────────────────────────────────────────

test("ไม่รู้ความสูงที่หมุดโรงเรียน → ตอบว่าประเมินไม่ได้ ไม่ใช่ระดับ 1", () => {
  const result = assessTerrainDifficulty(input({ schoolElevationM: null }));
  assert.equal(result.level, null);
  assert.ok(result.missing.length > 0);
});

test("ไม่รู้ขนาดชุมชน → ประเมินไม่ได้ (ขนาดชุมชนอยู่ในนิยามทุกระดับ)", () => {
  const result = assessTerrainDifficulty(input({ popDensityPerKm2: null }));
  assert.equal(result.level, null);
  assert.ok(result.missing.some((m) => m.includes("ชุมชน")));
});

test("ทุกคำตอบต้องแนบหลักฐานที่ใช้ตัดสิน", () => {
  const result = assessTerrainDifficulty(input({ schoolElevationM: 900, popDensityPerKm2: 200 }));
  const labels = result.evidence.map((e) => e.label).join("|");
  for (const key of ["ความสูง", "ชุมชน", "คดเคี้ยว", "ความเร็ว", "ระยะทาง", "เส้นทางที่เป็นภูเขา"]) {
    assert.ok(labels.includes(key), `ขาดหลักฐาน: ${key} (${labels})`);
  }
});

test("ผลลัพธ์ไม่แก้ไขค่าที่รับเข้ามา", () => {
  const original = input({ schoolElevationM: 900, popDensityPerKm2: 200 });
  const snapshot = JSON.stringify(original);
  assessTerrainDifficulty(original);
  assert.equal(JSON.stringify(original), snapshot);
});

// ── เขาต่ำที่ลาดชันจริง ต้องไม่ถูกเรียกว่าพื้นราบ ──────────────────────────────
// เคสจริงในฐานข้อมูล: บ้านนาตอน น่าน — สูงเพียง 220 ม. แต่ความลาดชัน 25.2% และพื้นที่ต่างระดับ 378 ม.
// เกณฑ์ความสูงสัมบูรณ์อย่างเดียวจะจัดเป็น "พื้นที่ราบ" ซึ่งขัดกับภูมิประเทศจริง

test("บ้านนาตอน (220 ม. แต่ลาดชัน 25%) ต้องนับเป็นภูมิประเทศภูเขา ไม่ใช่พื้นที่ราบ", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 220,
      provinceAvgElev: 350,
      innerSlopePct: 25.2,
      sectors: sectors(220, 2, 2),
      popDensityPerKm2: 150,
      roadCircuityRatio: 1.6,
      averageSpeedKmh: 57.4,
      elevationGainM: 700,
      roadDistanceKm: 130,
      routeMountainPct: 20,
    }),
  );
  assert.equal(result.highland, true);
  assert.doesNotMatch(result.areaLabelTh, /พื้นที่ราบ/);
  assert.match(result.areaLabelTh, /ภูเขา/);
  assert.ok(result.level !== null && result.level >= 3, `ได้ระดับ ${result.level}`);
});

test("ป้ายต้องบอกตรง ๆ ว่าเป็นภูเขาเพราะลาดชัน ไม่ใช่เพราะระดับความสูง", () => {
  const bySlope = assessTerrainDifficulty(
    input({ schoolElevationM: 220, provinceAvgElev: 350, innerSlopePct: 25.2, popDensityPerKm2: 150 }),
  );
  assert.match(bySlope.areaLabelTh, /ลาดชันสูง/);
  const byElevation = assessTerrainDifficulty(
    input({ schoolElevationM: 1100, provinceAvgElev: 350, innerSlopePct: 25.2, popDensityPerKm2: 150 }),
  );
  assert.match(byElevation.areaLabelTh, /ภูเขาสูง/);
});

test("พื้นราบจริง (ลาดชันต่ำ ความสูงต่ำ) ยังต้องเป็นพื้นที่ราบ", () => {
  assert.equal(assessTerrainDifficulty(BASE).highland, false);
  assert.match(assessTerrainDifficulty(BASE).areaLabelTh, /พื้นที่ราบ/);
});

// ── ป่าที่ใช้หนุนต้องเป็น "สภาพป่าจริง" เท่านั้น ไม่ใช่แนวเขตป่าสงวน ───────────
// สองอย่างนี้คนละคำถาม: อยู่ในเขตประกาศตามกฎหมาย ≠ รอบตัวยังเป็นป่าจริง
// polygon เขตสงวนเดิมที่กลายเป็นชุมชนไปแล้วต้องไม่ได้แต้มหนุน

const HIGHLAND_RURAL: Partial<TerrainDifficultyInput> = {
  schoolElevationM: 900,
  innerSlopePct: 14,
  sectors: sectors(900, 2, 1),
  popDensityPerKm2: 250,
  roadCircuityRatio: 1.2,
  averageSpeedKmh: 60,
  elevationGainM: 400,
  roadDistanceKm: 60,
  routeMountainPct: 40,
};

test("ป่าจริง (forest cover) หนุนระดับได้", () => {
  const result = assessTerrainDifficulty(
    input({ ...HIGHLAND_RURAL, forestSource: "cover", forestInside: 1, forestPct1km: 100, forestPct3km: 95 }),
  );
  assert.equal(result.forestSupports, true);
  assert.equal(result.level, 4);
});

test("แนวเขตป่าสงวนอย่างเดียว หนุนระดับไม่ได้ แม้ตัวเลขจะสูง", () => {
  const result = assessTerrainDifficulty(
    input({ ...HIGHLAND_RURAL, forestSource: "legal", forestInside: 1, forestPct1km: 100, forestPct3km: 95 }),
  );
  assert.equal(result.forestSupports, false, "เขตกฎหมายไม่ใช่หลักฐานว่ารอบตัวยังเป็นป่า");
  assert.equal(result.level, 3);
});

test("มีแต่แนวเขตป่าสงวน ต้องบอกว่ายังขาดข้อมูลสภาพป่าจริง", () => {
  const result = assessTerrainDifficulty(
    input({ ...HIGHLAND_RURAL, forestSource: "legal", forestInside: 1, forestPct1km: 100 }),
  );
  assert.ok(
    result.missing.some((m) => m.includes("สภาพพื้นที่ป่าจริง")),
    `ต้องบอกว่าขาดสภาพป่าจริง: ${JSON.stringify(result.missing)}`,
  );
});

test("หลักฐานต้องระบุว่าตัวเลขป่ามาจากชั้นไหน", () => {
  const cover = assessTerrainDifficulty(
    input({ ...HIGHLAND_RURAL, forestSource: "cover", forestInside: 1, forestPct1km: 100, forestPct3km: 95 }),
  );
  const legal = assessTerrainDifficulty(
    input({ ...HIGHLAND_RURAL, forestSource: "legal", forestInside: 1, forestPct1km: 100, forestPct3km: 95 }),
  );
  const line = (r: typeof cover) => r.evidence.find((e) => e.label.includes("ป่า"))?.value ?? "";
  assert.match(line(cover), /สภาพป่าจริง/);
  assert.match(line(legal), /แนวเขตป่าสงวน/);
});

test("ไม่รู้ที่มาของข้อมูลป่า → ไม่หนุน (ไม่เดาว่าเป็นป่าจริง)", () => {
  const result = assessTerrainDifficulty(
    input({ ...HIGHLAND_RURAL, forestSource: null, forestInside: 1, forestPct1km: 100, forestPct3km: 95 }),
  );
  assert.equal(result.forestSupports, false);
});

// ── ตัวแปลงต้องอ่าน "ที่มา" จาก authority ของชั้นข้อมูลที่บันทึกไว้ ──────────────

function gisWithForest(authority: "rfd-forest-cover" | "rfd-national-reserved-forest"): GisAnalysis {
  return {
    center: { lat: 19.05, lng: 100.65, source: "unit", confirmedAt: "2569-01-01T00:00:00.000Z" },
    elevation: {
      schoolMarkerElevationM: 900,
      meanElevationM: 880,
      minElevationM: 800,
      maxElevationM: 1100,
      reliefM: 300,
      meanSlopePct: 14,
      maxSlopePct: 30,
      localMaxElevation1KmM: 1000,
      slopeClass: "D",
      landformTh: "ภูเขา",
      terrainConfidence: "client",
      provinceAvgElev: 350,
      routeFullMaxElev: 1100,
      routeTailMaxElev: 1000,
    },
    routes: [],
    autoScore: null,
    appliedToResponses: false,
    savedAt: "2569-01-01T00:00:00.000Z",
    radiusSummaries: [{ radiusM: 1500, buildingCount: 60, estPopulation: 200, popDensityPerKm2: 250 }],
    forestAnalysis: {
      version: "fl-1",
      status: {
        inside: 1,
        distanceM: 0,
        pct1km: 100,
        pct3km: 95,
        pct5km: 90,
        yearBe: 2562,
        gridResolutionM: null,
        authority,
        dataSource: "test",
        attribution: "test",
      },
      legal: null,
      type: null,
      metrics: {
        forest_inside: 1,
        forest_distance_m: 0,
        forest_1km_pct: 100,
        forest_3km_pct: 95,
        forest_5km_pct: 90,
        forest_type: null,
        forest_type_code: null,
        protected_area: null,
        reserve_forest: null,
        legal_distance_m: null,
        insideSource: "status",
      },
      contextStrength: "strong",
      missing: [],
      calculatedAt: "2569-01-01T00:00:00.000Z",
    },
  } as unknown as GisAnalysis;
}

test("ตัวแปลง: ชั้นสภาพป่าจริงที่บันทึกไว้ → หนุนระดับได้", () => {
  const result = terrainDifficultyFromGis(gisWithForest("rfd-forest-cover"), {
    route: {
      roadCircuityRatio: 1.2,
      averageSpeedKmh: 60,
      travelTimeRatio: 1.2,
      elevationGainM: 400,
      roadDistanceKm: 60,
      mountainPct: 40,
    } as GisRouteAnalysis,
  });
  assert.equal(result.forestSupports, true);
  assert.equal(result.level, 4);
});

test("ตัวแปลง: แถวเก่าที่บันทึกไว้ตอนมีแต่แนวเขตป่าสงวน → ไม่หนุน และบอกว่าต้องบันทึกใหม่", () => {
  const result = terrainDifficultyFromGis(gisWithForest("rfd-national-reserved-forest"), {
    route: {
      roadCircuityRatio: 1.2,
      averageSpeedKmh: 60,
      travelTimeRatio: 1.2,
      elevationGainM: 400,
      roadDistanceKm: 60,
      mountainPct: 40,
    } as GisRouteAnalysis,
  });
  assert.equal(result.forestSupports, false);
  assert.equal(result.level, 3);
  assert.ok(result.missing.some((m) => m.includes("สภาพพื้นที่ป่าจริง")));
});

// ── ลานราบเล็กกลางภูเขา ต้องไม่ถูกเรียกว่าพื้นที่ราบ ─────────────────────────
// เคสจริง: บ้านนาตอน — โรงเรียนตั้งบนลานราบ (ลาดชันรอบตัว 5.9%) ที่ความสูงเพียง 220 ม.
// แต่ในรัศมี 1 กม. มียอดเขา/หุบเขาต่างระดับเกิน 50 ม. ถึง 7 จุด = ภูมิประเทศภูเขาตามนิยามที่กำหนด

test("ลานราบที่ล้อมด้วยยอด/หุบเกินเกณฑ์สลับซับซ้อน ต้องนับเป็นภูมิประเทศภูเขา", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 220,
      provinceAvgElev: 193,
      innerSlopePct: 5.9,
      sectors: sectors(220, 4, 3),
      popDensityPerKm2: 90,
      roadCircuityRatio: 1.6,
      averageSpeedKmh: 57,
      elevationGainM: 376,
      roadDistanceKm: 130,
      routeMountainPct: 0,
    }),
  );
  assert.equal(result.rugged, true);
  assert.equal(result.highland, true, "7 ยอด/หุบ ในรัศมี 1 กม. คือหลักฐานภูมิประเทศภูเขา");
  assert.doesNotMatch(result.areaLabelTh, /พื้นที่ราบ/);
  assert.equal(result.level, 5);
});

test("ป้ายต้องบอกว่าเป็นภูเขาเพราะสลับซับซ้อน ไม่ใช่เพราะลาดชันหรือความสูง", () => {
  const result = assessTerrainDifficulty(
    input({
      schoolElevationM: 220,
      provinceAvgElev: 193,
      innerSlopePct: 5.9,
      sectors: sectors(220, 4, 3),
      popDensityPerKm2: 900,
    }),
  );
  assert.match(result.areaLabelTh, /สลับซับซ้อน/);
  assert.doesNotMatch(result.areaLabelTh, /ลาดชันสูง/);
});

test("พื้นราบจริงที่ไม่มียอด/หุบรอบตัว ยังต้องเป็นพื้นที่ราบเหมือนเดิม", () => {
  const result = assessTerrainDifficulty(input({ sectors: sectors(300, 1, 1) }));
  assert.equal(result.rugged, false);
  assert.equal(result.highland, false);
  assert.match(result.areaLabelTh, /พื้นที่ราบ/);
});
