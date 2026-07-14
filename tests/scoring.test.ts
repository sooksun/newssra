// Unit tests สำหรับ lib/scoring.ts — เอนจินคะแนน พ.ส.ศ. (ผูกกับเงินเพิ่ม 2,000 บาท/เดือน)
// กัน regress: ครอบ 5 demo profiles + boundary ทุกช่วงคะแนนของทุกตัวชี้วัด + ธง/จุดตัดระดับ
// รันด้วย: npm test  (node:test + tsx loader — ไม่มี runtime dependency เพิ่ม)

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  scoreIndicator,
  totalScore,
  levelFor,
  flags,
  canSubmit,
  answeredCount,
  unitComplete,
} from "../lib/scoring";
import { makeBlankState } from "../lib/state";
import { makeDemoState } from "../lib/demo";
import { INDICATORS, PASS_THRESHOLD } from "../lib/criteria";
import { INDICATOR_IDS } from "../lib/types";
import type { AssessmentState, IndicatorId, ResponseData } from "../lib/types";

/** ให้คะแนนตัวชี้วัดเดียวแบบแยกเดี่ยว — ตั้ง totalStudents (ค่า default 100 → count = ร้อยละพอดี) */
function scoreOf(id: IndicatorId, data: ResponseData, totalStudents = "100"): number | null {
  const s = makeBlankState();
  s.unit.totalStudents = totalStudents;
  s.responses[id] = data;
  return scoreIndicator(id, s);
}

// ───────────────────────── 1) Demo profiles (คะแนนรวมที่รู้ค่าแน่นอน) ─────────────────────────

const DEMO_EXPECTED: Record<string, { total: number; levelKey: string }> = {
  "boundary-pass": { total: 70, levelKey: "level-3" },
  "severe-remote": { total: 98, levelKey: "level-3" },
  "borderline-review": { total: 68, levelKey: "level-2" },
  "level1-notpaid": { total: 55, levelKey: "level-1" },
  "urban-fail": { total: 12, levelKey: "neutral" },
};

describe("demo profiles — คะแนนรวมและระดับต้องคงที่", () => {
  for (const [id, exp] of Object.entries(DEMO_EXPECTED)) {
    test(`${id} → รวม ${exp.total} (${exp.levelKey})`, () => {
      const state = makeDemoState(id);
      const total = totalScore(state);
      assert.equal(total, exp.total, `คะแนนรวมของ ${id} ต้องเท่ากับ ${exp.total}`);
      assert.equal(levelFor(total).key, exp.levelKey);
    });
  }
});

// ───────────────────────── 2) Boundary ของทุกตัวชี้วัด ─────────────────────────

interface Case {
  id: IndicatorId;
  data: ResponseData;
  total?: string;
  expect: number | null;
}

