// Unit tests สำหรับ lib/gis-request.ts — shared server-side GIS request processor
// ใช้ทั้ง legacy POST /api/assessments/[id]/gis และ endpoint /from-map ใหม่ (Task 4)
// รันด้วย: node --import tsx --test tests/gis-request.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGisFromMapRequest, GisRequestError } from "../lib/gis-request";
import type { GisRequestContext } from "../lib/gis-request";

const baseContext: GisRequestContext = {
  provinceName: "เชียงราย",
  provinceAvgElev: 544,
  now: "2026-07-22T05:00:00.000Z",
  previousAreaSummary: undefined,
};

test("buildGisFromMapRequest recomputes route ratios and keeps validated terrain evidence", () => {
  const rawBody = {
    center: { lat: 20.0, lng: 99.0, source: "map-pin" },
    elevation: { schoolMarkerElevationM: 1062 },
    routes: [
      {
        destinationType: "province_hall",
        destinationName: "ศาลากลางจังหวัดเชียงราย",
        destLat: 20.3,
        destLng: 99.5,
        roadDistanceM: 74330,
        durationS: 5400,
        elevationGainM: 300,
        elevationLossM: 100,
        selected: true,
        highestPoint: { lat: 20.3, lng: 99.5, elevationM: 1070 },
      },
    ],
  };

  const result = buildGisFromMapRequest(rawBody, baseContext);
  assert.equal(result.gis.routes[0].roadCircuityRatio, 1.2);
  assert.equal(result.gis.elevation?.schoolMarkerElevationM, 1062);
  assert.deepEqual(result.gis.routes[0].highestPoint, { lat: 20.3, lng: 99.5, elevationM: 1070 });
});

test("buildGisFromMapRequest rejects invalid center coordinates", () => {
  assert.throws(
    () => buildGisFromMapRequest({ center: { lat: 999, lng: 99 } }, baseContext),
    (error: unknown) => error instanceof GisRequestError && error.code === "INVALID_CENTER",
  );
});

test("buildGisFromMapRequest rejects a malformed body", () => {
  assert.throws(
    () => buildGisFromMapRequest(null, baseContext),
    (error: unknown) => error instanceof GisRequestError && error.code === "INVALID_GIS",
  );
});

test("buildGisFromMapRequest drops routes with impossible physics and reports why", () => {
  const rawBody = {
    center: { lat: 20.0, lng: 99.0 },
    routes: [
      {
        destinationType: "district_office",
        destinationName: "สำนักงานเขตทดสอบ",
        destLat: 20.3,
        destLng: 99.5,
        // ระยะถนนสั้นกว่าเส้นตรงมาก — ผิดฟิสิกส์ ต้องถูกตัดทิ้ง
        roadDistanceM: 100,
        durationS: 60,
        elevationGainM: null,
        elevationLossM: null,
        selected: false,
      },
    ],
  };
  const result = buildGisFromMapRequest(rawBody, baseContext);
  assert.equal(result.gis.routes.length, 0);
  assert.equal(result.droppedRoutes.length, 1);
});

test("buildGisFromMapRequest requires a province_hall route when requireProvinceRoute is true", () => {
  const rawBody = { center: { lat: 20.0, lng: 99.0 }, routes: [] };
  assert.throws(
    () => buildGisFromMapRequest(rawBody, { ...baseContext, requireProvinceRoute: true }),
    (error: unknown) => error instanceof GisRequestError && error.code === "NO_VALID_ROUTE",
  );
  // ไม่ throw เมื่อไม่ได้บังคับ (ค่าเริ่มต้น = false, ใช้กับ /gis เดิม)
  const result = buildGisFromMapRequest(rawBody, baseContext);
  assert.equal(result.gis.routes.length, 0);
});

test("buildGisFromMapRequest keeps previous area summary when payload omits it", () => {
  const previousAreaSummary = {
    areaKm2: 1.2,
    buildingCount: 40,
    estPopulation: 120,
    buildingDensityPerKm2: 33,
    popDensityPerKm2: 100,
    settlementLabel: "ชุมชนชนบท",
    calculatedAt: "2026-01-01T00:00:00.000Z",
  };
  const rawBody = { center: { lat: 20.0, lng: 99.0 }, routes: [] };
  const result = buildGisFromMapRequest(rawBody, { ...baseContext, previousAreaSummary });
  // settlementLabel ถูกคำนวณใหม่จากความหนาแน่นเสมอ (clampGisPayload→cleanAreaSummary) — ค่าอื่นต้องคงเดิม
  assert.deepEqual(result.gis.areaSummary, previousAreaSummary);
});
