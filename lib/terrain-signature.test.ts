// เทสต์ตัวจำแนก "ลายเซ็นภูมิประเทศ" — เคสสอบเทียบจาก spec 2026-08-07-terrain-signature-classifier-design.md
// ทุกเคสเป็นสถานที่จริงที่รีวิวเชิงภูมิศาสตร์ใช้หักล้างต้นไม้รุ่นแรก — ห้ามลบเคสใดออกโดยไม่แก้ spec

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TERRAIN_SIGNATURE_VERSION,
  TS_HIGHLAND_MIN_M,
  TS_HIGH_MOUNTAIN_M,
  TS_MOUNTAIN_MIN_ALT_M,
  TS_PLAIN_RELIEF_MAX_M,
  TS_URBAN_DENSITY_CUT,
  classifyTerrainSignature,
  terrainSignatureFromGis,
  type TerrainSignatureInput,
} from "./terrain-signature";
import { settlementClass } from "./settlement";
import { SECTOR_RELIEF_K_M, deriveSectorMetrics } from "./gis-sectors";
import { SECTOR_KEYS, type GisAnalysis, type GisRouteAnalysis, type GisSectorElevation } from "./types";

/**
 * สร้างธง 8 ทิศจาก "ส่วนต่างจากโรงเรียน" ที่ต้องการ แล้วให้ deriveSectorMetrics (โค้ดจริง) คำนวณ delta เอง
 * highDeltas/lowDeltas ยาว 8 เรียงตาม SECTOR_KEYS
 */
function sectorsFrom(schoolElevationM: number, highDeltas: number[], lowDeltas: number[]): GisSectorElevation[] {
  const raw = SECTOR_KEYS.map((sector, i) => ({
    sector,
    highest: {
      lat: 18 + i * 0.001,
      lng: 98 + i * 0.001,
      elevationM: schoolElevationM + highDeltas[i],
      deltaFromSchoolM: null,
      meetsThreshold: false,
    },
    lowest: {
      lat: 18 - i * 0.001,
      lng: 98 - i * 0.001,
      elevationM: schoolElevationM + lowDeltas[i],
      deltaFromSchoolM: null,
      meetsThreshold: false,
    },
    reliefM: null,
    aboveThreshold: false,
  }));
  return deriveSectorMetrics(raw, schoolElevationM, SECTOR_RELIEF_K_M);
}

/** ทิศที่สูงกว่าโรงเรียนชัดเจน n ทิศ ที่เหลือแทบราบ (ไม่ถูกล้อม, ไม่ใช่สัน) */
function sectorsWithHigher(schoolElevationM: number, count: number): GisSectorElevation[] {
  const highs = SECTOR_KEYS.map((_, i) => (i < count ? 180 : 10));
  const lows = SECTOR_KEYS.map(() => -10);
  return sectorsFrom(schoolElevationM, highs, lows);
}

/** ทิศที่ต่ำกว่าโรงเรียนชัดเจน n ทิศ = อยู่บนสัน/ยอด */
function sectorsWithLower(schoolElevationM: number, count: number): GisSectorElevation[] {
  const highs = SECTOR_KEYS.map(() => 10);
  const lows = SECTOR_KEYS.map((_, i) => (i < count ? -180 : -10));
  return sectorsFrom(schoolElevationM, highs, lows);
}

const BASE: TerrainSignatureInput = {
  schoolElevationM: 300,
  innerSlopePct: 2,
  sectors: sectorsWithHigher(300, 0),
  localMaxElevation1KmM: 310,
  routeTailMaxElev: 310,
  routeFullMaxElev: 320,
  routeGainM: 30,
  provinceAvgElev: 200,
  popDensityPerKm2: 120,
  accessSeverity: 1,
  severityComponents: { rcr: 1, ttr: 1, avgSpeed: 1, gain: 1 },
  routeAccessStatus: "reachable",
};

function input(patch: Partial<TerrainSignatureInput>): TerrainSignatureInput {
  return { ...BASE, ...patch };
}

// ── เคสสอบเทียบสถานที่จริง (13 เคส) ───────────────────────────────────────────

test("ปาย: โรงเรียนกลางทุ่งพื้นหุบกว้าง ต้องเป็นหุบเขากว้าง ไม่ใช่ภูเขา", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 505,
      innerSlopePct: 3,
      sectors: sectorsWithHigher(505, 1),
      localMaxElevation1KmM: 540,
      routeTailMaxElev: 700,
      routeFullMaxElev: 1300,
      routeGainM: 850,
      provinceAvgElev: 400,
      popDensityPerKm2: 300,
    }),
  );
  assert.equal(result.ruleId, "R4");
  assert.equal(result.group, "valley_flat");
});

test("แม่สะเรียง: พื้นหุบต่ำกว่า 500 ม. แต่ต้องข้ามช่องเขาเข้ามา = หุบเขากว้าง", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 210,
      innerSlopePct: 4,
      sectors: sectorsWithHigher(210, 2),
      localMaxElevation1KmM: 260,
      routeTailMaxElev: 420,
      routeFullMaxElev: 1100,
      routeGainM: 900,
      provinceAvgElev: 400,
    }),
  );
  assert.equal(result.ruleId, "R4");
});

