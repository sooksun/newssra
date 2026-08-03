// วิเคราะห์ข้อมูลการประเมินเดิม (ssrainfo_ssra) แบบ "รายข้อ" เพื่อใช้กำหนดเกณฑ์ปี 2569
//
//   node scripts/analyze-legacy-items.mjs            → เขียน docs/analysis/legacy-item-stats.json
//   node scripts/analyze-legacy-items.mjs --print    → พิมพ์สรุปย่อทางหน้าจอด้วย
//
// แหล่งข้อมูล: .env.newssra (ฐานจริง) ถ้าไม่มีจะใช้ snapshot ในเครื่อง — ดู scripts/legacy-db.mjs
// สคริปต์นี้ "อ่านอย่างเดียว" ไม่มีคำสั่งเขียนฐานข้อมูลเดิม

import fs from "node:fs";
import path from "node:path";
import { connectLegacy, describeSource } from "./legacy-db.mjs";
import { HIGHLAND_ITEMS, ISLAND_ITEMS, GROUPS, LEVELS, levelOf } from "./legacy-items.mjs";
import { calcHighland, calcIsland, elevLinear600, elevBase15, num, r2 } from "./legacy-score.mjs";
import { MEASURE_TYPES, HIGHLAND_MEASURES, ISLAND_MEASURES, ORIGIN_LABELS } from "./legacy-measures.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "analysis");
const PASS = 70;

/* ------------------------------ สถิติพื้นฐาน ------------------------------ */


function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function pct(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * (p / 100);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num0 = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num0 += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num0 / Math.sqrt(da * db) : 0;
}
function describe(a) {
  return {
    n: a.length,
    mean: r2(mean(a)),
    sd: r2(sd(a)),
    min: a.length ? r2(Math.min(...a)) : 0,
    p10: r2(pct(a, 10)),
    p25: r2(pct(a, 25)),
    p50: r2(pct(a, 50)),
    p75: r2(pct(a, 75)),
    p90: r2(pct(a, 90)),
    max: a.length ? r2(Math.max(...a)) : 0,
  };
}
function histogram(values, edges) {
  const bins = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], n: 0 }));
  for (const v of values) {
    for (let i = 0; i < bins.length; i++) {
      const last = i === bins.length - 1;
      if (v >= bins[i].lo && (last ? v <= bins[i].hi : v < bins[i].hi)) {
        bins[i].n++;
        break;
      }
    }
  }
  return bins;
}

/* ------------------------------ วิเคราะห์รายข้อ ------------------------------ */

