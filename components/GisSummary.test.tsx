import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import GisSummary from "./GisSummary";
import { makeBlankState } from "@/lib/state";
import { sanitizeGis } from "@/lib/gis";
import type { AssessmentState, GisAnalysis } from "@/lib/types";

function stateWithGis(gis: GisAnalysis): AssessmentState {
  const s = makeBlankState();
  s.gis = gis;
  s.scoringVersion = gis.appliedToResponses ? "v2-gis" : undefined;
  return s;
}

const expandedGis: GisAnalysis = {
  center: {
    lat: 20.28,
    lng: 99.55,
    source: "unit",
    confirmedAt: "2569-01-15T09:00:00.000Z",
    nearestProvinceName: "เชียงราย",
  },
  elevation: {
    schoolMarkerElevationM: 1062,
    meanElevationM: 1010,
    minElevationM: 950,
    maxElevationM: 1090,
    reliefM: 140,
    meanSlopePct: 18.5,
    maxSlopePct: 30.2,
    localMaxElevation1KmM: 1080,
    slopeClass: "D: ลาดชันปานกลาง (12–20%)",
    landformTh: "หุบเขา",
    terrainConfidence: "client",
    provinceAvgElev: 380,
    routeFullMaxElev: 1120,
    routeTailMaxElev: 1090,
  },
  routes: [
    {
      destinationType: "province_hall",
      destinationName: "ศาลากลางจังหวัดเชียงราย",
      destLat: 20.32,
      destLng: 99.6,
      straightDistanceKm: 12,
      roadDistanceKm: 22,
      travelTimeMin: 35,
      roadCircuityRatio: 1.83,
      travelTimeRatio: 1.6,
      effectiveDistanceKm: 35.2,
      averageSpeedKmh: 37.7,
      elevationGainM: 320,
      elevationLossM: 210,
      routeSource: "osrm",
      selected: true,
      calculatedAt: "2569-01-15T09:00:00.000Z",
      highestPoint: { lat: 20.3, lng: 99.5, elevationM: 1070 },
    },
  ],
  autoScore: null,
  appliedToResponses: true,
  savedAt: "2569-01-15T09:00:00.000Z",
  radiusSummaries: [
    { radiusM: 500, buildingCount: 40, estPopulation: 120, popDensityPerKm2: 850 },
    { radiusM: 1000, buildingCount: 160, estPopulation: 480, popDensityPerKm2: 1200 },
    { radiusM: 1500, buildingCount: 300, estPopulation: 900, popDensityPerKm2: 1400 },
  ],
  dataSources: {
    terrain: "Terrarium DEM",
    routing: "OSRM",
    buildings: "Microsoft Building Footprints",
    populationMethod: "building-count-x-provincial-household-size",
    analyzedAt: "2569-01-15T09:00:00.000Z",
  },
};

test("GisSummary shows exact school and route-highest elevations separately", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={7} />);
  assert.match(html, /ระดับความสูงจุดตั้งโรงเรียน/);
  assert.match(html, /1,062/);
  assert.match(html, /จุดสูงสุดบนเส้นทาง/);
  assert.match(html, /1,070/);
  assert.match(html, /20\.30000, 99\.50000/);
});

test("GisSummary แสดงลายเซ็นภูมิประเทศพร้อมกฎที่ใช้และหลักฐานค่าอินพุต", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={7} />);
  assert.match(html, /ลายเซ็นภูมิประเทศ/);
  assert.match(html, /ความสูงที่หมุดโรงเรียน/);
});

test("GisSummary: โรงเรียนที่ระบุลักษณะที่ตั้งเป็นเกาะ ต้องถูกแยกเป็นกลุ่มเกาะ แม้ภูมิประเทศจะเป็นภูเขาสูง", () => {
  const state = stateWithGis(expandedGis);
  state.unit.settingType = "เกาะ";
  const html = renderToStaticMarkup(<GisSummary state={state} assessmentId={7} />);
  assert.match(html, /โรงเรียนพื้นที่เกาะ/);
  assert.match(html, /พื้นที่เกาะ \(แยกจากพื้นที่สูงทุรกันดาร\)/);
  assert.match(html, /ผู้กรอกระบุลักษณะที่ตั้งเป็นเกาะ/);
  assert.doesNotMatch(html, /ทุรกันดารหลายด้าน/);
});

