// Unit tests สำหรับ lib/map-assessment.ts — pure prefill + merge GIS เข้ากับ state (ไม่ต้องมี DB)
// รันด้วย: node --import tsx --test tests/map-assessment.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyMapGisToState, fillBlankUnitFromMaster, prefillMapAssessmentState } from "../lib/map-assessment";
import { makeBlankState } from "../lib/state";
import type { GisAnalysis } from "../lib/types";

const gis: GisAnalysis = {
  center: {
    lat: 20.32174,
    lng: 99.61929,
    source: "map-pin",
    confirmedAt: "2569-01-15T09:00:00.000Z",
    nearestProvinceName: "เชียงราย",
  },
  elevation: null,
  routes: [
    {
      destinationType: "province_hall",
      destinationName: "ศาลากลางจังหวัดเชียงราย",
      destLat: 20.0,
      destLng: 99.5,
      straightDistanceKm: 30,
      roadDistanceKm: 72,
      travelTimeMin: 200,
      roadCircuityRatio: 2.4,
      travelTimeRatio: 2.78,
      effectiveDistanceKm: 200.16,
      averageSpeedKmh: 21.6,
      elevationGainM: 1350,
      elevationLossM: 620,
      routeSource: "osrm",
      selected: true,
      calculatedAt: "2569-01-15T09:00:00.000Z",
    },
  ],
  autoScore: null,
  appliedToResponses: false,
  savedAt: "2569-01-15T09:00:00.000Z",
};

test("prefill creates only fields backed by school master data", () => {
  const state = prefillMapAssessmentState(
    { code: "57000001", name: "บ้านพญาไพร", province: "เชียงราย", lat: 20.32174, lng: 99.61929 },
    "2569",
  );
  assert.equal(state.unit.year, "2569");
  assert.equal(state.unit.name, "บ้านพญาไพร");
  assert.equal(state.unit.code, "57000001");
  assert.equal(state.unit.province, "เชียงราย");
  assert.equal(state.unit.lat, "20.321740");
  assert.equal(state.unit.lng, "99.619290");
  assert.equal(state.unit.totalStudents, "");
  assert.equal(state.unit.areaOffice, "");
  assert.equal(state.unit.settingType, "");
});

test("applyMapGisToState fills Dimension 3 but preserves unrelated answers", () => {
  const existing = makeBlankState();
  existing.responses["1.1"] = { count: "4" };
  const next = applyMapGisToState(existing, gis, { syncUnitLocation: true });
  assert.deepEqual(next.responses["1.1"], { count: "4" });
  assert.equal(next.responses["3.2"].level, "4");
  assert.equal(next.scoringVersion, "v2-gis");
});

test("applyMapGisToState syncs unit lat/lng only when syncUnitLocation is true", () => {
  const existing = makeBlankState();
  existing.unit.lat = "18.700000";
  existing.unit.lng = "98.900000";

  const synced = applyMapGisToState(existing, gis, { syncUnitLocation: true });
  assert.equal(synced.unit.lat, "20.321740");
  assert.equal(synced.unit.lng, "99.619290");

  const notSynced = applyMapGisToState(existing, gis, { syncUnitLocation: false });
  assert.equal(notSynced.unit.lat, "18.700000");
  assert.equal(notSynced.unit.lng, "98.900000");
});

test("applyMapGisToState does not overwrite a settingType the user already picked", () => {
  const existing = makeBlankState();
  existing.unit.settingType = "พื้นราบห่างไกล";
  const next = applyMapGisToState(existing, gis, { syncUnitLocation: false });
  assert.equal(next.unit.settingType, "พื้นราบห่างไกล");
});

test("applyMapGisToState keeps existing areaSummary/radiusSummaries when the new gis payload omits them", () => {
  const existing = makeBlankState();
  existing.gis = {
    ...gis,
    areaSummary: {
      areaKm2: 1.2,
      buildingCount: 40,
      estPopulation: 120,
      buildingDensityPerKm2: 33,
      popDensityPerKm2: 100,
      settlementLabel: "ชุมชนชนบท",
      calculatedAt: "2569-01-01T00:00:00.000Z",
    },
    radiusSummaries: [{ radiusM: 500, buildingCount: 5, estPopulation: 10, popDensityPerKm2: 20 }],
  };
  const next = applyMapGisToState(existing, gis, { syncUnitLocation: false });
  assert.equal(next.gis?.areaSummary?.settlementLabel, "ชุมชนชนบท");
  assert.equal(next.gis?.radiusSummaries?.length, 1);
});

test("applyMapGisToState keeps existing sectorElevations/sectorConfig when the new gis payload omits them", () => {
  const existing = makeBlankState();
  existing.gis = {
    ...gis,
    sectorElevations: [
      {
        sector: "N",
        highest: { lat: 18.71, lng: 98.9, elevationM: 1400, deltaFromSchoolM: 200, meetsThreshold: true },
        lowest: { lat: 18.705, lng: 98.9, elevationM: 1100, deltaFromSchoolM: -100, meetsThreshold: true },
        reliefM: 300,
        aboveThreshold: true,
      },
    ],
    sectorConfig: {
      radiusM: 1000,
      thresholdM: 50,
      schoolElevationM: 1200,
      schoolElevationSource: "route-profile",
    },
  };
  const next = applyMapGisToState(existing, gis, { syncUnitLocation: false });
  assert.equal(next.gis?.sectorElevations?.length, 1);
  assert.equal(next.gis?.sectorElevations?.[0].reliefM, 300);
  assert.equal(next.gis?.sectorConfig?.schoolElevationM, 1200);
});

