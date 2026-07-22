// Integration: route ของแบบประเมิน — ยิง handler จริงกับ MySQL จริง (session คุมผ่าน mock next/headers)
// ครอบคลุม 3 กลไกความปลอดภัยที่ระบุใน critical:
//   1) canAccessAssessment scoping — school อื่นเข้าถึง/แก้ของโรงเรียนอื่นไม่ได้ (403), admin/ssra ได้
//   2) PUT ต้อง preserve ฟิลด์ที่ server เป็นเจ้าของ — client ปลอม submitted / evidence.files ไม่สำเร็จ
//   3) POST /gis หลังยื่นแล้ว → 409 (submit-lock)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { actAs, ctx, dbAvailable, jsonRequest, rawExec, SESSIONS } from "./_setup.mts";
import { makeBlankState } from "../../lib/state.ts";
import type { AssessmentState, EvidenceFile } from "../../lib/types.ts";

const DB = await dbAvailable();
const BASE = "http://localhost/api/assessments";

const { NextRequest } = await import("next/server");
let assessmentRoute: typeof import("../../app/api/assessments/[id]/route.ts");
let gisRoute: typeof import("../../app/api/assessments/[id]/gis/route.ts");
let repo: typeof import("../../lib/repo.ts");

const created: number[] = [];
let draftAId = 0;
let submittedAId = 0;

const SEED_REF = "พสศ-TEST-0001";
const SEED_FILE: EvidenceFile = {
  id: "seed-file-uuid-0001",
  originalName: "หลักฐาน.pdf",
  mimeType: "application/pdf",
  size: 1234,
  sha256: "a".repeat(64),
  uploadedAt: "2026-01-01T00:00:00.000Z",
};

function draftState(): AssessmentState {
  const s = makeBlankState();
  s.unit.name = "โรงเรียนทดสอบ A";
  s.unit.code = "TESTAAAA";
  s.unit.totalStudents = "50";
  s.unit.areaOffice = "สพป.ทดสอบ";
  s.unit.province = "เชียงใหม่";
  s.unit.lat = "18.700000";
  s.unit.lng = "98.900000";
  return s;
}

function submittedState(): AssessmentState {
  const s = draftState();
  // ปีต่างจาก draftState() (2569) โดยตั้งใจ — ตั้งแต่มี uq_owner_school_year แถวเดียวกัน
  // (owner_school_code, assessment_year) จะซ้ำกันไม่ได้ และทั้งสองแถวนี้ใช้ schoolCode TESTAAAA เดียวกัน
  s.unit.year = "2568";
  s.evidence["1.2"] = { ready: true, note: "", files: [SEED_FILE] };
  s.submitted = { at: "2026-02-02T00:00:00.000Z", ref: SEED_REF, total: 98, level: "ระดับ 3 ยุ่งยากมากที่สุด" };
  return s;
}

before(async () => {
  if (!DB) return;
  // ล้างของค้างจากรอบก่อน (กัน unique submitted_ref ชน + owner ทดสอบตกค้าง)
  await rawExec("DELETE FROM assessments WHERE owner_school_code IN ('TESTAAAA','TESTBBBB') OR submitted_ref LIKE 'พสศ-TEST-%'");
  assessmentRoute = await import("../../app/api/assessments/[id]/route.ts");
  gisRoute = await import("../../app/api/assessments/[id]/gis/route.ts");
  repo = await import("../../lib/repo.ts");

  draftAId = await repo.createAssessment(draftState(), { userId: null, schoolCode: "TESTAAAA" });
  submittedAId = await repo.createAssessment(submittedState(), { userId: null, schoolCode: "TESTAAAA" });
  created.push(draftAId, submittedAId);
});

after(async () => {
  if (!DB) return;
  for (const id of created) await repo.deleteAssessment(id).catch(() => {});
  await rawExec("DELETE FROM assessments WHERE owner_school_code IN ('TESTAAAA','TESTBBBB') OR submitted_ref LIKE 'พสศ-TEST-%'");
});

// ─────────────────────── 1) การเข้าถึง (scoping) ───────────────────────

test("GET: school อื่นเข้าถึงแบบประเมินของโรงเรียนอื่น → 403", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolB);
  const res = await assessmentRoute.GET(new NextRequest(`${BASE}/${draftAId}`), ctx(draftAId));
  assert.equal(res.status, 403);
});

test("GET: school เจ้าของเข้าถึงได้ → 200 + คืนข้อมูลถูกตัว", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolA);
  const res = await assessmentRoute.GET(new NextRequest(`${BASE}/${draftAId}`), ctx(draftAId));
  assert.equal(res.status, 200);
  const rec = await res.json();
  assert.equal(rec.id, draftAId);
  assert.equal(rec.state.unit.code, "TESTAAAA");
});

test("GET: admin และ ssra_admin เข้าถึงได้ทุกโรงเรียน → 200", { skip: !DB }, async () => {
  for (const s of [SESSIONS.admin, SESSIONS.ssra]) {
    await actAs(s);
    const res = await assessmentRoute.GET(new NextRequest(`${BASE}/${draftAId}`), ctx(draftAId));
    assert.equal(res.status, 200, `${s.role} ควรเข้าถึงได้`);
  }
});

