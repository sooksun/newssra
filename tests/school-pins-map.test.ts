// Source-grep tests: pin ภาพรวมโรงเรียนบนแผนที่ (Cesium) — behavior ที่ browser test ไม่ครอบ
// ตรึงการผูก: prop schoolPins, การวาดหมุดสี, label ชื่อ, และคลิก → /map?assessment=ID
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const map = readFileSync("components/map/CesiumMap.tsx", "utf8");
const loader = readFileSync("components/map/CesiumMapLoader.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("CesiumMap รับ prop schoolPins และมี datasource ของหมุดโรงเรียน", () => {
  assert.match(map, /schoolPins\s*=\s*\[\]/);
  assert.match(map, /schoolPinsDsRef/);
  assert.match(map, /new CustomDataSource\("schoolPins"\)/);
});

test("หมุดโรงเรียนวาดเป็น point สีตามสถานะ + label ชื่อโรงเรียน", () => {
  assert.match(map, /function schoolPinColor/);
  assert.match(map, /#6b7280/);
  assert.match(map, /#22c55e/);
  assert.match(map, /#ef4444/);
  assert.match(map, /id: `school-pin:\$\{pin\.id\}`/);
  assert.match(map, /text: pin\.name/);
});

test("คลิกหมุดโรงเรียน → เปิดมุมมองแบบประเมินของโรงเรียนนั้น (read-only)", () => {
  assert.match(map, /school-pin:/);
  assert.match(map, /window\.location\.assign\(`\/map\?assessment=\$\{schoolPinId\}`\)/);
});

test("พาเนลโหมดทั้งประเทศแสดง legend สีหมุด", () => {
  assert.match(map, /map-pin-legend/);
  assert.match(css, /\.map-pin-legend\b/);
});

test("CesiumMapLoader ส่งผ่าน prop schoolPins", () => {
  assert.match(loader, /schoolPins/);
});
