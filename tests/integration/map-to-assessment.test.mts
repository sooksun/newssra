// Integration: POST /api/assessments/from-map — endpoint atomic ที่บันทึกผล GIS จากแผนที่ 3 มิติ
// ลงแบบประเมิน "ปีปัจจุบัน" ของโรงเรียนผู้เรียก (schoolCode มาจาก session เท่านั้น — ไม่รับจาก client)
// ครอบคลุม branch การตัดสินใจของ saveAssessmentFromMapAtomic ที่ยังไม่มี test ตรง (Task 3 review flag):
//   created (ยังไม่มีแถวของปีนี้) / updated (มีแถวร่างเดิม) / locked (แถวปีนี้ยื่นแล้ว — ต้องไม่แตะ state เดิมเลย)
// รวมถึงการตรวจสิทธิ์ (school เท่านั้น), การปลอม schoolCode ผ่าน body, และการแมป error code → HTTP status

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { actAs, dbAvailable, jsonRequest, rawExec, SESSIONS } from "./_setup.mts";
import { currentBuddhistYear } from "../../lib/assessment-year.ts";
import { makeBlankState } from "../../lib/state.ts";
import type { AssessmentState } from "../../lib/types.ts";
import type { SessionUser } from "../../lib/types.ts";

const DB = await dbAvailable();
const BASE = "http://localhost/api/assessments/from-map";

const { NextRequest } = await import("next/server");
let route: typeof import("../../app/api/assessments/from-map/route.ts");
let repo: typeof import("../../lib/repo.ts");

const YEAR = currentBuddhistYear();

// รหัสโรงเรียนทดสอบ 3 ตัว — แยกสถานการณ์ให้ไม่ชนกัน (แต่ละตัว cleanup แยกชัดเจนตอน after())
const SCHOOL_A = "TESTMAPA"; // มี master data — ใช้ทดสอบ created → updated + forged schoolCode
const SCHOOL_B = "TESTMAPB"; // มี master data + แบบประเมินปีนี้ยื่นแล้ว — ใช้ทดสอบ locked
const SCHOOL_C = "TESTMAPC"; // ไม่มี master data เลย — ใช้ทดสอบ 422 ไม่พบพิกัดโรงเรียน

const SESSION_A: SessionUser = { uid: 910001, role: "school", name: "รร.ทดสอบแผนที่ A", source: "local", schoolCode: SCHOOL_A };
const SESSION_B: SessionUser = { uid: 910002, role: "school", name: "รร.ทดสอบแผนที่ B", source: "local", schoolCode: SCHOOL_B };
const SESSION_C: SessionUser = { uid: 910003, role: "school", name: "รร.ทดสอบแผนที่ C", source: "local", schoolCode: SCHOOL_C };
const SESSION_NO_SCHOOL: SessionUser = { uid: 910004, role: "school", name: "บัญชียังไม่ผูกโรงเรียน", source: "local", schoolCode: "" };

const LOC_ID_A = 999999201;
const LOC_ID_B = 999999202;
// หมายเหตุ: ต้อง "ไม่" ขึ้นต้นด้วย "พสศ-TEST-" เพราะ assessment-security.test.mts มี cleanup แบบ
// LIKE 'พสศ-TEST-%' อยู่ — ไฟล์ integration test คนละไฟล์รันแข่งกัน (Node test runner กระจาย process)
// ถ้าใช้พรีฟิกซ์เดียวกันจะโดนลบข้ามไฟล์กลางคัน (ต้นเหตุ flake ที่เจอตอนรันทั้งชุดพร้อมกัน)
const SUBMITTED_REF_B = "พสศ-MAPTEST-9001";

const createdAssessmentIds: number[] = [];

function validPayload() {
  return {
    center: { lat: 20.0, lng: 99.0, source: "map-pin" },
    elevation: { schoolMarkerElevationM: 1062 },
    routes: [
      {
        destinationType: "province_hall",
        destinationName: "ศาลากลางจังหวัดเชียงราย",
        destLat: 20.3,
        destLng: 99.5,
        roadDistanceM: 74330,
        durationS: 5400,
        elevationGainM: 300,
        elevationLossM: 100,
        selected: true,
        highestPoint: { lat: 20.3, lng: 99.5, elevationM: 1070 },
      },
    ],
    syncUnitLocation: false,
  };
}

