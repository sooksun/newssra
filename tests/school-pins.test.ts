// Unit tests สำหรับ lib/school-pins.ts — helper บริสุทธิ์ของหมุดภาพรวมโรงเรียน (ไม่ต้องมี DB)
// รันด้วย: npm test (node:test + tsx loader)

import assert from "node:assert/strict";
import test from "node:test";
import { isSchoolPinSubmitted, schoolPinStatus, resolvePinCoord } from "../lib/school-pins";

test("isSchoolPinSubmitted: submitted object from stored AssessmentState counts as submitted", () => {
  const submitted = { ref: "PSS-2569-001", at: "2026-07-27T10:00:00.000Z" };
  assert.equal(isSchoolPinSubmitted(submitted), true);
  assert.equal(isSchoolPinSubmitted(JSON.stringify(submitted)), true);
  assert.equal(isSchoolPinSubmitted(null), false);
});

test("schoolPinStatus: ยังไม่ส่ง = draft ไม่ว่าระดับใด", () => {
  assert.equal(schoolPinStatus({ submitted: false, levelKey: "level-3" }), "draft");
  assert.equal(schoolPinStatus({ submitted: false, levelKey: "neutral" }), "draft");
  assert.equal(schoolPinStatus({ submitted: false, levelKey: "" }), "draft");
});

test("schoolPinStatus: ส่งแล้ว + คะแนน ≥50 (ไม่ใช่ neutral) = pass", () => {
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "level-3" }), "pass");
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "level-2" }), "pass");
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "level-1" }), "pass");
});

test("schoolPinStatus: ส่งแล้ว + neutral (คะแนน <50) = fail", () => {
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "neutral" }), "fail");
});

test("resolvePinCoord: พิกัดในแบบประเมินใช้ได้ → ใช้เลย", () => {
  assert.deepEqual(resolvePinCoord("18.79", "98.98", null), { lat: 18.79, lng: 98.98 });
  assert.deepEqual(resolvePinCoord(18.79, 98.98, null), { lat: 18.79, lng: 98.98 });
});

test("resolvePinCoord: พิกัดว่าง/เป็น (0,0) → ใช้ fallback ทะเบียน", () => {
  assert.deepEqual(resolvePinCoord("0", "0", { lat: 19.1, lng: 99.2 }), { lat: 19.1, lng: 99.2 });
  assert.deepEqual(resolvePinCoord("", "", { lat: 19.1, lng: 99.2 }), { lat: 19.1, lng: 99.2 });
});

test("resolvePinCoord: ไม่มีพิกัดใช้ได้เลย → null (ไม่แสดงหมุด)", () => {
  assert.equal(resolvePinCoord("", "", null), null);
  assert.equal(resolvePinCoord("abc", "def", { lat: 0, lng: 0 }), null);
  assert.equal(resolvePinCoord("0", "0", null), null);
});
