// Integration: กัน "lost update" เมื่อสองคำขอเขียน state ของแบบประเมินฉบับเดียวกันคาบเกี่ยวกัน
//
// สถานการณ์จริงที่เกิดได้: ผู้ใช้เปิดแบบประเมินไว้แล้ว autosave (PUT) ทำงาน ขณะที่อีกคำขอหนึ่ง
// (บันทึกภาพ 3D / บันทึกผลวิเคราะห์ AI ที่ใช้เวลาหลายวินาที) กำลังเขียนแถวเดียวกันอยู่
// ก่อนแก้: ทั้งสองฝั่งอ่าน state นอกล็อกแล้วเขียนทั้งก้อนกลับ → ฝั่งที่เขียนทีหลังทับงานอีกฝั่งเงียบ ๆ
// หลังแก้: repo.mutateAssessmentStateAtomic() อ่าน+เขียนใน transaction เดียวที่ SELECT ... FOR UPDATE
//
// ทดสอบผ่าน repo โดยตรง (ไม่ผ่าน route) เพราะต้องคุมจังหวะให้สองธุรกรรมคาบเกี่ยวกันจริง ๆ

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { dbAvailable, rawExec } from "./_setup.mts";
import { makeBlankState } from "../../lib/state.ts";
import type { AssessmentState } from "../../lib/types.ts";

const DB = await dbAvailable();
const SCHOOL_CODE = "TESTCONC"; // ไม่ชนกับไฟล์ integration อื่น (รันเป็นโปรเซสคู่ขนานบน DB เดียวกัน)

let repo: typeof import("../../lib/repo.ts");
let assessmentId = 0;

function seedState(): AssessmentState {
  const s = makeBlankState();
  s.unit.name = "โรงเรียนทดสอบเขียนพร้อมกัน";
  s.unit.code = SCHOOL_CODE;
  s.unit.year = "2569";
  s.unit.province = "เชียงใหม่";
  return s;
}

before(async () => {
  if (!DB) return;
  repo = await import("../../lib/repo.ts");
  await rawExec("DELETE FROM assessments WHERE owner_school_code = ?", [SCHOOL_CODE]);
  assessmentId = await repo.createAssessment(seedState(), { userId: null, schoolCode: SCHOOL_CODE });
});

after(async () => {
  if (!DB) return;
  await rawExec("DELETE FROM assessments WHERE owner_school_code = ?", [SCHOOL_CODE]);
});

test("เขียนพร้อมกันสองฝั่ง → งานของทั้งคู่อยู่ครบ ไม่มีฝั่งใดถูกทับเงียบ ๆ", { skip: !DB }, async () => {
  // ฝั่ง A แก้ชื่อหน่วยงาน (แทน autosave ของฟอร์ม), ฝั่ง B แก้ settingSuggestion (แทนผลวิเคราะห์ AI)
  // ยิงพร้อมกัน: ถ้าไม่มีล็อก ฝั่งที่ commit ทีหลังจะเขียนทับด้วย state ที่อ่านมาก่อนอีกฝั่งจะแก้เสร็จ
  const [a, b] = await Promise.all([
    repo.mutateAssessmentStateAtomic(assessmentId, (current) => ({
      ...current,
      unit: { ...current.unit, areaOffice: "สพป.เขียนพร้อมกัน" },
    })),
    repo.mutateAssessmentStateAtomic(assessmentId, (current) => ({
      ...current,
      unit: {
        ...current.unit,
        settingSuggestion: {
          settingType: "ภูเขาสูง",
          rationale: "จากภาพ 3 มิติ",
          confidence: "high",
          analyzedAt: "2026-08-02T00:00:00.000Z",
        },
      },
    })),
  ]);

  assert.equal(a.applied, true);
  assert.equal(b.applied, true);

  const after = await repo.getAssessment(assessmentId);
  assert.ok(after, "ต้องยังมีแถวอยู่");
  assert.equal(after!.state.unit.areaOffice, "สพป.เขียนพร้อมกัน", "งานของฝั่ง A ต้องไม่หาย");
  assert.equal(after!.state.unit.settingSuggestion?.settingType, "ภูเขาสูง", "งานของฝั่ง B ต้องไม่หาย");
});

test(
  "mutate คืน null → ไม่เขียนอะไรเลย (applied=false, state เดิมไม่เปลี่ยนแม้แต่ byte เดียว)",
  { skip: !DB },
  async () => {
    const before = await repo.getAssessment(assessmentId);
    const beforeJson = JSON.stringify(before!.state);

    const result = await repo.mutateAssessmentStateAtomic(assessmentId, () => null);
    assert.equal(result.found, true);
    assert.equal(result.applied, false);
    assert.equal(result.summary, null);

    const afterRow = await repo.getAssessment(assessmentId);
    assert.equal(JSON.stringify(afterRow!.state), beforeJson);
  },
);

test("id ที่ไม่มีอยู่ → found=false ไม่โยน error", { skip: !DB }, async () => {
  const result = await repo.mutateAssessmentStateAtomic(2_000_000_000, (s) => s);
  assert.equal(result.found, false);
  assert.equal(result.applied, false);
  assert.equal(result.summary, null);
});

test("mutate โยน error → rollback (state เดิมคงอยู่) และ error ทะลุถึงผู้เรียก", { skip: !DB }, async () => {
  const before = await repo.getAssessment(assessmentId);
  const beforeJson = JSON.stringify(before!.state);

  await assert.rejects(
    () =>
      repo.mutateAssessmentStateAtomic(assessmentId, () => {
        throw new Error("boom");
      }),
    /boom/,
  );

  const afterRow = await repo.getAssessment(assessmentId);
  assert.equal(JSON.stringify(afterRow!.state), beforeJson, "ต้อง rollback ไม่ทิ้งการเขียนบางส่วนไว้");
});
