// source-grep test — ตรึงพฤติกรรมชั้น polygon ป่าใน CesiumMap ที่รันทดสอบด้วย runtime ไม่ได้
// (แพตเทิร์นเดียวกับ tests/route-elevation-flags.test.ts)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("ชั้นสภาพป่าจริงปิดเป็นค่าเริ่มต้น", () => {
  assert.match(source, /const \[showForestCover, setShowForestCover\] = useState\(false\)/);
});

test("ดึง geometry จาก route ที่แยกไว้ ไม่ใช่ route วิเคราะห์เดิม", () => {
  assert.match(source, /\/api\/forest-status\/polygons\?/);
});

test("polygon ป่าทาบภูมิประเทศ ไม่ลอยเหนือพื้น", () => {
  const draw = source.slice(source.indexOf("forest-cover-"));
  assert.match(draw.slice(0, 1200), /heightReference: HeightReference\.CLAMP_TO_GROUND/);
  assert.match(draw.slice(0, 1200), /clampToGround: true/);
});

test("แสดงเครดิตข้อมูลกรมป่าไม้เมื่อเปิดชั้น (CC-BY กำหนดให้ต้องแสดง)", () => {
  assert.match(source, /forestCoverCredit/);
});

test("ยกเลิกคำขอที่ค้างเมื่อย้ายหมุด/ปิดชั้น", () => {
  const keyIndex = source.indexOf("showForestCover, center.lat");
  assert.ok(keyIndex > 0, "effect ต้อง keyed ด้วย showForestCover + center");
  const before = source.slice(0, keyIndex);
  assert.match(before.slice(-2000), /controller\.abort\(\)/);
});

test("ชั้นป่าทั่วไป OSM ปิดเป็นค่าเริ่มต้น", () => {
  assert.match(source, /const \[showForestGeneric, setShowForestGeneric\] = useState\(false\)/);
});

test("ป่าทั่วไปดึงผ่านโมดูลที่แยกไว้ ไม่ผ่าน classifyForestOverlay", () => {
  assert.match(source, /fetchGenericForest\(/);
  const generic = source.slice(source.indexOf("fetchGenericForest("));
  assert.doesNotMatch(generic.slice(0, 1500), /classifyForestOverlay/);
});

test("แสดงเครดิต OpenStreetMap เมื่อเปิดชั้นป่าทั่วไป (ODbL กำหนดให้ต้องแสดง)", () => {
  assert.match(source, /GENERIC_FOREST_ATTRIBUTION/);
});

test("ป่าทั่วไปวาดคนละสีกับสภาพป่าจริง", () => {
  assert.match(source, /const FOREST_GENERIC_COLOR = "#84cc16"/);
  assert.match(source, /const FOREST_COVER_COLOR = "#16a34a"/);
});
