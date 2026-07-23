import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SNAPSHOT_VIEWS } from "./snapshotViews";

describe("SNAPSHOT_VIEWS — มุมกล้องจับภาพ 3D", () => {
  test("มี 9 มุมพอดี", () => {
    assert.equal(SNAPSHOT_VIEWS.length, 9);
  });
  test("key ไม่ซ้ำกัน", () => {
    const keys = SNAPSHOT_VIEWS.map((v) => v.key);
    assert.equal(new Set(keys).size, 9);
  });
  test("มุมแรกเป็น top-down (pitch −90)", () => {
    assert.equal(SNAPSHOT_VIEWS[0].key, "top");
    assert.equal(SNAPSHOT_VIEWS[0].pitchDeg, -90);
  });
  test("มีมุมใกล้ 4 + ไกล 4 ครบทุกทิศ (heading 0/90/180/270)", () => {
    const near = SNAPSHOT_VIEWS.filter((v) => v.key.startsWith("near-"));
    const far = SNAPSHOT_VIEWS.filter((v) => v.key.startsWith("far-"));
    assert.equal(near.length, 4);
    assert.equal(far.length, 4);
    for (const group of [near, far]) {
      assert.deepEqual(
        group.map((v) => v.headingDeg).sort((a, b) => a - b),
        [0, 90, 180, 270],
      );
    }
  });
  test("ระยะไกล > ระยะใกล้ > 0 และทุกมุมมี label ไทยไม่ว่าง", () => {
    const near = SNAPSHOT_VIEWS.find((v) => v.key === "near-n")!;
    const far = SNAPSHOT_VIEWS.find((v) => v.key === "far-n")!;
    assert.ok(far.rangeM > near.rangeM && near.rangeM > 0);
    for (const v of SNAPSHOT_VIEWS) assert.ok(v.label.trim().length > 0);
  });
  test("ทุกมุมมี rangeM > 0 (ระยะห่างกล้องถึงหมุด สำหรับ lookAt)", () => {
    for (const v of SNAPSHOT_VIEWS) assert.ok(v.rangeM > 0);
  });
});
