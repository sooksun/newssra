// Unit tests สำหรับ waitForTilesLoaded ใน lib/map/snapshotCapture.ts — รัน: node --import tsx --test lib/map/snapshotCapture.test.ts
//
// captureCurrentView/dataUrlToBlob ต้องมี WebGL/canvas จริง จึงไม่มี unit test ในไฟล์นี้ (ทดสอบผ่าน browser เท่านั้น)
import { test } from "node:test";
import assert from "node:assert/strict";

import { waitForTilesLoaded } from "./snapshotCapture";
import type { Viewer } from "cesium";

// สร้าง fake viewer ขั้นต่ำที่ waitForTilesLoaded ต้องการเท่านั้น (ไม่ต้องพึ่ง Cesium จริง/browser)
function makeFakeViewer(opts: { tilesLoaded: boolean; isDestroyed?: boolean }) {
  return {
    isDestroyed: () => opts.isDestroyed ?? false,
    scene: {
      requestRender() {},
      globe: {
        tilesLoaded: opts.tilesLoaded,
      },
    },
  } as unknown as Viewer;
}

// viewer ที่ tilesLoaded สลับ true/false ตามลำดับที่กำหนด (อ่านทีละค่าในแต่ละ poll; ค่าสุดท้ายคงอยู่ต่อ)
function makeFlappingViewer(sequence: boolean[]) {
  let i = 0;
  const globe = {
    get tilesLoaded() {
      const v = sequence[Math.min(i, sequence.length - 1)];
      i++;
      return v;
    },
  };
  return {
    isDestroyed: () => false,
    scene: { requestRender() {}, globe },
  } as unknown as Viewer;
}

test("waitForTilesLoaded: resolve ทันทีเมื่อ tilesLoaded เป็น true ตั้งแต่แรก", async () => {
  const viewer = makeFakeViewer({ tilesLoaded: true });
  const start = Date.now();
  await waitForTilesLoaded(viewer, 4000);
  const elapsed = Date.now() - start;
  // ควรใช้เวลาน้อยมาก (ไม่ต้องรอ poll หลายรอบ) — ให้ margin กว้างพอสำหรับเครื่องช้า
  assert.ok(elapsed < 500, `expected quick resolve, took ${elapsed}ms`);
});

test("waitForTilesLoaded: resolve ผ่าน timeout cap เมื่อ tilesLoaded ไม่เคยเป็น true (ไม่พึ่ง rAF)", async () => {
  const viewer = makeFakeViewer({ tilesLoaded: false });
  const timeoutMs = 150;
  const start = Date.now();
  await waitForTilesLoaded(viewer, timeoutMs);
  const elapsed = Date.now() - start;
  // ต้อง resolve จริง (ไม่ค้าง) และใช้เวลาอย่างน้อยประมาณ timeoutMs
  assert.ok(elapsed >= timeoutMs - 20, `expected at least ~${timeoutMs}ms, took ${elapsed}ms`);
  // และไม่ควรเกิน timeout มากเกินไป (poll interval ~100ms เท่านั้น)
  assert.ok(elapsed < timeoutMs + 500, `expected resolve shortly after timeout, took ${elapsed}ms`);
});

test("waitForTilesLoaded: stableTicks ต้องเห็น tilesLoaded ติดกันครบก่อนจึง resolve", async () => {
  // true ครั้งเดียวแล้วกลับเป็น false (อาการจริงหลังหมุนกล้อง) → ต้องไม่ resolve ที่ tick แรก
  const viewer = makeFlappingViewer([true, false, true, true, true]);
  const start = Date.now();
  await waitForTilesLoaded(viewer, 4000, 3);
  const elapsed = Date.now() - start;
  // ต้องรออย่างน้อย 4 poll (~400ms) กว่าจะได้ true ติดกัน 3 ครั้ง
  assert.ok(elapsed >= 350, `expected to keep polling until stable, took ${elapsed}ms`);
  assert.ok(elapsed < 2000, `expected resolve once stable, took ${elapsed}ms`);
});

test("waitForTilesLoaded: stableTicks ไม่ทำให้ค้างเกิน timeout เมื่อไทล์ไม่นิ่งสักที", async () => {
  const viewer = makeFlappingViewer([true, false]); // สลับจนหมด sequence แล้วค้างที่ false
  const timeoutMs = 300;
  const start = Date.now();
  await waitForTilesLoaded(viewer, timeoutMs, 3);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= timeoutMs - 20, `expected to wait ~${timeoutMs}ms, took ${elapsed}ms`);
  assert.ok(elapsed < timeoutMs + 500, `expected resolve shortly after timeout, took ${elapsed}ms`);
});

test("waitForTilesLoaded: resolve ทันทีเมื่อ viewer.isDestroyed() เป็น true", async () => {
  const viewer = makeFakeViewer({ tilesLoaded: false, isDestroyed: true });
  const start = Date.now();
  await waitForTilesLoaded(viewer, 4000);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `expected quick resolve on destroyed viewer, took ${elapsed}ms`);
});