test("ขุนยวม/แม่แจ่ม: ก้นหุบแคบถูกผนังเขาล้อม = หุบเขาแคบ (R3 ต้องไม่เป็น dead code)", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 480,
      innerSlopePct: 6,
      sectors: sectorsWithHigher(480, 6),
      localMaxElevation1KmM: 900,
      routeTailMaxElev: 900,
      routeFullMaxElev: 1200,
      routeGainM: 700,
      provinceAvgElev: 400,
    }),
  );
  assert.equal(result.ruleId, "R3");
  assert.equal(result.group, "valley_flat");
});

test("ก้นหุบแคบที่ผนังเขาทำให้ความลาดชันสูง ยังต้องเป็นหุบเขา ไม่ใช่ภูเขา", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 480,
      innerSlopePct: 16,
      sectors: sectorsWithHigher(480, 6),
      localMaxElevation1KmM: 900,
      routeTailMaxElev: 900,
      routeFullMaxElev: 1200,
      routeGainM: 700,
    }),
  );
  assert.equal(result.ruleId, "R3");
});

test("ภูเรือ: ราบแต่ไต่ขึ้นมาแล้วแทบไม่ต้องลง = ที่ราบสูง ไม่ใช่พื้นราบปกติ", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 700,
      innerSlopePct: 4,
      sectors: sectorsWithHigher(700, 1),
      localMaxElevation1KmM: 730,
      routeTailMaxElev: 720,
      routeFullMaxElev: 750,
      routeGainM: 500,
      provinceAvgElev: 250,
    }),
  );
  assert.equal(result.ruleId, "R4b");
});

test("เขาค้อ: ความสูงที่หมุด ≥1,000 ม. = ภูเขาสูง", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 1050,
      innerSlopePct: 5,
      sectors: sectorsWithHigher(1050, 2),
      localMaxElevation1KmM: 1120,
      routeTailMaxElev: 1080,
      routeFullMaxElev: 1100,
      routeGainM: 800,
      provinceAvgElev: 250,
    }),
  );
  assert.equal(result.ruleId, "R1");
});

test("อมก๋อย: ไหล่เขาชัน ต้องข้ามเขาเข้ามา = ภูเขา/ไหล่เขา", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 900,
      innerSlopePct: 18,
      sectors: sectorsWithHigher(900, 2),
      localMaxElevation1KmM: 1050,
      routeTailMaxElev: 1100,
      routeFullMaxElev: 1300,
      routeGainM: 900,
      provinceAvgElev: 400,
    }),
  );
  assert.equal(result.ruleId, "R2");
});

test("บันนังสตา: เขาต่ำภาคใต้ชัน สูงกว่าค่าเฉลี่ยจังหวัดมาก = ภูเขา (ไม่หลุดเพราะความสูงสัมบูรณ์ต่ำ)", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 250,
      innerSlopePct: 15,
      sectors: sectorsWithHigher(250, 2),
      localMaxElevation1KmM: 420,
      routeTailMaxElev: 380,
      routeFullMaxElev: 450,
      routeGainM: 320,
      provinceAvgElev: 200,
    }),
  );
  assert.equal(result.ruleId, "R2");
});

test("ตีนดอยสุเทพ: มีที่สูงข้างเคียงแต่ทางเข้าราบ = เชิงเขา", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 330,
      innerSlopePct: 8,
      sectors: sectorsWithHigher(330, 2),
      localMaxElevation1KmM: 630,
      routeTailMaxElev: 340,
      routeFullMaxElev: 350,
      routeGainM: 60,
      provinceAvgElev: 330,
    }),
  );
  assert.equal(result.ruleId, "R5");
});

test("สันป่าตอง กลางแอ่งเชียงใหม่: พื้นราบปกติ", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 320,
      innerSlopePct: 2,
      sectors: sectorsWithHigher(320, 0),
      localMaxElevation1KmM: 340,
      routeTailMaxElev: 330,
      routeFullMaxElev: 330,
      routeGainM: 30,
      provinceAvgElev: 330,
    }),
  );
  assert.equal(result.ruleId, "R6");
  assert.equal(result.group, "flat_normal");
});

test("ตัวเมืองน่าน: อยู่ในหุบแต่หนาแน่นระดับเมือง = ตัดออกจากทุกกลุ่มทุรกันดารก่อนดูภูมิประเทศ", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 200,
      innerSlopePct: 2,
      sectors: sectorsWithHigher(200, 5),
      localMaxElevation1KmM: 500,
      routeTailMaxElev: 700,
      routeFullMaxElev: 900,
      routeGainM: 600,
      popDensityPerKm2: 1200,
      accessSeverity: 3,
      severityComponents: { rcr: 3, ttr: 3, avgSpeed: 2, gain: 3 },
    }),
  );
  assert.equal(result.ruleId, "R0");
  assert.equal(result.group, "flat_normal");
});

