// Integration: uq_owner_school_year แสดงผลเป็น 409 ที่ชั้น route (ไม่ใช่ 500 ดิบจาก DB)
//   1) POST /api/assessments (สร้างใหม่) ชนปีเดิมของโรงเรียนตน → 409 + assessmentId ของแถวเดิม (ไม่สร้างแถวใหม่)
//   2) PUT /api/assessments/[id] (autosave) แก้ unit.year ไปชนปีอื่นของโรงเรียนเดียวกัน → 409 (แถวเดิมไม่ถูกแก้ปี)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { actAs, ctx, dbAvailable, jsonRequest, rawExec, SESSIONS } from "./_setup.mts";
import { makeBlankState } from "../../lib/state.ts";
import type { AssessmentState } from "../../lib/types.ts";

const DB = await dbAvailable();
const BASE = "http://localhost/api/assessments";

const { NextRequest } = await import("next/server");
let listCreateRoute: typeof import("../../app/api/assessments/route.ts");
let assessmentRoute: typeof import("../../app/api/assessments/[id]/route.ts");
let repo: typeof import("../../lib/repo.ts");

const SCHOOL_CODE = "TESTYEAR";
const YEAR_A = "2560";
const YEAR_B = "2561";

const created: number[] = [];
let rowYearAId = 0;
let rowYearBId = 0;

function stateFor(year: string): AssessmentState {
  const s = makeBlankState(year);
  s.unit.name = "โรงเรียนทดสอบปีชน";
  s.unit.code = SCHOOL_CODE;
  s.unit.province = "เชียงใหม่";
  return s;
}

before(async () => {
  if (!DB) return;
  await rawExec("DELETE FROM assessments WHERE owner_school_code = ?", [SCHOOL_CODE]);
  listCreateRoute = await import("../../app/api/assessments/route.ts");
  assessmentRoute = await import("../../app/api/assessments/[id]/route.ts");
  repo = await import("../../lib/repo.ts");

  rowYearAId = await repo.createAssessment(stateFor(YEAR_A), { userId: null, schoolCode: SCHOOL_CODE });
  rowYearBId = await repo.createAssessment(stateFor(YEAR_B), { userId: null, schoolCode: SCHOOL_CODE });
  created.push(rowYearAId, rowYearBId);
});

after(async () => {
  if (!DB) return;
  for (const id of created) await repo.deleteAssessment(id).catch(() => {});
  await rawExec("DELETE FROM assessments WHERE owner_school_code = ?", [SCHOOL_CODE]);
});

test(
  "POST /api/assessments: โรงเรียนที่มีแบบประเมินปีปัจจุบันอยู่แล้ว → 409 + assessmentId เดิม (ไม่สร้างแถวใหม่)",
  { skip: !DB },
  async () => {
    // makeBlankState() ใช้ currentBuddhistYear() เป็น default — สร้างแถวปีปัจจุบันของโรงเรียนนี้ไว้ล่วงหน้า
    const { currentBuddhistYear } = await import("../../lib/assessment-year.ts");
    const thisYear = currentBuddhistYear();
    const existing = stateFor(thisYear);
    const existingId = await repo.createAssessment(existing, { userId: null, schoolCode: SCHOOL_CODE });
    created.push(existingId);

    const countBefore = await repo.countAssessments({ uid: 0, role: "school", schoolCode: SCHOOL_CODE });

    await actAs({ uid: 900010, role: "school", name: "รร.ทดสอบปีชน", source: "local", schoolCode: SCHOOL_CODE });
    const res = await listCreateRoute.POST();
    assert.equal(res.status, 409);
    const data = (await res.json()) as { error?: string; assessmentId?: number | null };
    assert.equal(data.assessmentId, existingId);
    assert.ok(data.error && data.error.length > 0);

    const countAfter = await repo.countAssessments({ uid: 0, role: "school", schoolCode: SCHOOL_CODE });
    assert.equal(countAfter, countBefore, "ต้องไม่มีแถวใหม่ถูกสร้างขึ้น");
  },
);

test(
  "PUT /api/assessments/[id]: แก้ unit.year ไปชนปีอื่นของโรงเรียนเดียวกัน → 409 (ปีเดิมในฐานข้อมูลไม่ถูกแก้)",
  { skip: !DB },
  async () => {
    await actAs({ uid: 900011, role: "school", name: "รร.ทดสอบปีชน", source: "local", schoolCode: SCHOOL_CODE });

    const forged = stateFor(YEAR_A);
    forged.unit.year = YEAR_B; // ชนกับ rowYearBId ที่มีอยู่แล้ว
    forged.unit.name = "ชื่อที่พยายามแก้";

    const res = await assessmentRoute.PUT(
      jsonRequest(NextRequest, `${BASE}/${rowYearAId}`, { method: "PUT", body: { state: forged } }),
      ctx(rowYearAId),
    );
    assert.equal(res.status, 409);
    const data = (await res.json()) as { error?: string };
    assert.ok(data.error && data.error.length > 0);

    const rec = await repo.getAssessment(rowYearAId);
    assert.ok(rec, "แถวต้องยังอยู่");
    assert.equal(rec!.state.unit.year, YEAR_A, "ปีในฐานข้อมูลต้องไม่เปลี่ยน");
    assert.notEqual(rec!.state.unit.name, "ชื่อที่พยายามแก้", "การแก้ที่ทำให้ชนต้องไม่ถูกบันทึกเลย");
  },
);
