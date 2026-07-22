// Unit tests สำหรับ lib/gis.ts — เอนจินวิเคราะห์ GIS (RCR/TTR/Effective Distance/Auto GIS Score)
// กัน regress: คณิตศาสตร์ ratio + boundary ทุกช่วงของทุกตาราง severity + การ derive มิติ 3
// ผ่านเอนจินคะแนนเดิม + ธง V11/V12/V14/V19/V20 + sanitize round-trip (แถว v1 ต้องไม่งอก key)
// รันด้วย: npm test  (node:test + tsx loader — ไม่มี runtime dependency เพิ่ม)

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  computeRcr,
  computeTtr,
  computeAvgSpeed,
  computeEffectiveDistance,
  rcrSeverity,
  avgSpeedSeverity,
  ttrSeverity,
  elevationGainSeverity,
  elevationGainLoss,
  buildRouteAnalysis,
  routePhysicsIssue,
  primaryRoute,
  hospitalRoute,
  derive32Severity,
  deriveD3Responses,
  computeAutoGisScore,
  computeCommunityClass,
  classifyCommunity,
  isCommunityElevHigh,
  landformSuggestsHighland,
  effectiveScoringVersion,
  sanitizeGis,
  clampGisPayload,
  finalizeGisAnalysis,
  settlementClass,
  cleanAreaSummary,
  cleanHighestPoint,
  cleanRadiusSummaries,
  cleanDataSources,
  GIS_LIMITS,
  MAX_GIS_ROUTES,
  COMMUNITY_HIGHLAND_MIN_M,
  COMMUNITY_HIGH_MOUNTAIN_M,
  COMMUNITY_CLASS_VERSION,
  SSRA_HILL_ELEV_MIN_M,
  SSRA_MOUNTAIN_ELEV_MIN_M,
  officialElevBandTh,
  landformAppLabelNoteTh,
  landformThresholdLegendRows,
  communityAxisATierLabelTh,
  suggestSettingTypeFromGis,
  displacementRatio,
  futureIndicators,
  FUTURE_INDICATOR_IDS,
} from "../lib/gis";
import { MORPHOLOGY_HIGH_MOUNTAIN_M, MORPHOLOGY_HIGHLAND_MIN_M, maxFiniteElev } from "../lib/map/morphology";
import { flags, scoreIndicator } from "../lib/scoring";
import { makeBlankState, sanitizeState } from "../lib/state";
import { estimateWscClass, wscProxySuggestsFlat, wscProxySuggestsUpland } from "../lib/wsc-proxy";
import type { AssessmentState, GisAnalysis, GisElevationInfo, GisRouteAnalysis } from "../lib/types";

// ───────────────────────── fixtures ─────────────────────────

/** เส้นทาง "กันดารหนัก" ค่าสอดคล้องกันเอง: 72 กม. / 180 นาที → RCR 2.4, TTR 2.5, speed 24, ED 180 */
function makeRoute(over: Partial<GisRouteAnalysis> = {}): GisRouteAnalysis {
  return {
    destinationType: "province_hall",
    destinationName: "ศาลากลางจังหวัดทดสอบ",
    destLat: 18.5,
    destLng: 99.0,
    straightDistanceKm: 30,
    roadDistanceKm: 72,
    travelTimeMin: 180,
    roadCircuityRatio: 2.4,
    travelTimeRatio: 2.5,
    effectiveDistanceKm: 180,
    averageSpeedKmh: 24,
    elevationGainM: 1200,
    elevationLossM: 300,
    routeSource: "osrm",
    selected: true,
    calculatedAt: "2569-01-01T00:00:00.000Z",
    ...over,
  };
}

/** เส้นทาง "ปกติ": 20 กม. / 18 นาที → RCR 1.11, TTR 0.9, speed 66.7, gain 20 */
function makeNormalRoute(over: Partial<GisRouteAnalysis> = {}): GisRouteAnalysis {
  return makeRoute({
    straightDistanceKm: 18,
    roadDistanceKm: 20,
    travelTimeMin: 18,
    roadCircuityRatio: 1.11,
    travelTimeRatio: 0.9,
    effectiveDistanceKm: 18,
    averageSpeedKmh: 66.7,
    elevationGainM: 20,
    elevationLossM: 10,
    ...over,
  });
}

/** ค่าเริ่มต้น GisElevationInfo — schoolMarkerElevationM 1200 ม. สอดคล้องกับเส้นทาง "กันดารหนัก" ของ makeRoute() */
function makeElevation(over: Partial<GisElevationInfo> = {}): GisElevationInfo {
  return {
    schoolMarkerElevationM: 1200,
    meanElevationM: 1200,
    minElevationM: 1100,
    maxElevationM: 1300,
    reliefM: 200,
    meanSlopePct: 25,
    maxSlopePct: 30,
    localMaxElevation1KmM: 1250,
    slopeClass: "E: เนินเขา/ลาดชันสูง (20–35%)",
    landformTh: "ชุมชนบนภูเขา",
    terrainConfidence: "client",
    provinceAvgElev: null,
    routeFullMaxElev: null,
    routeTailMaxElev: null,
    ...over,
  };
}

function makeGis(over: Partial<GisAnalysis> = {}): GisAnalysis {
  return {
    center: {
      lat: 19.0,
      lng: 99.5,
      source: "unit",
      confirmedAt: "2569-01-01T00:00:00.000Z",
      nearestProvinceName: "เชียงใหม่",
    },
    elevation: makeElevation(),
    routes: [makeRoute()],
    autoScore: null,
    appliedToResponses: false,
    savedAt: "2569-01-01T00:00:00.000Z",
    ...over,
  };
}

function stateWithGis(gis: GisAnalysis): AssessmentState {
  const s = makeBlankState();
  s.gis = gis;
  return s;
}

function flagCodes(state: AssessmentState): string[] {
  return flags(state).map((f) => f.code);
}

// ───────────────────────── 1) คณิตศาสตร์ ratio ─────────────────────────

describe("ratio math — ตัวอย่างจาก PRD และ guard", () => {
  test("RCR: 72 ÷ 30 = 2.40 (ตัวอย่าง PRD §7.1)", () => {
    assert.equal(computeRcr(72, 30), 2.4);
  });
  test("RCR: เส้นตรงสั้นเกิน (≤0.05 กม.) → null", () => {
    assert.equal(computeRcr(10, 0.05), null);
    assert.equal(computeRcr(10, 0), null);
  });
  test("TTR: 45 กม. 90 นาที → อ้างอิง 45 นาที → 2.00", () => {
    assert.equal(computeTtr(45, 90), 2);
  });
  test("TTR: 80 กม. 180 นาที → 2.25 (ตัวอย่าง PRD §7.2)", () => {
    assert.equal(computeTtr(80, 180), 2.25);
  });
  test("Effective Distance: 60 กม. × TTR 2.5 = 150 กม. (ตัวอย่าง PRD §7.3)", () => {
    assert.equal(computeEffectiveDistance(60, 2.5), 150);
  });
  test("ความเร็วเฉลี่ย: 45 กม. 90 นาที = 30 กม./ชม.", () => {
    assert.equal(computeAvgSpeed(45, 90), 30);
  });
  test("guard ค่าใช้ไม่ได้ → null", () => {
    assert.equal(computeAvgSpeed(45, 0), null);
    assert.equal(computeTtr(0, 90), null);
    assert.equal(computeEffectiveDistance(0, 2), null);
  });
});

// ───────────────────────── 2) Boundary ทุกตาราง severity ─────────────────────────

describe("rcrSeverity — เกณฑ์ PRD ตรงตัว", () => {
  const cases: [number, number][] = [
    [1.29, 0],
    [1.3, 1],
    [1.49, 1],
    [1.5, 2],
    [1.79, 2],
    [1.8, 3],
    [2.09, 3],
    [2.1, 4],
    [5, 4],
  ];
  for (const [rcr, expect] of cases) {
    test(`RCR ${rcr} → ระดับ ${expect}`, () => assert.equal(rcrSeverity(rcr), expect));
  }
  test("null → null", () => assert.equal(rcrSeverity(null), null));
});

