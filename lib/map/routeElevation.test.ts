import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRouteElevationProfile,
  formatElevationMeters,
  sampleRouteCoordinates,
  type RouteCoordinate,
} from "./routeElevation";

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
