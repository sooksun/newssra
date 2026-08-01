// source-grep test: การซ่อนป้ายที่ทับกันบนจอ ต้องซ่อนเฉพาะ "ป้าย" ไม่ใช่หมุด/ธง
// และต้องคำนวณใหม่เรื่อย ๆ เพื่อให้ป้ายกลับมาแสดงเองเมื่อผู้ใช้ซูมเข้า
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("declutter runs off postRender so it follows every camera move", () => {
  assert.match(component, /scene\.postRender\.addEventListener\(declutter\)/);
  assert.match(component, /scene\.postRender\.removeEventListener\(declutter\)/);
  assert.match(component, /now - lastRunMs < LABEL_DECLUTTER_INTERVAL_MS/);
});

test("only label entities are toggled — pins, flags and points keep showing", () => {
  const start = component.indexOf("const declutter = () => {");
  assert.ok(start > 0, "ไม่พบรอบตรวจการทับซ้อน");
  const body = component.slice(start, component.indexOf("scene.postRender.addEventListener", start));
  // เข้าถึงเฉพาะ entity ที่ลงทะเบียนไว้ใน labelPlacements (สร้างโดย addPinLabel เท่านั้น)
  assert.match(body, /const placement = labelPlacements\.get\(id\);/);
  assert.match(body, /if \(!placement\) continue;/);
  assert.match(body, /entity\.show = show/);
});

test("screen boxes are built in drawing-buffer pixels, the same space as billboard sizes", () => {
  assert.match(component, /SceneTransforms\.worldToDrawingBufferCoordinates\(scene, position, anchor\)/);
  assert.match(component, /labelBox\(id, screen\.x, screen\.y, placement\)/);
});

test("labels behind the camera or off screen never block the visible ones", () => {
  assert.match(component, /Cartesian3\.dot\(toPoint, scene\.camera\.directionWC\) <= 0/);
  assert.match(component, /box\.right < 0 \|\| box\.bottom < 0 \|\| box\.left > scene\.drawingBufferWidth/);
});

test("every label registers a priority so the important one survives a clash", () => {
  assert.match(component, /const LABEL_PRIORITY = \{/);
  const registered = component.match(/priority: LABEL_PRIORITY\.[a-zA-Z]+/g) ?? [];
  const created = component.match(/addPinLabel\(/g) ?? [];
  // addPinLabel ปรากฏหนึ่งครั้งเป็นนิยามฟังก์ชัน ที่เหลือคือจุดเรียกใช้
  assert.equal(registered.length, created.length - 1, "ทุกจุดที่สร้างป้ายต้องกำหนดลำดับความสำคัญ");
  assert.match(component, /priority: LABEL_PRIORITY\.school/);
});