describe("avgSpeedSeverity — เกณฑ์ PRD ตรงตัว", () => {
  const cases: [number, number][] = [
    [60.1, 0],
    [60, 1],
    [45, 1],
    [44.99, 2],
    [30, 2],
    [29.99, 3],
    [20, 3],
    [19.99, 4],
    [5, 4],
  ];
  for (const [speed, expect] of cases) {
    test(`${speed} กม./ชม. → ระดับ ${expect}`, () => assert.equal(avgSpeedSeverity(speed), expect));
  }
  test("null → null", () => assert.equal(avgSpeedSeverity(null), null));
});

describe("ttrSeverity", () => {
  const cases: [number, number][] = [
    [1.29, 0],
    [1.3, 1],
    [1.59, 1],
    [1.6, 2],
    [1.99, 2],
    [2.0, 3],
    [2.49, 3],
    [2.5, 4],
  ];
  for (const [ttr, expect] of cases) {
    test(`TTR ${ttr} → ระดับ ${expect}`, () => assert.equal(ttrSeverity(ttr), expect));
  }
});

describe("elevationGainSeverity", () => {
  const cases: [number, number][] = [
    [99, 0],
    [100, 1],
    [299, 1],
    [300, 2],
    [599, 2],
    [600, 3],
    [999, 3],
    [1000, 4],
  ];
  for (const [gain, expect] of cases) {
    test(`ไต่สะสม ${gain} ม. → ระดับ ${expect}`, () => assert.equal(elevationGainSeverity(gain), expect));
  }
});

// ───────────────────────── 3) elevationGainLoss ─────────────────────────

describe("elevationGainLoss — ความสูงสะสมตามเส้นทาง", () => {
  test("ขึ้นทางเดียว", () => {
    assert.deepEqual(elevationGainLoss([0, 10, 20, 30]), { gainM: 30, lossM: 0 });
  });
  test("ขึ้น-ลง-ขึ้น", () => {
    assert.deepEqual(elevationGainLoss([0, 100, 50, 150]), { gainM: 200, lossM: 50 });
  });
  test("noise ต่ำกว่า 3 ม. ถูกตัดทิ้ง", () => {
    assert.deepEqual(elevationGainLoss([0, 1, 2, 1, 2, 1]), { gainM: 0, lossM: 0 });
  });
  test("ทางขึ้นทีละน้อยยังนับสะสมได้ (anchor เลื่อนเมื่อครบ 3 ม.)", () => {
    assert.deepEqual(elevationGainLoss([0, 2, 4, 6, 8, 10]), { gainM: 8, lossM: 0 });
  });
  test("ข้าม NaN (ไทล์ DEM โหลดพลาด)", () => {
    assert.deepEqual(elevationGainLoss([0, Number.NaN, 50]), { gainM: 50, lossM: 0 });
  });
  test("อาร์เรย์ว่าง → 0/0", () => {
    assert.deepEqual(elevationGainLoss([]), { gainM: 0, lossM: 0 });
  });
});

// ───────────────────────── 4) buildRouteAnalysis + physics ─────────────────────────

describe("buildRouteAnalysis — คำนวณครบจากวัตถุดิบดิบ", () => {
  test("60 กม. 90 นาที → speed 40, TTR 1.5, ED 90", () => {
    const route = buildRouteAnalysis(
      18.0,
      99.0,
      {
        destinationType: "district_office",
        destinationName: "ที่ว่าการอำเภอทดสอบ",
        destLat: 18.2,
        destLng: 99.2,
        roadDistanceM: 60000,
        durationS: 5400,
        elevationGainM: 450,
        elevationLossM: 120,
        selected: true,
      },
      "2569-01-01T00:00:00.000Z",
    );
    assert.ok(route);
    assert.equal(route.roadDistanceKm, 60);
    assert.equal(route.travelTimeMin, 90);
    assert.equal(route.averageSpeedKmh, 40);
    assert.equal(route.travelTimeRatio, 1.5);
    assert.equal(route.effectiveDistanceKm, 90);
    assert.ok(route.straightDistanceKm > 20 && route.straightDistanceKm < 40, "haversine ~30 กม.");
    assert.equal(route.roadCircuityRatio, Math.round((60 / route.straightDistanceKm) * 100) / 100);
    assert.equal(route.elevationGainM, 450);
  });
  test("ข้อมูลดิบใช้ไม่ได้ → null", () => {
    const base = {
      destinationType: "other" as const,
      destinationName: "x",
      destLat: 18.2,
      destLng: 99.2,
      roadDistanceM: 60000,
      durationS: 5400,
      elevationGainM: null,
      elevationLossM: null,
      selected: false,
    };
    assert.equal(buildRouteAnalysis(18, 99, { ...base, destLat: 999 }, "t"), null);
    assert.equal(buildRouteAnalysis(18, 99, { ...base, roadDistanceM: 0 }, "t"), null);
    assert.equal(buildRouteAnalysis(18, 99, { ...base, durationS: -5 }, "t"), null);
  });
  test("physics: ถนนสั้นกว่าเส้นตรง / เร็วเกินจริง → มีข้อความเหตุผล", () => {
    assert.ok(routePhysicsIssue(10, 20, 50));
    assert.ok(routePhysicsIssue(100, 50, 180));
    assert.equal(routePhysicsIssue(72, 30, 24), null);
  });
});

// ───────────────────────── 5) derive มิติ 3 → ผ่านเอนจินคะแนนเดิม ─────────────────────────

describe("deriveD3Responses — ค่าที่ derive ต้องคิดคะแนนผ่าน scoreIndicator เดิมได้ถูกต้อง", () => {
  test("เส้นทางกันดารหนัก: 3.1=8 (180 นาที), 3.2=10 (ระดับ 4), 3.3=10 (รพ. 130 นาที)", () => {
    const gis = makeGis({
      routes: [
        makeRoute({ destinationType: "district_office", destinationName: "สพป.ทดสอบ เขต 9" }),
        makeRoute({
          destinationType: "hospital",
          destinationName: "โรงพยาบาลอำเภอทดสอบ",
          roadDistanceKm: 60,
          travelTimeMin: 130,
        }),
      ],
    });
    const derived = deriveD3Responses(gis);
    assert.deepEqual(derived["3.1"], { minutes: "180", km: "72.0" });
    assert.deepEqual(derived["3.2"], { level: "4" });
    assert.deepEqual(derived["3.3"], { minutes: "130", unitName: "โรงพยาบาลอำเภอทดสอบ" });

    const s = makeBlankState();
    Object.assign(s.responses, derived);
    assert.equal(scoreIndicator("3.1", s), 8, "180 นาที → ไม่เกิน 3 ชม. = 8 คะแนน");
    assert.equal(scoreIndicator("3.2", s), 10, "ระดับ 4 = 10 คะแนน");
    assert.equal(scoreIndicator("3.3", s), 10, "130 นาที → เกิน 2 ชม. = 10 คะแนน");
  });

  test("เส้นทางปกติ: severity 0 ทุกตัว → 3.1=0, 3.2=0", () => {
    const gis = makeGis({ routes: [makeNormalRoute()] });
    const derived = deriveD3Responses(gis);
    const s = makeBlankState();
    Object.assign(s.responses, derived);
    assert.equal(scoreIndicator("3.1", s), 0, "18 นาที → ไม่เกิน 30 นาที = 0 คะแนน");
    assert.equal(scoreIndicator("3.2", s), 0);
    assert.equal(derived["3.3"], undefined, "ไม่มีเส้นทาง รพ. → ไม่แตะ 3.3");
    assert.equal(scoreIndicator("3.3", s), null, "3.3 ยังไม่กรอก");
  });

  test("primaryRoute เลือก district_office ก่อน province_hall", () => {
    const gis = makeGis({
      routes: [
        makeRoute({ destinationType: "province_hall", travelTimeMin: 300 }),
        makeRoute({ destinationType: "district_office", travelTimeMin: 45 }),
      ],
    });
    assert.equal(primaryRoute(gis)?.travelTimeMin, 45);
    assert.equal(deriveD3Responses(gis)["3.1"]?.minutes, "45");
  });

  test("derive32Severity = worst-of ของตัวชี้วัดที่มีข้อมูล", () => {
    // RCR 1.11 (0) / TTR 0.9 (0) / speed 66.7 (0) / gain 650 (3) → 3
    const gis = makeGis({ routes: [makeNormalRoute({ elevationGainM: 650 })] });
    assert.equal(derive32Severity(gis), 3);
    // ไม่มีเส้นทาง → null
    assert.equal(derive32Severity(makeGis({ routes: [] })), null);
  });
});

