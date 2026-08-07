// Unit tests สำหรับ lib/gis-request.ts — shared server-side GIS request processor
// ใช้ทั้ง legacy POST /api/assessments/[id]/gis และ endpoint /from-map ใหม่ (Task 4)
// รันด้วย: node --import tsx --test tests/gis-request.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGisFromMapRequest, GisRequestError } from "../lib/gis-request";
import type { GisRequestContext } from "../lib/gis-request";
import { SECTOR_RADIUS_M, SECTOR_RELIEF_K_M } from "../lib/gis-sectors";

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

// ── routeAccess: ไม่มีเส้นทางไม่ใช่ error อีกต่อไป แต่ต้องบันทึกเหตุผลไว้เสมอ ──
// โรงเรียนที่ถนนเข้าไม่ถึงคือกลุ่มที่ควรได้คะแนนความยากลำบากสูงสุด การ throw ทิ้งทำให้บันทึกไม่ได้เลย

test("ไม่มีเส้นทางศาลากลาง + ไม่แจ้งเหตุ → บันทึกได้ สถานะ no-route", () => {
  const result = buildGisFromMapRequest({ center: { lat: 20.0, lng: 99.0 }, routes: [] }, baseContext);
  assert.equal(result.gis.routes.length, 0);
  assert.equal(result.gis.routeAccess?.status, "no-route");
  assert.match(result.gis.routeAccess?.note ?? "", /ไม่พบเส้นทางถนน/);
});

test("client แจ้งว่าเส้นทางถูกตัดเพราะข้ามพรมแดน → สถานะ border-blocked", () => {
  const result = buildGisFromMapRequest(
    { center: { lat: 18.42, lng: 97.55 }, routes: [], noRouteReason: "border-blocked" },
    baseContext,
  );
  assert.equal(result.gis.routeAccess?.status, "border-blocked");
  assert.match(result.gis.routeAccess?.note ?? "", /พรมแดน/);
});

test("noRouteReason นอกรายการที่รู้จัก → ไม่เชื่อ ใช้ no-route ตามค่าที่ตรวจได้เอง", () => {
  const result = buildGisFromMapRequest(
    { center: { lat: 20.0, lng: 99.0 }, routes: [], noRouteReason: "อ้างว่าเข้าถึงยากมาก" },
    baseContext,
  );
  assert.equal(result.gis.routeAccess?.status, "no-route");
});

test("มีเส้นทางแต่ snap ปลายทางไกลเกิน 1 กม. → snapped-far พร้อมระยะจริง", () => {
  const result = buildGisFromMapRequest(
    {
      center: { lat: 18.42141, lng: 97.54846 },
      routes: [
        {
          destinationType: "province_hall",
          destinationName: "ศาลากลางแม่ฮ่องสอน",
          destLat: 19.28836,
          destLng: 97.96483,
          roadDistanceM: 149563,
          durationS: 10525,
          destSnapM: 12152,
          selected: true,
        },
      ],
    },
    baseContext,
  );
  assert.equal(result.gis.routeAccess?.status, "snapped-far");
  assert.equal(result.gis.routeAccess?.destSnapM, 12152);
  assert.match(result.gis.routeAccess?.note ?? "", /12\.2 กม\./);
});