test("โขงเจียม: ราบแต่มีสันกั้นระดับต่ำระหว่างทาง = ครอบครัวพื้นราบ ไม่ใช่เนินเขา", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 120,
      innerSlopePct: 3,
      sectors: sectorsWithHigher(120, 1),
      localMaxElevation1KmM: 140,
      routeTailMaxElev: 250,
      routeFullMaxElev: 250,
      routeGainM: 140,
      provinceAvgElev: 130,
    }),
  );
  assert.equal(result.ruleId, "R6b");
  assert.equal(result.group, "flat_normal");
});

test("สันทรายชายฝั่งปัตตานี: เนิน 35 ม. เหนือค่าเฉลี่ยจังหวัด ต้องไม่กลายเป็นเชิงเขา", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 35,
      innerSlopePct: 2,
      sectors: sectorsWithHigher(35, 0),
      localMaxElevation1KmM: 70,
      routeTailMaxElev: 45,
      routeFullMaxElev: 40,
      routeGainM: 10,
      provinceAvgElev: 30,
    }),
  );
  assert.equal(result.ruleId, "R6");
});

test("เกาะพระทอง: เกาะราบที่ไม่มีเส้นทางบก ต้องเป็นกลุ่มเกาะ ไม่ใช่พื้นราบปกติ", () => {
  const result = classifyTerrainSignature(
    input({
      declaredSettingType: "เกาะ",
      schoolElevationM: 5,
      innerSlopePct: 1,
      routeTailMaxElev: null,
      routeFullMaxElev: null,
      routeGainM: null,
      routeAccessStatus: "no-route",
      accessSeverity: null,
      severityComponents: null,
    }),
  );
  assert.equal(result.ruleId, "R-I");
  assert.equal(result.group, "island");
});

// ── พื้นที่เกาะ: ต้องแยกออกจากพื้นที่สูงทุรกันดารโดยเด็ดขาด ─────────────────────

test("เกาะที่มีภูเขา ต้องเป็นกลุ่มเกาะ ห้ามถูกนับเป็นภูเขาสูงทุรกันดาร", () => {
  const result = classifyTerrainSignature(
    input({
      declaredSettingType: "เกาะ",
      schoolElevationM: 700,
      innerSlopePct: 22,
      sectors: sectorsWithHigher(700, 2),
      localMaxElevation1KmM: 740,
      routeTailMaxElev: 720,
      routeFullMaxElev: 740,
      routeGainM: 600,
      accessSeverity: 4,
      severityComponents: { rcr: 4, ttr: 4, avgSpeed: 3, gain: 3 },
    }),
  );
  assert.equal(result.ruleId, "R-I");
  assert.equal(result.group, "island");
  assert.notEqual(result.group, "highland_remote");
});

test("เกาะที่ความสูงเกิน 1,000 ม. ก็ยังเป็นเกาะ ไม่ใช่ภูเขาสูง", () => {
  const result = classifyTerrainSignature(
    input({ declaredSettingType: "เกาะ", schoolElevationM: 1200, innerSlopePct: 25 }),
  );
  assert.equal(result.ruleId, "R-I");
  assert.equal(result.group, "island");
});

test("เกาะที่หนาแน่นระดับเมือง ยังต้องถูกจัดเป็นเกาะก่อนเกตเขตเมือง", () => {
  const result = classifyTerrainSignature(input({ declaredSettingType: "เกาะ", popDensityPerKm2: 3000 }));
  assert.equal(result.ruleId, "R-I");
  assert.equal(result.group, "island");
});

test("AI จากภาพ 3 มิติระบุว่าเป็นเกาะ ก็ถือเป็นสัญญาณเกาะได้", () => {
  const result = classifyTerrainSignature(input({ aiSettingType: "เกาะ", schoolElevationM: 300 }));
  assert.equal(result.ruleId, "R-I");
});

test("เส้นทางต้องข้ามเรือข้ามฟาก = เกาะ แม้จะมีตัวเลขเส้นทางครบ", () => {
  const result = classifyTerrainSignature(input({ hasFerry: true, schoolElevationM: 40 }));
  assert.equal(result.ruleId, "R-I");
  assert.equal(result.group, "island");
});

test("หลักฐานที่ใช้บอกว่าเป็นเกาะต้องระบุที่มา ไม่ใช่ผลลอย ๆ", () => {
  const result = classifyTerrainSignature(input({ declaredSettingType: "เกาะ" }));
  const source = result.evidence.find((e) => e.label.includes("หลักฐานพื้นที่เกาะ"));
  assert.ok(source, "ต้องมีรายการหลักฐานพื้นที่เกาะ");
  assert.ok(source.value.includes("ผู้กรอก"), `ต้องบอกว่ามาจากผู้กรอก: ${source.value}`);
});

test("ไม่มีเส้นทางถนนอย่างเดียว ต้องไม่ถูกเรียกว่าเกาะ (โรงเรียนภูเขาที่ไม่มีถนนคือคนละเรื่อง)", () => {
  const result = classifyTerrainSignature(
    input({
      routeAccessStatus: "no-route",
      schoolElevationM: 1100,
      innerSlopePct: 24,
      routeTailMaxElev: null,
      routeFullMaxElev: null,
      routeGainM: null,
      accessSeverity: null,
      severityComponents: null,
    }),
  );
  assert.notEqual(result.ruleId, "R-I");
  assert.notEqual(result.group, "island");
  assert.equal(result.ruleId, "R1");
});

