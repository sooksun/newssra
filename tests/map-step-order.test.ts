// source-grep test: ตรึงลำดับขั้นตอนในแผงแผนที่ 3 มิติ (บนลงล่าง 1→5)
// ลำดับนี้มีผลต่อความถูกต้อง ไม่ใช่แค่ความสวยงาม — พื้นที่ที่วาด (ขั้นตอน 3) ถูกบันทึกไปพร้อมปุ่มบันทึก
// ซึ่งเป็นขั้นตอนสุดท้าย (ขั้นตอน 5) จึงต้องอยู่ล่างสุดของแผงเสมอ
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

function at(needle: string): number {
  const i = component.indexOf(needle);
  assert.ok(i >= 0, `ไม่พบใน CesiumMap.tsx: ${needle}`);
  return i;
}

test("panel blocks follow the numbered step order top to bottom", () => {
  const step1 = at('title="ยืนยันจุดที่ตั้งโรงเรียน"');
  const search = at('<div className="map-search">');
  const step2 = at('title="เลือกเส้นทางเดินทางเข้าถึง"');
  const routePicker = at('<div className="map-route-picker">');
  const step3 = at('title="วาดพื้นที่เพื่อคำนวณประชากร (ถ้าต้องการ)"');
  const drawControls = at('<div className="map-draw-controls">');
  const step4 = at('title="จับภาพ 3D ยืนยันที่ตั้ง"');
  const snapshot = at('<div className="map-snapshot-block">');
  const step5 = at('title="บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน"');
  const savePanel = at("<GisAssessmentPanel");

  assert.ok(step1 < search, "ขั้นตอน 1 ต้องอยู่เหนือช่องค้นหา");
  assert.ok(search < step2, "ช่องค้นหาต้องอยู่เหนือขั้นตอน 2");
  assert.ok(step2 < routePicker, "ขั้นตอน 2 ต้องอยู่เหนือปุ่มเลือกเส้นทาง");
  assert.ok(routePicker < step3, "ปุ่มเลือกเส้นทางต้องอยู่เหนือขั้นตอน 3");
  assert.ok(step3 < drawControls, "ขั้นตอน 3 ต้องอยู่เหนือปุ่มวาดพื้นที่");
  assert.ok(drawControls < step4, "ปุ่มวาดพื้นที่ต้องอยู่เหนือขั้นตอน 4");
  assert.ok(step4 < snapshot, "ขั้นตอน 4 ต้องอยู่เหนือปุ่มจับภาพ 3D");
  assert.ok(snapshot < step5, "ปุ่มจับภาพ 3D ต้องอยู่เหนือขั้นตอน 5");
  assert.ok(step5 < savePanel, "ขั้นตอน 5 ต้องอยู่เหนือกล่องบันทึก GIS");
});

test("the save action is the last actionable block in the panel", () => {
  const savePanel = at("<GisAssessmentPanel");
  for (const later of [
    '<div className="map-search">',
    '<div className="map-route-picker">',
    '<div className="map-draw-controls">',
    '<div className="map-snapshot-block">',
    '<div className="map-rings">',
    '<div className="map-analysis">',
  ]) {
    assert.ok(at(later) < savePanel, `${later} ต้องอยู่เหนือปุ่มบันทึก (บันทึกคือขั้นตอนสุดท้าย)`);
  }
});

test("map display settings and credits stay after the last step", () => {
  const savePanel = at("<GisAssessmentPanel");
  const imagery = at("map-imagery-status map-imagery-status-");
  const borders = at('<label className="map-border-toggle">');
  const credit = at('<p className="map-credit">');

  assert.ok(savePanel < imagery, "สถานะภาพถ่าย/แนวชายแดนเป็นการตั้งค่า ไม่ใช่ขั้นตอน จึงอยู่ท้ายสุด");
  assert.ok(imagery < borders && borders < credit);
});

test("the save step is the last one, so hiding it never leaves a numbering gap", () => {
  assert.match(component, /const showSaveStep = !national && \(canSaveAssessment \|\| Boolean\(assessment\)\)/);
  assert.doesNotMatch(component, /snapshotStepNo/);
  assert.match(component, /step=\{4\}\r?\n\s+title="จับภาพ 3D ยืนยันที่ตั้ง"/);
  assert.match(component, /step=\{5\}\r?\n\s+title="บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน"/);
});

test("step heading styles keep the numbered badge and the section divider", () => {
  assert.match(css, /\.map-step-num\s*\{[^}]*border-radius:\s*50%;/);
  assert.match(css, /\.map-step\s*\{[^}]*border-top:\s*1px solid var\(--line\);/);
});
