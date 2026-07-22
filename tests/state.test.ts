import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { makeBlankState, preserveServerOwned, sanitizeState } from "../lib/state";
import type { AssessmentState, EvidenceFile } from "../lib/types";

test("input ที่ไม่ใช่ object → blank state", () => {
  const s = sanitizeState(null);
  assert.equal(s.unit.name, "");
  assert.equal(s.signed, false);
  assert.equal(s.submitted, null);
});

test("ตัด key แปลกปลอมออก (strict allowlist)", () => {
  const s = sanitizeState({ evil: "x", unit: { name: "โรงเรียนบ้านทดสอบ", hacker: "y" } });
  assert.equal((s as unknown as Record<string, unknown>).evil, undefined);
  assert.equal((s.unit as unknown as Record<string, unknown>).hacker, undefined);
  assert.equal(s.unit.name, "โรงเรียนบ้านทดสอบ");
});

test("จำกัดความยาวข้อความของ unit (<= 500)", () => {
  const s = sanitizeState({ unit: { name: "ก".repeat(1000) } });
  assert.ok(s.unit.name.length <= 500);
});

test("unitType ที่ไม่รู้จัก → default 'โรงเรียน'", () => {
  assert.equal(sanitizeState({ unit: { unitType: "ปลอม" } }).unit.unitType, "โรงเรียน");
  assert.equal(sanitizeState({ unit: { unitType: "ห้องเรียนสาขา" } }).unit.unitType, "ห้องเรียนสาขา");
});

test("settingType — allowlist ลักษณะที่ตั้ง (ว่าง = ยังไม่ระบุ)", () => {
  assert.equal(sanitizeState({ unit: { settingType: "ภูเขาสูง" } }).unit.settingType, "ภูเขาสูง");
  assert.equal(sanitizeState({ unit: { settingType: "พื้นราบห่างไกล" } }).unit.settingType, "พื้นราบห่างไกล");
  assert.equal(sanitizeState({ unit: { settingType: "ปลอม" } }).unit.settingType, "");
  assert.equal(sanitizeState(makeBlankState()).unit.settingType, "");
});

test("responses — รับเฉพาะ key ตัวอักษร และ coerce ค่าเป็น string", () => {
  const s = sanitizeState({ responses: { "1.1": { count: 5, "bad key!": "x" } } });
  assert.equal(s.responses["1.1"].count, "5");
  assert.equal((s.responses["1.1"] as Record<string, unknown>)["bad key!"], undefined);
});

test("feedback แบบเก่า (string) ถูก migrate → {opinion:'agree', note}", () => {
  const s = sanitizeState({ feedback: { "1.1": "ข้อความเดิม" } });
  assert.deepEqual(s.feedback["1.1"], { opinion: "agree", note: "ข้อความเดิม" });
});

test("feedback opinion ที่ไม่รู้จัก → agree", () => {
  const s = sanitizeState({ feedback: { "1.1": { opinion: "weird", note: "n" } } });
  assert.equal(s.feedback["1.1"].opinion, "agree");
  assert.equal(s.feedback["1.1"].note, "n");
});

test("แถว v1 (ไม่มี gis) round-trip ไม่งอก key gis/scoringVersion", () => {
  const s = sanitizeState(makeBlankState());
  assert.equal("gis" in s, false);
  assert.equal("scoringVersion" in s, false);
});

test("scoringVersion 'v2-gis' ถูกทิ้งถ้าไม่มีก้อน gis ที่ใช้ได้", () => {
  assert.equal(sanitizeState({ scoringVersion: "v2-gis" }).scoringVersion, undefined);
});

test("ไฟล์หลักฐาน — จำกัดจำนวน (<=10) และต้องมี id", () => {
  const files = Array.from({ length: 50 }, (_, i) => ({
    id: `f${i}`,
    originalName: "a",
    mimeType: "image/png",
    size: 1,
    sha256: "x",
    uploadedAt: "t",
  }));
  const s = sanitizeState({ evidence: { "1.1": { ready: true, note: "", files } } });
  assert.ok(s.evidence["1.1"].files.length <= 10);

  const noId = sanitizeState({ evidence: { "1.1": { files: [{ originalName: "a" }] } } });
  assert.equal(noId.evidence["1.1"].files.length, 0, "ไฟล์ที่ไม่มี id ถูกตัดทิ้ง");
});

test("submitted — รับเฉพาะเมื่อมี ref + at เป็น string", () => {
  const ok = sanitizeState({
    submitted: { ref: "พสศ-2569-0001", at: "2026-01-01T00:00:00.000Z", total: 70, level: "ระดับ 3" },
  });
  assert.equal(ok.submitted?.ref, "พสศ-2569-0001");
  const bad = sanitizeState({ submitted: { ref: 123, at: null } });
  assert.equal(bad.submitted, null);
});