test("ไม่มีเส้นทางถนนและภูมิประเทศบอกไม่ได้ ต้องตอบว่าไม่พอข้อมูล ไม่ใช่พื้นราบปกติ", () => {
  const result = classifyTerrainSignature(
    input({
      routeAccessStatus: "no-route",
      schoolElevationM: 5,
      innerSlopePct: 1,
      routeTailMaxElev: null,
      routeFullMaxElev: null,
      routeGainM: null,
    }),
  );
  assert.equal(result.ruleId, "insufficient");
  assert.notEqual(result.group, "flat_normal");
});

test("ลักษณะที่ตั้งอื่นที่ไม่ใช่เกาะ ต้องไม่ทำให้ถูกจัดเป็นเกาะ", () => {
  const result = classifyTerrainSignature(input({ declaredSettingType: "ภูเขาสูง" }));
  assert.notEqual(result.ruleId, "R-I");
});

// ── ที่ราบผืนใหญ่ที่พัฒนาแล้วบนที่สูง: ต้องกรองออก โดยไม่กระทบโรงเรียนสูงที่ยากลำบากจริง ────

/** เมืองบนที่ราบผืนใหญ่: ราบทุกทิศ พื้นที่แทบไม่มีความต่างระดับ ถนนดี มีชุมชนจริง และบริการอยู่ใกล้ */
const DEVELOPED_PLAIN: Partial<TerrainSignatureInput> = {
  schoolElevationM: 1050,
  innerSlopePct: 2,
  gridReliefM: 40,
  sectors: sectorsWithHigher(1050, 0),
  localMaxElevation1KmM: 1070,
  routeTailMaxElev: 1060,
  routeFullMaxElev: 1080,
  routeGainM: 700,
  popDensityPerKm2: 500,
  accessSeverity: 3,
  severityComponents: { rcr: 1, ttr: 0, avgSpeed: 1, gain: 3 },
  primaryRouteMinutes: 20,
  primaryRouteKm: 18,
};

test("เมืองที่เจริญบนที่ราบผืนใหญ่ แม้อยู่สูง 1,050 ม. ต้องถูกกรองออกจากกลุ่มทุรกันดาร", () => {
  const result = classifyTerrainSignature(input(DEVELOPED_PLAIN));
  assert.equal(result.ruleId, "R0b");
  assert.equal(result.group, "developed");
  assert.notEqual(result.group, "highland_remote");
});

test("กฎที่ราบพัฒนาแล้วต้องมาก่อนเกณฑ์ภูเขาสูง ไม่ใช่ถูกความสูงตัดหน้า", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, schoolElevationM: 1200 }));
  assert.equal(result.ruleId, "R0b");
});

test("บ้านโคกงาม (ค่าจริง): สูง 639 ม. ถนนดีและพื้นที่ค่อนข้างราบ แต่ต้องไม่ถูกกรองออก", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 639,
      innerSlopePct: 7.1,
      gridReliefM: 109,
      sectors: sectorsWithHigher(639, 2),
      localMaxElevation1KmM: 700,
      routeTailMaxElev: 680,
      routeFullMaxElev: 775,
      routeGainM: 835,
      provinceAvgElev: 395,
      popDensityPerKm2: 273,
      accessSeverity: 3,
      severityComponents: { rcr: 1, ttr: 1, avgSpeed: 0, gain: 3 },
      primaryRouteMinutes: 53.5,
      primaryRouteKm: 69,
    }),
  );
  assert.notEqual(result.ruleId, "R0b");
  assert.notEqual(result.group, "developed");
});

test("ที่ราบผืนใหญ่ถนนดี แต่อยู่ไกลมาก ต้องไม่ถูกกรองออก และต้องติดธงให้ผู้ตรวจดู", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, primaryRouteMinutes: 120, primaryRouteKm: 110 }));
  assert.notEqual(result.ruleId, "R0b");
  assert.ok(
    result.reviewFlags.some((f) => f.includes("ที่ราบ")),
    `ต้องมีธงให้ผู้ตรวจ: ${JSON.stringify(result.reviewFlags)}`,
  );
});

test("ที่ราบผืนใหญ่ที่บริการอยู่ระยะปานกลาง (50 นาที/60 กม.) ต้องไม่ถูกกรองออกเอง แต่ต้องติดธง", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, primaryRouteMinutes: 50, primaryRouteKm: 60 }));
  assert.notEqual(result.ruleId, "R0b");
  assert.ok(result.reviewFlags.length > 0, "ต้องส่งให้ผู้ตรวจแทนการตัดสินเอง");
});

test("ที่ราบผืนใหญ่ถนนดีแต่ไม่มีชุมชน ต้องไม่ถูกกรองออก (ราบ ≠ เจริญ)", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, popDensityPerKm2: 80 }));
  assert.notEqual(result.ruleId, "R0b");
});

