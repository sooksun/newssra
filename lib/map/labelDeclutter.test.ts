import assert from "node:assert/strict";
import test from "node:test";
import {
  boxesOverlap,
  LABEL_GAP_PX,
  labelBox,
  labelFadedOut,
  nearFarScale,
  pickVisibleLabels,
  type LabelPlacement,
} from "./labelDeclutter";

const abovePin: LabelPlacement = {
  width: 120,
  height: 40,
  offsetY: -48,
  verticalCenter: false,
  priority: 1,
};

test("a label above a pin sits centred horizontally and above the anchor", () => {
  const box = labelBox("a", 500, 300, abovePin);
  assert.equal(box.left, 440);
  assert.equal(box.right, 560);
  assert.equal(box.bottom, 252, "ขอบล่างอยู่เหนือหมุดตาม pixelOffset");
  assert.equal(box.top, 212);
});

test("a centred label straddles the anchor vertically", () => {
  const box = labelBox("a", 100, 100, { ...abovePin, offsetY: 0, verticalCenter: true });
  assert.equal(box.top, 80);
  assert.equal(box.bottom, 120);
});

test("boxes that are far apart do not overlap", () => {
  const a = labelBox("a", 100, 300, abovePin);
  const b = labelBox("b", 400, 300, abovePin);
  assert.equal(boxesOverlap(a, b), false);
});

test("boxes separated by less than the gap count as overlapping", () => {
  const a = labelBox("a", 100, 300, abovePin);
  const b = labelBox("b", 100 + 120 + LABEL_GAP_PX - 1, 300, abovePin);
  assert.equal(boxesOverlap(a, b), true);
});

test("zoomed out: the more important label wins and the rest are hidden", () => {
  const school = labelBox("school", 500, 300, { ...abovePin, priority: 0 });
  const elevation = labelBox("elevation", 505, 305, { ...abovePin, priority: 1 });
  const country = labelBox("country", 510, 302, { ...abovePin, priority: 5 });

  const visible = pickVisibleLabels([country, elevation, school]);
  assert.deepEqual([...visible], ["school"]);
});

test("zoomed in: labels that no longer touch are all shown again", () => {
  const school = labelBox("school", 200, 300, { ...abovePin, priority: 0 });
  const elevation = labelBox("elevation", 600, 300, { ...abovePin, priority: 1 });
  const country = labelBox("country", 1000, 300, { ...abovePin, priority: 5 });

  const visible = pickVisibleLabels([school, elevation, country]);
  assert.equal(visible.size, 3);
});

test("a lower-priority label still shows when it only clashes with an already hidden one", () => {
  const school = labelBox("school", 500, 300, { ...abovePin, priority: 0 });
  const hidden = labelBox("hidden", 505, 300, { ...abovePin, priority: 1 });
  // ทับกับ hidden แต่ไม่ทับกับ school ที่ถูกเลือกไว้ — ต้องได้แสดง เพราะ hidden ไม่ได้อยู่บนจอแล้ว
  const far = labelBox("far", 640, 300, { ...abovePin, priority: 2 });

  const visible = pickVisibleLabels([school, hidden, far]);
  assert.deepEqual([...visible].sort(), ["far", "school"]);
});

test("ties are broken by id so the visible set does not flicker between frames", () => {
  const boxes = [
    labelBox("b", 500, 300, { ...abovePin, priority: 2 }),
    labelBox("a", 505, 300, { ...abovePin, priority: 2 }),
  ];
  assert.deepEqual([...pickVisibleLabels(boxes)], ["a"]);
  assert.deepEqual([...pickVisibleLabels([...boxes].reverse())], ["a"]);
});

test("an empty scene produces an empty visible set", () => {
  assert.equal(pickVisibleLabels([]).size, 0);
});

// ── ขนาดกล่องต้องเท่ากับขนาดที่เรนเดอร์จริงในทุกระยะซูม ──────────────────────────────
// ป้ายชื่อโรงเรียนในมุมมองทั้งประเทศถูกย่อด้วย scaleByDistance เหลือ 0.5 เท่าเมื่อกล้องไกล
// ถ้ากล่องยังใช้ขนาดเต็ม ป้ายจะกันกันเองเกินจริงและไม่ยอมโผล่กลับมาแม้ซูมเข้าจนแยกกันแล้ว
const overviewRamp = { near: 2.0e5, nearValue: 1.0, far: 2.0e6, farValue: 0.5 };

test("nearFarScale matches Cesium's NearFarScalar ramp", () => {
  assert.equal(nearFarScale(1.0e5, overviewRamp), 1.0, "ใกล้กว่า near = ค่าคงที่ nearValue");
  assert.equal(nearFarScale(3.0e6, overviewRamp), 0.5, "ไกลกว่า far = ค่าคงที่ farValue");
  assert.equal(nearFarScale(1.1e6, overviewRamp), 0.75, "กึ่งกลางช่วง = ค่ากึ่งกลาง");
  assert.equal(nearFarScale(Number.NaN, overviewRamp), 1, "ระยะใช้ไม่ได้ → ไม่ย่อ");
  assert.equal(nearFarScale(5e5, undefined), 1, "ไม่มี ramp → ไม่ย่อ");
});

test("a shrunk label gets a shrunk box, keeping pixelOffset unscaled like Cesium does", () => {
  const placement: LabelPlacement = { ...abovePin, scaleByDistance: overviewRamp };
  const far = labelBox("far", 500, 300, placement, 3.0e6);

  assert.equal(far.right - far.left, 60, "กว้างครึ่งเดียวที่ระยะไกลสุด");
  assert.equal(far.bottom - far.top, 20);
  assert.equal(far.bottom, 252, "ระยะยกจากหมุด (pixelOffset) ไม่ถูกย่อ");
});

test("zooming in reveals labels that the full-size box would have kept hidden", () => {
  const placement: LabelPlacement = { ...abovePin, scaleByDistance: overviewRamp, priority: 4 };
  // สองหมุดห่างกัน 70 px บนจอ — ป้ายเต็มขนาด (120 px) ทับกัน แต่ป้ายที่ย่อครึ่ง (60 px) ไม่ทับ
  const boxesFar = [
    labelBox("a", 500, 300, placement, 3.0e6),
    labelBox("b", 570, 300, { ...placement, priority: 5 }, 3.0e6),
  ];
  assert.equal(pickVisibleLabels(boxesFar).size, 2, "ที่ระยะไกลป้ายย่อลงจนไม่ทับกันแล้ว ต้องแสดงทั้งคู่");

  const boxesNear = [
    labelBox("a", 500, 300, placement, 1.0e5),
    labelBox("b", 570, 300, { ...placement, priority: 5 }, 1.0e5),
  ];
  assert.equal(pickVisibleLabels(boxesNear).size, 1, "ที่ระยะใกล้ป้ายเต็มขนาดจึงยังทับกัน");
});

test("a label already faded out by distance is treated as invisible", () => {
  const placement: LabelPlacement = {
    ...abovePin,
    translucencyByDistance: { near: 1.5e6, nearValue: 1.0, far: 3.0e6, farValue: 0.0 },
  };
  assert.equal(labelFadedOut(placement, 1.0e6), false);
  assert.equal(labelFadedOut(placement, 2.0e6), false, "ยังจางไม่พอ ยังนับว่ามองเห็น");
  assert.equal(labelFadedOut(placement, 2.95e6), true);
  assert.equal(labelFadedOut(abovePin, 1e9), false, "ไม่มี ramp → ไม่เคยจางหาย");
});