// ช่วงคะแนนยึด "เกิน a – ไม่เกิน b" (ล่าง exclusive, บน inclusive) ตามสเปก §4
const CASES: Case[] = [
  // 1.1 ร้อยละกลุ่มชาติพันธุ์ (total=100 → count=%)
  { id: "1.1", data: {}, expect: null },
  { id: "1.1", data: { count: "50" }, total: "0", expect: null }, // ไม่มีผู้เรียนทั้งหมด
  { id: "1.1", data: { count: "4" }, expect: 0 },
  { id: "1.1", data: { count: "5" }, expect: 2 },
  { id: "1.1", data: { count: "20" }, expect: 2 },
  { id: "1.1", data: { count: "21" }, expect: 4 },
  { id: "1.1", data: { count: "40" }, expect: 4 },
  { id: "1.1", data: { count: "41" }, expect: 6 },
  { id: "1.1", data: { count: "60" }, expect: 6 },
  { id: "1.1", data: { count: "61" }, expect: 8 },
  { id: "1.1", data: { count: "80" }, expect: 8 },
  { id: "1.1", data: { count: "81" }, expect: 10 },
  // 1.2 จำนวนผู้เรียนพักนอน (นับคนตรง)
  { id: "1.2", data: {}, expect: null },
  { id: "1.2", data: { count: "0" }, expect: 0 },
  { id: "1.2", data: { count: "1" }, expect: 4 },
  { id: "1.2", data: { count: "10" }, expect: 4 },
  { id: "1.2", data: { count: "11" }, expect: 6 },
  { id: "1.2", data: { count: "20" }, expect: 6 },
  { id: "1.2", data: { count: "21" }, expect: 7 },
  { id: "1.2", data: { count: "30" }, expect: 7 },
  { id: "1.2", data: { count: "31" }, expect: 8 },
  { id: "1.2", data: { count: "40" }, expect: 8 },
  { id: "1.2", data: { count: "41" }, expect: 9 },
  { id: "1.2", data: { count: "60" }, expect: 9 },
  { id: "1.2", data: { count: "61" }, expect: 10 },
  // 1.3 ร้อยละกลุ่มเปราะบาง (total=100)
  { id: "1.3", data: {}, expect: null },
  { id: "1.3", data: { count: "0" }, expect: 0 },
  { id: "1.3", data: { count: "1" }, expect: 1 },
  { id: "1.3", data: { count: "6" }, expect: 1 },
  { id: "1.3", data: { count: "7" }, expect: 2 },
  { id: "1.3", data: { count: "11" }, expect: 2 },
  { id: "1.3", data: { count: "12" }, expect: 3 },
  { id: "1.3", data: { count: "16" }, expect: 3 },
  { id: "1.3", data: { count: "17" }, expect: 4 },
  { id: "1.3", data: { count: "21" }, expect: 4 },
  { id: "1.3", data: { count: "22" }, expect: 5 },
  // 1.4 จำนวนภาษา (นับตรง + clamp 0..5)
  { id: "1.4", data: {}, expect: null },
  { id: "1.4", data: { langs: "0" }, expect: 0 },
  { id: "1.4", data: { langs: "1" }, expect: 1 },
  { id: "1.4", data: { langs: "3" }, expect: 3 },
  { id: "1.4", data: { langs: "5" }, expect: 5 },
  { id: "1.4", data: { langs: "7" }, expect: 5 }, // clamp
  // 2.1 อัตรากำลังต่ำกว่าเกณฑ์ (frame=100 → deficit=%)
  { id: "2.1", data: {}, expect: null },
  { id: "2.1", data: { frame: "100" }, expect: null }, // ขาด actual
  { id: "2.1", data: { frame: "0", actual: "0" }, expect: 0 }, // frame<=0
  { id: "2.1", data: { frame: "100", actual: "100" }, expect: 0 }, // ครบ
  { id: "2.1", data: { frame: "100", actual: "110" }, expect: 0 }, // เกินเกณฑ์ (deficit ติดลบ)
  { id: "2.1", data: { frame: "100", actual: "90" }, expect: 1 }, // 10%
  { id: "2.1", data: { frame: "100", actual: "89" }, expect: 2 }, // 11%
  { id: "2.1", data: { frame: "100", actual: "80" }, expect: 2 }, // 20%
  { id: "2.1", data: { frame: "100", actual: "79" }, expect: 3 }, // 21%
  // 2.2 ตำแหน่งว่าง (level 4 ตัวเลือก)
  { id: "2.2", data: {}, expect: null },
  { id: "2.2", data: { level: "0" }, expect: 0 },
  { id: "2.2", data: { level: "1" }, expect: 2 },
  { id: "2.2", data: { level: "2" }, expect: 3 },
  { id: "2.2", data: { level: "3" }, expect: 4 },
  { id: "2.2", data: { level: "9" }, expect: null }, // index เกินช่วง
  // 2.3 อัตราหมุนเวียนออก
  { id: "2.3", data: {}, expect: null },
  { id: "2.3", data: { rate: "9" }, expect: 0 },
  { id: "2.3", data: { rate: "10" }, expect: 1 },
  { id: "2.3", data: { rate: "20" }, expect: 1 },
  { id: "2.3", data: { rate: "21" }, expect: 2 },
  { id: "2.3", data: { rate: "30" }, expect: 2 },
  { id: "2.3", data: { rate: "31" }, expect: 3 },
  // 3.1 เวลาเดินทางจากเขต
  { id: "3.1", data: {}, expect: null },
  { id: "3.1", data: { minutes: "30" }, expect: 0 },
  { id: "3.1", data: { minutes: "31" }, expect: 3 },
  { id: "3.1", data: { minutes: "60" }, expect: 3 },
  { id: "3.1", data: { minutes: "61" }, expect: 6 },
  { id: "3.1", data: { minutes: "120" }, expect: 6 },
  { id: "3.1", data: { minutes: "121" }, expect: 8 },
  { id: "3.1", data: { minutes: "180" }, expect: 8 },
  { id: "3.1", data: { minutes: "181" }, expect: 10 },
  // 3.2 ความยากลำบากเข้าถึง (level 5 ตัวเลือก)
  { id: "3.2", data: {}, expect: null },
  { id: "3.2", data: { level: "0" }, expect: 0 },
  { id: "3.2", data: { level: "1" }, expect: 4 },
  { id: "3.2", data: { level: "2" }, expect: 6 },
  { id: "3.2", data: { level: "3" }, expect: 8 },
  { id: "3.2", data: { level: "4" }, expect: 10 },
  { id: "3.2", data: { level: "5" }, expect: null },
  // 3.3 บริการฉุกเฉิน
  { id: "3.3", data: {}, expect: null },
  { id: "3.3", data: { minutes: "15" }, expect: 0 },
  { id: "3.3", data: { minutes: "16" }, expect: 3 },
  { id: "3.3", data: { minutes: "30" }, expect: 3 },
  { id: "3.3", data: { minutes: "31" }, expect: 6 },
  { id: "3.3", data: { minutes: "60" }, expect: 6 },
  { id: "3.3", data: { minutes: "61" }, expect: 8 },
  { id: "3.3", data: { minutes: "120" }, expect: 8 },
  { id: "3.3", data: { minutes: "121" }, expect: 10 },
  // 4.1 ไฟฟ้า (level 4)
  { id: "4.1", data: {}, expect: null },
  { id: "4.1", data: { level: "0" }, expect: 0 },
  { id: "4.1", data: { level: "1" }, expect: 4 },
  { id: "4.1", data: { level: "2" }, expect: 6 },
  { id: "4.1", data: { level: "3" }, expect: 8 },
  // 4.2 น้ำ (level 4)
  { id: "4.2", data: {}, expect: null },
  { id: "4.2", data: { level: "0" }, expect: 0 },
  { id: "4.2", data: { level: "1" }, expect: 4 },
  { id: "4.2", data: { level: "2" }, expect: 6 },
  { id: "4.2", data: { level: "3" }, expect: 8 },
  // 4.3 อินเทอร์เน็ต (level 4)
  { id: "4.3", data: {}, expect: null },
  { id: "4.3", data: { level: "0" }, expect: 0 },
  { id: "4.3", data: { level: "1" }, expect: 2 },
  { id: "4.3", data: { level: "2" }, expect: 3 },
  { id: "4.3", data: { level: "3" }, expect: 4 },
  // 5.1 ความมั่นคง (level 3)
  { id: "5.1", data: {}, expect: null },
  { id: "5.1", data: { level: "0" }, expect: 0 },
  { id: "5.1", data: { level: "1" }, expect: 3 },
  { id: "5.1", data: { level: "2" }, expect: 5 },
  // 5.2 ยาเสพติด (level 3)
  { id: "5.2", data: {}, expect: null },
  { id: "5.2", data: { level: "0" }, expect: 0 },
  { id: "5.2", data: { level: "1" }, expect: 3 },
  { id: "5.2", data: { level: "2" }, expect: 5 },
];