test("พื้นที่ราบมีชุมชนแต่ถนนคดเคี้ยว/ช้า ต้องไม่ถูกกรองออก", () => {
  const result = classifyTerrainSignature(
    input({ ...DEVELOPED_PLAIN, severityComponents: { rcr: 3, ttr: 2, avgSpeed: 2, gain: 3 } }),
  );
  assert.notEqual(result.ruleId, "R0b");
});

test("พื้นที่ที่ยังมีเนินโผล่รอบตัว ไม่ใช่ที่ราบผืนใหญ่ ต้องไม่ถูกกรองออก", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, sectors: sectorsWithHigher(1050, 4) }));
  assert.notEqual(result.ruleId, "R0b");
});

test("ไม่รู้ความต่างระดับของพื้นที่ ต้องไม่กรองออกโดยเดา", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, gridReliefM: null }));
  assert.notEqual(result.ruleId, "R0b");
});

test("ไม่รู้ระยะ/เวลาเดินทาง ต้องไม่กรองออกโดยเดา", () => {
  const result = classifyTerrainSignature(
    input({ ...DEVELOPED_PLAIN, primaryRouteMinutes: null, primaryRouteKm: null }),
  );
  assert.notEqual(result.ruleId, "R0b");
});

test("เขตเมืองหนาแน่นยังตัดสินด้วยเกตเขตเมืองก่อน", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, popDensityPerKm2: 3000 }));
  assert.equal(result.ruleId, "R0");
});

test("เกาะยังมาก่อนกฎที่ราบพัฒนาแล้วเสมอ", () => {
  const result = classifyTerrainSignature(input({ ...DEVELOPED_PLAIN, declaredSettingType: "เกาะ" }));
  assert.equal(result.ruleId, "R-I");
});

// ── กลุ่มคำตอบตามโจทย์ (แกนภูมิประเทศ × แกนความยาก) ───────────────────────────

test("ภูเขาสูงที่ยากหลายด้าน = กลุ่มภูเขาสูงทุรกันดาร", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 1100,
      innerSlopePct: 20,
      sectors: sectorsWithHigher(1100, 2),
      localMaxElevation1KmM: 1300,
      routeTailMaxElev: 1250,
      routeFullMaxElev: 1400,
      routeGainM: 1200,
      accessSeverity: 4,
      severityComponents: { rcr: 3, ttr: 4, avgSpeed: 4, gain: 4 },
    }),
  );
  assert.equal(result.group, "highland_remote");
});

test("ที่ราบสูงถนนลาดยางดี ยากเฉพาะความชันสะสม ต้องไม่เข้ากลุ่มภูเขาสูงทุรกันดาร", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 1050,
      innerSlopePct: 5,
      sectors: sectorsWithHigher(1050, 1),
      localMaxElevation1KmM: 1100,
      routeTailMaxElev: 1080,
      routeFullMaxElev: 1100,
      routeGainM: 900,
      accessSeverity: 4,
      severityComponents: { rcr: 0, ttr: 1, avgSpeed: 0, gain: 4 },
    }),
  );
  assert.equal(result.ruleId, "R1");
  assert.notEqual(result.group, "highland_remote");
});

test("อยู่บนสันที่ดินหล่นรอบตัว = ภูเขา แม้ความลาดชันรอบโรงเรียนจะไม่ชัน", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 700,
      innerSlopePct: 7,
      sectors: sectorsWithLower(700, 6),
      localMaxElevation1KmM: 720,
      routeTailMaxElev: 800,
      routeFullMaxElev: 900,
      routeGainM: 600,
      provinceAvgElev: 300,
    }),
  );
  assert.equal(result.ruleId, "R2");
});

// ── ข้อมูลไม่พอ: ต้องปฏิเสธที่จะตอบ ไม่ใช่เดา ────────────────────────────────

test("ไม่รู้ความสูงที่หมุดโรงเรียน = ไม่พอข้อมูล", () => {
  const result = classifyTerrainSignature(input({ schoolElevationM: null }));
  assert.equal(result.ruleId, "insufficient");
  assert.ok(result.missing.some((m) => m.includes("ความสูง")));
});

test("ต้องข้ามเขาเข้ามาแต่ธง 8 ทิศไม่ครบ = ไม่พอข้อมูล (แยกหุบแคบจากหุบกว้างไม่ได้)", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 400,
      innerSlopePct: 3,
      sectors: null,
      routeTailMaxElev: 800,
      routeFullMaxElev: 1200,
      routeGainM: 800,
    }),
  );
  assert.equal(result.ruleId, "insufficient");
  assert.ok(result.missing.some((m) => m.includes("ทิศ")));
});

test("ธง 8 ทิศอ่านได้ไม่ถึง 7 ทิศ = ยังไม่พอสำหรับตัดสินความถูกล้อม", () => {
  const partial = sectorsWithHigher(400, 6).map((s, i) => (i >= 6 ? { ...s, highest: null, lowest: null } : s));
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 400,
      innerSlopePct: 3,
      sectors: partial,
      routeTailMaxElev: 800,
      routeFullMaxElev: 1200,
      routeGainM: 800,
    }),
  );
  assert.equal(result.ruleId, "insufficient");
});

