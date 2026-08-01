import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import MapStep from "./MapStep";

test("step heading renders the number, the title and an accessible group label", () => {
  const html = renderToStaticMarkup(<MapStep step={2} title="เลือกเส้นทางเดินทางเข้าถึง" />);
  assert.match(html, /class="map-step-num"[^>]*>2</);
  assert.match(html, /เลือกเส้นทางเดินทางเข้าถึง/);
  assert.match(html, /aria-label="ขั้นตอนที่ 2: เลือกเส้นทางเดินทางเข้าถึง"/);
});

test("hint only renders when provided", () => {
  const withHint = renderToStaticMarkup(<MapStep step={1} title="ยืนยันจุดที่ตั้ง" hint="ลากหมุดแดง" />);
  assert.match(withHint, /map-step-hint/);
  assert.match(withHint, /ลากหมุดแดง/);

  const withoutHint = renderToStaticMarkup(<MapStep step={1} title="ยืนยันจุดที่ตั้ง" />);
  assert.doesNotMatch(withoutHint, /map-step-hint/);
});
