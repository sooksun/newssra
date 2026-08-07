// เทสต์ตัวโหลดชั้นป่าจากดิสก์ — จุดสำคัญคือแยก "ไม่มีป่าแถวนี้" ออกจาก "ยังไม่ได้ติดตั้งข้อมูล"
// ใช้โฟลเดอร์ชั่วคราวจริงผ่าน FOREST_STATUS_DATA_DIR (ไม่ mock node:fs)

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadForestStatusAround } from "./forest-status-load";

const SQUARE = [
  [
    [98.9, 18.8],
    [99.0, 18.8],
    [99.0, 18.9],
    [98.9, 18.9],
    [98.9, 18.8],
  ],
];

const MANIFEST = {
  datasets: [
    {
      authority: "rfd-national-reserved-forest",
      layerRole: "legal-reserve-boundary",
      yearBe: 2562,
      dataSource: "RFD NRF final_NRF_all_1221",
      attribution: "กรมป่าไม้ — แนวเขตป่าสงวนแห่งชาติ",
      featureCount: 1221,
      cellCount: 204,
      nationwide: true,
      installedAt: "2026-08-07T00:00:00.000Z",
    },
  ],
};

async function withRoot(setup: (root: string) => Promise<void>, run: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "forest-status-"));
  const prev = process.env.FOREST_STATUS_DATA_DIR;
  process.env.FOREST_STATUS_DATA_DIR = root;
  try {
    await mkdir(path.join(root, "cells"), { recursive: true });
    await setup(root);
    await run();
  } finally {
    if (prev === undefined) delete process.env.FOREST_STATUS_DATA_DIR;
    else process.env.FOREST_STATUS_DATA_DIR = prev;
    await rm(root, { recursive: true, force: true });
  }
}

test("มี cell ในพื้นที่ → คืนเอกสารพร้อม polygon และประทับว่ายืนยันความครอบคลุมแล้ว", async () => {
  await withRoot(
    async (root) => {
      await writeFile(path.join(root, "manifest.json"), JSON.stringify(MANIFEST));
      await writeFile(
        path.join(root, "cells", "18.5_98.5.json"),
        JSON.stringify({
          attribution: "กรมป่าไม้ — แนวเขตป่าสงวนแห่งชาติ",
          dataSource: "RFD NRF final_NRF_all_1221",
          yearBe: 2562,
          authority: "rfd-national-reserved-forest",
          layerRole: "legal-reserve-boundary",
          features: [{ rings: SQUARE }],
        }),
      );
    },
    async () => {
      const doc = await loadForestStatusAround(18.85, 98.95, 1000);
      assert.ok(doc);
      assert.equal(doc!.features.length, 1);
      assert.equal(doc!.coverageConfirmed, true);
    },
  );
});

test("ไม่มี cell แต่ manifest ระบุว่าติดตั้งครบทั้งประเทศ → คืนเอกสารเปล่าที่ยืนยันแล้ว (ไม่ใช่ null)", async () => {
  await withRoot(
    async (root) => {
      await writeFile(path.join(root, "manifest.json"), JSON.stringify(MANIFEST));
    },
    async () => {
      const doc = await loadForestStatusAround(13.7563, 100.5018, 5000);
      assert.ok(doc, "ต้องไม่คืน null — ไม่มีป่าสงวนแถวนี้คือคำตอบจริง");
      assert.equal(doc!.features.length, 0);
      assert.equal(doc!.coverageConfirmed, true);
      assert.equal(doc!.authority, "rfd-national-reserved-forest");
      assert.equal(doc!.yearBe, 2562);
    },
  );
});

test("ไม่มี manifest → ต้องคืน null (ยังยืนยันไม่ได้ว่าติดตั้งครบ ห้ามเดาว่าไม่มีป่า)", async () => {
  await withRoot(
    async () => {},
    async () => {
      assert.equal(await loadForestStatusAround(13.7563, 100.5018, 5000), null);
    },
  );
});

test("manifest ที่ไม่ได้ระบุ nationwide → ไม่ยืนยันความครอบคลุม", async () => {
  await withRoot(
    async (root) => {
      await writeFile(
        path.join(root, "manifest.json"),
        JSON.stringify({ datasets: [{ ...MANIFEST.datasets[0], nationwide: false }] }),
      );
    },
    async () => {
      assert.equal(await loadForestStatusAround(13.7563, 100.5018, 5000), null);
    },
  );
});