test("ไม่รู้ความลาดชันรอบโรงเรียน = ไม่พอข้อมูล (แต่ภูเขาสูง ≥1,000 ม. ยังตัดสินได้)", () => {
  const noSlope = classifyTerrainSignature(input({ innerSlopePct: null }));
  assert.equal(noSlope.ruleId, "insufficient");

  const highMountain = classifyTerrainSignature(input({ schoolElevationM: 1200, innerSlopePct: null }));
  assert.equal(highMountain.ruleId, "R1");
});

test("ราบและสูงแต่ไม่มีค่าความสูงสะสมขาขึ้น = แยกที่ราบสูงจากพื้นราบไม่ได้", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 700,
      innerSlopePct: 3,
      sectors: sectorsWithHigher(700, 1),
      routeTailMaxElev: 710,
      routeFullMaxElev: 720,
      routeGainM: null,
      provinceAvgElev: 600,
    }),
  );
  assert.equal(result.ruleId, "insufficient");
});

test("ไม่มีข้อมูลความหนาแน่น: บอกภูมิประเทศได้ แต่ยังสรุปกลุ่มทุรกันดารไม่ได้", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 1100,
      innerSlopePct: 20,
      sectors: sectorsWithHigher(1100, 2),
      routeTailMaxElev: 1250,
      routeFullMaxElev: 1400,
      routeGainM: 1200,
      popDensityPerKm2: null,
      accessSeverity: 4,
      severityComponents: { rcr: 3, ttr: 4, avgSpeed: 4, gain: 4 },
    }),
  );
  assert.equal(result.ruleId, "R1");
  assert.equal(result.group, "unknown");
  assert.ok(result.missing.some((m) => m.includes("ความหนาแน่น")));
});

test("ไม่มีรายองค์ประกอบความยาก = ยังยืนยันกลุ่มภูเขาสูงทุรกันดารไม่ได้", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 1100,
      innerSlopePct: 20,
      sectors: sectorsWithHigher(1100, 2),
      routeTailMaxElev: 1250,
      routeFullMaxElev: 1400,
      routeGainM: 1200,
      accessSeverity: 4,
      severityComponents: null,
    }),
  );
  assert.equal(result.ruleId, "R1");
  assert.equal(result.group, "unknown");
});

test("ไม่มีค่าเฉลี่ยจังหวัด: โรงเรียนพื้นราบต้องไม่กลายเป็นภูเขา (กันบั๊กค่าเฉลี่ยเป็นศูนย์)", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 40,
      innerSlopePct: 13,
      sectors: sectorsWithHigher(40, 1),
      localMaxElevation1KmM: 60,
      routeTailMaxElev: 55,
      routeFullMaxElev: 60,
      routeGainM: 20,
      provinceAvgElev: null,
    }),
  );
  assert.notEqual(result.ruleId, "R2");
  assert.equal(result.ruleId, "R7");
});

// ── ความไม่แน่นอนใกล้เส้นแบ่ง ────────────────────────────────────────────────

test("ความสูง 987 ม. ต้องรายงานว่าใกล้เส้นแบ่งภูเขาสูง พร้อมระยะห่างจากเกณฑ์", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 987,
      innerSlopePct: 20,
      sectors: sectorsWithHigher(987, 2),
      localMaxElevation1KmM: 1100,
      routeTailMaxElev: 1050,
      routeFullMaxElev: 1200,
      routeGainM: 800,
    }),
  );
  assert.equal(result.nearBoundary, true);
  const altMargin = result.margins.find((m) => m.key === "schoolElevationM" && m.threshold === 1000);
  assert.ok(altMargin);
  assert.equal(altMargin.marginM, -13);
});

test("โรงเรียนที่ห่างทุกเส้นแบ่งชัดเจน ต้องไม่ถูกประทับว่าใกล้เส้นแบ่ง", () => {
  const result = classifyTerrainSignature(
    input({
      schoolElevationM: 320,
      innerSlopePct: 1,
      sectors: sectorsWithHigher(320, 0),
      localMaxElevation1KmM: 330,
      routeTailMaxElev: 325,
      routeFullMaxElev: 325,
      routeGainM: 20,
      // ค่าเฉลี่ยจังหวัดต้องอยู่ไกลจากเกณฑ์เส้นทางด้วย ไม่งั้นเคสนี้ยังใกล้เส้นแบ่งอยู่จริง
      provinceAvgElev: 300,
    }),
  );
  assert.equal(result.ruleId, "R6");
  assert.equal(result.nearBoundary, false);
});

test("ความสูงคร่อมเส้น 1,000 ม. สองฝั่ง ต้องถูกประทับว่าใกล้เส้นแบ่งทั้งคู่", () => {
  const common = {
    innerSlopePct: 20,
    localMaxElevation1KmM: 1200,
    routeTailMaxElev: 1150,
    routeFullMaxElev: 1300,
    routeGainM: 900,
  };
  const below = classifyTerrainSignature(
    input({ ...common, schoolElevationM: 999, sectors: sectorsWithHigher(999, 2) }),
  );
  const above = classifyTerrainSignature(
    input({ ...common, schoolElevationM: 1001, sectors: sectorsWithHigher(1001, 2) }),
  );
  assert.equal(below.nearBoundary, true);
  assert.equal(above.nearBoundary, true);
  assert.notEqual(below.ruleId, above.ruleId);
});

