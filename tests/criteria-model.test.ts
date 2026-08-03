// ทดสอบตัวประเมินเกณฑ์แบบกำหนดค่าได้ (scripts/criteria-model.mjs) — ตัวที่ใช้ทดลองเกณฑ์ปี 2569
// ทดสอบทั้งสูตรให้คะแนน ด่านคัดกรอง การอ่านตัวแปรจากค่าดิบ และการตรวจโครงสร้างไฟล์ config

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  applyScore,
  evaluateGates,
  readVariable,
  scoreWithConfig,
  validateConfig,
  configMaxScore,
} from "../scripts/criteria-model.mjs";

test("สูตร linear ตัดที่ from และเต็มที่ to", () => {
  const spec = { kind: "linear", from: 500, to: 1500 };
  assert.equal(applyScore(spec, 400, 20), 0, "ต่ำกว่า from → 0");
  assert.equal(applyScore(spec, 500, 20), 0);
  assert.equal(applyScore(spec, 1000, 20), 10);
  assert.equal(applyScore(spec, 1500, 20), 20);
  assert.equal(applyScore(spec, 3000, 20), 20, "เกิน to ไม่เกินคะแนนเต็ม");
});

test("สูตร band ใช้ช่วงแรกที่ค่าไม่เกิน upTo", () => {
  const spec = {
    kind: "band",
    bands: [
      { upTo: 0, points: 0 },
      { upTo: 1, points: 6 },
      { upTo: 2, points: 11 },
    ],
    else: 18,
  };
  assert.equal(applyScore(spec, 0, 18), 0);
  assert.equal(applyScore(spec, 1, 18), 6);
  assert.equal(applyScore(spec, 2, 18), 11);
  assert.equal(applyScore(spec, 3, 18), 18, "เกินทุกช่วง → ใช้ else");
});

test("สูตร map และ binary", () => {
  const spec = { kind: "map", table: { "1": 6, "2": 5, "3": 3 }, else: 0 };
  assert.equal(applyScore(spec, 1, 6), 6);
  assert.equal(applyScore(spec, 3, 6), 3);
  assert.equal(applyScore(spec, 9, 6), 0, "ค่าที่ไม่มีในตาราง → else");
  assert.equal(applyScore({ kind: "binary", whenPositive: 5 }, 1, 5), 5);
  assert.equal(applyScore({ kind: "binary", whenPositive: 5 }, 0, 5), 0);
});

test("คะแนนถูกจำกัดไม่ให้เกิน max และไม่ติดลบ", () => {
  assert.equal(applyScore({ kind: "map", table: { "1": 99 } }, 1, 10), 10);
  assert.equal(applyScore({ kind: "map", table: { "1": -5 } }, 1, 10), 0);
});

test("ตัวแปร badRoadKm ถูกล้างเป็น 0 เมื่อตอบว่าไม่มีเส้นทางลำบาก", () => {
  assert.equal(readVariable("badRoadKm", { citeria04: 1, citeria041: 7.5 }), 7.5);
  assert.equal(readVariable("badRoadKm", { citeria04: 2, citeria041: 7.5 }), 0);
});

test("ดัชนีความขาดแคลนใช้ตัวเลือกที่ลำบากที่สุด ไม่ลงโทษโรงเรียนที่กรอกครบ", () => {
  // มีทั้งโซลาร์เซลล์ (1) และไฟฟ้าส่วนภูมิภาค (2) — เกณฑ์เดิมให้ 0 คะแนน แต่ดัชนีนี้ยังนับว่าขาดแคลน
  const row = { citeria07: "1", citeria08: "1,2", citeria09: "1", citeria10: "1,3" };
  assert.equal(readVariable("infraDeprivation", row), 4);
  const served = { citeria07: "6", citeria08: "2", citeria09: "4", citeria10: "4" };
  assert.equal(readVariable("infraDeprivation", served), 0);
});

test("ตัวแปรที่คำนวณจากจำนวนนักเรียนกันหารด้วยศูนย์", () => {
  assert.equal(readVariable("poorPct", { citeria13: 5, stu_sum: 0 }), 100);
  assert.equal(readVariable("ethnicPct", { stu_sum: 0 }, [{ hilltrib_number: 3 }]), 100);
  assert.equal(readVariable("ethnicPct", { stu_sum: 200 }, [{ hilltrib_number: 50 }]), 25);
  assert.equal(readVariable("ethnicGroups", {}, [{ hilltrib_number: 1 }, { hilltrib_number: 2 }]), 2);
});

test("ตัวแปรที่ไม่รู้จักต้องโยน error ไม่ใช่คืน 0 เงียบ ๆ", () => {
  assert.throws(() => readVariable("ไม่มีตัวแปรนี้", {}), /ไม่รู้จักตัวแปร/);
});

