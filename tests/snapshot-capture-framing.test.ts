// Source-grep test: การจับภาพ 3D เป็นพฤติกรรมที่รันได้เฉพาะบนเบราว์เซอร์ (WebGL) จึงพินสัญญาสำคัญ
// ไว้ที่ระดับซอร์สแทน — กันการถอยกลับไปเล็งกล้องที่ความสูง 0 (หมุดหลุดขอบภาพในมุมใกล้)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SNAPSHOT_VIEWS } from "../lib/map/snapshotViews";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("กล้องจับภาพเล็งที่ผิวภูมิประเทศจริง ไม่ใช่ผิวทรงรี (ความสูง 0)", () => {
  // ต้องอ่านความสูงพื้นที่จุดโรงเรียน แล้วส่งเป็นอาร์กิวเมนต์ที่ 3 ของ fromDegrees
  assert.match(component, /viewer\.scene\.globe\.getHeight\(pinCarto\)/);
  assert.match(component, /const pin = Cartesian3\.fromDegrees\(center\.lng, center\.lat, pinHeightM\)/);
  // fallback เมื่อไทล์ยังไม่โหลด: ใช้ความสูงจากโปรไฟล์เส้นทาง ไม่ใช่ 0 เฉย ๆ
  assert.match(component, /routeElevationProfile\?\.schoolElevationM \?\? 0/);
});

test("จับภาพด้วยความละเอียดสูงกว่าปกติ แล้วคืนค่าเดิมเสมอ", () => {
  assert.match(component, /viewer\.resolutionScale = SNAPSHOT_RESOLUTION_SCALE/);
  assert.match(component, /viewer\.resolutionScale = prevResolutionScale/);
  assert.match(component, /await waitForTilesLoaded\(viewer, SNAPSHOT_TILE_WAIT_MS, SNAPSHOT_TILE_STABLE_TICKS\)/);
});

test("มุมภาพรวมครอบสองจุดใช้ BoundingSphere ของโรงเรียน+ศาลากลาง ไม่ใช่ lookAt รอบโรงเรียน", () => {
  // แยกสาขา frame ออกจาก lookAt และครอบทั้งหมุดโรงเรียน (pin) กับพิกัดศาลากลาง (province)
  assert.match(component, /view\.frame === "school-and-province"/);
  assert.match(component, /BoundingSphere\.fromPoints\(\[pin, hall\]\)/);
  assert.match(component, /viewer\.camera\.viewBoundingSphere\(/);
  // ต้องมีพิกัดศาลากลางจึงจับได้ — ไม่มี province ให้ข้ามมุมนี้ (ไม่พังทั้งชุด)
  assert.match(component, /if \(!province\)\s*\{[\s\S]{0,120}continue;/);
});

test("มุมใกล้ต้องใกล้กว่ามุมไกลอย่างมีนัยสำคัญ และก้มพอจะเห็นพื้นที่รอบโรงเรียน", () => {
  const near = SNAPSHOT_VIEWS.filter((v) => v.key.startsWith("near-"));
  const far = SNAPSHOT_VIEWS.filter((v) => v.key.startsWith("far-"));
  for (const v of near) {
    assert.ok(v.rangeM <= 2500, `มุมใกล้ ${v.key} ไกลเกินไป (${v.rangeM} ม.)`);
    assert.ok(v.pitchDeg <= -40, `มุมใกล้ ${v.key} ก้มน้อยเกินไป (${v.pitchDeg}°)`);
  }
  for (const v of far) {
    assert.ok(v.rangeM >= 3 * near[0].rangeM, `มุมไกล ${v.key} ต้องกว้างกว่ามุมใกล้อย่างชัดเจน (${v.rangeM} ม.)`);
  }
});
