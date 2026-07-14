import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBlankState, sanitizeState } from "../lib/state";

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
    id: `f${i}`, originalName: "a", mimeType: "image/png", size: 1, sha256: "x", uploadedAt: "t",
  }));
  const s = sanitizeState({ evidence: { "1.1": { ready: true, note: "", files } } });
  assert.ok(s.evidence["1.1"].files.length <= 10);

  const noId = sanitizeState({ evidence: { "1.1": { files: [{ originalName: "a" }] } } });
  assert.equal(noId.evidence["1.1"].files.length, 0, "ไฟล์ที่ไม่มี id ถูกตัดทิ้ง");
});

test("submitted — รับเฉพาะเมื่อมี ref + at เป็น string", () => {
  const ok = sanitizeState({ submitted: { ref: "พสศ-2569-0001", at: "2026-01-01T00:00:00.000Z", total: 70, level: "ระดับ 3" } });
  assert.equal(ok.submitted?.ref, "พสศ-2569-0001");
  const bad = sanitizeState({ submitted: { ref: 123, at: null } });
  assert.equal(bad.submitted, null);
});
