// Google Photorealistic 3D Tiles — เปิดใช้เฉพาะ "ช่วงจับภาพ 3D" แล้วคืนสถานะเดิมเสมอ (client-only)
//
// ทำไมต้องเปิดเฉพาะช่วงจับภาพ ไม่เปิดค้างทั้งแผนที่:
//   3D Tiles ของ Google เป็น mesh ของตัวเอง ที่ "แทนที่" globe (terrain + imagery) ทั้งก้อน ไม่ใช่ layer ซ้อน
//   แต่การให้คะแนนมิติ 3 ทั้งหมดของระบบนี้อ่านความสูงจาก globe/terrain ของ Terrarium
//   (lib/map/routeElevation.ts, lib/map/morphology.ts, globe.getHeight ตอนเล็งกล้อง) ถ้าเปิดค้าง
//   ค่าที่ใช้คิดคะแนนจะเปลี่ยนไปทั้งหมดโดยไม่มีใครสังเกต — ซึ่งรับไม่ได้สำหรับข้อมูลที่ใช้ตัดสินสิทธิ์
//   การเปิดเฉพาะตอนจับภาพจึงได้ภาพสวยขึ้นโดยที่ "ตัวเลขทุกตัวยังมาจากแหล่งเดิม"
//
// ข้อจำกัดที่ต้องรู้ (ไม่ได้แก้ให้ในโมดูลนี้ เพราะเป็นข้อจำกัดของ 3D Tiles เอง):
//   • verticalExaggeration ใช้กับ 3D Tiles ไม่ได้ → ภาพที่จับได้จะไม่ถูกยืดสูงเหมือนที่เห็นบนแผนที่
//     โมดูลนี้จึงตั้ง exaggeration = 1 ระหว่างจับภาพ เพื่อให้ "สิ่งที่เห็นตอนจับ" กับ "สิ่งที่ได้" ตรงกัน
//     แทนที่จะปล่อยให้ globe ถูกยืดแต่ mesh ไม่ถูกยืด
//   • ความละเอียดของ mesh นอกเขตเมืองหยาบกว่าในเมืองมาก — ตรวจพื้นที่จริงก่อนด้วย
//     scripts/probe-google-3dtiles.mjs
//   • คิดค่าใช้จ่ายผ่าน Map Tiles API คนละอัตรากับ 2D tiles

import type { Cesium3DTileset, Viewer } from "cesium";

/** ผลของการเตรียม 3D Tiles — tileset เป็น null ได้เมื่อปิดใช้งานหรือโหลดไม่สำเร็จ (ผู้เรียกต้องทำงานต่อได้) */
export interface Photorealistic3dHandle {
  tileset: Cesium3DTileset | null;
  /** เหตุผลที่ไม่ได้ใช้ 3D Tiles (null = ใช้ได้ปกติ) — เอาไปแสดงให้ผู้ใช้รู้ว่าภาพมาจากอะไร */
  skippedReason: string | null;
}

/** พร้อมจับภาพหรือยัง — 3D Tiles รายงานผ่าน tileset.tilesLoaded (คนละตัวกับ globe.tilesLoaded) */
export function tilesetReady(tileset: Cesium3DTileset | null): boolean {
  if (!tileset) return true; // ไม่ได้ใช้ 3D Tiles → ไม่ต้องรออะไรเพิ่ม
  return Boolean((tileset as unknown as { tilesLoaded?: boolean }).tilesLoaded);
}

/**
 * รัน `run` โดยเปิด Photorealistic 3D Tiles ชั่วคราว แล้วคืนสถานะ viewer ให้เหมือนเดิมทุกกรณี
 *
 * ถ้า `enabled` เป็น false หรือโหลด tileset ไม่สำเร็จ จะเรียก `run` ต่อด้วย tileset = null
 * (จับภาพด้วย globe เดิมตามปกติ) — การจับภาพต้องไม่ล้มเพราะบริการเสริมใช้ไม่ได้
 */
export async function withPhotorealisticTiles<T>(
  viewer: Viewer,
  opts: {
    enabled: boolean;
    /** ตัวสร้าง tileset — ฉีดเข้ามาจากผู้เรียก (ปกติคือ createGooglePhotorealistic3DTileset ของ Cesium)
     *  เจตนา: ไฟล์นี้ต้องไม่ import "cesium" เอง ไม่งั้น unit test ฝั่ง Node จะดึงไลบรารีทั้งก้อนเข้ามา
     *  จนหน่วยความจำหมด (เจอจริงตอนเขียนเทส) — และเป็นเหตุผลเดียวกับที่ lib/map/* ตัวอื่นเลี่ยง cesium */
    createTileset: () => Promise<Cesium3DTileset>;
  },
  run: (handle: Photorealistic3dHandle) => Promise<T>,
): Promise<T> {
  if (!opts.enabled) {
    return run({ tileset: null, skippedReason: null });
  }

  const scene = viewer.scene;
  const prevGlobeShow = scene.globe.show;
  const prevExaggeration = scene.verticalExaggeration;
  let tileset: Cesium3DTileset | null = null;
  let skippedReason: string | null = null;

  try {
    tileset = await opts.createTileset();
    scene.primitives.add(tileset);
    // 3D Tiles มีภูมิประเทศในตัว — ต้องซ่อน globe ไม่งั้นผิว Terrarium จะทะลุ mesh ออกมาเป็นลายซ้อน (z-fighting)
    scene.globe.show = false;
    // exaggeration มีผลกับ globe เท่านั้น ถ้าปล่อยไว้ ค่าที่ผู้ใช้เห็นกับภาพที่ได้จะเป็นคนละมาตราส่วน
    scene.verticalExaggeration = 1.0;
  } catch (error) {
    skippedReason = error instanceof Error ? error.message : "โหลด Google 3D Tiles ไม่สำเร็จ";
    if (tileset) {
      scene.primitives.remove(tileset);
      tileset = null;
    }
    scene.globe.show = prevGlobeShow;
    scene.verticalExaggeration = prevExaggeration;
  }

  try {
    return await run({ tileset, skippedReason });
  } finally {
    // คืนสถานะเสมอ แม้ run จะโยน error กลางคัน — ไม่งั้นแผนที่จะค้างอยู่ในโหมด 3D Tiles หลังจับภาพเสร็จ
    if (tileset && !viewer.isDestroyed()) {
      scene.primitives.remove(tileset);
    }
    if (!viewer.isDestroyed()) {
      scene.globe.show = prevGlobeShow;
      scene.verticalExaggeration = prevExaggeration;
    }
  }
}