// ── สัญญาของผลลัพธ์ ─────────────────────────────────────────────────────────

test("ทุกผลลัพธ์แนบเวอร์ชันเกณฑ์ ป้ายภาษาไทย และหลักฐานค่าอินพุตที่ใช้ตัดสิน", () => {
  const result = classifyTerrainSignature(BASE);
  assert.equal(result.version, TERRAIN_SIGNATURE_VERSION);
  assert.ok(result.labelTh.length > 0);
  assert.ok(result.evidence.length > 0);
  assert.ok(result.evidence.every((e) => typeof e.label === "string" && e.label.length > 0));
});

test("เกณฑ์ความหนาแน่นของกฎเขตเมือง ต้องตรงกับจุดตัดกึ่งเมืองของ settlementClass เสมอ", () => {
  assert.equal(settlementClass(TS_URBAN_DENSITY_CUT).tone, "semi");
  assert.equal(settlementClass(TS_URBAN_DENSITY_CUT - 1).tone, "rural");
});

test("เกณฑ์ความสูง 'ภูเขา' ต้องอยู่ระหว่างเกณฑ์พื้นที่สูงกับเกณฑ์ภูเขาสูง", () => {
  assert.ok(TS_MOUNTAIN_MIN_ALT_M > TS_HIGHLAND_MIN_M);
  assert.ok(TS_MOUNTAIN_MIN_ALT_M < TS_HIGH_MOUNTAIN_M);
});

test("เกณฑ์ที่ราบผืนใหญ่ต้องต่ำกว่าความต่างระดับของโรงเรียนภูเขาจริงที่วัดได้ (109–378 ม.)", () => {
  assert.ok(TS_PLAIN_RELIEF_MAX_M < 109, "ต้องไม่แตะบ้านโคกงามซึ่งวัดได้ 109 ม.");
});

test("ตัวจำแนกไม่แก้ไขค่าที่รับเข้ามา", () => {
  const sectors = sectorsWithHigher(500, 3);
  const snapshot = JSON.stringify(sectors);
  classifyTerrainSignature(input({ schoolElevationM: 500, sectors }));
  assert.equal(JSON.stringify(sectors), snapshot);
});

test("ความลาดชันจากกริดทั้งผืนต้องระบุขอบเขตให้ชัด ไม่ปนกับความลาดชันรอบโรงเรียนจริง", () => {
  const wholeGrid = classifyTerrainSignature(input({ slopeSource: "analysis-grid" }));
  const inner = classifyTerrainSignature(input({ slopeSource: "inner-500m" }));
  const gridLabel = wholeGrid.evidence.find((e) => e.label.includes("ความลาดชัน"))?.label ?? "";
  const innerLabel = inner.evidence.find((e) => e.label.includes("ความลาดชัน"))?.label ?? "";
  assert.ok(gridLabel.includes("พื้นที่วิเคราะห์"), `ป้ายต้องบอกขอบเขตกริด: ${gridLabel}`);
  assert.notEqual(gridLabel, innerLabel);
});

test("ความลาดชันจากกริดทั้งผืนมีความไม่แน่นอนสูงกว่า จึงต้องประทับ 'ใกล้เส้นแบ่ง' ในช่วงที่ค่ารอบโรงเรียนไม่ต้อง", () => {
  const patch = {
    schoolElevationM: 400,
    innerSlopePct: 8,
    sectors: sectorsWithHigher(400, 1),
    localMaxElevation1KmM: 430,
    routeTailMaxElev: 430,
    routeFullMaxElev: 440,
    routeGainM: 60,
    provinceAvgElev: 350,
  };
  const fromGrid = classifyTerrainSignature(input({ ...patch, slopeSource: "analysis-grid" }));
  const fromInner = classifyTerrainSignature(input({ ...patch, slopeSource: "inner-500m" }));
  assert.equal(fromGrid.nearBoundary, true);
  assert.equal(fromInner.nearBoundary, false);
});

// ── ตัวแปลงจากผล GIS ที่บันทึกไว้ ─────────────────────────────────────────────

function gisFixture(patch: Record<string, unknown> = {}): GisAnalysis {
  return {
    center: { lat: 19.36, lng: 98.44, source: "unit", confirmedAt: "t", nearestProvinceName: "แม่ฮ่องสอน" },
    elevation: {
      schoolMarkerElevationM: 505,
      meanElevationM: 620,
      minElevationM: 480,
      maxElevationM: 1120,
      reliefM: 640,
      // หุบกว้าง: ผนังหุบอยู่ไกลเกินกริดวิเคราะห์ (~2.8 กม.) ค่าเฉลี่ยทั้งผืนจึงต่ำตามพื้นหุบจริง
      meanSlopePct: 4,
      maxSlopePct: 40,
      localMaxElevation1KmM: 540,
      slopeClass: "C",
      landformTh: "ชุมชนในหุบเขา",
      terrainConfidence: "client",
      provinceAvgElev: 400,
      routeFullMaxElev: 1300,
      routeTailMaxElev: 700,
    },
    routes: [],
    autoScore: null,
    radiusSummaries: [
      { radiusM: 500, buildingCount: 40, estPopulation: 140, popDensityPerKm2: 178 },
      { radiusM: 1000, buildingCount: 90, estPopulation: 315, popDensityPerKm2: 100 },
      { radiusM: 1500, buildingCount: 150, estPopulation: 525, popDensityPerKm2: 74 },
    ],
    sectorElevations: sectorsWithHigher(505, 1),
    appliedToResponses: true,
    savedAt: "t",
    ...patch,
  } as GisAnalysis;
}

