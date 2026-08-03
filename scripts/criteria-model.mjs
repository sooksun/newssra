// ตัวประเมิน "เกณฑ์ที่เสนอ" แบบกำหนดค่าได้ — ใช้ทดลองเกณฑ์ปี 2569 กับข้อมูลจริงก่อนตัดสินใจ
//
// แนวคิด: เกณฑ์หนึ่งชุด = ไฟล์ JSON ที่ประกอบด้วย "ด่านคัดกรอง" (gates) + "ตัวชี้วัดที่ให้คะแนน" (items)
// ทุกตัวชี้วัดอ้างถึง **ตัวแปรที่มีชื่อ** ซึ่งดึงจากค่าดิบของแบบประเมินเดิม (ดู VARIABLES ด้านล่าง)
// จงใจไม่ทำภาษาสูตรแบบ eval — ตัวแปรมีรายการตายตัว ตรวจสอบได้ว่าค่ามาจากคอลัมน์ไหน
//
// ไฟล์นี้เป็น pure function ทั้งหมด (ทดสอบใน tests/criteria-model.test.ts)

import { num, r2, maxOfCsv } from "./legacy-score.mjs";

const minOfCsv = (csv) => {
  const ids = String(csv ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((x) => x > 0);
  return ids.length ? Math.min(...ids) : 0;
};

/**
 * ตัวแปรที่เกณฑ์อ้างถึงได้ — คีย์คือชื่อที่ใช้ในไฟล์ config, ค่าคือฟังก์ชันดึงจากแถวข้อมูลเดิม
 * `hill` = แถว highland_eval_hilltrib ของโรงเรียนนั้น
 */
export const VARIABLES = {
  /** จำนวนนักเรียนทั้งหมด (stu_sum) */
  students: (r) => num(r.stu_sum),
  /** ความสูง ณ จุดสูงสุดของเส้นทาง (เมตร) — citeria01 */
  elevM: (r) => num(r.citeria01),
  /** ความสูงเฉลี่ยของเส้นทาง (เมตร) — average_height */
  avgElevM: (r) => num(r.average_height),
  /** ระยะทางถึงศาลากลางจังหวัด (กม.) — citeria05 */
  distanceKm: (r) => num(r.citeria05),
  /** ระยะทางช่วงที่รถขับเคลื่อนสองล้อไปไม่ได้ (กม.) — citeria041 (ล้างเป็น 0 ถ้า citeria04=2) */
  badRoadKm: (r) => (num(r.citeria04) === 2 ? 0 : num(r.citeria041)),
  /** ระดับความใกล้ชายแดน 1=หมู่บ้านติดชายแดน … 5=ไม่ติด — citeria02 */
  borderLevel: (r) => num(r.citeria02),
  /** ระดับ อปท. 1=อบต. … 4=เทศบาลนคร — citeria03 */
  lgoLevel: (r) => num(r.citeria03),
  /** ระดับขนส่งสาธารณะ 1=ไม่มีรถประจำทาง … 5=เกิน 6 เที่ยว/วัน — citeria06 */
  transitLevel: (r) => num(r.citeria06),

  /** ตัวเลือกสาธารณูปโภค — MinId = ตัวเลือกที่ "ลำบากที่สุด" ที่โรงเรียนเลือกไว้ (id น้อย = ลำบากกว่า) */
  waterMinId: (r) => minOfCsv(r.citeria07),
  waterMaxId: (r) => maxOfCsv(r.citeria07),
  powerMinId: (r) => minOfCsv(r.citeria08),
  powerMaxId: (r) => maxOfCsv(r.citeria08),
  phoneMinId: (r) => minOfCsv(r.citeria09),
  phoneMaxId: (r) => maxOfCsv(r.citeria09),
  netMinId: (r) => minOfCsv(r.citeria10),
  netMaxId: (r) => maxOfCsv(r.citeria10),

  /**
   * ดัชนีความขาดแคลนโครงสร้างพื้นฐาน 0–4 — นับจำนวนสัญญาณขาดแคลนที่โรงเรียนรายงาน
   * (น้ำไม่ใช่ประปา · ต้องพึ่งไฟฟ้าทางเลือก · ไม่มีสัญญาณโทรศัพท์ · ไม่มีอินเทอร์เน็ต)
   * ใช้ค่า "ลำบากที่สุดที่เลือกไว้" จึงไม่ลงโทษโรงเรียนที่กรอกครบตามจริง
   */
  infraDeprivation: (r) => {
    let k = 0;
    const w = minOfCsv(r.citeria07);
    if (w >= 1 && w <= 3) k++;
    if (minOfCsv(r.citeria08) === 1) k++;
    if (minOfCsv(r.citeria09) === 1) k++;
    if (minOfCsv(r.citeria10) === 1) k++;
    return k;
  },

  /**
   * ความรุนแรงของการขาดแคลนโครงสร้างพื้นฐาน 0–10 — ถ่วงน้ำหนักตามระดับความขาดแคลน
   * ต่างจาก infraDeprivation ที่นับเป็นจำนวนด้าน (ซึ่งกระจุกที่ค่า 1 เพราะ 91.5% ใช้น้ำที่ไม่ใช่ประปา)
   *   น้ำ  ธรรมชาติล้วน = 2 · บ่อ/สระ/บาดาล = 1 · ประปา = 0
   *   ไฟ   ต้องพึ่งพลังงานทางเลือก = 2
   *   โทร  ไม่มีสัญญาณ = 3 · ได้เฉพาะดาวเทียม = 2 · มือถือ = 1
   *   เน็ต ไม่มีเครือข่าย = 3 · ได้เฉพาะดาวเทียม = 2 · ไร้สาย = 1
   */
  infraSeverity: (r) => {
    const w = minOfCsv(r.citeria07);
    const p = minOfCsv(r.citeria08);
    const t = minOfCsv(r.citeria09);
    const i = minOfCsv(r.citeria10);
    let s = 0;
    if (w === 1) s += 2;
    else if (w === 2 || w === 3) s += 1;
    if (p === 1) s += 2;
    if (t === 1) s += 3;
    else if (t === 2) s += 2;
    else if (t === 3) s += 1;
    if (i === 1) s += 3;
    else if (i === 2) s += 2;
    else if (i === 3) s += 1;
    return s;
  },

  /**
   * ความรุนแรงของอุปสรรคการเดินทาง 0–8 — รวมสามสัญญาณที่เกณฑ์เดิมแยกกันจนแต่ละข้อพื้นตัน/เพดานตัน
   *   ถนนที่รถสองล้อไปไม่ได้  >5 กม. = 3 · 2–5 = 2 · >0 = 1
   *   ขนส่งสาธารณะ            ไม่มีรถประจำทาง = 2 · ≤2 เที่ยว/วัน = 1
   *   ระยะทางถึงศาลากลาง      ≥184 กม. (P90) = 3 · ≥146 (P75) = 2 · ≥106 (P50) = 1
   */
  accessSeverity: (r) => {
    const road = num(r.citeria04) === 2 ? 0 : num(r.citeria041);
    const transit = num(r.citeria06);
    const dist = num(r.citeria05);
    let s = 0;
    if (road > 5) s += 3;
    else if (road >= 2) s += 2;
    else if (road > 0) s += 1;
    if (transit === 1) s += 2;
    else if (transit === 2) s += 1;
    if (dist >= 184) s += 3;
    else if (dist >= 146) s += 2;
    else if (dist >= 106) s += 1;
    return s;
  },

  /** ร้อยละนักเรียนกลุ่มชาติพันธุ์ (จาก highland_eval_hilltrib) */
  ethnicPct: (r, hill) => {
    const stu = Math.max(1, num(r.stu_sum));
    const sum = hill.reduce((s, h) => s + num(h.hilltrib_number), 0);
    return Math.min((sum * 100) / stu, 100);
  },
  /** จำนวนกลุ่มชาติพันธุ์ */
  ethnicGroups: (_r, hill) => hill.length,
  /** จำนวนนักเรียนยากจน/ยากจนพิเศษ — citeria13 */
  poorCount: (r) => num(r.citeria13),
  /** ร้อยละนักเรียนยากจนต่อนักเรียนทั้งหมด */
  poorPct: (r) => Math.min((num(r.citeria13) * 100) / Math.max(1, num(r.stu_sum)), 100),
  /** จำนวนนักเรียนพักนอน — citeria14 */
  boardingCount: (r) => num(r.citeria14),
  /** ร้อยละนักเรียนพักนอน */
  boardingPct: (r) => Math.min((num(r.citeria14) * 100) / Math.max(1, num(r.stu_sum)), 100),
  /** จำนวนโรงเรียนสาขา/ห้องเรียนสาขา — citeria15 */
  branches: (r) => num(r.citeria15),
  /** เป็นพื้นที่พิเศษตามประกาศกระทรวงการคลัง (1 = ใช่) — citeria16 */
  treasurySpecial: (r) => (num(r.citeria16) === 1 ? 1 : 0),
};

export function readVariable(name, row, hill = []) {
  const fn = VARIABLES[name];
  if (!fn) throw new Error(`ไม่รู้จักตัวแปร "${name}" — ดูรายการใน scripts/criteria-model.mjs`);
  return fn(row, hill);
}

/* ------------------------------ สูตรให้คะแนน ------------------------------ */

/**
 * แปลงค่าตัวแปรเป็นคะแนน
 *  linear  {from, to}          — ต่ำกว่า from = 0, ตั้งแต่ to ขึ้นไป = เต็ม, ระหว่างนั้นไล่ระดับ
 *  band    {bands:[{upTo,points}], else}  — ไล่จากช่วงล่างขึ้นบน (upTo = ค่าสูงสุดของช่วง)
 *  map     {table:{"1":5,...}}  — จับคู่ค่าจำนวนเต็มกับคะแนนตรง ๆ
 *  binary  {whenPositive}       — ค่ามากกว่า 0 ได้คะแนนนี้ ไม่งั้น 0
 */
export function applyScore(spec, value, max) {
  let pts = 0;
  switch (spec.kind) {
    case "linear": {
      const { from = 0, to } = spec;
      if (to === undefined || to === from) throw new Error('สูตร "linear" ต้องระบุ to ที่ต่างจาก from');
      const t = (value - from) / (to - from);
      pts = Math.max(0, Math.min(1, t)) * max;
      break;
    }
    case "band": {
      const bands = spec.bands ?? [];
      pts = spec.else ?? 0;
      for (const b of bands) {
        if (value <= b.upTo) {
          pts = b.points;
          break;
        }
      }
      break;
    }
    case "map": {
      pts = spec.table?.[String(Math.round(value))] ?? spec.else ?? 0;
      break;
    }
    case "binary": {
      pts = value > 0 ? (spec.whenPositive ?? max) : 0;
      break;
    }
    default:
      throw new Error(`ไม่รู้จักสูตร "${spec.kind}"`);
  }
  return r2(Math.max(0, Math.min(max, pts)));
}

/** ตรวจด่านคัดกรอง — คืน {passed, failed:[ชื่อด่านที่ไม่ผ่าน]} */
export function evaluateGates(config, row, hill = []) {
  const failed = [];
  for (const g of config.gates ?? []) {
    const v = readVariable(g.variable, row, hill);
    const ref = g.value;
    const ok =
      g.op === ">=" ? v >= ref : g.op === ">" ? v > ref : g.op === "<=" ? v <= ref : g.op === "<" ? v < ref : v === ref;
    const anyOf = g.orVariable ? readVariable(g.orVariable, row, hill) >= (g.orValue ?? 0) : false;
    if (!ok && !anyOf) failed.push(g.label ?? g.id);
  }
  return { passed: failed.length === 0, failed };
}

/**
 * ให้คะแนนโรงเรียนหนึ่งแห่งตามชุดเกณฑ์ที่กำหนด
 * `total` = คะแนนดิบ (คำนวณไว้ดูเสมอ) · `effectiveTotal` = คะแนนที่มีผลจริง (เป็น 0 ถ้าไม่ผ่านด่าน)
 * @returns {{scores: Record<string,number>, total: number, effectiveTotal: number, level: number, gate: {passed:boolean, failed:string[]}}}
 */
export function scoreWithConfig(config, row, hill = []) {
  const gate = evaluateGates(config, row, hill);
  const scores = {};
  let total = 0;
  for (const item of config.items) {
    const value = readVariable(item.variable, row, hill);
    const s = applyScore(item.score, value, item.max);
    scores[item.id] = s;
    total += s;
  }
  total = r2(total);
  const effective = gate.passed ? total : 0;
  const levels = config.levels ?? [];
  let level = 0;
  for (const l of levels) {
    if (effective >= l.min) {
      level = l.key;
      break;
    }
  }
  return { scores, total, effectiveTotal: effective, level, gate };
}

/** ผลรวมคะแนนเต็มของชุดเกณฑ์ — ใช้ตรวจว่าน้ำหนักรวมเป็น 100 จริง */
export function configMaxScore(config) {
  return config.items.reduce((s, i) => s + i.max, 0);
}

/** ตรวจความถูกต้องเชิงโครงสร้างของไฟล์ config ก่อนนำไปรัน */
export function validateConfig(config) {
  const errors = [];
  if (!config.name) errors.push("ต้องมี name");
  if (!Array.isArray(config.items) || !config.items.length) errors.push("ต้องมี items อย่างน้อย 1 ข้อ");
  const ids = new Set();
  for (const it of config.items ?? []) {
    if (!it.id) errors.push("ทุก item ต้องมี id");
    if (ids.has(it.id)) errors.push(`id ซ้ำ: ${it.id}`);
    ids.add(it.id);
    if (!VARIABLES[it.variable]) errors.push(`${it.id}: ไม่รู้จักตัวแปร "${it.variable}"`);
    if (!(it.max > 0)) errors.push(`${it.id}: max ต้องมากกว่า 0`);
    if (!it.score?.kind) errors.push(`${it.id}: ต้องระบุ score.kind`);
  }
  for (const g of config.gates ?? []) {
    if (!VARIABLES[g.variable]) errors.push(`gate ${g.id}: ไม่รู้จักตัวแปร "${g.variable}"`);
    if (g.orVariable && !VARIABLES[g.orVariable]) errors.push(`gate ${g.id}: ไม่รู้จักตัวแปร "${g.orVariable}"`);
  }
  const max = configMaxScore(config);
  if (Math.abs(max - (config.fullScore ?? 100)) > 0.01) {
    errors.push(`คะแนนเต็มรวม ${max} ไม่เท่ากับ fullScore ${config.fullScore ?? 100}`);
  }
  return errors;
}
