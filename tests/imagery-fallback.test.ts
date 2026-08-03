// Source-grep test — pin พฤติกรรม fallback ของชั้นภาพถ่ายที่รันจริงต้องมี WebGL/เครือข่าย
// (แบบเดียวกับ tests/route-elevation-flags.test.ts และ tests/snapshot-3dtiles-wiring.test.ts)
//
// ทำไมต้องมี: ระบบพึ่ง Google เป็นภาพฐานหลักตั้งแต่สลับ provider ถ้า provider ล้มแล้วไม่ถอย
// ลูกโลกจะไม่มีภาพถ่ายเลย แต่ปุ่มจับภาพ 3D ยังทำงานต่อ → ส่งภาพเปล่า 10 ใบเข้า AI ไปตัดสิน
// "ลักษณะที่ตั้ง" โดยไม่มีอะไรเตือน ซึ่งเป็นความเสียหายเงียบที่ผู้ตรวจจับไม่ได้จากผลลัพธ์

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "components/map/CesiumMap.tsx"), "utf8");

test("provider ที่โหลดแบบ async ต้องถูกดักความล้มเหลวทุกตัว", () => {
  // ทั้ง google และ ion ต้องผ่าน guard() ก่อนส่งให้ ImageryLayer.fromProviderAsync
  // นับเทียบกันตรง ๆ แทน negative lookahead (ซึ่ง \s* ยุบเป็นศูนย์แล้วผ่านเสมอ = เทสหลอกตัวเอง)
  const allCalls = (src.match(/ImageryLayer\.fromProviderAsync\(/g) ?? []).length;
  const guardedCalls = (src.match(/ImageryLayer\.fromProviderAsync\(\s*guard\(/g) ?? []).length;
  assert.ok(allCalls >= 2, `คาดว่ามีอย่างน้อย 2 จุด (google + ion) แต่พบ ${allCalls}`);
  assert.equal(guardedCalls, allCalls, "ทุกจุดที่เรียก fromProviderAsync ต้องส่ง provider ที่ผ่าน guard() แล้ว");
  assert.ok(/const guard = \(provider: Promise<ImageryProvider>\) =>/.test(src), "ต้องมี guard() ที่ดัก catch");
  assert.ok(/onProviderFailed\?\.\(source,/.test(src), "guard ต้องรายงานกลับผู้เรียกพร้อมชื่อ provider");
});

test("เมื่อ provider ล้ม ต้องถอยไป Esri จริง ๆ ไม่ใช่แค่ log", () => {
  assert.ok(
    /replaceEsriImageryLayer\(ESRI_MAX_REQUEST_LEVEL, \{ force: true \}\)/.test(src),
    "ต้องสลับชั้นภาพเป็น Esri แบบ force (ระดับเท่าเดิมจึงถูกกันไว้โดย guard ปกติ)",
  );
});

test("แถบสถานะต้องบอกผู้ใช้ว่าใช้ provider สำรอง พร้อมเหตุผล", () => {
  assert.ok(/tone: "warn"/.test(src), "ต้องเป็นโทนเตือน ไม่ใช่ ok/muted");
  assert.ok(/\(สำรอง\)/.test(src), "ป้ายต้องบอกว่าเป็นชั้นภาพสำรอง");
  assert.ok(/detail: `ใช้ \$\{imageryLabel\(failedSource\)\} ไม่ได้ — \$\{reason\}`/.test(src), "ต้องแสดงเหตุผลจริง");
});

test("imageryStatus.source ต้องถูกตั้งเป็น esri ตอน fallback (ค่านี้ถูกบันทึกลง metadata ของภาพ)", () => {
  assert.ok(
    /imageryFallbackRef\.current = \([\s\S]{0,400}source: "esri"/.test(src),
    "ตัวจัดการ fallback ต้องตั้ง source เป็น esri ไม่งั้น metadata จะบันทึกว่าภาพมาจาก Google ทั้งที่ไม่ใช่",
  );
});

test("การอัปโหลดต้องส่งแหล่งภาพ/ภูมิประเทศที่ใช้จริงไปด้วย", () => {
  assert.ok(/fd\.append\("imagerySource", imageryStatus\.source\)/.test(src), "ต้องส่งแหล่งภาพที่ใช้จริง");
  assert.ok(/fd\.append\("terrainSource", usedTerrainSource\)/.test(src), "ต้องส่งแหล่งภูมิประเทศที่ใช้จริง");
  // ต้องตั้งเป็น google-3dtiles เฉพาะเมื่อ tileset โหลดสำเร็จ ไม่ใช่เมื่อ "ตั้งใจเปิด"
  assert.ok(/if \(tileset\) usedTerrainSource = "google-3dtiles";/.test(src), "ต้องอิงผลจริง ไม่ใช่ค่า config");
  assert.ok(
    /let usedTerrainSource: SnapshotTerrainSource = "terrarium";/.test(src),
    "ค่าเริ่มต้นต้องเป็น terrarium (แหล่งที่ใช้จริงเมื่อ 3D Tiles ไม่ทำงาน)",
  );
});
