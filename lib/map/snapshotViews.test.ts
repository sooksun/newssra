import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { OVERVIEW_FIT_MARGIN, overviewFitRangeM, SNAPSHOT_VIEWS } from "./snapshotViews";

// ทรงกลมรัศมี R อยู่ในกรวยภาพครบเมื่อ asin(R / range) ≤ ครึ่ง fov ของมิติที่แคบที่สุด
function fitsInFrame(radiusM: number, range: number, fovRad: number, aspect: number): boolean {
  const minorRatio = Math.min(aspect, 1 / aspect);
  const minHalfFov = Math.atan(Math.tan(fovRad / 2) * minorRatio);
  return Math.asin(Math.min(1, radiusM / range)) <= minHalfFov + 1e-9;
}

describe("SNAPSHOT_VIEWS — มุมกล้องจับภาพ 3D", () => {
  test("มี 10 มุมพอดี (9 มุมรอบโรงเรียน + 1 ภาพรวมถึงศาลากลาง)", () => {
    assert.equal(SNAPSHOT_VIEWS.length, 10);
  });
  test("key ไม่ซ้ำกัน", () => {
    const keys = SNAPSHOT_VIEWS.map((v) => v.key);
    assert.equal(new Set(keys).size, 10);
  });
  test("overviewFitRangeM: สองจุดอยู่ในเฟรมครบทุก aspect (แนวนอน/จัตุรัส/แนวตั้ง)", () => {
    const fov = Math.PI / 3; // 60° — ค่า default ของ Cesium
    const R = 24_500; // ครึ่งระยะ ~49 กม. (โรงเรียน↔ศาลากลาง)
    for (const aspect of [1.0, 1.5, 1.78, 2.0, 0.53, 0.75]) {
      const range = overviewFitRangeM(R, fov, aspect);
      assert.ok(range > 0, `aspect ${aspect} ต้องได้ระยะ > 0`);
      assert.ok(fitsInFrame(R, range, fov, aspect), `aspect ${aspect}: สองจุดต้องอยู่ในเฟรม`);
    }
  });

  test("overviewFitRangeM: จอแนวนอนต้องถอยไกลกว่าจอจัตุรัส และไกลกว่าตัวคูณเดิม 2.4×R", () => {
    const fov = Math.PI / 3;
    const R = 1000;
    const square = overviewFitRangeM(R, fov, 1.0);
    const wide = overviewFitRangeM(R, fov, 1.78);
    assert.ok(wide > square, "จอแนวนอนต้องถอยไกลกว่าจอจัตุรัส");
    assert.ok(wide > 2.4 * R, `จอแนวนอน (${(wide / R).toFixed(2)}×R) ต้องไกลกว่า 2.4×R ที่เคยหลุดเฟรม`);
  });

  test("overviewFitRangeM: margin เผื่อขอบจริง และค่าอินพุตไม่ถูกต้องคืน 0", () => {
    const fov = Math.PI / 3;
    const withMargin = overviewFitRangeM(1000, fov, 1.5, OVERVIEW_FIT_MARGIN);
    const exact = overviewFitRangeM(1000, fov, 1.5, 1);
    assert.ok(withMargin > exact, "margin > 1 ต้องถอยไกลกว่าพอดีขอบ");
    assert.equal(overviewFitRangeM(0, fov, 1.5), 0);
    assert.equal(overviewFitRangeM(1000, 0, 1.5), 0);
    assert.equal(overviewFitRangeM(1000, fov, 0), 0);
  });

  test("มุมภาพรวมครอบสองจุด: key/frame/label ถูกต้อง และเป็นมุมสุดท้าย", () => {
    const ov = SNAPSHOT_VIEWS.find((v) => v.key === "overview-province")!;
    assert.ok(ov, "ต้องมีมุม overview-province");
    assert.equal(ov.frame, "school-and-province");
    assert.match(ov.label, /ศาลากลาง/);
    assert.equal(SNAPSHOT_VIEWS[SNAPSHOT_VIEWS.length - 1].key, "overview-province");
    // มีมุม frame แบบครอบสองจุดเพียงมุมเดียว
    assert.equal(SNAPSHOT_VIEWS.filter((v) => v.frame === "school-and-province").length, 1);
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
  test("ทุกมุม lookAt (ไม่มี frame) มี rangeM > 0 — มุม frame ครอบสองจุดคำนวณระยะเอง จึง rangeM = 0 ได้", () => {
    for (const v of SNAPSHOT_VIEWS) {
      if (v.frame) assert.equal(v.rangeM, 0, `มุม frame ${v.key} ไม่ใช้ rangeM`);
      else assert.ok(v.rangeM > 0, `มุม ${v.key} ต้องมี rangeM > 0`);
    }
  });
});
