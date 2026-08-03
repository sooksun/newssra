// Source-grep test — วิธีเดียวกับ tests/route-elevation-flags.test.ts และ snapshot-capture-framing.test.ts
// คือ pin พฤติกรรมฝั่ง Cesium ที่รันจริงต้องมีเบราว์เซอร์ ด้วยการยืนยันรูปแบบในซอร์ส
//
// สิ่งที่ต้องกันไม่ให้ถอยกลับ:
//   1) ความสูงของหมุด/ศาลากลางต้องอ่านจาก globe "ก่อน" เข้าโหมด 3D Tiles — เพราะ globe ถูกซ่อนระหว่างนั้น
//      และค่านี้ต้องมาจาก terrain เดิมซึ่งเป็นแหล่งเดียวกับที่ใช้คิดคะแนนมิติ 3
//   2) การรอไทล์ต้องรอ tileset ด้วย ไม่ใช่แค่ globe — ไม่งั้นจับภาพตอน mesh ยังโหลดไม่ครบ
//   3) 3D Tiles ต้องถูกเปิดผ่าน withPhotorealisticTiles เท่านั้น (มี finally คืนสถานะ) ห้ามเรียก
//      createGooglePhotorealistic3DTileset ตรง ๆ ใน component

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "components/map/CesiumMap.tsx"), "utf8");

test("จับภาพต้องเปิด 3D Tiles ผ่าน withPhotorealisticTiles เท่านั้น", () => {
  assert.ok(src.includes("withPhotorealisticTiles("), "ต้องเรียกผ่าน helper ที่มี finally คืนสถานะ");
  // createGooglePhotorealistic3DTileset ถูก import มาได้ แต่ต้องถูก "ส่งเข้า" helper เท่านั้น
  // (helper เป็นที่เดียวที่รู้วิธีถอด tileset + คืน globe.show/verticalExaggeration)
  const directCalls = src.match(/createGooglePhotorealistic3DTileset\(\)/g) ?? [];
  assert.equal(directCalls.length, 1, "ต้องมีจุดเรียกเดียวเท่านั้น คือใน createTileset ที่ส่งให้ helper");
  assert.ok(
    /createTileset:\s*\(\)\s*=>\s*createGooglePhotorealistic3DTileset\(\)/.test(src),
    "จุดเรียกเดียวนั้นต้องอยู่ในรูป createTileset ที่ส่งเข้า helper",
  );
});

test("เปิด 3D Tiles ตามค่า config เท่านั้น (opt-in ไม่ใช่ค่าเริ่มต้น)", () => {
  assert.ok(
    /enabled:\s*photorealistic3dEnabled\(\)/.test(src),
    "ต้องส่ง photorealistic3dEnabled() เป็นตัวตัดสิน ไม่ใช่ค่าคงที่ true",
  );
});

test("ความสูงหมุด + ศาลากลาง ต้องอ่านจาก globe ก่อนเข้าโหมด 3D Tiles", () => {
  const pinHeightAt = src.indexOf("const terrainHeightM = viewer.scene.globe.getHeight(");
  const hallHeightAt = src.indexOf("const hallHeightM = province");
  const tilesAt = src.indexOf("withPhotorealisticTiles(");

  assert.ok(pinHeightAt > 0, "ต้องยังอ่านความสูงหมุดจาก globe");
  assert.ok(hallHeightAt > 0, "ต้องยังอ่านความสูงศาลากลางจาก globe");
  assert.ok(pinHeightAt < tilesAt, "ความสูงหมุดต้องถูกอ่านก่อนเปิด 3D Tiles (globe ถูกซ่อนหลังจากนั้น)");
  assert.ok(hallHeightAt < tilesAt, "ความสูงศาลากลางต้องถูกอ่านก่อนเปิด 3D Tiles");
});

test("การรอไทล์ก่อนจับภาพต้องรวมความพร้อมของ tileset ด้วย", () => {
  assert.ok(
    /waitForTilesLoaded\([\s\S]{0,160}tilesetReady\(tileset\)/.test(src),
    "ต้องส่ง tilesetReady(tileset) เป็นเงื่อนไขเพิ่มให้ waitForTilesLoaded",
  );
});

test("ถ้า 3D Tiles ใช้ไม่ได้ ต้องแจ้งผู้ใช้ ไม่ใช่เงียบแล้วส่งภาพจากแหล่งอื่นไปให้ AI", () => {
  assert.ok(/if \(skippedReason\)/.test(src), "ต้องเช็ค skippedReason");
  assert.ok(/setCaptureErr\(`ใช้ Google 3D Tiles ไม่ได้/.test(src), "ต้องแสดงข้อความบอกว่าใช้ภูมิประเทศปกติแทน");
});