// ───────────────────────── 6) Auto GIS Score ─────────────────────────

describe("computeAutoGisScore — เต็ม 45, นับเฉพาะที่คำนวณได้", () => {
  test("ข้อมูลครบ (มี รพ.): 38 / 40 (จากเต็ม 45)", () => {
    const gis = makeGis({
      routes: [
        makeRoute(), // RCR sev4→10, TTR sev4→10, speed sev3→4, gain sev4
        makeRoute({ destinationType: "hospital", roadDistanceKm: 60, travelTimeMin: 130 }),
      ],
    });
    const auto = computeAutoGisScore(gis, "2569-01-01T00:00:00.000Z");
    assert.ok(auto);
    assert.deepEqual(auto.components, {
      elevation: 4, // 1200 ม. → 4
      slopeGain: 5, // max(slope 25% → 4, gain sev4 → 5)
      rcr: 10,
      ttr: 10,
      avgSpeed: 4,
      serviceDistance: 5, // รพ. 60 กม. → 5
      borderMunicipality: null,
    });
    assert.equal(auto.total, 38);
    assert.equal(auto.maxComputable, 40);
    assert.equal(auto.max, 45);
  });

  test("ไม่มี รพ. → serviceDistance = null, maxComputable = 35", () => {
    const auto = computeAutoGisScore(makeGis(), "t");
    assert.ok(auto);
    assert.equal(auto.components.serviceDistance, null);
    assert.equal(auto.maxComputable, 35);
  });

  test("ไม่มีข้อมูลอะไรเลย → null", () => {
    assert.equal(computeAutoGisScore(makeGis({ routes: [], elevation: null }), "t"), null);
  });

  test("invariant: total ≤ maxComputable ≤ 45", () => {
    const auto = computeAutoGisScore(makeGis(), "t");
    assert.ok(auto && auto.total <= auto.maxComputable && auto.maxComputable <= 45);
  });
});

// ───────────────────────── 7) ธง V11/V12/V14/V19/V20 ─────────────────────────

describe("ธงชุด GIS ใน flags()", () => {
  test("ไม่มี gis → ไม่มีธงชุด GIS (แถว v1 ได้ธงชุดเดิมเป๊ะ)", () => {
    const codes = flagCodes(makeBlankState());
    for (const code of ["V11", "V12", "V14", "V19", "V20"]) {
      assert.ok(!codes.includes(code), `ไม่ควรมี ${code}`);
    }
  });

  test("V11: จังหวัดใกล้สุดไม่ตรงกับที่กรอก", () => {
    const s = stateWithGis(makeGis());
    s.unit.province = "น่าน"; // gis อยู่ใกล้ศาลากลางเชียงใหม่
    assert.ok(flagCodes(s).includes("V11"));
    s.unit.province = "เชียงใหม่";
    assert.ok(!flagCodes(s).includes("V11"));
  });

  test("V12: ระยะถนนสั้นกว่าระยะเส้นตรง", () => {
    const s = stateWithGis(
      makeGis({
        routes: [makeRoute({ roadDistanceKm: 20, straightDistanceKm: 30 })],
      }),
    );
    assert.ok(flagCodes(s).includes("V12"));
  });

  test("V14: RCR ของเส้นทางหลัก > 3.0", () => {
    const s = stateWithGis(
      makeGis({
        routes: [makeRoute({ roadCircuityRatio: 3.2 })],
      }),
    );
    assert.ok(flagCodes(s).includes("V14"));
    assert.ok(!flagCodes(stateWithGis(makeGis())).includes("V14"), "RCR 2.4 ไม่ติดธง");
  });

  test("V19: GIS บ่งชี้ระดับ 4 แต่เลือกเองระดับ 1", () => {
    const s = stateWithGis(makeGis()); // severity 4
    s.responses["3.2"] = { level: "1" };
    assert.ok(flagCodes(s).includes("V19"));
    assert.ok(!flagCodes(s).includes("V20"));
  });

  test("V20: เลือกเองระดับ 4 แต่ GIS บ่งชี้ระดับ 0", () => {
    const s = stateWithGis(makeGis({ routes: [makeNormalRoute()] })); // severity 0
    s.responses["3.2"] = { level: "4" };
    assert.ok(flagCodes(s).includes("V20"));
    assert.ok(!flagCodes(s).includes("V19"));
  });

  test("ต่างกัน 1 ระดับ หรือยังไม่เลือก 3.2 → ไม่ติดธง", () => {
    const s = stateWithGis(makeGis()); // severity 4
    s.responses["3.2"] = { level: "3" };
    assert.ok(!flagCodes(s).includes("V19"));
    const blank = stateWithGis(makeGis());
    assert.ok(!flagCodes(blank).includes("V19") && !flagCodes(blank).includes("V20"));
  });

  test("V03: กรอกเวลา 3.1 = 300 นาที แต่ GIS 180 นาที (>50%) → ติด V03 ที่ 3.1", () => {
    const s = stateWithGis(makeGis()); // primaryRoute travelTimeMin = 180
    s.responses["3.1"] = { minutes: "300" };
    const f = flags(s).find((x) => x.code === "V03" && x.id === "3.1");
    assert.ok(f, "ควรมี V03 ที่ 3.1");
    assert.equal(f?.tone, "warn");
  });

  test("V03: กรอก 3.1 = 200 นาที เทียบ GIS 180 (ไม่ถึง 50%) → ไม่ติด V03", () => {
    const s = stateWithGis(makeGis());
    s.responses["3.1"] = { minutes: "200" };
    assert.ok(!flagCodes(s).includes("V03"));
  });

  test("V03: 3.3 มีเส้นทางโรงพยาบาล — กรอก 100 แต่ GIS 40 นาที (>50%) → ติด V03 ที่ 3.3", () => {
    const gis = makeGis({
      routes: [makeRoute(), makeRoute({ destinationType: "hospital", destinationName: "รพ.ทดสอบ", travelTimeMin: 40 })],
    });
    const s = stateWithGis(gis);
    s.responses["3.3"] = { minutes: "100" };
    const f = flags(s).find((x) => x.code === "V03" && x.id === "3.3");
    assert.ok(f, "ควรมี V03 ที่ 3.3");
  });

  test("V03: ไม่มี gis หรือไม่ได้กรอกนาที → ไม่ติด V03", () => {
    assert.ok(!flagCodes(makeBlankState()).includes("V03"));
    assert.ok(!flagCodes(stateWithGis(makeGis())).includes("V03"), "มี gis แต่ไม่กรอก 3.1/3.3 → ไม่ติด");
  });

  test("ธงชุด GIS เป็น info/warn เท่านั้น — ไม่กระทบ canSubmit", () => {
    const s = stateWithGis(
      makeGis({ routes: [makeRoute({ roadCircuityRatio: 3.5, roadDistanceKm: 20, straightDistanceKm: 30 })] }),
    );
    s.unit.province = "น่าน";
    s.responses["3.2"] = { level: "0" };
    const gisFlags = flags(s).filter((f) =>
      ["V11", "V12", "V14", "V19", "V20", "V21", "V22", "V23", "V24", "V25", "V26"].includes(f.code),
    );
    assert.ok(gisFlags.length >= 3);
    for (const f of gisFlags) assert.notEqual(f.tone, "block");
  });

  test("V21: flat_normal แต่เลือก 3.2 ≥ 3", () => {
    const s = stateWithGis(
      makeGis({
        elevation: makeElevation({
          schoolMarkerElevationM: 80,
          meanSlopePct: 2,
          slopeClass: "B",
          landformTh: "ชุมชนบนพื้นราบ",
          provinceAvgElev: 100,
          routeFullMaxElev: 90,
        }),
        routes: [makeNormalRoute()],
      }),
    );
    s.responses["3.2"] = { level: "3" };
    assert.ok(flagCodes(s).includes("V21"));
    s.responses["3.2"] = { level: "1" };
    assert.ok(!flagCodes(s).includes("V21"));
  });

  test("V22: พื้นที่สูงแต่ severity เข้าถึง = 0", () => {
    const s = stateWithGis(
      makeGis({
        elevation: makeElevation({
          schoolMarkerElevationM: 900,
          meanSlopePct: 10,
          slopeClass: "C",
          landformTh: "ชุมชนบนภูเขา",
          provinceAvgElev: 400,
          routeFullMaxElev: 920,
        }),
        routes: [makeNormalRoute()],
      }),
    );
    assert.equal(derive32Severity(s.gis!), 0);
    assert.ok(flagCodes(s).includes("V22"));
  });

  test("V23: เมืองหนาแน่น + พื้นที่สูง", () => {
    const gis = makeGis();
    gis.areaSummary = {
      areaKm2: 1,
      buildingCount: 5000,
      estPopulation: 10000,
      buildingDensityPerKm2: 5000,
      popDensityPerKm2: 3000,
      settlementLabel: settlementClass(3000).label,
      calculatedAt: "t",
    };
    gis.communityClass = computeCommunityClass(gis, "t");
    const s = stateWithGis(gis);
    assert.equal(s.gis?.communityClass?.axisC?.tone, "urban");
    assert.ok(flagCodes(s).includes("V23"));
  });
});

