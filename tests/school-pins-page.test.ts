// Source-grep test: หน้า /map เรียก listSchoolPins เฉพาะภาพรวม admin, ส่ง prop, และมีปุ่มกลับแผนที่รวม
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/map/page.tsx", "utf8");

test("เรียก listSchoolPins เฉพาะ admin โหมดภาพรวม (canSeeAll && ไม่มี assessment)", () => {
  assert.match(page, /listSchoolPins/);
  assert.match(page, /canSeeAll && !assessment/);
});

test("ส่ง prop schoolPins ให้ CesiumMapLoader", () => {
  assert.match(page, /schoolPins=\{schoolPins\}/);
});

test("มีปุ่มกลับแผนที่รวมเมื่อ admin เจาะดูโรงเรียน (canSeeAll && assessment)", () => {
  assert.match(page, /canSeeAll && assessment/);
  assert.match(page, /กลับแผนที่รวม/);
  assert.match(page, /href="\/map"/);
});

test("สลับ drill-in กลับภาพรวมแล้ว remount แผนที่เพื่อไม่ค้าง state โรงเรียนเดิม", () => {
  assert.match(page, /key=\{assessment\?\.id \?\? "national"\}/);
});