test("GET: ไม่ล็อกอิน → 401", { skip: !DB }, async () => {
  await actAs(null);
  const res = await assessmentRoute.GET(new NextRequest(`${BASE}/${draftAId}`), ctx(draftAId));
  assert.equal(res.status, 401);
});

test("GET: แบบประเมินที่ไม่มีจริง → 404", { skip: !DB }, async () => {
  await actAs(SESSIONS.admin);
  const res = await assessmentRoute.GET(new NextRequest(`${BASE}/999000111`), ctx(999000111));
  assert.equal(res.status, 404);
});

test("PUT: school อื่นแก้แบบประเมินของโรงเรียนอื่น → 403 (ไม่บันทึก)", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolB);
  const body = { state: draftState() };
  const res = await assessmentRoute.PUT(jsonRequest(NextRequest, `${BASE}/${draftAId}`, { method: "PUT", body }), ctx(draftAId));
  assert.equal(res.status, 403);
});

// ─────────────────── 2) PUT preserve ฟิลด์ที่ server เป็นเจ้าของ ───────────────────

test("PUT: client ปลอม submitted + ล้าง evidence.files ไม่สำเร็จ (server preserve จาก DB)", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolA);

  // client แนบ state ที่ (ก) เปลี่ยน submitted เป็นเลขปลอม (ข) ส่ง files ปลอม/ล้าง — ทั้งคู่ต้องถูกเมิน
  const forged = submittedState();
  forged.unit.name = "ชื่อที่แก้ผ่านฟอร์ม"; // การแก้ปกติ (ต้องถูกบันทึก)
  forged.submitted = { at: "2000-01-01T00:00:00.000Z", ref: "HACKED-9999", total: 0, level: "ปลอม" };
  forged.evidence["1.2"] = { ready: false, note: "", files: [{ ...SEED_FILE, id: "HACKED-FILE" }] };

  const res = await assessmentRoute.PUT(
    jsonRequest(NextRequest, `${BASE}/${submittedAId}`, { method: "PUT", body: { state: forged } }),
    ctx(submittedAId),
  );
  assert.equal(res.status, 200);

  const rec = await repo.getAssessment(submittedAId);
  assert.ok(rec, "ต้องอ่านแถวกลับได้");
  // submitted preserve จาก DB (ไม่ใช่ค่าปลอมจาก client)
  assert.equal(rec!.state.submitted?.ref, SEED_REF, "submitted.ref ต้องคงเดิม (กันปลอมสถานะยื่น)");
  assert.equal(rec!.state.submitted?.total, 98);
  // evidence.files preserve จาก DB (ไม่ใช่ไฟล์ปลอม/ที่ถูกล้าง)
  assert.equal(rec!.state.evidence["1.2"].files.length, 1);
  assert.equal(rec!.state.evidence["1.2"].files[0].id, SEED_FILE.id, "ไฟล์หลักฐานต้องเป็นตัวจริงจาก DB");
  // การแก้ฟิลด์ปกติต้องถูกบันทึก
  assert.equal(rec!.state.unit.name, "ชื่อที่แก้ผ่านฟอร์ม");
});

// ─────────────────────── 3) POST /gis submit-lock ───────────────────────

test("POST /gis: แบบประเมินที่ยื่นแล้ว → 409 (ห้ามเขียนผล GIS ทับ)", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolA);
  const body = { center: { lat: 18.7, lng: 98.9 }, routes: [], apply: false };
  const res = await gisRoute.POST(jsonRequest(NextRequest, `${BASE}/${submittedAId}/gis`, { method: "POST", body }), ctx(submittedAId));
  assert.equal(res.status, 409);
});

test("POST /gis: school อื่น → 403", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolB);
  const body = { center: { lat: 18.7, lng: 98.9 }, routes: [] };
  const res = await gisRoute.POST(jsonRequest(NextRequest, `${BASE}/${draftAId}/gis`, { method: "POST", body }), ctx(draftAId));
  assert.equal(res.status, 403);
});

test("POST /gis: พิกัดศูนย์กลางไม่ถูกต้อง → 400", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolA);
  const body = { center: { lat: 999, lng: 98.9 }, routes: [] };
  const res = await gisRoute.POST(jsonRequest(NextRequest, `${BASE}/${draftAId}/gis`, { method: "POST", body }), ctx(draftAId));
  assert.equal(res.status, 400);
});

// ─────────────── 4) uq_owner_school_year — 1 โรงเรียน/1 ปี ต่อแบบประเมิน ───────────────

test("database rejects a second assessment for the same school and year", { skip: !DB }, async () => {
  const first = draftState();
  first.unit.year = "2599";
  const second = draftState();
  second.unit.year = "2599";
  const id = await repo.createAssessment(first, { userId: null, schoolCode: "TESTAAAA" });
  created.push(id);
  await assert.rejects(
    repo.createAssessment(second, { userId: null, schoolCode: "TESTAAAA" }),
    (error: unknown) => (error as { code?: string }).code === "ER_DUP_ENTRY",
  );
});
