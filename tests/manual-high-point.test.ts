// จุดสูงสุดที่ผู้ใช้ชี้เอง (คลิกขวาบนแผนที่) — ข้อความบนป้าย + สัญญา "ดูอย่างเดียว ไม่บันทึก"
// ส่วนที่เป็น Cesium ล้วน ๆ ตรึงด้วย source-grep เหมือน tests/route-elevation-flags.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatManualHighPointLabel } from "@/lib/map/routeElevation";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("label shows the elevation and the coordinates of the clicked point", () => {
  const label = formatManualHighPointLabel({ lat: 19.12345, lng: 99.6789, elevationM: 1234.6 });
  assert.match(label, /จุดสูงสุด \(ชี้เอง — ไม่บันทึก\)/);
  assert.match(label, /ระดับความสูง 1,235 ม\./);
  assert.match(label, /19\.12345, 99\.67890/);
});

test("label says so plainly when the terrain height is unavailable — never a stand-in number", () => {
  const label = formatManualHighPointLabel({ lat: 19, lng: 99, elevationM: null });
  assert.match(label, /ไม่มีข้อมูลระดับความสูงตรงจุดนี้/);
  assert.doesNotMatch(label, /\d+ ม\./);
});

test("non-finite elevation is treated as missing, not rendered as NaN", () => {
  const label = formatManualHighPointLabel({ lat: 19, lng: 99, elevationM: Number.NaN });
  assert.match(label, /ไม่มีข้อมูลระดับความสูงตรงจุดนี้/);
  assert.doesNotMatch(label, /NaN/);
});

test("right-click handler is wired to the manual high-point setter", () => {
  assert.match(component, /const set_high_point_manaual = useCallback\(/);
  assert.match(component, /ScreenSpaceEventType\.RIGHT_CLICK/);
  assert.match(component, /canvas\.addEventListener\("contextmenu", suppressContextMenu\)/);
  assert.match(component, /canvas\.removeEventListener\("contextmenu", suppressContextMenu\)/);
});

test("the manual pin is view-only: never sent to the server and only one pin at a time", () => {
  // ไม่มีการส่ง manualHighPoint ไปกับ payload ที่บันทึก (/from-map หรือ /gis)
  assert.doesNotMatch(component, /manualHighPoint[^\n]*(body|JSON\.stringify|areaSummary|highestPoint:)/);
  // datasource ถูกล้างทั้งชุดก่อนวางหมุดใหม่ → เหลือจุดล่าสุดเพียงจุดเดียว
  const drawIdx = component.indexOf('id: "manual-high-point"');
  assert.ok(drawIdx > 0, "ไม่พบ entity หมุดจุดสูงสุดที่ชี้เอง");
  const before = component.slice(component.lastIndexOf("useEffect(", drawIdx), drawIdx);
  assert.match(before, /ds\.entities\.removeAll\(\)/);
});