function analyzeItem(item, rows, totals) {
  const n = rows.length;
  const scores = rows.map((r) => num(r.__score[item.scoreKey]));
  const rest = rows.map((_, i) => totals[i] - scores[i]);

  const out = {
    no: item.no,
    key: item.key,
    title: item.title,
    short: item.short,
    unit: item.unit ?? null,
    kind: item.kind,
    max: item.max,
    group: item.group,
    groupLabel: GROUPS[item.group].label,
    rule: item.rule ?? null,
    note: item.note ?? null,
    n,
  };

  // การกระจายของคะแนน
  out.score = describe(scores);
  out.score.share = item.max ? r2((mean(scores) / item.max) * 100) : 0;
  out.score.contribution = r2(mean(scores)); // คะแนนเฉลี่ยที่ข้อนี้ป้อนเข้าคะแนนรวม 100
  out.score.zeroPct = r2((scores.filter((s) => s === 0).length / n) * 100);
  out.score.fullPct = item.max ? r2((scores.filter((s) => s >= item.max - 0.001).length / n) * 100) : 0;
  out.score.distinctValues = new Set(scores.map((s) => r2(s))).size;

  // อำนาจจำแนก
  out.discrimination = {
    itemRestCorr: r2(pearson(scores, rest)),
    itemTotalCorr: r2(pearson(scores, totals)),
  };
  const order = rows.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
  const k = Math.max(1, Math.round(n * 0.27));
  const top = order.slice(0, k).map((i) => scores[i]);
  const bottom = order.slice(-k).map((i) => scores[i]);
  out.discrimination.upperMean = r2(mean(top));
  out.discrimination.lowerMean = r2(mean(bottom));
  out.discrimination.D = item.max ? r2((mean(top) - mean(bottom)) / item.max) : 0;

  // ผลต่อการผ่านจุดตัด — ถ้าตัดข้อนี้ทิ้งแล้วปรับสเกลกลับเป็น 100
  const passNow = totals.filter((t) => t >= PASS).length;
  const scale = item.max < 100 ? 100 / (100 - item.max) : 0;
  const passWithout = rest.filter((t) => t * scale >= PASS).length;
  let flips = 0;
  for (let i = 0; i < n; i++) {
    const a = totals[i] >= PASS;
    const b = rest[i] * scale >= PASS;
    if (a !== b) flips++;
  }
  out.impact = {
    passNow,
    passRateNow: r2((passNow / n) * 100),
    passWithoutItem: passWithout,
    passRateWithoutItem: r2((passWithout / n) * 100),
    flips,
    flipPct: r2((flips / n) * 100),
  };

  // การกระจายของค่าดิบ
  if (item.kind === "numeric") {
    const raw = rows.map((r) => num(r[item.key]));
    out.value = describe(raw);
    out.value.zeroPct = r2((raw.filter((v) => v === 0).length / n) * 100);
    if (item.cap) {
      out.value.atOrAboveCapPct = r2((raw.filter((v) => v >= item.cap).length / n) * 100);
    }
    const hi = Math.max(...raw, 1);
    const edges = [];
    const step = hi / 12;
    for (let i = 0; i <= 12; i++) edges.push(r2(i * step));
    out.value.histogram = histogram(raw, edges);
  } else {
    const counts = new Map();
    let blank = 0;
    let multiCount = [];
    for (const r of rows) {
      const raw = String(r[item.key] ?? "").trim();
      if (raw === "" || raw === "0") {
        blank++;
        continue;
      }
      const ids = item.kind === "multi" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [raw];
      if (item.kind === "multi") multiCount.push(ids.length);
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    out.value = {
      blank,
      blankPct: r2((blank / n) * 100),
      options: Object.entries(item.options ?? {}).map(([id, o]) => ({
        id: Number(id),
        label: o.label,
        points: o.points,
        n: counts.get(id) ?? 0,
        pct: r2(((counts.get(id) ?? 0) / n) * 100),
      })),
    };
    if (item.kind === "multi") {
      out.value.selectionsPerSchool = describe(multiCount);
      // ข้อที่เลือกได้หลายข้อแต่คิดคะแนนจาก id สูงสุด → นับว่ามีกี่แห่งที่เลือกหลายข้อจริง
      out.value.multiSelectPct = r2((multiCount.filter((c) => c > 1).length / n) * 100);

      // กติกา "ใช้ id สูงสุด" กับตัวเลือกที่คะแนนลดลงตาม id → ยิ่งกรอกครบ ยิ่งได้คะแนนน้อย
      // นับโรงเรียนที่เสียคะแนนเพราะกติกานี้ (ตัวเลือกที่เลือกไว้มีตัวที่ให้คะแนนสูงกว่าที่ได้รับจริง)
      let penalised = 0;
      let lost = 0;
      for (const r of rows) {
        const raw = String(r[item.key] ?? "").trim();
        if (!raw) continue;
        const ids = raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((x) => x > 0);
        if (ids.length < 2) continue;
        const best = Math.max(...ids.map((id) => item.options?.[id]?.points ?? 0));
        const awarded = num(r.__score[item.scoreKey]);
        if (best > awarded + 0.001) {
          penalised++;
          lost += best - awarded;
        }
      }
      out.value.penalisedByMaxIdRule = {
        n: penalised,
        pct: r2((penalised / n) * 100),
        meanPointsLost: penalised ? r2(lost / penalised) : 0,
      };
    }
  }

  return out;
}

function analyzeGroups(items, itemStats) {
  const byGroup = new Map();
  for (const it of items) {
    const g = byGroup.get(it.group) ?? { key: it.group, ...GROUPS[it.group], maxScore: 0, items: [], mean: 0 };
    g.maxScore += it.max;
    g.items.push(it.no);
    byGroup.set(it.group, g);
  }
  for (const st of itemStats) {
    const g = byGroup.get(st.group);
    g.mean += st.score.mean;
  }
  return [...byGroup.values()].map((g) => ({
    ...g,
    mean: r2(g.mean),
    maxShare: r2(g.maxScore),
    realShare: r2(g.mean),
    utilisation: g.maxScore ? r2((g.mean / g.maxScore) * 100) : 0,
  }));
}

function correlationMatrix(items, rows, itemStats) {
  const cols = items
    .filter((i) => i.max > 0)
    .map((i) => ({ no: i.no, short: i.short, values: rows.map((r) => num(r.__score[i.scoreKey])) }));
  const pairs = [];
  for (let a = 0; a < cols.length; a++) {
    for (let b = a + 1; b < cols.length; b++) {
      pairs.push({
        a: cols[a].no,
        b: cols[b].no,
        aShort: cols[a].short,
        bShort: cols[b].short,
        r: r2(pearson(cols[a].values, cols[b].values)),
      });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  return { top: pairs.slice(0, 20), all: pairs };
}

/* --------------------------------- main --------------------------------- */

const argv = process.argv.slice(2);
const PRINT = argv.includes("--print");

const { conn, cfg } = await connectLegacy();
const SOURCE = await describeSource(conn, cfg);
console.error("แหล่งข้อมูล:", SOURCE);

const [highRows] = await conn.query("SELECT * FROM highland_eval");
const [islandRows] = await conn.query("SELECT * FROM island_eval");
const [hillRows] = await conn.query("SELECT * FROM highland_eval_hilltrib");
const [confirmRows] = await conn.query(
  "SELECT sc_id, area_type, acadyears, std_total, tch_total, school_confirmed, submitted, sao_status, spt_status" +
    " FROM school_confirm WHERE acadyears = 2569",
);
const [schoolRows] = await conn.query("SELECT sc_id, sc_name, provinces, sao_code FROM master_school");
await conn.end();

const provinceOf = new Map(schoolRows.map((s) => [String(s.sc_id), String(s.provinces || "").trim()]));
const confirmed = new Map(confirmRows.map((c) => [String(c.sc_id), c]));

const hillBy = new Map();
for (const h of hillRows) {
  const k = `${h.sc_id}|${h.acadyears}`;
  if (!hillBy.has(k)) hillBy.set(k, []);
  hillBy.get(k).push(h);
}

/** เก็บรอบประเมิน "ล่าสุด" ของแต่ละโรงเรียน */
function latestPerSchool(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = String(r.sc_id);
    const prev = by.get(k);
    if (!prev || num(r.acadyears) > num(prev.acadyears)) by.set(k, r);
  }
  return [...by.values()];
}

// ตาราง hilltrib ผูกกับ (sc_id, acadyears) — บางโรงเรียนกรอกไว้เฉพาะรอบ 2565
// ถ้ารอบล่าสุดไม่มีแถว ให้ย้อนไปใช้รอบที่มีข้อมูลล่าสุดแทน (นับจำนวนไว้เป็นคุณภาพข้อมูล)
const hillYearsBy = new Map();
for (const key of hillBy.keys()) {
  const [sc, y] = key.split("|");
  if (!hillYearsBy.has(sc)) hillYearsBy.set(sc, []);
  hillYearsBy.get(sc).push(Number(y));
}
let hillFallbackCount = 0;
function hilltribFor(sc_id, acadyears) {
  const direct = hillBy.get(`${sc_id}|${acadyears}`);
  if (direct) return { rows: direct, fallback: false };
  const years = (hillYearsBy.get(String(sc_id)) ?? []).sort((a, b) => b - a);
  if (!years.length) return { rows: [], fallback: false };
  hillFallbackCount++;
  return { rows: hillBy.get(`${sc_id}|${years[0]}`) ?? [], fallback: true };
}

function prepHighland(rows) {
  return rows.map((r) => {
    const hl = hilltribFor(r.sc_id, r.acadyears);
    const calc = calcHighland(r, hl.rows);
    return {
      ...r,
      citeria11: calc.pct11,
      citeria12: calc.groups12,
      __score: calc,
      __hillFallback: hl.fallback,
      __stored: Number(r.sum_score) || 0,
      __province: provinceOf.get(String(r.sc_id)) || String(r.provinces || "").trim(),
    };
  });
}
function prepIsland(rows) {
  return rows.map((r) => {
    const calc = calcIsland(r);
    return { ...r, __score: calc, __stored: Number(r.sum_score) || 0, __province: provinceOf.get(String(r.sc_id)) || String(r.provinces || "").trim() };
  });
}

const highAll = prepHighland(highRows);
const islandAll = prepIsland(islandRows);

const highLatest = latestPerSchool(highAll);
const islandLatest = latestPerSchool(islandAll);
const highPop = highLatest.filter((r) => confirmed.has(String(r.sc_id)) && num(confirmed.get(String(r.sc_id)).area_type) === 1);
const islandPop = islandLatest.filter((r) => confirmed.has(String(r.sc_id)) && num(confirmed.get(String(r.sc_id)).area_type) === 2);

// ประชากรหลักของการวิเคราะห์ = โรงเรียนที่ยืนยันสถานะปี 2569 และมีผลประเมินเดิม (ใช้รอบล่าสุดของแต่ละแห่ง)
const H = highPop.length >= 100 ? highPop : highLatest;
const I = islandPop.length >= 20 ? islandPop : islandLatest;

const hTotals = H.map((r) => r.__score.sum_score);
const iTotals = I.map((r) => r.__score.sum_score);

/* ---- ความถูกต้องของคะแนนที่เก็บไว้ vs คำนวณใหม่ ---- */
function reconcile(rows, items) {
  const diffs = rows.map((r) => r.__score.sum_score - r.__stored);
  const bad = rows.filter((r) => Math.abs(r.__score.sum_score - r.__stored) > 0.5);
  const byYear = {};
  for (const r of rows) {
    const y = r.acadyears;
    byYear[y] = byYear[y] ?? { n: 0, mismatched: 0 };
    byYear[y].n++;
    if (Math.abs(r.__score.sum_score - r.__stored) > 0.5) byYear[y].mismatched++;
  }
  // ข้อไหนเป็นต้นเหตุของความต่าง (เทียบ scoreNN ที่เก็บไว้กับที่คำนวณใหม่)
  const byItem = items
    .filter((it) => it.max > 0)
    .map((it) => {
      const off = rows.filter(
        (r) => Math.abs(num(r.__score[it.scoreKey]) - num(r[it.scoreKey])) > 0.05,
      );
      return {
        no: it.no,
        short: it.short,
        mismatched: off.length,
        pct: r2((off.length / Math.max(1, rows.length)) * 100),
      };
    })
    .sort((a, b) => b.mismatched - a.mismatched);
  return {
    n: rows.length,
    matched: rows.length - bad.length,
    mismatched: bad.length,
    mismatchPct: r2((bad.length / Math.max(1, rows.length)) * 100),
    meanDiff: r2(mean(diffs)),
    maxAbsDiff: r2(Math.max(0, ...diffs.map(Math.abs))),
    byYear,
    byItem,
    samples: bad.slice(0, 10).map((r) => ({
      sc_id: r.sc_id,
      acadyears: r.acadyears,
      stored: r.__stored,
      recomputed: r.__score.sum_score,
    })),
  };
}

/* ---- การกระจายคะแนนรวม + ความไวจุดตัด ---- */
function totalsProfile(totals) {
  const d = describe(totals);
  const cuts = [50, 55, 60, 65, 68, 70, 72, 75, 80].map((c) => ({
    cut: c,
    pass: totals.filter((t) => t >= c).length,
    pct: r2((totals.filter((t) => t >= c).length / totals.length) * 100),
  }));
  const band = (lo, hi) => totals.filter((t) => t >= lo && t < hi).length;
  return {
    ...d,
    cuts,
    levels: LEVELS.map((l) => ({
      key: l.key,
      label: l.label,
      n: totals.filter((t) => levelOf(t).key === l.key).length,
    })),
    nearCut: {
      "65-70": band(65, 70),
      "70-75": band(70, 75),
      "65-75": band(65, 75),
      pctInBand: r2((band(65, 75) / totals.length) * 100),
    },
    histogram: histogram(totals, Array.from({ length: 21 }, (_, i) => i * 5)),
  };
}

/* ---- ตัดขวางรายจังหวัด ---- */
function byProvince(rows, totals) {
  const by = new Map();
  rows.forEach((r, i) => {
    const p = r.__province || "(ไม่ระบุ)";
    if (!by.has(p)) by.set(p, []);
    by.get(p).push({ total: totals[i], s: r.__score });
  });
  return [...by.entries()]
    .map(([province, list]) => ({
      province,
      n: list.length,
      meanTotal: r2(mean(list.map((x) => x.total))),
      pass70: list.filter((x) => x.total >= PASS).length,
      passRate: r2((list.filter((x) => x.total >= PASS).length / list.length) * 100),
      meanElevScore: r2(mean(list.map((x) => num(x.s.score01)))),
      meanUtility: r2(mean(list.map((x) => num(x.s.score07) + num(x.s.score08) + num(x.s.score09) + num(x.s.score10)))),
      meanLearner: r2(mean(list.map((x) => num(x.s.score11) + num(x.s.score12) + num(x.s.score13) + num(x.s.score14)))),
    }))
    .sort((a, b) => b.n - a.n);
}

/* ---- คุณภาพข้อมูล ---- */
function dataQuality(rows) {
  const n = rows.length;
  const c = (f) => {
    const k = rows.filter(f).length;
    return { n: k, pct: r2((k / n) * 100) };
  };
  return {
    n,
    stuSumZero: c((r) => num(r.stu_sum) === 0),
    elevZero: c((r) => num(r.citeria01) === 0),
    elevBelowAvg: c((r) => num(r.citeria01) > 0 && num(r.citeria01) < num(r.average_height)),
    noLatLng: c((r) => !String(r.lat || "").trim() || !String(r.lng || "").trim()),
    distanceZero: c((r) => num(r.citeria05) === 0),
    waterBlank: c((r) => String(r.citeria07 ?? "").trim() === ""),
    powerBlank: c((r) => String(r.citeria08 ?? "").trim() === ""),
    phoneBlank: c((r) => String(r.citeria09 ?? "").trim() === ""),
    netBlank: c((r) => String(r.citeria10 ?? "").trim() === ""),
    poorGtStudents: c((r) => num(r.citeria13) > num(r.stu_sum) && num(r.stu_sum) > 0),
    boardingGtStudents: c((r) => num(r.citeria14) > num(r.stu_sum) && num(r.stu_sum) > 0),
    ethnicGtStudents: c((r) => num(r.citeria11) > 100.01),
    noRefdocWhenPositive: c(
      (r) => num(r.citeria14) > 0 && String(r.citeria14_refdoc ?? "").trim() === "",
    ),
  };
}

/* ---- ข้อ 1: สูตรคิดคะแนนความสูงเปลี่ยนระหว่างรอบปี ---- */
// รอบ 2565 ใช้สูตร A = min(ความสูง, 600) × 30/600  (เชิงเส้น ไม่มีคะแนนฐาน)
// รอบ 2566 เป็นต้นมาใช้สูตร B = 15 + min(ความสูง, 500) × 15/500 เมื่อผ่านด่าน (≥500 ม. หรือ ≥ ค่าเฉลี่ย)
const elevA = elevLinear600;
const elevB = elevBase15;

function elevationRegimes(rowsAll, pop) {
  const years = [...new Set(rowsAll.map((r) => r.acadyears))].sort();
  const fit = years.map((y) => {
    const rows = rowsAll.filter((r) => r.acadyears === y && r.score01 !== null);
    const a = rows.filter((r) => Math.abs(num(r.score01) - elevA(num(r.citeria01))) <= 0.05).length;
    const b = rows.filter(
      (r) => Math.abs(num(r.score01) - elevB(num(r.citeria01), num(r.average_height))) <= 0.05,
    ).length;
    return { year: y, n: rows.length, fitLinear600: a, fitBase15: b };
  });
  const elev = pop.map((r) => num(r.citeria01));
  const a = pop.map((r) => elevA(num(r.citeria01)));
  const b = pop.map((r) => elevB(num(r.citeria01), num(r.average_height)));
  const totalsB = pop.map((r) => r.__score.sum_score);
  const totalsA = pop.map((r, i) => r2(totalsB[i] - b[i] + a[i]));
  return {
    fitByYear: fit,
    elevation: {
      ...describe(elev),
      histogram: histogram(elev, [0, 200, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000]),
      below500Pct: r2((elev.filter((e) => e < 500).length / elev.length) * 100),
      atLeast600Pct: r2((elev.filter((e) => e >= 600).length / elev.length) * 100),
    },
    scoreUnderLinear600: { ...describe(a), fullPct: r2((a.filter((x) => x >= 29.999).length / a.length) * 100) },
    scoreUnderBase15: { ...describe(b), fullPct: r2((b.filter((x) => x >= 29.999).length / b.length) * 100) },
    passRate: {
      base15: r2((totalsB.filter((t) => t >= PASS).length / totalsB.length) * 100),
      linear600: r2((totalsA.filter((t) => t >= PASS).length / totalsA.length) * 100),
      meanTotalBase15: r2(mean(totalsB)),
      meanTotalLinear600: r2(mean(totalsA)),
    },
    discrimination: {
      base15: r2(pearson(b, totalsB.map((t, i) => t - b[i]))),
      linear600: r2(pearson(a, totalsA.map((t, i) => t - a[i]))),
    },
    // การกระจุกตัวที่ค่าจุดตัด 500 ม. — สัญญาณว่ามีการรายงานอิงเกณฑ์ ไม่ใช่ค่าที่วัดได้จริง
    bunchingAt500: {
      exactly500: elev.filter((e) => e === 500).length,
      in480to494: elev.filter((e) => e >= 480 && e <= 494).length,
      in506to520: elev.filter((e) => e >= 506 && e <= 520).length,
      roundedToHundred: elev.filter((e) => e > 0 && e % 100 === 0).length,
      roundedToTen: elev.filter((e) => e > 0 && e % 10 === 0).length,
      nonZero: elev.filter((e) => e > 0).length,
      byYear: years.map((y) => {
        const rows = rowsAll.filter((r) => r.acadyears === y);
        const e = rows.map((r) => num(r.citeria01));
        return {
          year: y,
          n: rows.length,
          exactly500: e.filter((x) => x === 500).length,
          pct: r2((e.filter((x) => x === 500).length / Math.max(1, rows.length)) * 100),
        };
      }),
    },
  };
}

/* ---- จำลองทางเลือกการให้น้ำหนัก ---- */
function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const out = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}
const spearman = (a, b) => r2(pearson(rank(a), rank(b)));

function simulate(pop, baseTotals, label, scoreFn) {
  const totals = pop.map((r, i) => r2(scoreFn(r, i)));
  const changed = pop.filter((_, i) => (baseTotals[i] >= PASS) !== (totals[i] >= PASS)).length;
  return {
    label,
    ...describe(totals),
    pass70: totals.filter((t) => t >= PASS).length,
    passRate: r2((totals.filter((t) => t >= PASS).length / totals.length) * 100),
    changedPassStatus: changed,
    changedPct: r2((changed / totals.length) * 100),
    spearmanVsCurrent: spearman(baseTotals, totals),
    p50: r2(pct(totals, 50)),
    cutForSameCount: (() => {
      // จุดตัดที่ทำให้ได้จำนวนโรงเรียนผ่านเท่าเดิม (ใช้เทียบเวลาปรับสูตรแล้วอยากคงจำนวน)
      const target = baseTotals.filter((t) => t >= PASS).length;
      const sorted = [...totals].sort((a, b) => b - a);
      return target > 0 && target <= sorted.length ? r2(sorted[target - 1]) : null;
    })(),
  };
}

function simulations(pop) {
  const base = pop.map((r) => r.__score.sum_score);
  const s = (r, k) => num(r.__score[k]);
  const sims = [];
  sims.push(simulate(pop, base, "S0 — เกณฑ์ปัจจุบัน (ฐาน 15 + เพดาน 500 ม.)", (r) => r.__score.sum_score));
  sims.push(
    simulate(pop, base, "S1 — ข้อ 1 กลับไปใช้สูตรเชิงเส้น 0–600 ม. (แบบรอบ 2565)", (r) =>
      r.__score.sum_score - s(r, "score01") + elevA(num(r.citeria01)),
    ),
  );
  sims.push(
    simulate(pop, base, "S2 — ข้อ 1 เชิงเส้น 0–1,000 ม. เต็ม 30 (ตัดคะแนนฐาน)", (r) =>
      r.__score.sum_score - s(r, "score01") + r2((Math.min(num(r.citeria01), 1000) * 30) / 1000),
    ),
  );
  sims.push(
    simulate(pop, base, "S3 — ลดน้ำหนักข้อ 1 เหลือ 15 แล้วโยกไปข้อที่จำแนกได้ (4/8/10/14/16 ×2)", (r) => {
      const keep =
        r.__score.sum_score -
        s(r, "score01") -
        s(r, "score04") -
        s(r, "score08") -
        s(r, "score10") -
        s(r, "score14") -
        s(r, "score16");
      const elev = (elevB(num(r.citeria01), num(r.average_height)) * 15) / 30;
      return keep + elev + 2 * (s(r, "score04") + s(r, "score08") + s(r, "score10") + s(r, "score14") + s(r, "score16"));
    }),
  );
  sims.push(
    simulate(pop, base, "S4 — ตัดข้อที่แทบไม่จำแนก (1/3/5/6) ออก แล้วปรับสเกลเป็น 100", (r) => {
      const rest =
        r.__score.sum_score - s(r, "score01") - s(r, "score03") - s(r, "score05") - s(r, "score06");
      return (rest * 100) / 55;
    }),
  );
  return sims;
}

/* ---- ช่วงค่าตามเปอร์เซ็นไทล์ สำหรับตั้งระดับใหม่ ---- */
function bands(items, rows) {
  return items
    .filter((it) => it.kind === "numeric")
    .map((it) => {
      const raw = rows.map((r) => num(r[it.key])).filter((v) => Number.isFinite(v));
      const q = [10, 25, 40, 50, 60, 75, 80, 90, 95].map((p) => ({ p, v: r2(pct(raw, p)) }));
      return {
        no: it.no,
        short: it.short,
        unit: it.unit ?? null,
        currentRule: it.rule,
        percentiles: q,
        suggestedBands: [
          { level: 1, from: r2(pct(raw, 40)), to: r2(pct(raw, 70)) },
          { level: 2, from: r2(pct(raw, 70)), to: r2(pct(raw, 90)) },
          { level: 3, from: r2(pct(raw, 90)), to: null },
        ],
      };
    });
}

/* ---- จำแนกตาม "ชนิดของค่า" ที่แต่ละข้อวัด ---- */

const QUANTITATIVE = new Set(["continuous", "count", "percent", "mean"]);

/** ฐานนิยมและมัธยฐานของตัวเลือก — ใช้แทนค่าเฉลี่ยซึ่งไม่มีความหมายกับข้อมูลเชิงคุณภาพ */
function categoricalSummary(stat) {
  const allOptions = stat.value?.options ?? [];
  const opts = allOptions.filter((o) => o.n > 0);
  if (!opts.length) return { mode: null, medianOptionId: null, totalOptions: allOptions.length, distribution: [] };
  const total = opts.reduce((s, o) => s + o.n, 0);
  const mode = opts.reduce((a, b) => (b.n > a.n ? b : a));
  let cum = 0;
  let medianOptionId = opts[0].id;
  for (const o of [...opts].sort((a, b) => a.id - b.id)) {
    cum += o.n;
    if (cum >= total / 2) {
      medianOptionId = o.id;
      break;
    }
  }
  return {
    answered: total,
    mode: { id: mode.id, label: mode.label, n: mode.n, pct: r2((mode.n / total) * 100) },
    medianOptionId,
    medianOptionLabel: opts.find((o) => o.id === medianOptionId)?.label ?? null,
    distinctOptionsUsed: opts.length,
    totalOptions: allOptions.length,
    distribution: opts.map((o) => ({ id: o.id, label: o.label, n: o.n, pct: o.pct, points: o.points })),
  };
}

function measurementProfile(items, itemStats, measures) {
  const perItem = itemStats.map((st) => {
    const m = measures[st.no] ?? {};
    const isQuant = QUANTITATIVE.has(m.measure);
    const summary = isQuant
      ? {
          kind: "quantitative",
          unit: m.unit ?? st.unit,
          mean: st.value?.mean ?? null,
          median: st.value?.p50 ?? null,
          sd: st.value?.sd ?? null,
          p25: st.value?.p25 ?? null,
          p75: st.value?.p75 ?? null,
          min: st.value?.min ?? null,
          max: st.value?.max ?? null,
          zeroPct: st.value?.zeroPct ?? null,
          atOrAboveCapPct: st.value?.atOrAboveCapPct ?? null,
        }
      : { kind: "qualitative", ...categoricalSummary(st) };
    if (m.measure === "multiset") {
      summary.meanSelections = st.value?.selectionsPerSchool?.mean ?? null;
      summary.multiSelectPct = st.value?.multiSelectPct ?? null;
      summary.penalisedByMaxIdRule = st.value?.penalisedByMaxIdRule ?? null;
    }
    return {
      no: st.no,
      short: st.short,
      title: st.title,
      max: st.max,
      measure: m.measure ?? null,
      measureLabel: MEASURE_TYPES[m.measure]?.label ?? null,
      scale: m.scale ?? null,
      unit: m.unit ?? null,
      origin: m.origin ?? null,
      originLabel: ORIGIN_LABELS[m.origin] ?? null,
      collectedAs: m.collectedAs ?? null,
      scoredAs: m.scoredAs ?? null,
      normalized: m.normalized ?? null,
      mismatch: m.mismatch ?? null,
      meanScore: st.score.mean,
      D: st.discrimination.D,
      summary,
    };
  });

  const byType = new Map();
  for (const it of perItem) {
    if (!it.measure) continue;
    const g = byType.get(it.measure) ?? {
      ...MEASURE_TYPES[it.measure],
      items: [],
      weight: 0,
      meanScoreTotal: 0,
    };
    g.items.push(it.no);
    g.weight += it.max;
    g.meanScoreTotal += it.meanScore;
    byType.set(it.measure, g);
  }
  const fullScore = perItem.reduce((s, i) => s + i.max, 0) || 100;
  const taxonomy = [...byType.values()]
    .map((g) => ({
      ...g,
      itemCount: g.items.length,
      weightPct: r2((g.weight / fullScore) * 100),
      meanScoreTotal: r2(g.meanScoreTotal),
      utilisation: g.weight ? r2((g.meanScoreTotal / g.weight) * 100) : 0,
    }))
    .sort((a, b) => b.weight - a.weight);

  const quantWeight = taxonomy.filter((g) => QUANTITATIVE.has(g.key)).reduce((s, g) => s + g.weight, 0);
  const autoWeight = perItem.filter((i) => i.origin === "auto").reduce((s, i) => s + i.max, 0);
  const derivedWeight = perItem.filter((i) => i.origin === "derived").reduce((s, i) => s + i.max, 0);
  const enteredWeight = perItem.filter((i) => i.origin === "entered").reduce((s, i) => s + i.max, 0);

  return {
    fullScore,
    taxonomy,
    split: {
      quantitativeWeight: quantWeight,
      quantitativePct: r2((quantWeight / fullScore) * 100),
      qualitativeWeight: fullScore - quantWeight,
      qualitativePct: r2(((fullScore - quantWeight) / fullScore) * 100),
    },
    byOrigin: {
      auto: { weight: autoWeight, pct: r2((autoWeight / fullScore) * 100), label: ORIGIN_LABELS.auto },
      derived: { weight: derivedWeight, pct: r2((derivedWeight / fullScore) * 100), label: ORIGIN_LABELS.derived },
      entered: { weight: enteredWeight, pct: r2((enteredWeight / fullScore) * 100), label: ORIGIN_LABELS.entered },
    },
    normalization: {
      countItems: perItem.filter((i) => i.measure === "count").map((i) => ({ no: i.no, short: i.short, normalized: i.normalized })),
      normalizedWeight: perItem.filter((i) => i.normalized === true).reduce((s, i) => s + i.max, 0),
      unnormalizedCountWeight: perItem
        .filter((i) => i.measure === "count" && i.normalized === false)
        .reduce((s, i) => s + i.max, 0),
    },
    mismatches: perItem.filter((i) => i.mismatch).map((i) => ({ no: i.no, short: i.short, mismatch: i.mismatch })),
    items: perItem,
  };
}

/* ---- ประกอบผลลัพธ์ ---- */
const highItemStats = HIGHLAND_ITEMS.map((it) => analyzeItem(it, H, hTotals));
const islandItemStats = ISLAND_ITEMS.map((it) => analyzeItem(it, I, iTotals));

const result = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    passThreshold: PASS,
    note: "คะแนนทั้งหมดคำนวณใหม่จากค่าดิบด้วยสูตรเกณฑ์เดิม (ตรวจสอบตรงกับ ScoreService/IslandScoreService)",
    populations: {
      highland: {
        rowsAll: highAll.length,
        schools: highLatest.length,
        analysed: H.length,
        rule: "รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะที่ยืนยันสถานะปี 2569 (school_confirm.area_type=1)",
      },
      island: {
        rowsAll: islandAll.length,
        schools: islandLatest.length,
        analysed: I.length,
        rule: "รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะที่ยืนยันสถานะปี 2569 (school_confirm.area_type=2)",
      },
    },
    // ความคืบหน้าของรอบยืนยันสถานะปี 2569 — บอกว่าประชากรที่วิเคราะห์นิ่งแล้วหรือยัง
    confirmWorkflow: [1, 2].map((t) => {
      const list = confirmRows.filter((c) => num(c.area_type) === t);
      const c = (f) => list.filter(f).length;
      return {
        areaType: t,
        label: t === 1 ? "พื้นที่สูง" : "พื้นที่เกาะ",
        rows: list.length,
        schoolConfirmed: c((x) => num(x.school_confirmed) === 1),
        submitted: c((x) => num(x.submitted) === 1),
        saoApproved: c((x) => num(x.sao_status) === 1),
        sptApproved: c((x) => num(x.spt_status) === 1),
        sptRejected: c((x) => num(x.spt_status) === 2),
        pending: c((x) => num(x.spt_status) === 0),
      };
    }),
    yearCoverage: {
      highland: Object.fromEntries(
        [...new Set(highAll.map((r) => r.acadyears))].sort().map((y) => [y, highAll.filter((r) => r.acadyears === y).length]),
      ),
      island: Object.fromEntries(
        [...new Set(islandAll.map((r) => r.acadyears))].sort().map((y) => [y, islandAll.filter((r) => r.acadyears === y).length]),
      ),
    },
  },
  highland: {
    totals: totalsProfile(hTotals),
    reconcile: reconcile(H, HIGHLAND_ITEMS),
    quality: dataQuality(H),
    items: highItemStats,
    groups: analyzeGroups(HIGHLAND_ITEMS, highItemStats),
    correlations: correlationMatrix(HIGHLAND_ITEMS, H, highItemStats),
    provinces: byProvince(H, hTotals),
    elevationRegimes: elevationRegimes(highAll, H),
    simulations: simulations(H),
    bands: bands(HIGHLAND_ITEMS, H),
    measurement: measurementProfile(HIGHLAND_ITEMS, highItemStats, HIGHLAND_MEASURES),
    hilltribFallback: hillFallbackCount,
  },
  island: {
    totals: totalsProfile(iTotals),
    reconcile: reconcile(I, ISLAND_ITEMS),
    items: islandItemStats,
    groups: analyzeGroups(ISLAND_ITEMS, islandItemStats),
    correlations: correlationMatrix(ISLAND_ITEMS, I, iTotals),
    provinces: byProvince(I, iTotals),
    bands: bands(ISLAND_ITEMS, I),
    measurement: measurementProfile(ISLAND_ITEMS, islandItemStats, ISLAND_MEASURES),
  },
  trend: {
    highlandByYear: [...new Set(highAll.map((r) => r.acadyears))]
      .sort()
      .map((y) => {
        const rows = highAll.filter((r) => r.acadyears === y);
        const t = rows.map((r) => r.__score.sum_score);
        return { year: y, n: rows.length, meanTotal: r2(mean(t)), pass70: t.filter((x) => x >= PASS).length };
      }),
    islandByYear: [...new Set(islandAll.map((r) => r.acadyears))]
      .sort()
      .map((y) => {
        const rows = islandAll.filter((r) => r.acadyears === y);
        const t = rows.map((r) => r.__score.sum_score);
        return { year: y, n: rows.length, meanTotal: r2(mean(t)), pass70: t.filter((x) => x >= PASS).length };
      }),
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, "legacy-item-stats.json");
fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");
console.error("เขียนผลลัพธ์:", path.relative(ROOT, outFile));

if (PRINT) {
  console.log("\n== พื้นที่สูง N =", H.length, " คะแนนเฉลี่ย", result.highland.totals.mean);
  for (const it of highItemStats) {
    console.log(
      `ข้อ ${String(it.no).padStart(2)} ${it.short.padEnd(22)} เต็ม ${String(it.max).padStart(2)}  ` +
        `เฉลี่ย ${String(it.score.mean).padStart(6)} (${String(it.score.share).padStart(5)}%)  ` +
        `0คะแนน ${String(it.score.zeroPct).padStart(5)}%  เต็ม ${String(it.score.fullPct).padStart(5)}%  ` +
        `r=${it.discrimination.itemRestCorr}  D=${it.discrimination.D}  พลิกผล ${it.impact.flipPct}%`,
    );
  }
}
