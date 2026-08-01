// จุดสูงสุดที่ผู้ใช้ชี้เอง (คลิกขวาบนแผนที่) — ข้อความบนป้าย + สัญญา "ดูอย่างเดียว ไม่บันทึก"
// ส่วนที่เป็น Cesium ล้วน ๆ ตรึงด้วย source-grep เหมือน tests/route-elevation-flags.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatManualHighPointLabel } from "@/lib/map/routeElevation";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("label shows only the title and the elevation — no coordinates, no disclaimer text", () => {
  const label = formatManualHighPointLabel({ lat: 20.32407, lng: 99.61637, elevationM: 1072.4 });
  assert.equal(label, "จุดสูงสุด\nระดับความสูง 1,072 ม.");
  assert.doesNotMatch(label, /ไม่บันทึก|ชี้เอง/);
  assert.doesNotMatch(label, /20\.32407|99\.61637/);
});

test("label says it is still reading while the terrain sample is in flight", () => {
  const label = formatManualHighPointLabel({ lat: 19, lng: 99, elevationM: null, sampling: true });
  assert.match(label, /กำลังอ่านระดับความสูง…/);
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
  assert.match(component, /const set_high_point_manaual = useCallback\(async /);
  assert.match(component, /ScreenSpaceEventType\.RIGHT_CLICK/);
  assert.match(component, /canvas\.addEventListener\("contextmenu", suppressContextMenu\)/);
  assert.match(component, /canvas\.removeEventListener\("contextmenu", suppressContextMenu\)/);
});

// ฉากตั้ง verticalExaggeration ไว้ 2 เท่า — ความสูงจาก globe.getHeight()/pickPosition จึงเป็นค่าที่คูณแล้ว
// (เคยทำให้ป้ายขึ้น 2,125 ม. ที่จุดซึ่งจริง ๆ สูงราว 1,062 ม.) ต้องสุ่มจาก terrain provider เท่านั้น
test("elevation comes from the terrain provider, not from the exaggerated render space", () => {
  const start = component.indexOf("const set_high_point_manaual");
  assert.ok(start > 0, "ไม่พบ set_high_point_manaual");
  const body = component
    .slice(start, component.indexOf("useEffect(", start))
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//")) // คอมเมนต์อธิบายเหตุผลพูดถึงชื่อ API เหล่านี้ได้
    .join("\n");
  assert.match(body, /sampleCesiumPoints\(provider, \[\{ lat, lng \}\], KEYLESS_SAMPLE_LEVEL\)/);
  // pickPosition ใช้ได้เฉพาะหาละติจูด/ลองจิจูดในตัว handler — ความสูงต้องไม่มาจากพื้นที่เรนเดอร์
  assert.doesNotMatch(body, /globe\.getHeight|carto\.height/);
  assert.match(component, /scene\.verticalExaggeration = VERTICAL_EXAGGERATION/);
});

test("a later right-click wins when samples resolve out of order", () => {
  assert.match(component, /const manualHighSeqRef = useRef\(0\)/);
  assert.match(component, /if \(seq !== manualHighSeqRef\.current\) return/);
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
