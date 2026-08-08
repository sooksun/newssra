// source-grep — ตรึงว่าการนับลูกเขาต่อสายไฟครบใน CesiumMap: วัดจากเส้นทางหลักที่ถูกเลือก
// และผลไปกับ payload บันทึก (แพตเทิร์นเดียวกับ tests/route-elevation-flags.test.ts)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("CesiumMap สุ่มความสูง 3 แนวแล้วเรียก countRidgeCrossings", () => {
  assert.match(source, /sampleWaveLines\(/);
  assert.match(source, /countRidgeCrossings\(/);
});

test("ผลนับลูกไปกับ payload เส้นหลัก (ridgeCrossings)", () => {
  const payload = source.slice(source.indexOf("const buildRoutesPayload"));
  assert.ok(payload.length > 100, "ต้องมี buildRoutesPayload");
  assert.match(payload.slice(0, 2500), /ridgeCrossings: mainRouteRidges/);
});

test("การนับผูกกับเส้นทางที่ถูกเลือก — เปลี่ยนเส้นแล้ววัดใหม่", () => {
  const idx = source.indexOf("sampleWaveLines(");
  assert.ok(idx > 0);
  const around = source.slice(Math.max(0, idx - 4000), idx + 4000);
  assert.match(around, /selectedRouteIdx|routeCoordsRef/);
});

test("แผงวิเคราะห์แสดงจำนวนลูกที่ข้ามจาก preview เดียวกับที่บันทึก", () => {
  const panel = readFileSync("components/map/GisAssessmentPanel.tsx", "utf8");
  assert.match(panel, /ข้ามภูเขา/);
  assert.match(panel, /ridgeCrossings/);
  // preview ต้องพกผลนับชุดเดียวกับ payload (ตัวเลขบนจอ = ตัวเลขที่เก็บ)
  assert.match(source, /ridgeCrossings: mainRouteRidges/);
});
