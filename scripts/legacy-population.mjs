// ประกอบ "ประชากรที่ใช้วิเคราะห์" จากฐานเดิม — ใช้ร่วมกันหลายสคริปต์ให้ได้ชุดข้อมูลเดียวกันเสมอ
//
// นิยาม: รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะโรงเรียนที่ยืนยันสถานะปี 2569
//        (school_confirm.area_type = 1 พื้นที่สูง · 2 พื้นที่เกาะ)
// ตาราง highland_eval_hilltrib ผูกกับ (sc_id, acadyears) — ถ้ารอบล่าสุดไม่มีแถว จะย้อนไปใช้รอบที่มีข้อมูลล่าสุด

import { connectLegacy, describeSource } from "./legacy-db.mjs";
import { num } from "./legacy-score.mjs";

export async function loadLegacyPopulation({ areaType = 1 } = {}) {
  const { conn, cfg } = await connectLegacy();
  const source = await describeSource(conn, cfg);

  const table = areaType === 2 ? "island_eval" : "highland_eval";
  const [evalRows] = await conn.query(`SELECT * FROM ${table}`);
  const [hillRows] = areaType === 1 ? await conn.query("SELECT * FROM highland_eval_hilltrib") : [[]];
  const [confirmRows] = await conn.query(
    "SELECT sc_id FROM school_confirm WHERE acadyears = 2569 AND area_type = ?",
    [areaType],
  );
  const [schoolRows] = await conn.query("SELECT sc_id, provinces FROM master_school");
  await conn.end();

  const hillBy = new Map();
  for (const h of hillRows) {
    const k = `${h.sc_id}|${h.acadyears}`;
    if (!hillBy.has(k)) hillBy.set(k, []);
    hillBy.get(k).push(h);
  }
  const hillYears = new Map();
  for (const k of hillBy.keys()) {
    const [sc, y] = k.split("|");
    if (!hillYears.has(sc)) hillYears.set(sc, []);
    hillYears.get(sc).push(Number(y));
  }
  const hilltribFor = (sc, y) =>
    hillBy.get(`${sc}|${y}`) ??
    hillBy.get(`${sc}|${(hillYears.get(String(sc)) ?? []).sort((a, b) => b - a)[0]}`) ??
    [];

  const latest = new Map();
  for (const r of evalRows) {
    const k = String(r.sc_id);
    if (!latest.has(k) || num(r.acadyears) > num(latest.get(k).acadyears)) latest.set(k, r);
  }
  const confirmed = new Set(confirmRows.map((c) => String(c.sc_id)));
  const rows = [...latest.values()]
    .filter((r) => confirmed.has(String(r.sc_id)))
    .map((r) => ({ row: r, hill: hilltribFor(r.sc_id, r.acadyears) }));

  return {
    source,
    cfg,
    rows,
    provinceOf: new Map(schoolRows.map((s) => [String(s.sc_id), String(s.provinces || "").trim()])),
    counts: { allRows: evalRows.length, schools: latest.size, analysed: rows.length },
    rule:
      `รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะที่ยืนยันสถานะปี 2569 (school_confirm.area_type=${areaType})`,
  };
}