const ROUTE_FIXTURE = {
  destinationType: "province_hall",
  destinationName: "ศาลากลาง",
  destLat: 19.3,
  destLng: 97.97,
  straightDistanceKm: 50,
  roadDistanceKm: 110,
  travelTimeMin: 180,
  roadCircuityRatio: 2.2,
  travelTimeRatio: 1.6,
  effectiveDistanceKm: 176,
  averageSpeedKmh: 36,
  elevationGainM: 850,
  elevationLossM: 640,
  routeSource: "osrm",
  selected: true,
  calculatedAt: "t",
} as GisRouteAnalysis;

test("ตัวแปลง: อ่านค่าจากผล GIS ที่บันทึกไว้แล้วจำแนกได้ตรงกับเคสหุบเขากว้าง", () => {
  const result = terrainSignatureFromGis(gisFixture(), {
    route: ROUTE_FIXTURE,
    accessSeverity: 3,
    severityComponents: { rcr: 4, ttr: 2, avgSpeed: 2, gain: 3 },
  });
  assert.equal(result.ruleId, "R4");
  assert.equal(result.group, "valley_flat");
});

test("ตัวแปลง: ใช้ความหนาแน่นของวงแหวนนอกสุด (1,500 ม.)", () => {
  const urban = terrainSignatureFromGis(
    gisFixture({
      radiusSummaries: [{ radiusM: 1500, buildingCount: 9000, estPopulation: 31500, popDensityPerKm2: 4456 }],
    }),
    { route: ROUTE_FIXTURE, accessSeverity: 3, severityComponents: null },
  );
  assert.equal(urban.ruleId, "R0");
});

test("ตัวแปลง: ลักษณะที่ตั้งที่ผู้กรอกระบุว่าเกาะ ต้องไปถึงตัวจำแนกและแยกกลุ่มออกมา", () => {
  const result = terrainSignatureFromGis(gisFixture(), {
    route: ROUTE_FIXTURE,
    accessSeverity: 3,
    severityComponents: { rcr: 4, ttr: 2, avgSpeed: 2, gain: 3 },
    declaredSettingType: "เกาะ",
  });
  assert.equal(result.ruleId, "R-I");
  assert.equal(result.group, "island");
});

test("ตัวแปลง: ไม่มีเส้นทางบกและไม่มีหลักฐานว่าเป็นเกาะ ต้องไม่เดาว่าเป็นเกาะ", () => {
  const result = terrainSignatureFromGis(
    gisFixture({
      routeAccess: { status: "no-route", note: "หาเส้นทางไม่พบ" },
      elevation: { ...gisFixture().elevation, routeTailMaxElev: null, routeFullMaxElev: null },
    }),
    { route: null, accessSeverity: null, severityComponents: null },
  );
  assert.notEqual(result.group, "island");
  assert.notEqual(result.group, "flat_normal");
});

test("ตัวแปลง: ถ้ามีความลาดชันรอบโรงเรียน ต้องใช้ค่านั้นแทนค่าเฉลี่ยทั้งกริด", () => {
  // ก้นหุบแคบ: รอบโรงเรียนราบ (3%) แต่ค่าเฉลี่ยทั้งผืนถูกผนังหุบดึงขึ้นเป็น 22%
  const gis = gisFixture({
    elevation: {
      ...gisFixture().elevation,
      meanSlopePct: 22,
      innerSlopePct: 3,
    },
  });
  const result = terrainSignatureFromGis(gis, {
    route: ROUTE_FIXTURE,
    accessSeverity: 3,
    severityComponents: { rcr: 4, ttr: 2, avgSpeed: 2, gain: 3 },
  });
  const slopeLabel = result.evidence.find((e) => e.label.includes("ความลาดชัน"));
  assert.ok(slopeLabel?.label.includes("รอบโรงเรียน"), `ต้องใช้ค่ารอบโรงเรียน: ${slopeLabel?.label}`);
  assert.ok(slopeLabel?.value.startsWith("3"), `ต้องเป็นค่ารอบโรงเรียน 3% ไม่ใช่ 22%: ${slopeLabel?.value}`);
  assert.equal(result.ruleId, "R4");
});

test("ตัวแปลง: แถวเก่าที่ยังไม่มีข้อมูลความสูง ต้องตอบว่าไม่พอข้อมูล", () => {
  const result = terrainSignatureFromGis(gisFixture({ elevation: null }), {
    route: null,
    accessSeverity: null,
    severityComponents: null,
  });
  assert.equal(result.ruleId, "insufficient");
});
