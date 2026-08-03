// ตรรกะคะแนน "เกณฑ์เดิม" ถอดมาเป็น JavaScript เพื่อคำนวณย้อนหลังจากค่าดิบ
// ต้นทาง: newhighland/app/Services/ScoreService.php และ IslandScoreService.php
// เรคคอร์ดอ้างอิงที่ใช้ยืนยันความถูกต้อง (ดู tests/legacy-score.test.ts):
//   พื้นที่สูง sc_id=1063020130 acadyears=2567 → 68.14
//   พื้นที่เกาะ sc_id=1091560035 acadyears=2568 → 71.38

export const num = (x) => (x === null || x === undefined || x === "" ? 0 : Number(x) || 0);
export const r2 = (x) => Math.round(x * 100) / 100;

export const maxOfCsv = (csv) =>
  String(csv ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10) || 0)
    .reduce((m, x) => (x > m ? x : m), 0);

const map = (k, t) => t[k] ?? 0;

/** สูตรข้อ 1 ของรอบ 2565 — เชิงเส้น 0–600 ม. ไม่มีคะแนนฐาน */
export const elevLinear600 = (c) => r2((Math.min(c, 600) * 30) / 600);
/** สูตรข้อ 1 ของรอบ 2566 เป็นต้นมา — คะแนนฐาน 15 เมื่อผ่านด่าน แล้วเพิ่มถึงเพดาน 500 ม. */
export const elevBase15 = (c, avg) => (c >= 500 || c >= avg ? r2(15 + (Math.min(c, 500) * 15) / 500) : 0);

/**
 * คิดคะแนนพื้นที่สูง 16 ข้อ (เต็ม 100)
 * @param {object} v แถวจาก highland_eval
 * @param {Array<{hilltrib_number:number}>} hillRows แถวจาก highland_eval_hilltrib ของ (sc_id, acadyears) เดียวกัน
 */
export function calcHighland(v, hillRows = []) {
  const o = {};
  const stuSum = Math.max(1, num(v.stu_sum));
  o.score01 = elevBase15(num(v.citeria01), num(v.average_height));
  o.score02 = map(num(v.citeria02), { 1: 5, 2: 4, 3: 3, 4: 2, 5: 0 });
  o.score03 = map(num(v.citeria03), { 1: 5, 2: 4, 3: 3, 4: 0 });
  let c041 = num(v.citeria041);
  if (num(v.citeria04) === 2) c041 = 0;
  o.score04 = r2(Math.min(c041, 5));
  o.score05 = r2((Math.min(num(v.citeria05), 80) * 5) / 80);
  o.score06 = map(num(v.citeria06), { 1: 5, 2: 4, 3: 3, 4: 1, 5: 1 });
  o.score07 = map(maxOfCsv(v.citeria07), { 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1 });
  o.score08 = map(maxOfCsv(v.citeria08), { 1: 3, 2: 0 });
  o.score09 = map(maxOfCsv(v.citeria09), { 1: 3, 2: 2, 3: 1, 4: 0 });
  o.score10 = map(maxOfCsv(v.citeria10), { 1: 3, 2: 2, 3: 1, 4: 0 });

  const sumHill = hillRows.reduce((s, r) => s + num(r.hilltrib_number), 0);
  const pct11 = Math.min((sumHill * 100) / stuSum, 100);
  o.pct11 = r2(pct11);
  o.score11 = r2((pct11 * 5) / 100);
  o.groups12 = hillRows.length;
  o.score12 = r2(Math.min(hillRows.length, 5));

  const pct13 = Math.min((num(v.citeria13) * 100) / stuSum, 50);
  o.pct13 = r2(pct13);
  o.score13 = r2((pct13 * 5) / 50);
  o.score14 = r2((Math.min(num(v.citeria14), 50) * 5) / 50);
  o.score15 = map(Math.min(num(v.citeria15), 3), { 1: 3, 2: 4, 3: 5 });
  o.score16 = map(num(v.citeria16), { 1: 5, 2: 0 });

  o.sum_score = r2(
    Object.keys(o)
      .filter((k) => k.startsWith("score"))
      .reduce((s, k) => s + o[k], 0),
  );
  o.highland_type = o.sum_score >= 70 ? 3 : o.sum_score >= 60 ? 2 : o.sum_score >= 50 ? 1 : 0;
  return o;
}

/** คิดคะแนนพื้นที่เกาะ 15 ข้อ (เต็ม 100 — ข้อ 1 เป็นด่านคัดกรอง ไม่คิดคะแนน) */
export function calcIsland(v) {
  const o = {};
  const stuSum = Math.max(1, num(v.stu_sum));
  o.score01 = 0;
  o.score02 = map(num(v.citeria02), { 1: 10, 2: 8, 3: 6, 4: 4 });
  o.score03 = map(num(v.citeria03), { 1: 16, 2: 0 });
  o.score04 = map(num(v.citeria04), { 1: 20, 2: 15, 3: 10, 4: 5, 5: 0 });
  o.score05 = r2((Math.min(num(v.citeria05), 20) * 5) / 20);
  o.score06 = r2((Math.min(num(v.citeria06), 20) * 5) / 20);
  o.score07 = r2((Math.min(num(v.citeria07), 60) * 5) / 60);
  o.score08 = r2((Math.min(num(v.citeria08), 500) * 5) / 500);
  o.score09 = map(num(v.citeria09), { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 });
  o.score10 = map(num(v.citeria10), { 1: 5, 2: 0 });
  o.score11 = map(num(v.citeria11), { 1: 10, 2: 8, 3: 6, 4: 4, 5: 2, 6: 0 });
  o.score12 = map(num(v.citeria12), { 1: 5, 2: 4, 3: 3, 4: 2 });
  o.score13 = map(num(v.citeria13), { 1: 5, 2: 4, 3: 3, 4: 2 });
  o.score14 = map(num(v.citeria14), { 1: 2, 2: 0 });
  o.score15 = r2((Math.min((num(v.citeria15) * 100) / stuSum, 50) * 2) / 50);

  o.sum_score = r2(
    Object.keys(o)
      .filter((k) => k.startsWith("score"))
      .reduce((s, k) => s + o[k], 0),
  );
  o.island_type = o.sum_score >= 70 ? 3 : o.sum_score >= 60 ? 2 : o.sum_score >= 50 ? 1 : 0;
  return o;
}
