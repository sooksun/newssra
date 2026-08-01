import assert from "node:assert/strict";
import test from "node:test";
import { createLabelImage, labelImageSize, LABEL_IMAGE_DEFAULTS } from "./labelImage";

test("size follows the widest line and the number of lines", () => {
  const one = labelImageSize([100], { background: "#000" });
  const two = labelImageSize([100, 180], { background: "#000" });

  assert.equal(one.width, 100 + LABEL_IMAGE_DEFAULTS.paddingX * 2);
  assert.equal(two.width, 180 + LABEL_IMAGE_DEFAULTS.paddingX * 2, "ต้องกว้างตามบรรทัดที่ยาวที่สุด");
  assert.equal(two.height - one.height, one.lineHeight, "เพิ่มหนึ่งบรรทัด = สูงขึ้นหนึ่ง lineHeight");
});

test("size stays a whole number of pixels so the texture is not resampled", () => {
  const size = labelImageSize([101.4, 60.7], { background: "#000", fontPx: 13 });
  assert.equal(size.width, Math.ceil(size.width));
  assert.equal(size.height, Math.ceil(size.height));
});

test("non-finite measurements never collapse or blow up the box", () => {
  const size = labelImageSize([Number.NaN, 120], { background: "#000" });
  assert.equal(size.width, 120 + LABEL_IMAGE_DEFAULTS.paddingX * 2);
});

test("an empty label still has a one-line box, never zero height", () => {
  const size = labelImageSize([], { background: "#000" });
  assert.ok(size.height > 0);
});

test("style overrides are honoured", () => {
  const size = labelImageSize([50], { background: "#000", fontPx: 20, paddingX: 4, paddingY: 2, lineHeightRatio: 1 });
  assert.equal(size.width, 58);
  assert.equal(size.height, 24);
});

test("createLabelImage is a no-op outside the browser (server render must not throw)", () => {
  assert.equal(typeof document, "undefined", "เทสต์นี้ต้องรันในสภาพแวดล้อมที่ไม่มี DOM");
  assert.equal(createLabelImage(["ระดับความสูง 1,062 ม."], { background: "#b91c1c" }), null);
});