describe("scoreIndicator — boundary ทุกช่วงของทุกตัวชี้วัด", () => {
  for (const c of CASES) {
    const label = `${c.id} ${JSON.stringify(c.data)}${c.total ? ` @${c.total}` : ""} → ${c.expect}`;
    test(label, () => {
      assert.equal(scoreOf(c.id, c.data, c.total ?? "100"), c.expect);
    });
  }
});

// ───────────────────────── 3) Invariants ของเกณฑ์ (กันคะแนนเพี้ยนจากเพดาน) ─────────────────────────

describe("invariants — เพดานคะแนนและผลรวม", () => {
  test("ผลรวม max ของทุกตัวชี้วัด = 100", () => {
    const sum = INDICATOR_IDS.reduce((acc, id) => acc + INDICATORS[id].max, 0);
    assert.equal(sum, 100);
  });

  test("ตัวเลือก level ทุกตัว: คะแนนสูงสุด = max ของตัวชี้วัด และเรียงไม่ลด", () => {
    for (const id of INDICATOR_IDS) {
      const ind = INDICATORS[id];
      if (ind.kind !== "level") continue;
      const pts = ind.options.map((o) => o.points);
      assert.equal(Math.max(...pts), ind.max, `${id}: ตัวเลือกสูงสุดต้อง = max ${ind.max}`);
      for (let i = 1; i < pts.length; i++) {
        assert.ok(pts[i] >= pts[i - 1], `${id}: คะแนนตัวเลือกต้องเรียงไม่ลด`);
      }
    }
  });

  test("state ที่กรอกเต็มเพดานทุกด้าน → แต่ละตัวชี้วัด = max และรวม = 100", () => {
    const s = makeBlankState();
    s.unit.totalStudents = "100";
    const maxData: Record<IndicatorId, ResponseData> = {
      "1.1": { count: "100" }, "1.2": { count: "100" }, "1.3": { count: "100" }, "1.4": { langs: "5" },
      "2.1": { frame: "100", actual: "0" }, "2.2": { level: "3" }, "2.3": { rate: "100" },
      "3.1": { minutes: "999" }, "3.2": { level: "4" }, "3.3": { minutes: "999" },
      "4.1": { level: "3" }, "4.2": { level: "3" }, "4.3": { level: "3" },
      "5.1": { level: "2" }, "5.2": { level: "2" },
    };
    INDICATOR_IDS.forEach((id) => (s.responses[id] = maxData[id]));
    for (const id of INDICATOR_IDS) {
      assert.equal(scoreIndicator(id, s), INDICATORS[id].max, `${id} ควรได้เพดาน`);
    }
    assert.equal(totalScore(s), 100);
    assert.equal(answeredCount(s), INDICATOR_IDS.length);
  });

  test("state เปล่า → ทุกตัวชี้วัด null, รวม 0, answered 0", () => {
    const s = makeBlankState();
    for (const id of INDICATOR_IDS) assert.equal(scoreIndicator(id, s), null);
    assert.equal(totalScore(s), 0);
    assert.equal(answeredCount(s), 0);
  });
});