async function seedMasterSchool(schoolCode: string, locId: number, name: string) {
  await rawExec(
    `INSERT INTO master_school
      (sc_id, sc_smis, sc_obec, sao_code, sc_name, dir_name, address, districts, amphures, provinces,
       zipcodes, email, website, telephone, establish, status, remote, last_update)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [String(locId), schoolCode, "000000", 1, name, "ทดสอบ", "ที่อยู่ทดสอบ", "ทดสอบ", "ทดสอบ", "เชียงราย", "57000", "", "", "", "", 1, 0, "2026"],
  );
  await rawExec(
    `INSERT INTO school_location
      (id, sname, lat, lng, location_high, pre, p, m, s, rpre, rp, rm, rs, teacher, student, room, url, highest, distance, comment, elevation65)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, '', NULL)`,
    [locId, name, "20.000000", "99.000000", 500],
  );
}

function draftState(schoolCode: string): AssessmentState {
  const s = makeBlankState();
  s.unit.name = `โรงเรียนทดสอบแผนที่ ${schoolCode}`;
  s.unit.code = schoolCode;
  s.unit.province = "เชียงราย";
  s.unit.lat = "20.000000";
  s.unit.lng = "99.000000";
  return s;
}

function submittedState(schoolCode: string): AssessmentState {
  const s = draftState(schoolCode);
  s.submitted = { at: "2026-02-02T00:00:00.000Z", ref: SUBMITTED_REF_B, total: 98, level: "ระดับ 3 ยุ่งยากมากที่สุด" };
  return s;
}

async function cleanupTestRows() {
  await rawExec(
    "DELETE FROM assessments WHERE owner_school_code IN (?, ?, ?) OR submitted_ref = ?",
    [SCHOOL_A, SCHOOL_B, SCHOOL_C, SUBMITTED_REF_B],
  );
  await rawExec("DELETE FROM master_school WHERE sc_smis IN (?, ?, ?)", [SCHOOL_A, SCHOOL_B, SCHOOL_C]);
  await rawExec("DELETE FROM school_location WHERE id IN (?, ?)", [LOC_ID_A, LOC_ID_B]);
}

let submittedBId = 0;

before(async () => {
  if (!DB) return;
  await cleanupTestRows();
  route = await import("../../app/api/assessments/from-map/route.ts");
  repo = await import("../../lib/repo.ts");

  await seedMasterSchool(SCHOOL_A, LOC_ID_A, `โรงเรียนทดสอบแผนที่ ${SCHOOL_A}`);
  await seedMasterSchool(SCHOOL_B, LOC_ID_B, `โรงเรียนทดสอบแผนที่ ${SCHOOL_B}`);
  // SCHOOL_C ไม่มี master data เลย (จงใจ) — ใช้ทดสอบ 422 ไม่พบพิกัดโรงเรียน

  const submitted = submittedState(SCHOOL_B);
  submitted.unit.year = YEAR; // ต้องเป็นปีปัจจุบัน — /from-map ผูกกับ (schoolCode, ปีปัจจุบัน) เท่านั้น
  submittedBId = await repo.createAssessment(submitted, { userId: null, schoolCode: SCHOOL_B });
  createdAssessmentIds.push(submittedBId);
});

after(async () => {
  if (!DB) return;
  for (const id of createdAssessmentIds) await repo.deleteAssessment(id).catch(() => {});
  await cleanupTestRows();
});

// ─────────────────────── การตรวจสิทธิ์ ───────────────────────

test("POST from-map: ไม่ล็อกอิน → 401", { skip: !DB }, async () => {
  await actAs(null);
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload() }));
  assert.equal(res.status, 401);
});

test("POST from-map: admin และ ssra_admin → 403 (school เท่านั้น)", { skip: !DB }, async () => {
  for (const s of [SESSIONS.admin, SESSIONS.ssra]) {
    await actAs(s);
    const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload() }));
    assert.equal(res.status, 403, `${s.role} ต้องถูกปฏิเสธ`);
  }
});

test("POST from-map: บัญชี school ที่ยังไม่ผูกรหัสโรงเรียน → 403", { skip: !DB }, async () => {
  await actAs(SESSION_NO_SCHOOL);
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload() }));
  assert.equal(res.status, 403);
});

test("POST from-map: ไม่พบข้อมูลพิกัดโรงเรียนในทะเบียน → 422", { skip: !DB }, async () => {
  await actAs(SESSION_C);
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload() }));
  assert.equal(res.status, 422);
});

test("POST from-map: JSON ผิดรูปแบบ → 400", { skip: !DB }, async () => {
  await actAs(SESSION_A);
  const malformed = new NextRequest(BASE, {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: "{ this is not json",
  });
  const res = await route.POST(malformed);
  assert.equal(res.status, 400);
});

test("POST from-map: พิกัดศูนย์กลางไม่ถูกต้อง → 400", { skip: !DB }, async () => {
  await actAs(SESSION_A);
  const body = { center: { lat: 999, lng: 99 }, routes: [] };
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body }));
  assert.equal(res.status, 400);
});

test("POST from-map: ไม่มีเส้นทางศาลากลางจังหวัดที่ใช้ได้ → 422", { skip: !DB }, async () => {
  await actAs(SESSION_A);
  const body = { center: { lat: 20.0, lng: 99.0 }, routes: [] };
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body }));
  assert.equal(res.status, 422);
});

// ─────────────────── created → updated (แถวเดียวกัน, ปีเดียวกัน) ───────────────────

let mapAAssessmentId = 0;

test("POST from-map: สร้างแบบประเมินปีปัจจุบันครั้งแรก → 201 created", { skip: !DB }, async () => {
  await actAs(SESSION_A);
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload() }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.action, "created");
  assert.ok(Number.isInteger(body.assessmentId) && body.assessmentId > 0);
  mapAAssessmentId = body.assessmentId;
  createdAssessmentIds.push(mapAAssessmentId);

  const rec = await repo.getAssessment(mapAAssessmentId);
  assert.ok(rec, "ต้องอ่านแถวที่สร้างกลับได้");
  assert.equal(rec!.ownerSchoolCode, SCHOOL_A);
  assert.equal(rec!.state.unit.year, YEAR);
  assert.equal(rec!.state.scoringVersion, "v2-gis");
});

test("POST from-map: เรียกซ้ำปีเดียวกัน → 200 updated ทับแถวเดิม (ไม่สร้างแถวใหม่)", { skip: !DB }, async () => {
  await actAs(SESSION_A);
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload() }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.action, "updated");
  assert.equal(body.assessmentId, mapAAssessmentId, "ต้องเป็นแถวเดิม ไม่ใช่แถวใหม่");
});

test("POST from-map: schoolCode ปลอมใน body ไม่มีผล — เจ้าของยังเป็นโรงเรียนตาม session", { skip: !DB }, async () => {
  await actAs(SESSION_A);
  const forged = { ...validPayload(), schoolCode: SCHOOL_B };
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: forged }));
  assert.equal(res.status, 200); // แถวของ SCHOOL_A มีอยู่แล้วจากสองการทดสอบก่อนหน้า → updated
  const body = await res.json();
  assert.equal(body.assessmentId, mapAAssessmentId, "ต้องยังเป็นแถวของ SCHOOL_A เดิม ไม่ใช่แถวปลอมของ SCHOOL_B");

  const rec = await repo.getAssessment(body.assessmentId);
  assert.equal(rec!.ownerSchoolCode, SCHOOL_A, "owner ต้องมาจาก session เท่านั้น ไม่ใช่ค่าที่ปลอมมาทาง body");

  // ยืนยันด้วยว่าแถวของ SCHOOL_B (ยื่นแล้ว) ไม่ถูกแตะต้องจากการปลอมนี้
  const bRec = await repo.getAssessment(submittedBId);
  assert.equal(bRec!.state.submitted?.ref, SUBMITTED_REF_B);
});

// ─────────────────────── locked (แถวปีนี้ยื่นแล้ว) ───────────────────────

test("POST from-map: แบบประเมินปีปัจจุบันยื่นแล้ว → 200 locked และ state ไม่เปลี่ยนแม้แต่ byte เดียว", { skip: !DB }, async () => {
  const before_ = await repo.getAssessment(submittedBId);
  assert.ok(before_, "ต้องมีแถวยื่นแล้วให้เปรียบเทียบ");

  await actAs(SESSION_B);
  const res = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload() }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.action, "locked");
  assert.equal(body.assessmentId, submittedBId);

  const after_ = await repo.getAssessment(submittedBId);
  assert.ok(after_, "แถวต้องยังอยู่หลังเรียก locked");
  assert.deepEqual(after_!.state, before_!.state, "state ทั้งก้อนต้องเหมือนเดิมทุกประการ (ห้ามแตะ GIS/คะแนนของแบบที่ยื่นแล้ว)");
});
