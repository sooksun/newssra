// source-grep test: เส้นทางที่นำไปคิดคะแนนต้องเป็นเส้นทางในประเทศเท่านั้น
// ถ้าเส้นทางข้ามพรมแดนหลุดเข้าไป ระยะทาง/เวลาที่บันทึกลงตัวชี้วัด 3.1/3.2 จะเป็นการเดินทางที่ทำจริงไม่ได้
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("both OSRM call sites filter out routes that cross a border", () => {
  const callSites = component.split("fetchOsrmRoutes(").length - 1;
  assert.ok(callSites >= 2, "คาดว่ามีจุดเรียก fetchOsrmRoutes อย่างน้อยสองแห่ง (เส้นทางหลัก + จุดหมายเพิ่ม)");
  const filterCalls = component.split("filterDomesticRoutes(").length - 1;
  assert.ok(filterCalls >= 2, "ทุกจุดที่ขอเส้นทางต้องกรองเส้นข้ามพรมแดนออก");
  assert.match(component, /import \{ borderBlockedMessage, filterDomesticRoutes \} from "@\/lib\/map\/borderCrossing"/);
});

test("when every alternative crosses a border no route is used at all", () => {
  assert.match(component, /if \(domestic\.length === 0\) \{/);
  assert.match(component, /setRoute\(null\)/);
  assert.match(component, /setRouteErr\(borderBlockedMessage\(/);
  // ไม่มีเส้นทางศาลากลาง → ปุ่มบันทึกจะถูกล็อกด้วย missingData เดิมของ GisAssessmentPanel
  assert.match(component, /routeCoordsRef\.current = null/);
});

test("the user is told when a foreign route was dropped but a domestic one remains", () => {
  assert.match(component, /setRouteBorderNote\(/);
  assert.match(component, /routeBorderNote \? <p className="map-note map-note-sync">/);
});

test("a failed border download must not disable routing entirely", () => {
  assert.match(component, /loadBorders\(\)\.catch\(\(\) => null\)/);
});
