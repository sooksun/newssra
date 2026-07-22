import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("Cesium renders red flag billboards for the school and selected-route high point", () => {
  assert.match(component, /const RED_FLAG_ICON/);

  const schoolStart = component.indexOf('id: "center-pin"');
  const highStart = component.indexOf('id: "route-highest-point"');
  assert.ok(schoolStart >= 0, "missing draggable school entity");
  assert.ok(highStart >= 0, "missing selected-route highest-point entity");
  assert.match(component.slice(schoolStart, schoolStart + 1_400), /billboard:\s*\{/);
  assert.match(component.slice(highStart, highStart + 1_400), /billboard:\s*\{/);
});

test("both flag labels expose elevation and route sampling keeps the exact school coordinate", () => {
  assert.match(component, /ระดับความสูง[\s\S]*formatElevationMeters/);
  assert.match(component, /จุดสูงสุดบนเส้นทาง[\s\S]*formatElevationMeters/);
  assert.match(component, /sampledCoords\[sampledCoords\.length - 1\] = \[center\.lng, center\.lat\]/);
  assert.match(component, /buildRouteElevationProfile\(sampledCoords, heights\)/);
});