test("ด่านคัดกรองทำให้คะแนนที่มีผลเป็น 0 แต่ยังเก็บคะแนนดิบไว้ดู", () => {
  const config = {
    name: "ทดสอบ",
    fullScore: 10,
    levels: [
      { key: 3, min: 7 },
      { key: 0, min: 0 },
    ],
    gates: [{ id: "elev", label: "ความสูง ≥ 500 ม.", variable: "elevM", op: ">=", value: 500 }],
    items: [{ id: "X", variable: "poorPct", max: 10, score: { kind: "linear", from: 0, to: 50 } }],
  };
  const passed = scoreWithConfig(config, { citeria01: 800, citeria13: 50, stu_sum: 100 });
  assert.equal(passed.gate.passed, true);
  assert.equal(passed.total, 10);
  assert.equal(passed.effectiveTotal, 10);
  assert.equal(passed.level, 3);

  const blocked = scoreWithConfig(config, { citeria01: 200, citeria13: 50, stu_sum: 100 });
  assert.equal(blocked.gate.passed, false);
  assert.deepEqual(blocked.gate.failed, ["ความสูง ≥ 500 ม."]);
  assert.equal(blocked.total, 10, "คะแนนดิบยังคำนวณไว้เพื่อการวิเคราะห์");
  assert.equal(blocked.effectiveTotal, 0);
  assert.equal(blocked.level, 0);
});

test("validateConfig จับ id ซ้ำ ตัวแปรผิด และคะแนนรวมไม่ครบ 100", () => {
  const bad = {
    name: "ผิด",
    fullScore: 100,
    items: [
      { id: "A", variable: "elevM", max: 10, score: { kind: "linear", from: 0, to: 100 } },
      { id: "A", variable: "ไม่มีจริง", max: 10, score: { kind: "linear", from: 0, to: 100 } },
    ],
  };
  const errors = validateConfig(bad);
  assert.ok(errors.some((e) => e.includes("id ซ้ำ")));
  assert.ok(errors.some((e) => e.includes("ไม่รู้จักตัวแปร")));
  assert.ok(errors.some((e) => e.includes("ไม่เท่ากับ fullScore")));
});

test("ไฟล์ร่างเกณฑ์ที่ให้มาต้องผ่านการตรวจ และคะแนนเต็มรวมเป็น 100", () => {
  const dir = path.join(import.meta.dirname, "..", "scripts", "criteria");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 2, "ควรมีไฟล์ร่างอย่างน้อย 2 ชุดไว้เทียบกัน");
  for (const file of files) {
    const config = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    assert.deepEqual(validateConfig(config), [], `${file} ต้องไม่มีข้อผิดพลาด`);
    assert.equal(configMaxScore(config), 100, `${file} คะแนนเต็มรวมต้องเป็น 100`);
  }
});

test("ดัชนีความขาดแคลนต้องเป็นฟังก์ชันไม่ลดลง — กรอกข้อมูลจริงเพิ่มแล้วคะแนนต้องไม่ลด", () => {
  // คุณสมบัติที่เกณฑ์เดิมละเมิด: ข้อ 8 ให้โรงเรียนที่มีทั้งโซลาร์เซลล์และไฟฟ้าส่วนภูมิภาคได้ 0 คะแนน
  // เท่ากับโรงเรียนที่มีไฟฟ้าส่วนภูมิภาคอย่างเดียว ทั้งที่รายงานความขาดแคลนเพิ่มขึ้น
  const base = { citeria07: "6", citeria08: "2", citeria09: "4", citeria10: "4" };
  let prev = readVariable("infraDeprivation", base);
  assert.equal(prev, 0);

  // เพิ่มสัญญาณความขาดแคลนทีละอย่าง — ค่าต้องไม่ลดลงเลย
  const steps = [
    { ...base, citeria08: "1,2" }, // มีโซลาร์เซลล์ด้วย
    { ...base, citeria08: "1,2", citeria09: "1,4" }, // บางจุดไม่มีสัญญาณโทรศัพท์
    { ...base, citeria08: "1,2", citeria09: "1,4", citeria10: "1,4" }, // บางจุดไม่มีอินเทอร์เน็ต
    { ...base, citeria08: "1,2", citeria09: "1,4", citeria10: "1,4", citeria07: "1,6" }, // ใช้น้ำธรรมชาติด้วย
  ];
  for (const s of steps) {
    const v = readVariable("infraDeprivation", s);
    assert.ok(v >= prev, `ค่าต้องไม่ลดลง แต่ ${v} < ${prev}`);
    prev = v;
  }
  assert.equal(prev, 4, "ครบทั้ง 4 สัญญาณความขาดแคลน");
});

test("สูตร band และ linear ต้องไม่ลดลงเมื่อค่าเพิ่มขึ้น", () => {
  const band = {
    kind: "band",
    bands: [
      { upTo: 0, points: 0 },
      { upTo: 1, points: 6 },
      { upTo: 2, points: 11 },
    ],
    else: 18,
  };
  const linear = { kind: "linear", from: 300, to: 1350 };
  let prevBand = -1;
  let prevLinear = -1;
  for (let v = 0; v <= 1500; v += 25) {
    const b = applyScore(band, Math.min(v / 375, 4), 18);
    const l = applyScore(linear, v, 20);
    assert.ok(b >= prevBand, `band ลดลงที่ค่า ${v}`);
    assert.ok(l >= prevLinear, `linear ลดลงที่ค่า ${v}`);
    prevBand = b;
    prevLinear = l;
  }
});

test("ชุดเกณฑ์ที่ไม่มีด่านคัดกรองถือว่าผ่านเสมอ", () => {
  const { passed, failed } = evaluateGates({ gates: [] }, { citeria01: 0 });
  assert.equal(passed, true);
  assert.deepEqual(failed, []);
});