test("applyMapGisToState ใช้ธง 8 ทิศชุดใหม่เมื่อ payload ส่งมา (ไม่ค้างของเดิม)", () => {
  const existing = makeBlankState();
  existing.gis = {
    ...gis,
    sectorElevations: [{ sector: "N", highest: null, lowest: null, reliefM: null, aboveThreshold: false }],
  };
  const next = applyMapGisToState(
    existing,
    {
      ...gis,
      sectorElevations: [
        {
          sector: "S",
          highest: { lat: 18.69, lng: 98.9, elevationM: 900, deltaFromSchoolM: 0, meetsThreshold: false },
          lowest: { lat: 18.688, lng: 98.9, elevationM: 880, deltaFromSchoolM: -20, meetsThreshold: false },
          reliefM: 20,
          aboveThreshold: false,
        },
      ],
    },
    { syncUnitLocation: false },
  );
  assert.equal(next.gis?.sectorElevations?.length, 1);
  assert.equal(next.gis?.sectorElevations?.[0].sector, "S");
});

const MASTER = { code: "57000001", name: "บ้านพญาไพร", province: "เชียงราย", lat: 20.32174, lng: 99.61929 };

test("fillBlankUnitFromMaster fills blank name/code/province/year/lat/lng from master data", () => {
  const state = makeBlankState();
  const filled = fillBlankUnitFromMaster(state, MASTER, "2569");
  assert.equal(filled.unit.name, "บ้านพญาไพร");
  assert.equal(filled.unit.code, "57000001");
  assert.equal(filled.unit.province, "เชียงราย");
  assert.equal(filled.unit.year, "2569");
  assert.equal(filled.unit.lat, "20.321740");
  assert.equal(filled.unit.lng, "99.619290");
});

test("fillBlankUnitFromMaster does not overwrite user-typed values", () => {
  const state = makeBlankState();
  state.unit.name = "ชื่อที่ครูพิมพ์เอง";
  state.unit.province = "เชียงใหม่";
  const filled = fillBlankUnitFromMaster(state, MASTER, "2569");
  assert.equal(filled.unit.name, "ชื่อที่ครูพิมพ์เอง");
  assert.equal(filled.unit.province, "เชียงใหม่");
  // ฟิลด์ที่ยังว่างอยู่ต้องเติมตามปกติ
  assert.equal(filled.unit.code, "57000001");
});

test("fillBlankUnitFromMaster never fills totalStudents/areaOffice (no real source)", () => {
  const state = makeBlankState();
  const filled = fillBlankUnitFromMaster(state, MASTER, "2569");
  assert.equal(filled.unit.totalStudents, "");
  assert.equal(filled.unit.areaOffice, "");
});

test("fillBlankUnitFromMaster does not touch responses/gis", () => {
  const state = makeBlankState();
  state.responses["1.1"] = { count: "9" };
  const filled = fillBlankUnitFromMaster(state, MASTER, "2569");
  assert.deepEqual(filled.responses["1.1"], { count: "9" });
  assert.equal(filled.gis, undefined);
});

const DATA_SOURCES_A = {
  terrain: "Terrarium DEM" as const,
  routing: "OSRM" as const,
  buildings: "Microsoft Building Footprints" as const,
  populationMethod: "building-count-x-provincial-household-size" as const,
  analyzedAt: "2569-01-01T00:00:00.000Z",
};

const DATA_SOURCES_B = {
  ...DATA_SOURCES_A,
  analyzedAt: "2569-02-02T00:00:00.000Z",
};

test("applyMapGisToState: new dataSources in payload wins over previous", () => {
  const existing = makeBlankState();
  existing.gis = { ...gis, dataSources: DATA_SOURCES_A };
  const next = applyMapGisToState(existing, { ...gis, dataSources: DATA_SOURCES_B }, { syncUnitLocation: false });
  assert.deepEqual(next.gis?.dataSources, DATA_SOURCES_B);
});

test("applyMapGisToState: previous dataSources preserved when new payload omits it", () => {
  const existing = makeBlankState();
  existing.gis = { ...gis, dataSources: DATA_SOURCES_A };
  const next = applyMapGisToState(existing, gis, { syncUnitLocation: false });
  assert.deepEqual(next.gis?.dataSources, DATA_SOURCES_A);
});

test("applyMapGisToState: dataSources absent on both sides stays absent (v1 rows never grow the key)", () => {
  const existing = makeBlankState();
  const next = applyMapGisToState(existing, gis, { syncUnitLocation: false });
  assert.equal("dataSources" in (next.gis ?? {}), false);
});

test("applyMapGisToState marks appliedToResponses false when no Dimension 3 route exists", () => {
  const existing = makeBlankState();
  const empty: GisAnalysis = { ...gis, routes: [] };
  const next = applyMapGisToState(existing, empty, { syncUnitLocation: false });
  assert.equal(next.gis?.appliedToResponses, false);
  assert.deepEqual(next.responses["3.2"], {});
});
