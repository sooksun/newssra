// applyDemoCriteria — ปุ่ม "เติมคำตอบตัวอย่าง" ต้องเติมเฉพาะคำตอบตามเกณฑ์ ไม่แตะข้อมูลโรงเรียน
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { applyDemoCriteria, DEMO_PROFILES, makeDemoState } from "../lib/demo";
import { makeBlankState } from "../lib/state";
import { flags, totalScore } from "../lib/scoring";
import { INDICATOR_IDS } from "../lib/types";
import type { AssessmentState } from "../lib/types";

// แบบประเมินของโรงเรียนจริงที่กรอกข้อมูลโรงเรียนไว้แล้ว + มีไฟล์หลักฐานจริง + ผล GIS จากแผนที่
function realSchoolState(): AssessmentState {
  const s = makeBlankState("2569");
  s.unit = {
    name: "โรงเรียนบ้านพญาไพร",
    code: "57030129",
    year: "2569",
    totalStudents: "241",
    areaOffice: "สพป.เชียงราย เขต 3",
    province: "เชียงราย",
    lat: "20.312400",
    lng: "99.771500",
    unitType: "โรงเรียน",
    settingType: "ภูเขาสูง",
  };
  s.evidence["1.1"].files = [
    {
      id: "real-file-1",
      originalName: "ทะเบียนนักเรียน.pdf",
      mimeType: "application/pdf",
      size: 1024,
      sha256: "abc",
      uploadedAt: "2569-05-01T03:00:00.000Z",
    },
  ];
  s.feedback["2.2"] = { opinion: "disagree", note: "เกณฑ์นี้ยังไม่ครอบคลุม" };
  s.generalFeedback = "โดยรวมใช้งานได้";
  s.gis = makeDemoState("severe-remote").gis;
  s.scoringVersion = "v2-gis";
  return s;
}