test("snap ใกล้โรงเรียน → reachable และเก็บระยะ snap ไว้ด้วย", () => {
  const result = buildGisFromMapRequest(
    {
      center: { lat: 19.9, lng: 99.2 },
      routes: [
        {
          destinationType: "province_hall",
          destinationName: "ศาลากลาง",
          destLat: 19.91,
          destLng: 99.21,
          roadDistanceM: 4200,
          durationS: 420,
          destSnapM: 38,
          selected: true,
        },
      ],
    },
    baseContext,
  );
  assert.equal(result.gis.routeAccess?.status, "reachable");
  assert.equal(result.gis.routeAccess?.destSnapM, 38);
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

// ── ธงจุดสูงสุด/ต่ำสุด 8 ทิศ ────────────────────────────────────────────────
const SECTOR_BODY = {
  center: { lat: 20.0, lng: 99.0, source: "map-pin" },
  routes: [],
  sectorConfig: {
    // ค่าที่ client "อยาก" ให้ใช้ — server ต้องไม่เชื่อรัศมี/เกณฑ์ K จาก client
    radiusM: 250,
    thresholdM: 1,
    schoolElevationM: 1200,
    schoolElevationSource: "route-profile",
  },
  sectorElevations: [
    {
      sector: "N",
      highest: { lat: 20.008, lng: 99.0, elevationM: 1400 },
      lowest: { lat: 20.006, lng: 99.001, elevationM: 1100 },
      // ค่าปลอมที่ client ยัดมา — ต้องถูกคำนวณทับทั้งหมด
      reliefM: 3,
      aboveThreshold: false,
      highestDelta: 9999,
    },
    {
      sector: "S",
      highest: { lat: 19.994, lng: 99.0, elevationM: 1230 },
      lowest: { lat: 19.992, lng: 99.001, elevationM: 1200 },
    },
  ],
};

test("ธง 8 ทิศ: server คำนวณ relief/ส่วนต่าง/เกินเกณฑ์ใหม่เสมอ ไม่ใช้ค่าที่ client ส่งมา", () => {
  const result = buildGisFromMapRequest(SECTOR_BODY, baseContext);
  const north = result.gis.sectorElevations?.find((s) => s.sector === "N");
  const south = result.gis.sectorElevations?.find((s) => s.sector === "S");

  assert.equal(north?.reliefM, 300, "reliefM ต้องมาจากสูงสุด−ต่ำสุดที่ server คำนวณเอง");
  assert.equal(north?.aboveThreshold, true);
  assert.equal(north?.highest?.deltaFromSchoolM, 200);
  assert.equal(north?.lowest?.deltaFromSchoolM, -100);
  // relief 30 ม. < K (50 ม.) → ไม่ถึงเกณฑ์ แม้ client จะส่ง thresholdM: 1 มาก็ตาม
  assert.equal(south?.reliefM, 30);
  assert.equal(south?.aboveThreshold, false);
});

test("ธง 8 ทิศ: รัศมีและค่า K ใน sectorConfig มาจากค่าคงที่ฝั่ง server เท่านั้น", () => {
  const result = buildGisFromMapRequest(SECTOR_BODY, baseContext);
  assert.equal(result.gis.sectorConfig?.radiusM, SECTOR_RADIUS_M);
  assert.equal(result.gis.sectorConfig?.thresholdM, SECTOR_RELIEF_K_M);
  // ความสูงอ้างอิงและที่มาเป็นข้อมูลบริบทจาก client — เก็บตามที่ส่งมาได้ (ผ่านการ validate แล้ว)
  assert.equal(result.gis.sectorConfig?.schoolElevationM, 1200);
  assert.equal(result.gis.sectorConfig?.schoolElevationSource, "route-profile");
});

test("ธง 8 ทิศ: payload ที่ไม่ได้ส่งมา → ใช้ค่าที่บันทึกไว้เดิม (ข้อมูลไม่หาย)", () => {
  const previous = buildGisFromMapRequest(SECTOR_BODY, baseContext).gis;
  const result = buildGisFromMapRequest(
    { center: { lat: 20.0, lng: 99.0 }, routes: [] },
    {
      ...baseContext,
      previousSectorElevations: previous.sectorElevations,
      previousSectorConfig: previous.sectorConfig,
    },
  );
  assert.equal(result.gis.sectorElevations?.length, 2);
  assert.equal(result.gis.sectorConfig?.radiusM, SECTOR_RADIUS_M);
});

test("ธง 8 ทิศ: ไม่มีทั้งของใหม่และของเดิม → ไม่งอก key ในผลลัพธ์", () => {
  const result = buildGisFromMapRequest({ center: { lat: 20.0, lng: 99.0 }, routes: [] }, baseContext);
  assert.ok(!("sectorElevations" in result.gis));
  assert.ok(!("sectorConfig" in result.gis));
});
