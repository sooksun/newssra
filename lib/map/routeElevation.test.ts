import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRouteElevationProfile,
  formatElevationMeters,
  formatRouteHighestLabel,
  routeElevationSampleCoordinates,
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
  const profile = buildRouteElevationProfile([[99, 20], [99.1, 20.1]], [1070, 1062]);
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
