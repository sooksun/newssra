// source-grep test: ป้ายของหมุดทั้งสามบนแผนที่ 3 มิติ ต้องวาดเป็นรูป (addPinLabel) ไม่ใช่ Cesium Label
//
// Cesium แยก glyph ทีละตัวอักษรลง texture atlas แล้วจัดตำแหน่งเอง ข้อความไทยที่มีสระบน/ล่าง
// และวรรณยุกต์จึงถูกฉีก — ของจริงที่เจอคือ "ระดับความสูง" กลายเป็น "ระดั" แล้วขึ้นบรรทัดใหม่เป็น "บ"
// และ "จุดสูงสุด ระ / บความสูง 914 ม." การถอยกลับไปใช้ label: { text } จะทำให้บั๊กนี้กลับมา
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

/** เนื้อความของ entity ตัวที่มี id ที่ระบุ (ตัดตั้งแต่ id ไปจนจบ object) */
function entityBlock(id: string): string {
  const start = component.indexOf(`id: "${id}"`);
  assert.ok(start > 0, `ไม่พบ entity id="${id}"`);
  return component.slice(start, start + 900);
}

test("every pin that shows free-form Thai draws its label through addPinLabel", () => {
  const ids = [
    "center-pin-label", // ชื่อโรงเรียน + ระดับความสูง
    "route-highest-point-label",
    "manual-high-point-label",
    "province-hall-label", // "ศาลากลางจังหวัดเชียงราย"
    "search-pin-label", // ชื่อสถานที่จากการค้นหา
  ];
  for (const id of ids) assert.ok(component.includes(`id: "${id}"`), `ไม่พบป้ายของหมุด ${id}`);
  // ป้ายที่ id สร้างจากข้อมูล (ชื่อโรงเรียนภาพรวม / ชื่อประเทศเพื่อนบ้าน / จุดหมาย GIS)
  assert.match(component, /id: `school-pin:\$\{pin\.id\}:label`/);
  // ชื่อประเทศเพื่อนบ้านมีหลายป้ายต่อหนึ่งแนวชายแดน (วางบนเส้นจริง) จึงมีลำดับต่อท้าย id
  assert.match(component, /id: `border-label:\$\{border\.name\}:\$\{index\}`/);
  assert.match(component, /id: `gis-dest-label:\$\{d\.key\}`/);
  assert.match(component, /function addPinLabel\(/);
});

// ด่านสุดท้าย: Cesium Label ที่ยังเหลือได้ต้องเป็นข้อความที่ไม่มีสระบน/ล่างหรือวรรณยุกต์เท่านั้น
// เพิ่ม label ใหม่ที่มีข้อความไทยเต็มรูปแบบเมื่อไร เทสต์นี้จะพัง — ให้ใช้ addPinLabel แทน
test("the Cesium Labels left in the map only render text without Thai combining marks", () => {
  const allowed = new Set([
    "text: `ระยะตรง ${fmtKm(straightM)}`,",
    "text: String(i + 1),",
    "text: r >= 1000 ? `${r / 1000} กม.` : `${r} ม.`,",
  ]);
  const combiningMark = /[ัิ-ฺ็-๎]/;
  const lines = component.split(/\r?\n/);

  const used = lines.flatMap((line, index) => (line.trim() === "label: {" ? [lines[index + 1].trim()] : []));
  assert.ok(used.length > 0, "ไม่พบ Cesium label เหลืออยู่เลย — ปรับเทสต์ให้ตรงกับโค้ดจริง");
  for (const text of used) {
    assert.ok(allowed.has(text), `label ใหม่ต้องใช้ addPinLabel ไม่ใช่ Cesium label: ${text}`);
    assert.doesNotMatch(text, combiningMark, `ข้อความนี้มีสระ/วรรณยุกต์ Cesium จะฉีก glyph: ${text}`);
  }
});

test("no Cesium Label is attached to the school pin, the route-highest pin or the manual pin", () => {
  for (const id of ["center-pin", "route-highest-point", "manual-high-point"]) {
    assert.doesNotMatch(entityBlock(id), /\blabel: \{/, `หมุด ${id} ต้องไม่ใช้ Cesium label กับข้อความไทย`);
  }
});

test("the label entity is a billboard sized to the rendered image", () => {
  const block = component.slice(component.indexOf("function addPinLabel("));
  assert.match(block, /image: image\.url/);
  assert.match(block, /width: image\.width/);
  assert.match(block, /height: image\.height/);
});

test("the school pin label follows the pin while it is being dragged", () => {
  assert.match(component, /centerPinLabelRef\.current\.position = draggedPosition/);
  assert.match(component, /centerPinRef\.current\.position = draggedPosition/);
});

test("clicking the overview school name still opens that school, not a broken id", () => {
  assert.match(component, /raw\.slice\("school-pin:"\.length\)\.replace\(\/:label\$\/, ""\)/);
});
