import assert from "node:assert/strict";
import test from "node:test";
import { boxesOverlap, LABEL_GAP_PX, labelBox, pickVisibleLabels, type LabelPlacement } from "./labelDeclutter";

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
