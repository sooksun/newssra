// Unit tests สำหรับ lib/map-assessment.ts — pure prefill + merge GIS เข้ากับ state (ไม่ต้องมี DB)
// รันด้วย: node --import tsx --test tests/map-assessment.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyMapGisToState, prefillMapAssessmentState } from "../lib/map-assessment";
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

test("applyMapGisToState marks appliedToResponses false when no Dimension 3 route exists", () => {
  const existing = makeBlankState();
  const empty: GisAnalysis = { ...gis, routes: [] };
  const next = applyMapGisToState(existing, empty, { syncUnitLocation: false });
  assert.equal(next.gis?.appliedToResponses, false);
  assert.deepEqual(next.responses["3.2"], {});
});