test("GisSummary แสดงเหตุที่ต้องให้ผู้ตรวจดูซ้ำ เมื่อกฎอัตโนมัติเลือกไม่ตัดสินเอง", () => {
  // ที่ราบผืนใหญ่ พัฒนาแล้ว ถนนดี แต่อยู่ไกลจริง → ระบบต้องไม่กรองออกเอง และต้องบอกเหตุผล
  const developedButFar = sanitizeGis({
    ...expandedGis,
    elevation: {
      ...expandedGis.elevation,
      schoolMarkerElevationM: 1050,
      minElevationM: 1030,
      maxElevationM: 1070,
      reliefM: 40,
      meanSlopePct: 2,
      innerSlopePct: 2,
      localMaxElevation1KmM: 1060,
      routeTailMaxElev: 1055,
      routeFullMaxElev: 1080,
    },
    routes: [
      {
        ...expandedGis.routes[0],
        roadCircuityRatio: 1.15,
        travelTimeRatio: 1.05,
        averageSpeedKmh: 62,
        travelTimeMin: 130,
        roadDistanceKm: 120,
        elevationGainM: 800,
      },
    ],
    radiusSummaries: [{ radiusM: 1500, buildingCount: 900, estPopulation: 3200, popDensityPerKm2: 450 }],
    sectorElevations: Array.from({ length: 8 }, (_, i) => ({
      sector: (["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const)[i],
      highest: { lat: 20.28 + i * 0.001, lng: 99.55, elevationM: 1060, deltaFromSchoolM: null, meetsThreshold: false },
      lowest: { lat: 20.28 - i * 0.001, lng: 99.55, elevationM: 1040, deltaFromSchoolM: null, meetsThreshold: false },
      reliefM: null,
      aboveThreshold: false,
    })),
    sectorConfig: { radiusM: 1000, thresholdM: 50, schoolElevationM: 1050, schoolElevationSource: "route-profile" },
  });
  assert.ok(developedButFar);
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(developedButFar)} assessmentId={7} />);
  assert.match(html, /ควรให้ผู้ตรวจยืนยัน/);
  assert.match(html, /บริการไม่ได้อยู่ใกล้/);
  assert.doesNotMatch(html, /ที่ราบผืนใหญ่ที่พัฒนาแล้ว<\/strong>/);
});

test("GisSummary บอกตรง ๆ เมื่อข้อมูลไม่พอจะจำแนกภูมิประเทศ แทนการเดา", () => {
  const noTerrain = sanitizeGis({ ...expandedGis, elevation: null });
  assert.ok(noTerrain);
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(noTerrain)} assessmentId={7} />);
  assert.match(html, /ข้อมูลไม่พอ/);
});

test("legacy GIS renders missing new fields without substituting mean elevation", () => {
  const legacyRaw = {
    center: {
      lat: 18.5,
      lng: 99.2,
      source: "unit",
      confirmedAt: "2568-01-01T00:00:00.000Z",
      nearestProvinceName: "เชียงราย",
    },
    // ก้อนเดิมก่อนขยาย (Task 1) — มีแค่ meanElevationM/landformTh/meanSlopePct/provinceAvgElev เก่า
    // ไม่มี schoolMarkerElevationM/min/max/relief/localMax/maxSlopePct/slopeClass/routes[].highestPoint
    elevation: {
      meanElevationM: 950,
      landformTh: "พื้นที่ราบ",
      meanSlopePct: 2,
      provinceAvgElev: 300,
    },
    routes: [
      {
        destinationType: "province_hall",
        destinationName: "ศาลากลางจังหวัดเชียงราย",
        destLat: 18.6,
        destLng: 99.3,
        straightDistanceKm: 10,
        roadDistanceKm: 15,
        travelTimeMin: 20,
        roadCircuityRatio: 1.5,
        travelTimeRatio: 1.2,
        effectiveDistanceKm: 18,
        averageSpeedKmh: 45,
        elevationGainM: 50,
        elevationLossM: 40,
        routeSource: "osrm",
        selected: true,
        calculatedAt: "2568-01-01T00:00:00.000Z",
      },
    ],
    autoScore: null,
    appliedToResponses: false,
    savedAt: "2568-01-01T00:00:00.000Z",
  };
  const gis = sanitizeGis(legacyRaw);
  assert.ok(gis, "legacy fixture must sanitize into a GisAnalysis");
  assert.equal(gis?.radiusSummaries, undefined);
  assert.equal(gis?.dataSources, undefined);
  assert.equal(gis?.elevation?.schoolMarkerElevationM, null);

  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(gis as GisAnalysis)} assessmentId={8} />);
  assert.match(html, /ระดับความสูงจุดตั้งโรงเรียน[\s\S]*ไม่มีข้อมูล/);
});

test("GisSummary renders 500/1,000/1,500 m building/population rings and data sources with analyzedAt", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={9} />);
  assert.match(html, /500/);
  assert.match(html, /1,000/);
  assert.match(html, /1,500/);
  assert.match(html, /Terrarium DEM/);
  assert.match(html, /OSRM/);
  assert.match(html, /Microsoft Building Footprints/);
});

test("GisSummary keeps the future F1/F2 section and comparisons table intact", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={10} />);
  assert.match(html, /เกณฑ์เสนอเพิ่ม \(อนาคต\)/);
});

const sectorGis: GisAnalysis = {
  ...expandedGis,
  sectorConfig: {
    radiusM: 1000,
    thresholdM: 50,
    schoolElevationM: 1062,
    schoolElevationSource: "route-profile",
  },
  sectorElevations: [
    {
      sector: "N",
      highest: { lat: 20.289, lng: 99.55, elevationM: 1400, deltaFromSchoolM: 338, meetsThreshold: true },
      lowest: { lat: 20.285, lng: 99.552, elevationM: 1100, deltaFromSchoolM: 38, meetsThreshold: false },
      reliefM: 300,
      aboveThreshold: true,
    },
    {
      sector: "NE",
      highest: { lat: 20.286, lng: 99.556, elevationM: 1080, deltaFromSchoolM: 18, meetsThreshold: false },
      lowest: { lat: 20.284, lng: 99.558, elevationM: 1060, deltaFromSchoolM: -2, meetsThreshold: false },
      reliefM: 20,
      aboveThreshold: false,
    },
    { sector: "E", highest: null, lowest: null, reliefM: null, aboveThreshold: false },
  ],
};

