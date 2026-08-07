import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRouteElevationProfile,
  formatElevationMeters,
  formatRouteHighestLabel,
  routeElevationSampleCoordinates,
  routeMountainPercent,
  sampleRouteCoordinates,
  type RouteCoordinate,
} from "./routeElevation";

test("formatRouteHighestLabel keeps the numeric elevation on a Thai-led second line", () => {
  assert.equal(formatRouteHighestLabel(1_069.6), "จุดสูงสุดบนเส้นทาง\nระดับความสูง 1,070 ม.");
});

test("routeElevationSampleCoordinates uses one capped route sample and the exact school endpoint", () => {
  const coords = Array.from({ length: 11 }, (_, i) => [100 + i, 10 + i] as RouteCoordinate);

  const sampled = routeElevationSampleCoordinates(coords, [120.5, 20.5], 4);

  assert.deepEqual(sampled, [coords[0], coords[3], coords[7], [120.5, 20.5]]);
});

test("sampleRouteCoordinates spreads samples and preserves both endpoints", () => {
  const coords = Array.from({ length: 11 }, (_, i) => [100 + i, 10 + i] as RouteCoordinate);
  const sampled = sampleRouteCoordinates(coords, 4);

  assert.equal(sampled.length, 4);
  assert.deepEqual(sampled[0], coords[0]);
  assert.deepEqual(sampled.at(-1), coords.at(-1));
  assert.deepEqual(sampled, [coords[0], coords[3], coords[7], coords[10]]);
});

test("sampleRouteCoordinates rejects a limit that cannot preserve both endpoints", () => {
  assert.throws(
    () =>
      sampleRouteCoordinates(
        [
          [100, 10],
          [101, 11],
        ],
        1,
      ),
    /at least 2/,
  );
});

test("buildRouteElevationProfile selects the highest finite route point and exact school endpoint", () => {
  const coords: RouteCoordinate[] = [
    [100, 10],
    [101, 11],
    [102, 12],
    [103, 13],
  ];
  const profile = buildRouteElevationProfile(coords, new Float32Array([100, Number.NaN, 375, 250]));

  assert.equal(profile.schoolElevationM, 250);
  assert.deepEqual(profile.highestPoint, { lng: 102, lat: 12, elevationM: 375 });
});

test("route profile keeps school marker and highest point from the same samples", () => {
  const profile = buildRouteElevationProfile(
    [
      [99, 20],
      [99.1, 20.1],
    ],
    [1070, 1062],
  );
  assert.deepEqual(profile.highestPoint, { lng: 99, lat: 20, elevationM: 1070 });
  assert.equal(profile.schoolElevationM, 1062);
});

test("buildRouteElevationProfile never converts missing terrain to zero", () => {
  const profile = buildRouteElevationProfile(
    [
      [100, 10],
      [101, 11],
    ],
    [Number.NaN, Number.NaN],
  );

  assert.equal(profile.schoolElevationM, null);
  assert.equal(profile.highestPoint, null);
});

test("formatElevationMeters rounds and formats metres for Thai UI", () => {
  assert.equal(formatElevationMeters(1245.6), "1,246 ม.");
});

// ── % ของเส้นทางที่เป็นภูเขา ─────────────────────────────────────────────────
// ตอบคำถาม "เส้นทางเข้าโรงเรียนผ่านภูมิประเทศภูเขากี่เปอร์เซ็นต์" ซึ่งต่างจาก
// จุดสูงสุด (ยอดเดียว) และต่างจากความสูงสะสม (นับทุกเนินเล็กรวมกัน)

test("routeMountainPercent นับสัดส่วนจุดที่สูงถึงเกณฑ์ภูเขา", () => {
  assert.equal(routeMountainPercent([100, 200, 600, 700], 500), 50);
  assert.equal(routeMountainPercent([600, 700, 800, 900], 500), 100);
  assert.equal(routeMountainPercent([100, 200, 300], 500), 0);
});

test("routeMountainPercent นับที่ค่าเท่าเกณฑ์พอดีว่าเป็นภูเขา", () => {
  assert.equal(routeMountainPercent([500, 100], 500), 50);
});

test("routeMountainPercent ข้ามค่าที่อ่านไม่ได้ ไม่นับเป็น 0 เมตร", () => {
  // NaN = สุ่ม DEM ไม่สำเร็จ — ถ้านับเป็น 0 จะทำให้ % ภูเขาต่ำกว่าจริง
  assert.equal(routeMountainPercent([600, Number.NaN, 700], 500), 100);
});

test("routeMountainPercent ไม่มีตัวอย่างที่ใช้ได้เลย → null (ไม่ใช่ 0)", () => {
  assert.equal(routeMountainPercent([], 500), null);
  assert.equal(routeMountainPercent([Number.NaN, Number.NaN], 500), null);
});

test("buildRouteElevationProfile แนบ % ภูเขามาด้วย", () => {
  const coords: RouteCoordinate[] = [
    [98, 18],
    [98.1, 18.1],
    [98.2, 18.2],
    [98.3, 18.3],
  ];
  const profile = buildRouteElevationProfile(coords, [300, 900, 1100, 1200], { mountainThresholdM: 500 });
  assert.equal(profile.mountainPct, 75);
  assert.equal(profile.schoolElevationM, 1200);
});
