// Unit tests ของ lib/map/photorealistic3d.ts — ไม่ต้องมี WebGL/browser (ใช้ viewer ปลอมขั้นต่ำ)
// สิ่งที่ต้องคุมให้แน่น: "คืนสถานะ viewer เหมือนเดิมเสมอ" ไม่ว่างานที่รันข้างในจะสำเร็จหรือพัง
// เพราะถ้าคืนไม่ครบ แผนที่จะค้างอยู่ในโหมด 3D Tiles (globe ถูกซ่อน) หลังจับภาพเสร็จ

import { test } from "node:test";
import assert from "node:assert/strict";
import { tilesetReady, withPhotorealisticTiles } from "./photorealistic3d";
import type { Cesium3DTileset, Viewer } from "cesium";

function makeFakeViewer(opts: { destroyed?: boolean } = {}) {
  const removed: unknown[] = [];
  const viewer = {
    isDestroyed: () => opts.destroyed ?? false,
    scene: {
      globe: { show: true },
      verticalExaggeration: 2.0,
      primitives: {
        add(p: unknown) {
          return p;
        },
        remove(p: unknown) {
          removed.push(p);
          return true;
        },
      },
    },
  };
  return { viewer: viewer as unknown as Viewer, removed, raw: viewer };
}

test("tilesetReady: ไม่มี tileset (ไม่ได้ใช้ 3D Tiles) → ถือว่าพร้อมเสมอ", () => {
  assert.equal(tilesetReady(null), true);
});

test("tilesetReady: สะท้อนค่า tilesLoaded ของ tileset", () => {
  assert.equal(tilesetReady({ tilesLoaded: false } as unknown as Cesium3DTileset), false);
  assert.equal(tilesetReady({ tilesLoaded: true } as unknown as Cesium3DTileset), true);
});

const fakeTileset = { tilesLoaded: true } as unknown as Cesium3DTileset;
const okFactory = async () => fakeTileset;
const failFactory = async () => {
  throw new Error("Map Tiles API ปฏิเสธคำขอ");
};

test("enabled=false → ไม่แตะ viewer และไม่เรียก factory เลย", async () => {
  const { viewer, raw, removed } = makeFakeViewer();
  let factoryCalls = 0;
  let seen: { tileset: unknown; skippedReason: unknown } | null = null;

  const out = await withPhotorealisticTiles(
    viewer,
    {
      enabled: false,
      createTileset: async () => {
        factoryCalls++;
        return fakeTileset;
      },
    },
    async (handle) => {
      seen = handle;
      return "ok";
    },
  );

  assert.equal(out, "ok");
  assert.equal(factoryCalls, 0, "ปิดอยู่ต้องไม่เรียก API ของ Google เลย (ไม่งั้นเสียเงินฟรี)");
  assert.deepEqual(seen, { tileset: null, skippedReason: null });
  assert.equal(raw.scene.globe.show, true, "globe ต้องไม่ถูกซ่อน");
  assert.equal(raw.scene.verticalExaggeration, 2.0, "exaggeration ต้องไม่ถูกแตะ");
  assert.equal(removed.length, 0);
});

test("enabled=true สำเร็จ → ซ่อน globe + ตั้ง exaggeration=1 ระหว่างรัน แล้วคืนค่าเดิมครบเมื่อจบ", async () => {
  const { viewer, raw, removed } = makeFakeViewer();
  let insideGlobeShow: boolean | null = null;
  let insideExaggeration: number | null = null;

  const out = await withPhotorealisticTiles(viewer, { enabled: true, createTileset: okFactory }, async (h) => {
    insideGlobeShow = raw.scene.globe.show;
    insideExaggeration = raw.scene.verticalExaggeration;
    assert.equal(h.tileset, fakeTileset);
    assert.equal(h.skippedReason, null);
    return "done";
  });

  assert.equal(out, "done");
  assert.equal(insideGlobeShow, false, "ระหว่างจับภาพต้องซ่อน globe กัน z-fighting กับ mesh");
  assert.equal(insideExaggeration, 1.0, "ระหว่างจับภาพต้องเลิกยืดแนวดิ่ง (3D Tiles ไม่รองรับ)");
  assert.equal(raw.scene.globe.show, true, "จบแล้วต้องคืน globe");
  assert.equal(raw.scene.verticalExaggeration, 2.0, "จบแล้วต้องคืน exaggeration เดิม");
  assert.deepEqual(removed, [fakeTileset], "ต้องถอด tileset ออกจาก scene");
});

test("run โยน error → ยังคืนสถานะ viewer ครบ และ error ทะลุถึงผู้เรียก", async () => {
  const { viewer, raw, removed } = makeFakeViewer();

  await assert.rejects(
    () =>
      withPhotorealisticTiles(viewer, { enabled: true, createTileset: okFactory }, async () => {
        throw new Error("จับภาพพังกลางคัน");
      }),
    /จับภาพพังกลางคัน/,
  );

  assert.equal(raw.scene.globe.show, true, "แม้พังก็ต้องคืน globe ไม่งั้นแผนที่ค้างเป็นจอเปล่า");
  assert.equal(raw.scene.verticalExaggeration, 2.0);
  assert.deepEqual(removed, [fakeTileset]);
});

test("โหลด tileset ไม่สำเร็จ → ยังรันงานต่อด้วย tileset=null พร้อมบอกเหตุผล และ viewer ไม่ถูกเปลี่ยนค้าง", async () => {
  const { viewer, raw, removed } = makeFakeViewer();
  let handle: { tileset: unknown; skippedReason: unknown } | null = null;

  const out = await withPhotorealisticTiles(viewer, { enabled: true, createTileset: failFactory }, async (h) => {
    handle = h;
    return 42;
  });

  assert.equal(out, 42, "การจับภาพต้องไม่ล้มเพราะบริการเสริมใช้ไม่ได้");
  assert.equal(handle!.tileset, null);
  assert.match(String(handle!.skippedReason), /Map Tiles API/);
  assert.equal(raw.scene.globe.show, true, "globe ต้องยังแสดงผล (จับภาพด้วยภูมิประเทศเดิม)");
  assert.equal(raw.scene.verticalExaggeration, 2.0);
  assert.equal(removed.length, 0);
});

test("viewer ถูกทำลายระหว่างทาง → finally ไม่ throw ซ้ำทับ error เดิม", async () => {
  const { viewer } = makeFakeViewer({ destroyed: true });
  await assert.rejects(
    () =>
      withPhotorealisticTiles(viewer, { enabled: true, createTileset: okFactory }, async () => {
        throw new Error("ยกเลิกกลางคัน");
      }),
    /ยกเลิกกลางคัน/,
  );
});
