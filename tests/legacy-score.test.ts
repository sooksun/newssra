// ยืนยันว่าการถอดสูตร "เกณฑ์เดิม" มาเป็น JavaScript ให้ผลตรงกับเรคคอร์ดจริงในฐาน ssrainfo_ssra
// (ค่าดิบด้านล่างคัดลอกมาจากฐานข้อมูลจริง — เป็นคู่เดียวกับที่ระบบ newhighland ใช้ตรวจสอบ ScoreService)

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcHighland, calcIsland, elevLinear600, elevBase15, maxOfCsv } from "../scripts/legacy-score.mjs";

test("พื้นที่สูง sc_id=1063020130 acadyears=2567 ได้ 68.14 คะแนน ระดับ 2", () => {
  const row = {
    stu_sum: 169,
    citeria01: 500,
    average_height: 258,
    citeria02: 3,
    citeria03: 1,
    citeria04: 2,
    citeria041: 0,
    citeria05: 136,
    citeria06: 1,
    citeria07: "1,2,3",
    citeria08: "2",
    citeria09: "3",
    citeria10: "3,4",
    citeria13: 53,
    citeria14: 0,
    citeria15: 0,
    citeria16: 1,
  };
  const hilltrib = [{ hilltrib_number: 153 }, { hilltrib_number: 16 }];
  const out = calcHighland(row, hilltrib);

  assert.equal(out.sum_score, 68.14);
  assert.equal(out.highland_type, 2);
  // ตรวจรายข้อที่เป็นจุดเสี่ยงของการถอดสูตร
  assert.equal(out.score01, 30, "ผ่านด่าน 500 ม. → คะแนนฐาน 15 + เต็มเพดาน");
  assert.equal(out.score05, 5, "ระยะทาง 136 กม. เกินเพดาน 80 กม.");
  assert.equal(out.score07, 4, "แหล่งน้ำเลือก 1,2,3 → คิดจาก id สูงสุด = 3");
  assert.equal(out.score10, 0, "อินเทอร์เน็ตเลือก 3,4 → คิดจาก id สูงสุด = 4");
  assert.equal(out.score11, 5, "นักเรียนชาติพันธุ์ 169/169 = 100%");
  assert.equal(out.score12, 2, "2 กลุ่มชาติพันธุ์");
  assert.equal(out.score13, 3.14, "ยากจน 53/169 = 31.36% ของเพดาน 50%");
});

test("พื้นที่เกาะ sc_id=1091560035 acadyears=2568 ได้ 71.38 คะแนน ระดับ 3", () => {
  const row = {
    stu_sum: 76,
    citeria02: 1,
    citeria03: 1,
    citeria04: 2,
    citeria05: 10.52,
    citeria06: 8.01,
    citeria07: 45,
    citeria08: 100,
    citeria09: 2,
    citeria10: 2,
    citeria11: 2,
    citeria12: 4,
    citeria13: 3,
    citeria14: 1,
    citeria15: 54,
  };
  const out = calcIsland(row);

  assert.equal(out.sum_score, 71.38);
  assert.equal(out.island_type, 3);
  assert.equal(out.score01, 0, "ข้อ 1 เป็นด่านคัดกรอง ไม่คิดคะแนน");
  assert.equal(out.score10, 0, "ไฟฟ้าส่วนภูมิภาค = 0 คะแนน");
  assert.equal(out.score15, 2, "ยากจน 54/76 = 71% เกินเพดาน 50% → เต็ม 2");
});

test("ข้อ 4 ตอบว่าไม่มีเส้นทางลำบาก ต้องล้างระยะทางเป็น 0", () => {
  const base = { stu_sum: 100, citeria041: 4.5 };
  assert.equal(calcHighland({ ...base, citeria04: 1 }).score04, 4.5);
  assert.equal(calcHighland({ ...base, citeria04: 2 }).score04, 0);
});

test("สูตรความสูงสองรุ่นให้ผลต่างกันในช่วง 500–600 เมตร", () => {
  // รุ่น 2565 เชิงเส้น 0–600
  assert.equal(elevLinear600(300), 15);
  assert.equal(elevLinear600(600), 30);
  assert.equal(elevLinear600(1200), 30);
  // รุ่น 2566+ คะแนนฐาน 15 เพดาน 500
  assert.equal(elevBase15(500, 0), 30);
  assert.equal(elevBase15(1200, 0), 30, "ตันที่เพดาน 500 ม. — สูงกว่านั้นไม่ได้เพิ่ม");
  assert.equal(elevBase15(300, 400), 0, "ต่ำกว่า 500 ม. และต่ำกว่าค่าเฉลี่ย → ไม่ผ่านด่าน");
  assert.equal(elevBase15(300, 200), 24, "ต่ำกว่า 500 ม. แต่สูงกว่าค่าเฉลี่ย → ผ่านด่าน");
  // ช่วงที่ทำให้คะแนนสองรุ่นต่างกันมากที่สุด
  assert.equal(elevLinear600(500), 25);
  assert.equal(elevBase15(500, 0), 30);
});

test("ข้อที่เลือกได้หลายตัวเลือกคิดจาก id สูงสุดเสมอ", () => {
  assert.equal(maxOfCsv("1,2,3"), 3);
  assert.equal(maxOfCsv("4"), 4);
  assert.equal(maxOfCsv(""), 0);
  assert.equal(maxOfCsv(" 2 , 6 "), 6);
});