test("พิกัดไม่ถูกต้อง → null", async () => {
  await withRoot(
    async (root) => {
      await writeFile(path.join(root, "manifest.json"), JSON.stringify(MANIFEST));
    },
    async () => {
      assert.equal(await loadForestStatusAround(Number.NaN, 100, 5000), null);
    },
  );
});

// ── สองชุดข้อมูลอยู่ร่วมกัน: สภาพป่าจริง (cells-cover) กับ แนวเขตป่าสงวน (cells) ──
// ทั้งสองมีความหมายคนละอย่าง ห้ามรวม polygon ข้ามชุดกัน

const TWO_DATASETS = {
  datasets: [
    { ...MANIFEST.datasets[0] },
    {
      authority: "rfd-forest-cover",
      layerRole: "forest-cover",
      dir: "cells-cover",
      yearBe: 2562,
      dataSource: "กรมป่าไม้ — ข้อมูลสภาพพื้นที่ป่าไม้ 2562",
      attribution: "กรมป่าไม้ (CC-BY)",
      nationwide: true,
    },
  ],
};

async function setupTwo(root: string): Promise<void> {
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(TWO_DATASETS));
  await mkdir(path.join(root, "cells-cover"), { recursive: true });
  await writeFile(
    path.join(root, "cells", "18.5_98.5.json"),
    JSON.stringify({
      attribution: "กรมป่าไม้ — แนวเขตป่าสงวนแห่งชาติ",
      dataSource: "RFD NRF",
      yearBe: 2562,
      authority: "rfd-national-reserved-forest",
      layerRole: "legal-reserve-boundary",
      features: [{ rings: SQUARE }],
    }),
  );
  await writeFile(
    path.join(root, "cells-cover", "18.5_98.5.json"),
    JSON.stringify({
      attribution: "กรมป่าไม้ (CC-BY)",
      dataSource: "กรมป่าไม้ — ข้อมูลสภาพพื้นที่ป่าไม้ 2562",
      yearBe: 2562,
      authority: "rfd-forest-cover",
      layerRole: "forest-cover",
      features: [{ rings: SQUARE }, { rings: SQUARE }],
    }),
  );
}

test("เลือกชุดสภาพป่าจริงได้ด้วย authority — ต้องไม่ปน polygon ของชั้นป่าสงวน", async () => {
  await withRoot(setupTwo, async () => {
    const doc = await loadForestStatusAround(18.85, 98.95, 1000, { authority: "rfd-forest-cover" });
    assert.ok(doc);
    assert.equal(doc!.authority, "rfd-forest-cover");
    assert.equal(doc!.features.length, 2, "ต้องได้เฉพาะ polygon ของชั้นสภาพป่า");
    assert.equal(doc!.coverageConfirmed, true);
  });
});

test("เลือกชั้นแนวเขตป่าสงวนได้ด้วย authority เช่นกัน", async () => {
  await withRoot(setupTwo, async () => {
    const doc = await loadForestStatusAround(18.85, 98.95, 1000, {
      authority: "rfd-national-reserved-forest",
    });
    assert.ok(doc);
    assert.equal(doc!.authority, "rfd-national-reserved-forest");
    assert.equal(doc!.features.length, 1);
  });
});

test("ไม่ระบุ authority → ใช้ชั้นสภาพป่าจริงก่อน เพราะเป็นชั้นหลักตามสเปก", async () => {
  await withRoot(setupTwo, async () => {
    const doc = await loadForestStatusAround(18.85, 98.95, 1000);
    assert.equal(doc?.authority, "rfd-forest-cover");
  });
});

test("ขอชุดที่ยังไม่ได้ติดตั้ง → null (ไม่ถอยไปใช้ชุดอื่นแทนเงียบ ๆ)", async () => {
  await withRoot(
    async (root) => {
      await writeFile(path.join(root, "manifest.json"), JSON.stringify(MANIFEST));
    },
    async () => {
      assert.equal(await loadForestStatusAround(18.85, 98.95, 1000, { authority: "rfd-forest-cover" }), null);
    },
  );
});

test("ชุดที่ติดตั้งครบแต่ไม่มี polygon แถวนั้น → เอกสารเปล่าที่ยืนยันแล้วของชุดที่ขอ", async () => {
  await withRoot(setupTwo, async () => {
    const doc = await loadForestStatusAround(13.7563, 100.5018, 5000, { authority: "rfd-forest-cover" });
    assert.ok(doc);
    assert.equal(doc!.authority, "rfd-forest-cover");
    assert.equal(doc!.features.length, 0);
    assert.equal(doc!.coverageConfirmed, true);
  });
});