describe("applyDemoCriteria", () => {
  test("ไม่แตะข้อมูลโรงเรียนเลยแม้แต่ฟิลด์เดียว", () => {
    const before = realSchoolState();
    const after = applyDemoCriteria(before, "severe-remote");
    assert.deepEqual(after.unit, before.unit);
    // โปรไฟล์ตัวอย่างมีชื่อ/รหัสของโรงเรียนสมมติ ต้องไม่รั่วเข้ามา
    const demo = makeDemoState("severe-remote");
    assert.notEqual(after.unit.name, demo.unit.name);
    assert.notEqual(after.unit.code, demo.unit.code);
  });

  test("เติมคำตอบตามเกณฑ์ครบทุกตัวชี้วัด ตรงกับโปรไฟล์ที่เลือก", () => {
    const after = applyDemoCriteria(realSchoolState(), "borderline-review");
    const demo = makeDemoState("borderline-review");
    for (const id of INDICATOR_IDS) {
      // ข้อ 1.1/1.3 ถูกปรับตามสัดส่วนผู้เรียนจริง (ทดสอบแยกด้านล่าง) — ที่เหลือต้องตรงกันทุกค่า
      if (["1.1", "1.3"].includes(id)) continue;
      assert.deepEqual(after.responses[id], demo.responses[id], `ตัวชี้วัด ${id} ต้องถูกเติม`);
    }
    for (const id of INDICATOR_IDS) {
      assert.ok(Object.keys(after.responses[id]).length > 0, `ตัวชี้วัด ${id} ต้องไม่ว่าง`);
    }
  });

  test("คะแนนรวมเท่ากับที่แสดงในเมนู แม้ขนาดโรงเรียนจริงต่างจากโปรไฟล์", () => {
    for (const size of ["241", "60", "1200"]) {
      for (const profile of DEMO_PROFILES) {
        const base = realSchoolState();
        base.unit.totalStudents = size;
        const after = applyDemoCriteria(base, profile.id);
        assert.equal(totalScore(after), profile.total, `โปรไฟล์ ${profile.id} ที่ผู้เรียน ${size} คน`);
      }
    }
  });

  test("ข้อ 1.1/1.3 ปรับตามสัดส่วน ส่วน 1.2 คงค่าดิบ (แถบคะแนนเป็นจำนวนคน ไม่ใช่ร้อยละ)", () => {
    const base = realSchoolState();
    base.unit.totalStudents = "60"; // เล็กกว่าโปรไฟล์ severe-remote (210 คน) มาก
    const after = applyDemoCriteria(base, "severe-remote");
    assert.equal(after.responses["1.1"].count, "51"); // 180/210 ของ 60
    assert.equal(after.responses["1.3"].count, "14"); // 48/210 ของ 60
    assert.equal(after.responses["1.2"].count, "45"); // คงเดิม (45 ≤ 60 จึงไม่ถูกจำกัด)
  });

  test("ไม่มีข้อใดเกินจำนวนผู้เรียนทั้งหมดจริง แม้โรงเรียนเล็กมาก (กันธง V00 ที่บล็อกการส่ง)", () => {
    const base = realSchoolState();
    base.unit.totalStudents = "12";
    const after = applyDemoCriteria(base, "severe-remote");
    for (const id of ["1.1", "1.2", "1.3"] as const) {
      const count = Number(after.responses[id].count);
      assert.ok(count <= 12, `${id} = ${count} ต้องไม่เกินผู้เรียนทั้งหมด`);
    }
    assert.ok(!flags(after).some((f) => f.code === "V00"), "ต้องไม่มีธง V00");
  });

  test("ยังไม่กรอกจำนวนผู้เรียน → คัดลอกค่าดิบตามโปรไฟล์ (ไม่มีฐานให้เทียบสัดส่วน)", () => {
    const blank = makeBlankState("2569");
    const after = applyDemoCriteria(blank, "severe-remote");
    assert.equal(after.responses["1.1"].count, makeDemoState("severe-remote").responses["1.1"].count);
  });

  test("เติมสถานะหลักฐาน/หมายเหตุ แต่ไฟล์หลักฐานจริงยังอยู่ครบและไม่มีไฟล์สมมติงอกมา", () => {
    const before = realSchoolState();
    const after = applyDemoCriteria(before, "severe-remote");
    assert.equal(after.evidence["1.1"].ready, true);
    assert.deepEqual(after.evidence["1.1"].files, before.evidence["1.1"].files);
    // โปรไฟล์นี้แนบไฟล์สมมติไว้ที่ 1.2 — ต้องไม่ถูกยัดลงแถวจริง
    assert.deepEqual(after.evidence["1.2"].files, []);
    assert.equal(makeDemoState("severe-remote").evidence["1.2"].files.length, 1);
  });

  test("ผล GIS ของโรงเรียนจริงคงเดิม ไม่ถูกทับด้วยพิกัดของโปรไฟล์ตัวอย่าง", () => {
    const before = realSchoolState();
    const after = applyDemoCriteria(before, "urban-fail");
    assert.deepEqual(after.gis, before.gis);
    assert.equal(after.scoringVersion, "v2-gis");
  });

  test("แถวที่ยังไม่เคยวิเคราะห์ GIS ต้องไม่งอก key gis/scoringVersion", () => {
    const blank = makeBlankState("2569");
    const after = applyDemoCriteria(blank, "severe-remote");
    assert.ok(!("gis" in after), "ต้องไม่มี key gis");
    assert.ok(!("scoringVersion" in after), "ต้องไม่มี key scoringVersion");
  });

  test("ความคิดเห็นผู้ทดสอบและสถานะการยื่นคงเดิม", () => {
    const before = realSchoolState();
    const after = applyDemoCriteria(before, "level1-notpaid");
    assert.deepEqual(after.feedback, before.feedback);
    assert.equal(after.generalFeedback, before.generalFeedback);
    assert.equal(after.signed, before.signed);
    assert.equal(after.submitted, before.submitted);
  });
});