test("ตารางธง 8 ทิศ: แสดงความสูง ส่วนต่าง พิกัด และธงที่ขึ้นจริงบนแผนที่", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(sectorGis)} assessmentId={11} />);
  assert.match(html, /จุดสูงสุด\/ต่ำสุดของภูมิประเทศ 8 ทิศ/);
  assert.match(html, /ตะวันออกเฉียงเหนือ/);
  assert.match(html, /1,400 ม\. \(\+338 ม\.\)/);
  assert.match(html, /1,060 ม\. \(−2 ม\.\)/);
  assert.match(html, /20\.28900, 99\.55000/);
  // ทิศเหนือ: จุดสูงสุด +338 ผ่านเกณฑ์ ปักธงม่วง ส่วนจุดต่ำสุด +38 ไม่ถึง ±50 จึงไม่ปักธงฟ้า
  assert.match(html, /<td>สูงสุด \(ม่วง\)<\/td>/);
  // ทิศตะวันออกเฉียงเหนือ: ทั้งสองจุดต่างไม่ถึง ±50 → ไม่ปักธงเลย แต่ค่ายังอยู่ในตาราง
  assert.match(html, /<td>ไม่ปักธง<\/td>/);
  assert.match(html, /1,080 ม\. \(\+18 ม\.\)/);
});

test("ตารางธง 8 ทิศ: อธิบายกติกา ±K ให้ผู้ตรวจเข้าใจว่าทำไมบางจุดไม่มีธง", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(sectorGis)} assessmentId={14} />);
  assert.match(html, /ปักธงเฉพาะจุดที่ต่างจากความสูงโรงเรียนตั้งแต่ ±50 ม\. ขึ้นไป/);
  assert.match(html, /ยังบันทึกค่าไว้ในตารางนี้/);
});

test("ตารางธง 8 ทิศ: ทิศที่อ่านความสูงไม่ได้แสดง ไม่มีข้อมูล ไม่แทนด้วยค่าอื่น", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(sectorGis)} assessmentId={12} />);
  const east = html.slice(html.indexOf("<td>ตะวันออก</td>"));
  assert.match(east.slice(0, 400), /ไม่มีข้อมูล/);
});

test("แถวที่ไม่มีธง 8 ทิศ → ไม่เรนเดอร์ตารางนี้เลย", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={13} />);
  assert.doesNotMatch(html, /จุดสูงสุด\/ต่ำสุดของภูมิประเทศ 8 ทิศ/);
});

test("GisSummary แสดงระดับความยากลำบาก 5 ระดับ พร้อมหลักฐานที่ใช้ตัดสิน", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={7} />);
  assert.match(html, /ระดับความยากลำบากของพื้นที่/);
  assert.match(html, /ระดับ [1-5]/);
  assert.match(html, /ยากลำบาก|ไม่ยากลำบาก/);
  // ต้องโชว์ตัววัดที่ผู้ใช้กำหนดให้ใช้ตัดสิน
  assert.match(html, /ยอดเขา\/หุบเขาต่างระดับเกิน 50 ม\./);
  assert.match(html, /สัดส่วนเส้นทางที่เป็นภูเขา/);
  assert.match(html, /ความคดเคี้ยวของถนน/);
  assert.match(html, /ขนาดชุมชนรอบโรงเรียน/);
});

test("GisSummary แสดงจำนวนลูกเขาที่ข้าม พร้อมพารามิเตอร์ที่ใช้นับ", () => {
  const gis: GisAnalysis = {
    ...expandedGis,
    routes: [
      {
        ...expandedGis.routes[0],
        ridgeCrossings: {
          count: 6,
          confirmedCount: 4,
          spacingM: 50,
          sideOffsetM: 200,
          prominenceM: 50,
          waves: [{ atKm: 3.1, elevM: 900, prominenceM: 150, confirmed: true }],
        },
      },
    ],
  };
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(gis)} assessmentId={21} />);
  assert.match(html, /ภูเขาที่ต้องข้ามบนเส้นทาง/);
  const row = html.slice(html.indexOf("ภูเขาที่ต้องข้ามบนเส้นทาง"));
  assert.match(row.slice(0, 500), /6 ลูก/);
  assert.match(row.slice(0, 500), /4 ลูก/);
  assert.match(row.slice(0, 500), /±200 ม\./);
  assert.match(row.slice(0, 500), /≥50 ม\./);
});

test("แถวเก่าที่ไม่มีผลนับลูกเขา → ไม่เรนเดอร์หัวข้อนี้ (ไม่เดาว่าเป็นศูนย์)", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={22} />);
  assert.doesNotMatch(html, /ภูเขาที่ต้องข้ามบนเส้นทาง/);
});