// ───────────────────────── 8) sanitize round-trip ─────────────────────────

describe("sanitizeGis + sanitizeState — allowlist และ round-trip", () => {
  test("sanitizeGis maps legacy schoolElevationM to the exact marker field", () => {
    const raw = {
      ...makeGis(),
      elevation: {
        schoolElevationM: 1062,
        meanSlopePct: 10,
        slopeClass: "B",
        landformTh: "ชุมชนบนพื้นราบ",
        terrainConfidence: "client",
      },
    };
    const gis = sanitizeGis(raw);
    assert.equal(gis?.elevation?.schoolMarkerElevationM, 1062);
    assert.equal("schoolElevationM" in (gis?.elevation ?? {}), false);
  });

  test("แถว v1 (ไม่มี gis) → ไม่งอก key gis/scoringVersion", () => {
    const out = sanitizeState(JSON.parse(JSON.stringify(makeBlankState())));
    assert.ok(!("gis" in out), "ต้องไม่มี key gis");
    assert.ok(!("scoringVersion" in out), "ต้องไม่มี key scoringVersion");
  });

  test("state ที่มี gis ครบ → รอด JSON round-trip + sanitize โดยค่าไม่เพี้ยน", () => {
    const s = makeBlankState();
    s.gis = makeGis({
      routes: [makeRoute(), makeRoute({ destinationType: "hospital", roadDistanceKm: 60, travelTimeMin: 130 })],
    });
    s.scoringVersion = "v2-gis";
    // server-owned: autoScore + communityClass มาจาก finalizeGisAnalysis (เดียวกับ sanitizeGis)
    s.gis = finalizeGisAnalysis(s.gis, { calculatedAt: s.gis.savedAt });
    const out = sanitizeState(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(out.gis, s.gis);
    assert.equal(out.scoringVersion, "v2-gis");
  });

  test("scoringVersion v2-gis โดยไม่มี gis → ถูกตัดทิ้ง", () => {
    const raw = JSON.parse(JSON.stringify(makeBlankState()));
    raw.scoringVersion = "v2-gis";
    const out = sanitizeState(raw);
    assert.ok(!("scoringVersion" in out));
  });

  test("พิกัด center ใช้ไม่ได้ → gis ทั้งก้อนถูกตัด (กลับเป็น v1)", () => {
    const gis = makeGis();
    (gis.center as { lat: number }).lat = 999;
    assert.equal(sanitizeGis(gis), undefined);
  });

  test("ค่าเกินช่วง → ถูก clamp", () => {
    const gis = makeGis({
      routes: [makeRoute({ roadDistanceKm: 99999, travelTimeMin: 999999, averageSpeedKmh: 900 })],
    });
    const out = sanitizeGis(gis);
    assert.ok(out);
    assert.equal(out.routes[0].roadDistanceKm, GIS_LIMITS.distanceKm.max);
    assert.equal(out.routes[0].travelTimeMin, GIS_LIMITS.travelTimeMin.max);
    assert.equal(out.routes[0].averageSpeedKmh, GIS_LIMITS.speedKmh.max);
  });

  test("routes เกินเพดานถูกตัดเหลือ MAX_GIS_ROUTES", () => {
    const gis = makeGis({ routes: Array.from({ length: 9 }, () => makeRoute()) });
    const out = sanitizeGis(gis);
    assert.equal(out?.routes.length, MAX_GIS_ROUTES);
  });

  test("destinationType แปลกปลอม → กลายเป็น other; route พิกัดพัง → ถูกตัดทิ้ง", () => {
    const weird = makeRoute();
    (weird as { destinationType: string }).destinationType = "evil";
    const broken = makeRoute();
    (broken as { destLat: number }).destLat = 555;
    const out = sanitizeGis(makeGis({ routes: [weird, broken] }));
    assert.equal(out?.routes.length, 1);
    assert.equal(out?.routes[0].destinationType, "other");
  });
});

// ───────────────────────── 9) effectiveScoringVersion ─────────────────────────

// ───────────────────────── 10) ข้อสรุปพื้นที่ (settlementClass + cleanAreaSummary) ─────────────────────────

describe("settlementClass — เกณฑ์ความหนาแน่นประชากร", () => {
  const cases: [number, string][] = [
    [0, "sparse"],
    [99, "sparse"],
    [100, "rural"],
    [749, "rural"],
    [750, "semi"],
    [2499, "semi"],
    [2500, "urban"],
    [10000, "urban"],
  ];
  for (const [density, tone] of cases) {
    test(`${density} คน/ตร.กม. → ${tone}`, () => assert.equal(settlementClass(density).tone, tone));
  }
});

// ───────────────────────── 10b) จำแนกชุมชน 3 แกน (classifyCommunity) ─────────────────────────

describe("classifyCommunity / computeCommunityClass — พื้นที่สูง vs พื้นราบ", () => {
  test("isCommunityElevHigh: ≥500 หรือ > ค่าเฉลี่ยจังหวัด", () => {
    assert.equal(isCommunityElevHigh(500, null), true);
    assert.equal(isCommunityElevHigh(499, null), false);
    assert.equal(isCommunityElevHigh(400, 300), true);
    assert.equal(isCommunityElevHigh(400, 500), false);
    assert.equal(isCommunityElevHigh(null, 100), false);
  });

  test("landformSuggestsHighland: ภูเขา/หุบเขา/เชิงเขา ใช่ · พื้นราบ/เนินเขา อย่างเดียว ไม่", () => {
    assert.equal(landformSuggestsHighland("ชุมชนบนภูเขาสูง"), true);
    assert.equal(landformSuggestsHighland("ชุมชนบนภูเขา"), true);
    assert.equal(landformSuggestsHighland("ชุมชนในหุบเขา"), true);
    assert.equal(landformSuggestsHighland("ชุมชนเชิงเขา/ที่ลาดเชิงเขา"), true);
    assert.equal(landformSuggestsHighland("ชุมชนบนพื้นราบ"), false);
    assert.equal(landformSuggestsHighland("ชุมชนบนเนินเขา"), false);
  });

  test("ดอยสูงเข้าถึงยาก + หนาแน่นเมือง → highland_remote (C ไม่ลบล้าง A/B)", () => {
    const cc = classifyCommunity({
      schoolElevationM: 1180,
      provinceAvgElev: 400,
      routeFullMaxElev: 1300,
      landformTh: "ชุมชนบนภูเขาสูง",
      accessSeverity: 4,
      popDensityPerKm2: 3000,
    });
    assert.equal(cc.axisA.highland, true);
    assert.equal(cc.axisA.tier, "high");
    assert.equal(cc.axisB.severity, 4);
    assert.equal(cc.axisC?.tone, "urban");
    assert.equal(cc.composite.key, "highland_remote");
    assert.equal(cc.version, COMMUNITY_CLASS_VERSION);
  });

  test("หมู่บ้านพื้นราบเบาบาง เข้าถึงปกติ → flat_normal (ไม่ใช่พื้นที่พิเศษ)", () => {
    const cc = classifyCommunity({
      schoolElevationM: 80,
      provinceAvgElev: 120,
      routeFullMaxElev: 90,
      landformTh: "ชุมชนบนพื้นราบ",
      accessSeverity: 0,
      popDensityPerKm2: 50,
    });
    assert.equal(cc.axisA.highland, false);
    assert.equal(cc.axisA.tier, "low");
    assert.equal(cc.axisC?.tone, "sparse");
    assert.equal(cc.composite.key, "flat_normal");
  });

  test("พื้นราบเข้าถึงยาก → flat_remote", () => {
    const cc = classifyCommunity({
      schoolElevationM: 50,
      provinceAvgElev: 80,
      routeFullMaxElev: 60,
      landformTh: "ชุมชนบนพื้นราบ",
      accessSeverity: 3,
      popDensityPerKm2: 200,
    });
    assert.equal(cc.composite.key, "flat_remote");
    assert.equal(cc.axisA.highland, false);
  });

  test("ที่ราบสูงเข้าถึงง่าย → highland_accessible", () => {
    const cc = classifyCommunity({
      schoolElevationM: 700,
      provinceAvgElev: 400,
      routeFullMaxElev: 720,
      landformTh: "ชุมชนบนภูเขา",
      accessSeverity: 1,
      popDensityPerKm2: null,
    });
    assert.equal(cc.composite.key, "highland_accessible");
    assert.equal(cc.axisC, null);
  });

  test("elev 400 > provinceAvg 200 → เข้าประตูพื้นที่สูง (SSRA เทียบจังหวัด)", () => {
    const cc = classifyCommunity({
      schoolElevationM: 400,
      provinceAvgElev: 200,
      routeFullMaxElev: null,
      landformTh: "ชุมชนบนเนินเขา",
      accessSeverity: 2,
    });
    assert.equal(cc.axisA.highland, true);
    assert.equal(cc.composite.key, "highland_remote");
  });

  test("elev 400 แต่เส้นทางผ่าน 800 → highland ผ่าน route gate", () => {
    const cc = classifyCommunity({
      schoolElevationM: 400,
      provinceAvgElev: 500,
      routeFullMaxElev: 800,
      landformTh: "ชุมชนในหุบเขา",
      accessSeverity: 3,
    });
    assert.equal(cc.axisA.highland, true);
    assert.ok(cc.axisA.reasons.some((r) => r.includes("เส้นทาง") || r.includes("หุบเขา")));
    assert.equal(cc.composite.key, "highland_remote");
  });

  test("computeCommunityClass จาก makeGis กันดาร → highland_remote", () => {
    const gis = makeGis(); // elev 1200, hard route
    const cc = computeCommunityClass(gis, "t");
    assert.equal(cc.axisA.highland, true);
    assert.equal(cc.composite.key, "highland_remote");
    assert.equal(cc.axisB.severity, derive32Severity(gis));
  });

  test("sanitizeGis เขียน communityClass ใหม่ — ไม่เชื่อ client ปลอม", () => {
    const gis = makeGis({
      elevation: makeElevation({
        schoolMarkerElevationM: 80,
        meanSlopePct: 2,
        slopeClass: "B",
        landformTh: "ชุมชนบนพื้นราบ",
        provinceAvgElev: 100,
        routeFullMaxElev: 90,
      }),
      routes: [makeNormalRoute()],
    });
    (gis as { communityClass?: unknown }).communityClass = {
      composite: { key: "highland_remote", labelTh: "โกหก", tone: "warn" },
    };
    const out = sanitizeGis(JSON.parse(JSON.stringify(gis)));
    assert.ok(out?.communityClass);
    assert.equal(out.communityClass.composite.key, "flat_normal");
    assert.notEqual(out.communityClass.composite.labelTh, "โกหก");
    assert.equal(out.elevation?.provinceAvgElev, 100);
    assert.equal(out.elevation?.routeFullMaxElev, 90);
  });

  test("sanitizeGis เติม communityClass ให้แถวเก่าที่ไม่มี key", () => {
    const raw = JSON.parse(JSON.stringify(makeGis()));
    delete raw.communityClass;
    const out = sanitizeGis(raw);
    assert.ok(out?.communityClass);
    assert.equal(out.communityClass.version, COMMUNITY_CLASS_VERSION);
    assert.equal(out.communityClass.composite.key, "highland_remote");
  });

  test(`เกณฑ์ขั้นต่ำพื้นที่สูง = ${COMMUNITY_HIGHLAND_MIN_M} ม.`, () => {
    assert.equal(COMMUNITY_HIGHLAND_MIN_M, 500);
  });

  test("cc-2/cc-3: แกน A อย่างเดียว → incomplete (ไม่เดา flat/highland composite)", () => {
    const cc = classifyCommunity({
      schoolElevationM: 900,
      provinceAvgElev: 400,
      routeFullMaxElev: 950,
      landformTh: "ชุมชนบนภูเขา",
      accessSeverity: null,
    });
    assert.equal(cc.axisA.highland, true);
    assert.equal(cc.composite.key, "incomplete");
    assert.equal(cc.version, COMMUNITY_CLASS_VERSION);
  });

  test("cc-2/cc-3: แกน B อย่างเดียว → incomplete (ไม่เรียก flat_remote/flat_normal)", () => {
    const hard = classifyCommunity({
      schoolElevationM: null,
      provinceAvgElev: null,
      routeFullMaxElev: null,
      landformTh: "",
      accessSeverity: 4,
    });
    assert.equal(hard.composite.key, "incomplete");
    const easy = classifyCommunity({
      schoolElevationM: null,
      provinceAvgElev: null,
      routeFullMaxElev: null,
      landformTh: "",
      accessSeverity: 0,
    });
    assert.equal(easy.composite.key, "incomplete");
  });

  test("cc-2/cc-3: มีทั้ง A+B ถึงได้ flat_normal / highland_remote", () => {
    const flat = classifyCommunity({
      schoolElevationM: 80,
      provinceAvgElev: 120,
      routeFullMaxElev: 90,
      landformTh: "ชุมชนบนพื้นราบ",
      accessSeverity: 0,
    });
    assert.equal(flat.composite.key, "flat_normal");
    const remote = classifyCommunity({
      schoolElevationM: 1200,
      provinceAvgElev: 400,
      routeFullMaxElev: 1300,
      landformTh: "ชุมชนบนภูเขาสูง",
      accessSeverity: 4,
    });
    assert.equal(remote.composite.key, "highland_remote");
  });

  test("WSC 1–5 proxy จาก meanSlopePct (cc-3)", () => {
    assert.equal(estimateWscClass({ meanSlopePct: 55 })?.class, 1);
    assert.equal(estimateWscClass({ meanSlopePct: 40 })?.class, 2);
    assert.equal(estimateWscClass({ meanSlopePct: 25 })?.class, 3);
    assert.equal(estimateWscClass({ meanSlopePct: 10 })?.class, 4);
    assert.equal(estimateWscClass({ meanSlopePct: 3 })?.class, 5);
    assert.equal(estimateWscClass({ meanSlopePct: null }), null);
    assert.equal(wscProxySuggestsUpland(1), true);
    assert.equal(wscProxySuggestsUpland(2), true);
    assert.equal(wscProxySuggestsUpland(5), false);
    assert.equal(wscProxySuggestsFlat(5), true);
    assert.equal(wscProxySuggestsFlat(1), false);
    // ภูเขาสูง + ลาด ≥35 → ชั้น 1
    assert.equal(estimateWscClass({ meanSlopePct: 36, schoolElevationM: 1100 })?.class, 1);
  });

  test("classifyCommunity แนบ wscProxy จาก meanSlopePct", () => {
    const flat = classifyCommunity({
      schoolElevationM: 80,
      provinceAvgElev: 100,
      routeFullMaxElev: 90,
      landformTh: "ชุมชนบนพื้นราบ",
      accessSeverity: 0,
      meanSlopePct: 2,
    });
    assert.equal(flat.wscProxy?.class, 5);
    assert.ok(flat.wscProxy?.labelTh.includes("WSC 5"));
    assert.ok(flat.wscProxy?.hint.includes("ไม่ใช่ชั้นลุ่มน้ำราชการ"));

    const steep = classifyCommunity({
      schoolElevationM: 1200,
      provinceAvgElev: 400,
      routeFullMaxElev: 1300,
      landformTh: "ชุมชนบนภูเขาสูง",
      accessSeverity: 4,
      meanSlopePct: 45,
    });
    assert.equal(steep.wscProxy?.class, 1); // elev≥1000 && slope≥35 → 1
  });

  test("V24: highland + WSC 5 · V25: not highland + WSC 1–2 · V26: เกาะ", () => {
    const plateau = stateWithGis(
      makeGis({
        elevation: makeElevation({
          schoolMarkerElevationM: 900,
          meanSlopePct: 3,
          slopeClass: "A",
          landformTh: "ชุมชนบนภูเขา",
          provinceAvgElev: 400,
          routeFullMaxElev: 920,
        }),
        routes: [makeNormalRoute()],
      }),
    );
    // เข้า highland จาก elev แต่ slope ต่ำ → WSC 5 → V24
    assert.ok(flagCodes(plateau).includes("V24"));

    const steepLow = stateWithGis(
      makeGis({
        elevation: makeElevation({
          schoolMarkerElevationM: 200,
          meanSlopePct: 55,
          slopeClass: "E",
          landformTh: "ชุมชนบนเนินเขา",
          provinceAvgElev: 250,
          routeFullMaxElev: 220,
        }),
        routes: [makeNormalRoute()],
      }),
    );
    assert.ok(flagCodes(steepLow).includes("V25"));

    const island = stateWithGis(makeGis({}));
    island.unit.settingType = "เกาะ";
    assert.ok(flagCodes(island).includes("V26"));
  });
});

// ───────────────────────── 10c) Phase 2 — legend ถ้อยคำ เนินเขา/ภูเขา/ภูเขาสูง ─────────────────────────

describe("landform legend (Phase 2) — สพฐ. 600 vs แอป 1000", () => {
  test("morphology ยังใช้ ภูเขาสูง = 1000 ม. (ไม่ลดเหลือ 600)", () => {
    assert.equal(MORPHOLOGY_HIGH_MOUNTAIN_M, 1000);
    assert.equal(MORPHOLOGY_HIGHLAND_MIN_M, 500);
    assert.equal(COMMUNITY_HIGH_MOUNTAIN_M, MORPHOLOGY_HIGH_MOUNTAIN_M);
    assert.equal(COMMUNITY_HIGHLAND_MIN_M, MORPHOLOGY_HIGHLAND_MIN_M);
  });

  test("เกณฑ์ สพฐ. เนินเขา/ภูเขา ตามคู่มือ", () => {
    assert.equal(SSRA_HILL_ELEV_MIN_M, 150);
    assert.equal(SSRA_MOUNTAIN_ELEV_MIN_M, 600);
  });

  test("officialElevBandTh แบ่งแถบ 150 / 500 / 600 / 1000", () => {
    assert.ok(officialElevBandTh(100)?.includes("เนินเขา"));
    assert.ok(officialElevBandTh(400)?.includes("500"));
    assert.ok(officialElevBandTh(550)?.includes("600"));
    assert.ok(officialElevBandTh(700)?.includes("600"));
    assert.ok(officialElevBandTh(700)?.includes("1,000") || officialElevBandTh(700)?.includes("1000"));
    assert.ok(officialElevBandTh(1200)?.includes("ภูเขาสูง"));
    assert.equal(officialElevBandTh(null), null);
  });

  test("landformAppLabelNoteTh อธิบายป้ายแอป vs สพฐ.", () => {
    assert.ok(
      landformAppLabelNoteTh("ชุมชนบนภูเขาสูง").includes("1,000") ||
        landformAppLabelNoteTh("ชุมชนบนภูเขาสูง").includes("1000"),
    );
    assert.ok(landformAppLabelNoteTh("ชุมชนบนภูเขาสูง").includes("600"));
    assert.ok(landformAppLabelNoteTh("ชุมชนบนพื้นราบ").includes("พื้นราบ"));
    assert.ok(landformAppLabelNoteTh("ชุมชนในหุบเขา").includes("หุบเขา"));
  });

  test("landformThresholdLegendRows มีอย่างน้อย 4 แถว และพูดถึง 500/600/1000", () => {
    const rows = landformThresholdLegendRows();
    assert.ok(rows.length >= 4);
    const blob = rows.map((r) => `${r.term} ${r.rule}`).join(" ");
    assert.ok(blob.includes("500"));
    assert.ok(blob.includes("600"));
    assert.ok(blob.includes("1,000") || blob.includes("1000"));
  });

  test("communityAxisATierLabelTh mid-band บอก 500–999 และ สพฐ. 600", () => {
    assert.ok(
      communityAxisATierLabelTh("high").includes("1,000") || communityAxisATierLabelTh("high").includes("1000"),
    );
    assert.ok(communityAxisATierLabelTh("mid").includes("500"));
    assert.ok(communityAxisATierLabelTh("mid").includes("600"));
    assert.ok(communityAxisATierLabelTh("low").includes("500"));
  });
});

// ───────────────────────── 10d) Phase 3 — แนะนำ settingType + ธง V21–V23 ─────────────────────────

// ───────────────────────── 10e) Phase 4 — full-route elev + maxFiniteElev ─────────────────────────

describe("finalizeGisAnalysis / clampGisPayload (PR B)", () => {
  test("clamp ไม่ใส่ communityClass; finalize ใส่ autoScore + communityClass", () => {
    const raw = makeGis({ autoScore: null });
    const clamped = clampGisPayload(JSON.parse(JSON.stringify(raw)));
    assert.ok(clamped);
    assert.equal(clamped.communityClass, undefined);
    const final = finalizeGisAnalysis(clamped, { calculatedAt: "t" });
    assert.ok(final.communityClass);
    assert.equal(final.communityClass.composite.key, "highland_remote");
    assert.ok(final.autoScore);
    assert.ok(final.autoScore.total > 0);
  });

  test("finalize เติม provinceAvgElev แล้ว highland เปลี่ยนตามเกตจังหวัด", () => {
    const gis = makeGis({
      elevation: makeElevation({
        schoolMarkerElevationM: 400,
        meanSlopePct: 5,
        slopeClass: "C",
        landformTh: "ชุมชนบนเนินเขา",
      }),
      routes: [makeNormalRoute()],
    });
    const without = finalizeGisAnalysis(gis, { calculatedAt: "t" });
    assert.equal(without.communityClass!.axisA.highland, false);
    const withProv = finalizeGisAnalysis(gis, { provinceAvgElev: 200, calculatedAt: "t" });
    assert.equal(withProv.elevation?.provinceAvgElev, 200);
    assert.equal(withProv.communityClass!.axisA.highland, true);
  });

  test("sanitizeGis = clamp + finalize (idempotent ครั้งที่สอง)", () => {
    const once = sanitizeGis(makeGis());
    assert.ok(once?.communityClass);
    const twice = finalizeGisAnalysis(once!, { calculatedAt: once!.savedAt });
    assert.deepEqual(twice.communityClass, once!.communityClass);
    assert.equal(twice.autoScore?.total, once!.autoScore?.total);
  });
});

describe("maxFiniteElev / route elev (Phase 4)", () => {
  test("maxFiniteElev ข้าม NaN และคืน null เมื่อว่าง", () => {
    assert.equal(maxFiniteElev([]), null);
    assert.equal(maxFiniteElev([NaN, Number.POSITIVE_INFINITY]), null);
    assert.equal(maxFiniteElev([100, NaN, 250, 180]), 250);
  });

  test("community gate ใช้ routeFullMaxElev ทั้งเส้น — elev ต่ำแต่ route สูง → highland", () => {
    const cc = classifyCommunity({
      schoolElevationM: 200,
      provinceAvgElev: 400,
      routeFullMaxElev: 900, // ตลอดเส้น (SSRA)
      landformTh: "ชุมชนในหุบเขา",
      accessSeverity: 2,
    });
    assert.equal(cc.axisA.highland, true);
    assert.ok(cc.axisA.reasons.some((r) => r.includes("ทั้งเส้น") || r.includes("เส้นทาง")));
  });

  test("sanitize เก็บ routeTailMaxElev แยกจาก routeFullMaxElev", () => {
    const gis = makeGis({
      elevation: makeElevation({
        schoolMarkerElevationM: 400,
        meanSlopePct: 10,
        slopeClass: "C",
        landformTh: "ชุมชนในหุบเขา",
        provinceAvgElev: 300,
        routeFullMaxElev: 950,
        routeTailMaxElev: 720,
      }),
    });
    const out = sanitizeGis(JSON.parse(JSON.stringify(gis)));
    assert.equal(out?.elevation?.routeFullMaxElev, 950);
    assert.equal(out?.elevation?.routeTailMaxElev, 720);
  });
});

describe("suggestSettingTypeFromGis — ลักษณะที่ตั้งจาก GIS", () => {
  test("ภูเขาสูง / หุบเขา / เชิงเขา / พื้นราบห่างไกล", () => {
    assert.equal(
      suggestSettingTypeFromGis(
        makeGis({
          elevation: makeElevation({
            schoolMarkerElevationM: 1200,
            meanSlopePct: 20,
            slopeClass: "E",
            landformTh: "ชุมชนบนภูเขาสูง",
            provinceAvgElev: 400,
            routeFullMaxElev: 1300,
          }),
        }),
      ),
      "ภูเขาสูง",
    );
    assert.equal(
      suggestSettingTypeFromGis(
        makeGis({
          elevation: makeElevation({
            schoolMarkerElevationM: 400,
            meanSlopePct: 8,
            slopeClass: "C",
            landformTh: "ชุมชนในหุบเขา",
            provinceAvgElev: 500,
            routeFullMaxElev: 900,
          }),
        }),
      ),
      "หุบเขา",
    );
    assert.equal(
      suggestSettingTypeFromGis(
        makeGis({
          elevation: makeElevation({
            schoolMarkerElevationM: 700,
            meanSlopePct: 12,
            slopeClass: "D",
            landformTh: "ชุมชนเชิงเขา/ที่ลาดเชิงเขา",
            provinceAvgElev: 300,
            routeFullMaxElev: 350,
          }),
        }),
      ),
      "เชิงเขา",
    );
    assert.equal(
      suggestSettingTypeFromGis(
        makeGis({
          elevation: makeElevation({
            schoolMarkerElevationM: 50,
            meanSlopePct: 1,
            slopeClass: "A",
            landformTh: "ชุมชนบนพื้นราบ",
            provinceAvgElev: 80,
            routeFullMaxElev: 60,
          }),
          routes: [makeRoute()], // hard access → flat_remote
        }),
      ),
      "พื้นราบห่างไกล",
    );
  });
});

describe("cleanAreaSummary — sanitize ข้อสรุปพื้นที่", () => {
  test("ค่าปกติ: settlementLabel คำนวณใหม่จากความหนาแน่น (ไม่เชื่อ client)", () => {
    const out = cleanAreaSummary({
      areaKm2: 1.17,
      buildingCount: 120,
      estPopulation: 336,
      buildingDensityPerKm2: 103,
      popDensityPerKm2: 287,
      settlementLabel: "โกหก",
      calculatedAt: "2569-01-01T00:00:00.000Z",
    });
    assert.ok(out);
    assert.equal(out.areaKm2, 1.17);
    assert.equal(out.buildingCount, 120);
    assert.equal(out.settlementLabel, settlementClass(287).label); // เขียนทับค่าปลอมจาก client
  });
  test("พื้นที่ ≤ 0 หรือไม่ใช่ object → undefined", () => {
    assert.equal(cleanAreaSummary({ areaKm2: 0, buildingCount: 5 }), undefined);
    assert.equal(cleanAreaSummary(null), undefined);
    assert.equal(cleanAreaSummary("x"), undefined);
  });
  test("ไม่มี popDensity → settlementLabel ว่าง (จำแนกไม่ได้)", () => {
    const out = cleanAreaSummary({ areaKm2: 1, buildingCount: 3, popDensityPerKm2: null });
    assert.ok(out);
    assert.equal(out.popDensityPerKm2, null);
    assert.equal(out.settlementLabel, "");
  });
  test("รอด round-trip ผ่าน sanitizeGis (แนบใน gis)", () => {
    const gis = makeGis();
    gis.areaSummary = {
      areaKm2: 1.17,
      buildingCount: 120,
      estPopulation: 336,
      buildingDensityPerKm2: 103,
      popDensityPerKm2: 287,
      settlementLabel: settlementClass(287).label,
      calculatedAt: "2569-01-01T00:00:00.000Z",
    };
    const out = sanitizeGis(JSON.parse(JSON.stringify(gis)));
    assert.ok(out?.areaSummary);
    assert.equal(out.areaSummary.buildingCount, 120);
    assert.equal(out.areaSummary.settlementLabel, settlementClass(287).label);
  });
});

describe("cleanHighestPoint — sanitize จุดสูงสุดตามเส้นทาง", () => {
  test("ค่าปกติผ่านครบ", () => {
    const out = cleanHighestPoint({ lat: 19.5, lng: 99.2, elevationM: 1234 });
    assert.deepEqual(out, { lat: 19.5, lng: 99.2, elevationM: 1234 });
  });
  test("lat/lng นอกช่วง → ทั้งจุดถูกตัดเป็น null", () => {
    assert.equal(cleanHighestPoint({ lat: 999, lng: 99.2, elevationM: 1000 }), null);
    assert.equal(cleanHighestPoint({ lat: 19.5, lng: 999, elevationM: 1000 }), null);
  });
  test("elevationM ไม่ใช่ตัวเลข (ไม่ใช่แค่นอกช่วง — นอกช่วงจะถูก clamp) → null", () => {
    assert.equal(cleanHighestPoint({ lat: 19.5, lng: 99.2, elevationM: "สูง" }), null);
  });
  test("ไม่ใช่ object / ค่าว่าง → null", () => {
    assert.equal(cleanHighestPoint(null), null);
    assert.equal(cleanHighestPoint("x"), null);
    assert.equal(cleanHighestPoint(undefined), null);
  });
});

describe("cleanRadiusSummaries — สรุปอาคาร/ประชากรตามรัศมี", () => {
  test("ค่าปกติผ่านครบ (500/1000/1500)", () => {
    const out = cleanRadiusSummaries([
      { radiusM: 500, buildingCount: 5, estPopulation: 10, popDensityPerKm2: 20 },
      { radiusM: 1000, buildingCount: 20, estPopulation: 40, popDensityPerKm2: 15 },
      { radiusM: 1500, buildingCount: 50, estPopulation: 100, popDensityPerKm2: 12 },
    ]);
    assert.equal(out?.length, 3);
    assert.deepEqual(out?.[0], { radiusM: 500, buildingCount: 5, estPopulation: 10, popDensityPerKm2: 20 });
  });
  test("แถวหนึ่งมี radiusM แปลกปลอม (ไม่ใช่ 500/1000/1500) → ตัดทิ้งทั้งชุด", () => {
    const out = cleanRadiusSummaries([
      { radiusM: 500, buildingCount: 5, estPopulation: 10, popDensityPerKm2: 20 },
      { radiusM: 750, buildingCount: 8, estPopulation: 16, popDensityPerKm2: 20 },
    ]);
    assert.equal(out, undefined);
  });
  test("แถวหนึ่ง buildingCount ไม่ใช่ตัวเลข → ตัดทิ้งทั้งชุด", () => {
    const out = cleanRadiusSummaries([{ radiusM: 500, buildingCount: "ห้า", estPopulation: 10, popDensityPerKm2: 20 }]);
    assert.equal(out, undefined);
  });
  test("ไม่ใช่ array → undefined; array ว่าง → undefined (ไม่มีแถวเหลือ)", () => {
    assert.equal(cleanRadiusSummaries(null), undefined);
    assert.equal(cleanRadiusSummaries("x"), undefined);
    assert.equal(cleanRadiusSummaries([]), undefined);
  });
});

describe("cleanDataSources — metadata แหล่งข้อมูล GIS", () => {
  test("ค่าปกติผ่านครบ", () => {
    const out = cleanDataSources({
      terrain: "Terrarium DEM",
      routing: "OSRM",
      buildings: "Microsoft Building Footprints",
      populationMethod: "building-count-x-provincial-household-size",
      analyzedAt: "2569-01-01T00:00:00.000Z",
    });
    assert.deepEqual(out, {
      terrain: "Terrarium DEM",
      routing: "OSRM",
      buildings: "Microsoft Building Footprints",
      populationMethod: "building-count-x-provincial-household-size",
      analyzedAt: "2569-01-01T00:00:00.000Z",
    });
  });
  test("terrain/routing ผิดค่า (ไม่ใช่ literal ที่รองรับ) → ทั้งก้อนถูกปฏิเสธ", () => {
    assert.equal(cleanDataSources({ terrain: "SRTM", routing: "OSRM" }), undefined);
    assert.equal(cleanDataSources({ terrain: "Terrarium DEM", routing: "Google Maps" }), undefined);
  });
  test("buildings/populationMethod เป็นค่าที่ไม่รู้จัก → ตัวนั้นกลายเป็น null (ไม่ปฏิเสธทั้งก้อน)", () => {
    const out = cleanDataSources({
      terrain: "Terrarium DEM",
      routing: "OSRM",
      buildings: "ข้อมูลปลอม",
      populationMethod: "แต่งขึ้นเอง",
      analyzedAt: "t",
    });
    assert.ok(out);
    assert.equal(out.buildings, null);
    assert.equal(out.populationMethod, null);
  });
  test("ไม่ใช่ object / ค่าว่าง → undefined", () => {
    assert.equal(cleanDataSources(null), undefined);
    assert.equal(cleanDataSources("x"), undefined);
  });
});

describe("sanitizeGis — absent optional keys stay absent (v1/แถวไม่มีข้อมูล)", () => {
  test("gis ที่ไม่มี radiusSummaries/dataSources/areaSummary → ไม่งอก key เหล่านี้", () => {
    const out = sanitizeGis(makeGis());
    assert.ok(out);
    assert.equal("radiusSummaries" in out, false);
    assert.equal("dataSources" in out, false);
    assert.equal("areaSummary" in out, false);
  });
  test("gis ที่มี radiusSummaries/dataSources ครบ → รอด round-trip", () => {
    const raw = makeGis({
      radiusSummaries: [{ radiusM: 500, buildingCount: 5, estPopulation: 10, popDensityPerKm2: 20 }],
      dataSources: {
        terrain: "Terrarium DEM",
        routing: "OSRM",
        buildings: "Microsoft Building Footprints",
        populationMethod: "building-count-x-provincial-household-size",
        analyzedAt: "2569-01-01T00:00:00.000Z",
      },
    });
    const out = sanitizeGis(JSON.parse(JSON.stringify(raw)));
    assert.equal(out?.radiusSummaries?.length, 1);
    assert.equal(out?.dataSources?.buildings, "Microsoft Building Footprints");
  });
});

describe("effectiveScoringVersion", () => {
  test("state เปล่า → v1", () => {
    assert.equal(effectiveScoringVersion(makeBlankState()), "v1");
  });
  test("มี gis + flag → v2-gis", () => {
    const s = stateWithGis(makeGis());
    s.scoringVersion = "v2-gis";
    assert.equal(effectiveScoringVersion(s), "v2-gis");
  });
  test("flag โดยไม่มี gis → v1", () => {
    const s = makeBlankState();
    s.scoringVersion = "v2-gis";
    assert.equal(effectiveScoringVersion(s), "v1");
  });
  test("hospitalRoute เลือกเส้น selected ก่อน", () => {
    const gis = makeGis({
      routes: [
        makeRoute({ destinationType: "hospital", selected: false, travelTimeMin: 60 }),
        makeRoute({ destinationType: "hospital", selected: true, travelTimeMin: 90 }),
      ],
    });
    assert.equal(hospitalRoute(gis)?.travelTimeMin, 90);
  });
});

// ───────────────── เกณฑ์เสนอเพิ่ม (อนาคต) F1/F2 — ไม่นับรวมคะแนน 100 ─────────────────

describe("displacementRatio (การกระจัด ÷ ระยะถนนจริง)", () => {
  test("คำนวณและปัด 2 ตำแหน่ง", () => {
    assert.equal(displacementRatio(30, 72), 0.42);
    assert.equal(displacementRatio(10, 10), 1);
    assert.equal(displacementRatio(1, 3), 0.33);
  });
  test("guard: ค่าไม่ finite / เส้นตรงสั้นเกิน / ถนนเป็นศูนย์หรือติดลบ → null", () => {
    assert.equal(displacementRatio(Number.NaN, 10), null);
    assert.equal(displacementRatio(10, Number.NaN), null);
    assert.equal(displacementRatio(0.05, 10), null);
    assert.equal(displacementRatio(0, 10), null);
    assert.equal(displacementRatio(10, 0), null);
    assert.equal(displacementRatio(10, -5), null);
  });
});

describe("futureIndicators (F1 Displacement Ratio + F2 Travel Time Ratio)", () => {
  test("เส้นทางกันดารหนัก (fixture เดิม RCR 2.4/TTR 2.5) → F1+F2 ระดับ 4 ทั้งคู่", () => {
    const out = futureIndicators(makeGis());
    assert.equal(out.length, 2);
    const [f1, f2] = out;
    assert.equal(f1.id, "F1");
    assert.equal(f1.severity, 4);
    assert.equal(f1.score, 4);
    assert.equal(f1.maxScore, 4);
    assert.ok(f1.valueLabel.includes("0.42"));
    assert.equal(f2.id, "F2");
    assert.equal(f2.severity, 4);
    assert.equal(f2.score, 4);
    assert.equal(f2.maxScore, 4);
    assert.ok(f2.valueLabel.includes("2.50"));
  });

  test("ids ตรงกับ FUTURE_INDICATOR_IDS", () => {
    const out = futureIndicators(makeGis());
    assert.deepEqual(
      out.map((f) => f.id),
      [...FUTURE_INDICATOR_IDS],
    );
  });

  test("F1 severity ตามขอบ band RCR เดิมทุกจุด (1.29/1.3/1.5/1.8/2.1)", () => {
    const at = (rcr: number) =>
      futureIndicators(makeGis({ routes: [makeRoute({ roadCircuityRatio: rcr })] }))[0].severity;
    assert.equal(at(1.29), 0);
    assert.equal(at(1.3), 1);
    assert.equal(at(1.5), 2);
    assert.equal(at(1.8), 3);
    assert.equal(at(2.1), 4);
  });

  test("F1 severity สอดคล้อง rcrSeverity เสมอ (single source of truth)", () => {
    for (const rcr of [1.0, 1.29, 1.3, 1.49, 1.5, 1.79, 1.8, 2.09, 2.1, 3.5]) {
      const out = futureIndicators(makeGis({ routes: [makeRoute({ roadCircuityRatio: rcr })] }));
      assert.equal(out[0].severity, rcrSeverity(rcr));
    }
  });

  test("F2 severity ตามขอบ band TTR เดิมทุกจุด (1.29/1.3/1.6/2.0/2.5)", () => {
    const at = (ttr: number) =>
      futureIndicators(makeGis({ routes: [makeRoute({ travelTimeRatio: ttr })] }))[1].severity;
    assert.equal(at(1.29), 0);
    assert.equal(at(1.3), 1);
    assert.equal(at(1.6), 2);
    assert.equal(at(2.0), 3);
    assert.equal(at(2.5), 4);
  });

  test("ไม่มีเส้นทาง → list ว่าง", () => {
    assert.deepEqual(futureIndicators(makeGis({ routes: [] })), []);
  });

  test("เส้นตรงสั้นเกิน (DR คำนวณไม่ได้) → มีแต่ F2", () => {
    const out = futureIndicators(makeGis({ routes: [makeRoute({ straightDistanceKm: 0.04 })] }));
    assert.deepEqual(
      out.map((f) => f.id),
      ["F2"],
    );
  });
});