// ───────────────────────── 4) จุดตัดระดับ (levelFor) ─────────────────────────

describe("levelFor — จุดตัด 50/60/70", () => {
  const cases: [number, string][] = [
    [0, "neutral"], [49, "neutral"],
    [50, "level-1"], [59, "level-1"],
    [60, "level-2"], [69, "level-2"],
    [PASS_THRESHOLD, "level-3"], [70, "level-3"], [100, "level-3"],
  ];
  for (const [score, key] of cases) {
    test(`${score} → ${key}`, () => assert.equal(levelFor(score).key, key));
  }
});

// ───────────────────────── 5) ธงตรวจทาน (flags) + canSubmit ─────────────────────────

function fullValidState(): AssessmentState {
  // boundary-pass demo: กรอกครบ + หลักฐาน ready ทุกตัว (withEvidence) — เหลือแค่ลงนาม
  const s = makeDemoState("boundary-pass");
  s.signed = true;
  return s;
}

describe("flags — ธงบล็อก/เตือน", () => {
  test("V00: จำนวนกรอกมากกว่าผู้เรียนทั้งหมด → block", () => {
    const s = makeBlankState();
    s.unit.totalStudents = "100";
    s.responses["1.1"] = { count: "150" };
    const f = flags(s);
    const v00 = f.find((x) => x.code === "V00");
    assert.ok(v00, "ต้องมีธง V00");
    assert.equal(v00?.tone, "block");
  });

  test("V02: มีผู้เรียนพักนอนแต่ยังไม่แนบไฟล์หลักฐาน → block", () => {
    const s = makeBlankState();
    s.unit.totalStudents = "100";
    s.responses["1.2"] = { count: "5" }; // evidence.files ยังว่าง
    const v02 = flags(s).find((x) => x.code === "V02");
    assert.ok(v02);
    assert.equal(v02?.tone, "block");
  });

  test("V02: ready=true แต่ไม่มีไฟล์จริง → ยัง block (ไม่เชื่อ boolean จาก client)", () => {
    const s = makeBlankState();
    s.unit.totalStudents = "100";
    s.responses["1.2"] = { count: "5" };
    s.evidence["1.2"] = { ready: true, note: "", files: [] }; // ปลอม ready แต่ไม่มีไฟล์
    assert.ok(flags(s).find((x) => x.code === "V02"), "ready ปลอมต้องไม่ปลดล็อก V02");
  });

  test("V02: มีไฟล์หลักฐานจริง → ไม่มี block", () => {
    const s = makeBlankState();
    s.unit.totalStudents = "100";
    s.responses["1.2"] = { count: "5" };
    s.evidence["1.2"] = {
      ready: false,
      note: "",
      files: [{ id: "f1", originalName: "a.pdf", mimeType: "application/pdf", size: 1, sha256: "x", uploadedAt: "t" }],
    };
    assert.equal(flags(s).find((x) => x.code === "V02"), undefined, "มีไฟล์แล้วต้องไม่ติด V02");
  });

  test("V04: เข้าถึงยากระดับสูง (3.2≥3) แต่เดินทางจากเขต ≤30 นาที → warn", () => {
    const s = makeBlankState();
    s.responses["3.2"] = { level: "3" };
    s.responses["3.1"] = { minutes: "20" };
    const v04 = flags(s).find((x) => x.code === "V04");
    assert.ok(v04, "ต้องมีธง V04");
    assert.equal(v04?.tone, "warn");
  });

  test("V06: ไม่มีไฟฟ้าสาธารณะ (4.1∈{2,3}) แต่อินเทอร์เน็ตปกติ (4.3=0) → warn", () => {
    const s = makeBlankState();
    s.responses["4.1"] = { level: "2" };
    s.responses["4.3"] = { level: "0" };
    const v06 = flags(s).find((x) => x.code === "V06");
    assert.ok(v06, "ต้องมีธง V06");
    assert.equal(v06?.tone, "warn");
  });

  test("V07: ไม่มีสัญญาณสื่อสาร (4.3=3) → info", () => {
    const s = makeBlankState();
    s.responses["4.3"] = { level: "3" };
    const v07 = flags(s).find((x) => x.code === "V07");
    assert.ok(v07, "ต้องมีธง V07");
    assert.equal(v07?.tone, "info");
  });

  test("V09: คะแนนรวมแถบ 65-74 → info (ต้องตรวจภาคสนาม)", () => {
    const s = makeDemoState("boundary-pass"); // รวม 70
    const v09 = flags(s).find((x) => x.code === "V09");
    assert.ok(v09, "70 คะแนนต้องติดธง V09");
    assert.equal(v09?.tone, "info");
  });
});

describe("canSubmit — เงื่อนไขการยื่น", () => {
  test("ครบ + ลงนาม + ไม่มีธง block → ยื่นได้", () => {
    assert.equal(canSubmit(fullValidState()), true);
  });

  test("ยังไม่ลงนาม → ยื่นไม่ได้", () => {
    const s = fullValidState();
    s.signed = false;
    assert.equal(canSubmit(s), false);
  });

  test("มีธง block (V00) → ยื่นไม่ได้", () => {
    const s = fullValidState();
    s.responses["1.1"] = { count: "9999" }; // มากกว่า totalStudents → V00 block
    assert.equal(canSubmit(s), false);
  });

  test("unit ไม่ครบ → ยื่นไม่ได้ และ unitComplete = false", () => {
    const s = fullValidState();
    s.unit.province = "";
    assert.equal(unitComplete(s), false);
    assert.equal(canSubmit(s), false);
  });
});
