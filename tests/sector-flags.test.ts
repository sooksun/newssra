import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// เทสต์อ่านซอร์สเป็นข้อความ (แบบเดียวกับ route-elevation-flags.test.ts) เพราะพฤติกรรมนี้อยู่ใน Cesium ล้วน
// รันในเบราว์เซอร์ไม่ได้ในชุดเทสต์นี้ จึงตรึง "การต่อสาย" ไว้แทน
const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("แผนที่คำนวณธง 8 ทิศจากกริดชุดเดียวกับการวิเคราะห์ภูมิประเทศ (ไม่ยิง terrain เพิ่ม)", () => {
  assert.match(component, /sectorElevationsFromGrid\(grid, GRID_N, ANALYSIS_WIDTH_M, bbox/);
  // ต้องไม่มีการสุ่ม terrain รอบใหม่เฉพาะสำหรับธง 8 ทิศ
  assert.equal(component.match(/sampleCesiumGrid\(/g)?.length, 1);
});

test("รัศมีและค่า K มาจากค่าคงที่ร่วม ไม่ hardcode ซ้ำในคอมโพเนนต์", () => {
  assert.match(component, /SECTOR_RADIUS_M/);
  assert.match(component, /SECTOR_RELIEF_K_M/);
  assert.doesNotMatch(component, /radiusM:\s*1000\b/);
  assert.doesNotMatch(component, /thresholdM:\s*50\b/);
});

test("ธงม่วง/ฟ้าปักทีละจุด และปักเฉพาะจุดที่ผ่านเกณฑ์ ±K จากความสูงโรงเรียน", () => {
  assert.match(component, /const SECTOR_HIGH_FLAG_ICON/);
  assert.match(component, /const SECTOR_LOW_FLAG_ICON/);

  const highStart = component.indexOf("id: `sector-high-${sector.sector}`");
  const lowStart = component.indexOf("id: `sector-low-${sector.sector}`");
  assert.ok(highStart >= 0, "ไม่มี entity ธงจุดสูงสุดราย 8 ทิศ");
  assert.ok(lowStart >= 0, "ไม่มี entity ธงจุดต่ำสุดราย 8 ทิศ");
  assert.match(component.slice(highStart, highStart + 800), /billboard:\s*\{/);
  assert.match(component.slice(lowStart, lowStart + 800), /billboard:\s*\{/);

  // เกณฑ์ซ่อน/แสดงต้องมาจาก sectorFlagVisible (ตัวเดียวที่เทสต์ครอบคลุมกติกา ±K) — ตัดสินรายจุด ไม่ใช่รายทิศ
  assert.match(component, /if \(sectorFlagVisible\(sector\.highest\) && sector\.highest\)/);
  assert.match(component, /if \(sectorFlagVisible\(sector\.lowest\) && sector\.lowest\)/);
  // ห้ามกลับไปวาดธงจาง ๆ แทนการซ่อน
  assert.doesNotMatch(component, /SECTOR_FLAG_MUTED_ALPHA/);
});

test("ป้ายธงใช้ addPinLabel (ห้ามใช้ Cesium label กับข้อความไทย) และข้อความมาจากตัวจัดรูปกลาง", () => {
  assert.match(component, /sectorFlagLines\(`สูงสุดทิศ\$\{sectorTh\}`/);
  assert.match(component, /sectorFlagLines\(`ต่ำสุดทิศ\$\{sectorTh\}`/);
  assert.match(component, /priority: LABEL_PRIORITY\.sector/);
});

test("payload ที่ส่งขึ้น server มีเฉพาะค่าดิบ — ไม่ส่ง relief/aboveThreshold ที่ client คำนวณ", () => {
  const start = component.indexOf("sectorElevations: sectorResult.sectors.map(");
  assert.ok(start >= 0, "ไม่ได้ส่ง sectorElevations ไปกับการบันทึกจากแผนที่");
  const payload = component.slice(start, start + 600);
  assert.doesNotMatch(payload, /reliefM/);
  assert.doesNotMatch(payload, /aboveThreshold/);
  assert.doesNotMatch(payload, /deltaFromSchoolM/);
  // รัศมี/ค่า K ต้องมาจากค่าคงที่ฝั่ง server เท่านั้น ไม่ส่งขึ้นไปให้เชื่อ
  assert.doesNotMatch(payload, /radiusM/);
  assert.doesNotMatch(payload, /thresholdM/);
});