// preserveServerOwned — helper ที่ทั้ง PUT autosave และ POST submit ใช้ร่วมกัน
// ยืนยันว่า client เขียนทับฟิลด์ที่ server เป็นเจ้าของไม่ได้ (บั๊กเดิม: submit ลืม merge แบบ PUT)
const DB_FILE: EvidenceFile = {
  id: "db-file",
  originalName: "a.pdf",
  mimeType: "application/pdf",
  size: 1,
  sha256: "x",
  uploadedAt: "t",
};

test("preserveServerOwned — evidence.files มาจาก DB แต่ ready/ฟิลด์ปกติมาจาก client", () => {
  const existing = makeBlankState();
  existing.evidence["1.2"] = { ready: true, note: "จาก DB", files: [DB_FILE] };
  const incoming = makeBlankState();
  incoming.unit.name = "ชื่อใหม่จากฟอร์ม";
  incoming.evidence["1.2"] = { ready: false, note: "จาก client", files: [{ ...DB_FILE, id: "FAKE" }] };

  const merged = preserveServerOwned(incoming, existing);
  assert.equal(merged.evidence["1.2"].files.length, 1);
  assert.equal(merged.evidence["1.2"].files[0].id, "db-file", "ไฟล์หลักฐานต้องมาจาก DB ไม่ใช่ client");
  assert.equal(merged.evidence["1.2"].ready, false, "ready (ธงไม่ใช่ไฟล์) ยังมาจาก client");
  assert.equal(merged.evidence["1.2"].note, "จาก client");
  assert.equal(merged.unit.name, "ชื่อใหม่จากฟอร์ม", "ฟิลด์ปกติของ client ต้องผ่าน");
});

test("preserveServerOwned — gis/scoringVersion มาจาก DB, client แก้ไม่ได้", () => {
  const existing = makeBlankState();
  existing.gis = { sentinel: "from-db" } as unknown as AssessmentState["gis"];
  existing.scoringVersion = "v2-gis";
  const incoming = makeBlankState();
  incoming.gis = { sentinel: "forged" } as unknown as AssessmentState["gis"];
  incoming.scoringVersion = "v2-gis";

  const merged = preserveServerOwned(incoming, existing);
  assert.equal((merged.gis as unknown as Record<string, unknown>).sentinel, "from-db");
  assert.equal(merged.scoringVersion, "v2-gis");
});

test("preserveServerOwned — existing เป็นแถว v1 → client ยัด gis เข้ามาไม่ได้ (ไม่งอก key)", () => {
  const existing = makeBlankState(); // v1 — ไม่มี gis
  const incoming = makeBlankState();
  incoming.gis = { sentinel: "forged" } as unknown as AssessmentState["gis"];
  incoming.scoringVersion = "v2-gis";

  const merged = preserveServerOwned(incoming, existing);
  assert.equal("gis" in merged, false, "gis ต้องไม่งอกจากค่าที่ client ส่งมา");
  assert.equal("scoringVersion" in merged, false);
});

describe("siteSnapshots — ภาพยืนยันที่ตั้ง (server-owned)", () => {
  const snap = (over = {}) => ({
    id: "123e4567-e89b-12d3-a456-426614174000",
    originalName: "top.jpg",
    mimeType: "image/jpeg",
    size: 1234,
    sha256: "a".repeat(64),
    uploadedAt: "2026-07-23T00:00:00.000Z",
    viewKey: "top",
    viewLabel: "มุมมองจากด้านบน",
    ...over,
  });

  test("แถวไม่มี siteSnapshots → sanitize ไม่งอก key", () => {
    const s = sanitizeState({ unit: { name: "รร" } });
    assert.equal("siteSnapshots" in s.unit, false);
  });

  test("sanitize รับ array + cap ที่ 9 และกรองรายการไม่มี id ทิ้ง", () => {
    const many = Array.from({ length: 12 }, (_, i) => snap({ id: `123e4567-e89b-12d3-a456-42661417400${i % 10}` }));
    many.push({ viewKey: "x" } as never); // ไม่มี id → ถูกกรอง
    const s = sanitizeState({ unit: { siteSnapshots: many } });
    assert.ok(Array.isArray(s.unit.siteSnapshots));
    assert.equal(s.unit.siteSnapshots!.length, 9);
    assert.equal(s.unit.siteSnapshots![0].viewLabel, "มุมมองจากด้านบน");
  });

  test("preserveServerOwned — siteSnapshots มาจาก DB, client แก้ไม่ได้", () => {
    const existing = makeBlankState();
    existing.unit.siteSnapshots = [snap()];
    const incoming = makeBlankState();
    incoming.unit.siteSnapshots = [snap({ id: "00000000-0000-4000-8000-000000000000", originalName: "ปลอม.jpg" })];
    const merged = preserveServerOwned(incoming, existing);
    assert.equal(merged.unit.siteSnapshots!.length, 1);
    assert.equal(merged.unit.siteSnapshots![0].originalName, "top.jpg");
  });

  test("preserveServerOwned — existing ไม่มี key → ไม่งอก key", () => {
    const merged = preserveServerOwned(makeBlankState(), makeBlankState());
    assert.equal("siteSnapshots" in merged.unit, false);
  });
});
