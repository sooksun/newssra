// ดึงตัวอย่างจริงประกอบคำอธิบายร่างเกณฑ์ — แสดงการคิดคะแนนทีละข้อของโรงเรียนจริง ทั้งเกณฑ์เดิมและร่างใหม่
//
//   node scripts/explain-draft.mjs [--config=scripts/criteria/2569-draft-c.json] [--cases=6]
//
// ใช้เขียนเอกสารอธิบาย (docs/EXPLAINER-ร่างค.md) ให้อ้างอิงกรณีจริงได้ ไม่ใช่ตัวอย่างสมมติ

import fs from "node:fs";
import path from "node:path";
import { loadLegacyPopulation } from "./legacy-population.mjs";
import { calcHighland, num, r2 } from "./legacy-score.mjs";
import { scoreWithConfig, readVariable } from "./criteria-model.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const cfgArg = process.argv.find((a) => a.startsWith("--config="));
const CONFIG_PATH = cfgArg ? cfgArg.slice("--config=".length) : "scripts/criteria/2569-draft-c.json";
const config = JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG_PATH), "utf8"));

const { rows, provinceOf, source } = await loadLegacyPopulation({ areaType: 1 });
console.error("แหล่งข้อมูล:", source);

const scored = rows.map(({ row, hill }) => {
  const old = calcHighland(row, hill);
  const neu = scoreWithConfig(config, row, hill);
  return {
    sc_id: String(row.sc_id),
    province: provinceOf.get(String(row.sc_id)) || "(ไม่ระบุ)",
    year: num(row.acadyears),
    row,
    hill,
    old,
    neu,
    delta: r2(neu.effectiveTotal - old.sum_score),
  };
});

const CUT_OLD = 70;
const CUT_NEW = 62.72; // จุดตัดเทียบเท่าที่ตัวจำลองคำนวณไว้

const fmt = (s) => {
  const vars = config.items.map((it) => ({
    id: it.id,
    title: it.title,
    variable: it.variable,
    value: r2(readVariable(it.variable, s.row, s.hill)),
    score: s.neu.scores[it.id],
    max: it.max,
  }));
  return {
    sc_id: s.sc_id,
    province: s.province,
    year: s.year,
    students: num(s.row.stu_sum),
    oldTotal: s.old.sum_score,
    newTotal: s.neu.effectiveTotal,
    delta: s.delta,
    oldPass: s.old.sum_score >= CUT_OLD,
    newPass: s.neu.effectiveTotal >= CUT_NEW,
    oldItems: {
      elev: { value: num(s.row.citeria01), score: s.old.score01 },
      water: { value: String(s.row.citeria07 ?? ""), score: s.old.score07 },
      power: { value: String(s.row.citeria08 ?? ""), score: s.old.score08 },
      phone: { value: String(s.row.citeria09 ?? ""), score: s.old.score09 },
      net: { value: String(s.row.citeria10 ?? ""), score: s.old.score10 },
      treasury: { value: num(s.row.citeria16), score: s.old.score16 },
      poor: { count: num(s.row.citeria13), pct: s.old.pct13, score: s.old.score13 },
      boarding: { count: num(s.row.citeria14), score: s.old.score14 },
    },
    newItems: vars,
  };
};

const byDelta = [...scored].sort((a, b) => b.delta - a.delta);
const gainers = byDelta.slice(0, 3).map(fmt);
const losers = byDelta.slice(-3).reverse().map(fmt);

// กรณีที่อธิบายข้อบกพร่องของเกณฑ์เดิมได้ชัดที่สุด
const solarCase = scored.find((s) => {
  const ids = String(s.row.citeria08 ?? "")
    .split(",")
    .map((x) => x.trim());
  return ids.includes("1") && ids.includes("2");
});
const exactly500 = scored.filter((s) => num(s.row.citeria01) === 500);
const highest = [...scored].sort((a, b) => num(b.row.citeria01) - num(a.row.citeria01))[0];

/* ---- ตรวจว่าเกณฑ์ใหม่ลำเอียงตามขนาดโรงเรียนหรือไม่ ---- */
const meanOf = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pearson = (a, b) => {
  const ma = meanOf(a);
  const mb = meanOf(b);
  let s = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    s += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? s / Math.sqrt(da * db) : 0;
};
const sizes = scored.map((s) => num(s.row.stu_sum));
const oldTotals = scored.map((s) => s.old.sum_score);
const newTotals = scored.map((s) => s.neu.effectiveTotal);
const sizeBias = {
  corrOld: r2(pearson(sizes, oldTotals)),
  corrNew: r2(pearson(sizes, newTotals)),
  bands: [
    [0, 30, "ต่ำกว่า 30 คน"],
    [30, 60, "30–59 คน"],
    [60, 120, "60–119 คน"],
    [120, 300, "120–299 คน"],
    [300, Infinity, "300 คนขึ้นไป"],
  ].map(([lo, hi, label]) => {
    const idx = sizes.map((s, i) => [s, i]).filter(([s]) => s >= lo && s < hi).map(([, i]) => i);
    return {
      label,
      n: idx.length,
      meanOld: r2(meanOf(idx.map((i) => oldTotals[i]))),
      meanNew: r2(meanOf(idx.map((i) => newTotals[i]))),
    };
  }),
};

/* ---- เทียบผลตรวจสุขภาพรายข้อ เกณฑ์เดิม vs ร่างนี้ ---- */
const legacyStats = JSON.parse(
  fs.readFileSync(path.join(ROOT, "docs", "analysis", "legacy-item-stats.json"), "utf8"),
);
const TH = { maxWeight: 25, maxFullPct: 60, maxZeroPct: 70, minD: 0.2 };
const legacyHealth = (() => {
  const failing = [];
  let passed = 0;
  for (const it of legacyStats.highland.items) {
    const iss = [];
    if (it.max > TH.maxWeight) iss.push(`น้ำหนัก ${it.max} คะแนน`);
    if (it.score.fullPct > TH.maxFullPct) iss.push(`ได้เต็ม ${it.score.fullPct}%`);
    if (it.score.zeroPct > TH.maxZeroPct) iss.push(`ได้ 0 คะแนน ${it.score.zeroPct}%`);
    if (it.discrimination.D < TH.minD) iss.push(`D = ${it.discrimination.D}`);
    if (iss.length) failing.push({ no: it.no, short: it.short, max: it.max, issues: iss });
    else passed++;
  }
  return {
    thresholds: TH,
    passed,
    total: legacyStats.highland.items.length,
    failing,
    failingWeight: failing.reduce((s, x) => s + x.max, 0),
  };
})();

const out = {
  generatedAt: new Date().toISOString(),
  source,
  config: { id: config.id, name: config.name, file: CONFIG_PATH },
  cuts: { old: CUT_OLD, newEquivalent: CUT_NEW },
  population: rows.length,
  gainers,
  losers,
  solarCase: solarCase ? fmt(solarCase) : null,
  exactly500: {
    count: exactly500.length,
    meanOld: r2(exactly500.reduce((s, x) => s + x.old.sum_score, 0) / Math.max(1, exactly500.length)),
    meanNew: r2(exactly500.reduce((s, x) => s + x.neu.effectiveTotal, 0) / Math.max(1, exactly500.length)),
    sample: exactly500.slice(0, 2).map(fmt),
  },
  highestSchool: fmt(highest),
  sizeBias,
  legacyHealth,
  // เปรียบเทียบคะแนนข้อความสูงระหว่างสองสูตร ณ ระดับความสูงตัวอย่าง
  elevationLadder: [300, 400, 500, 600, 800, 1000, 1350, 1800].map((m) => ({
    metres: m,
    oldScore: m >= 500 ? r2(15 + (Math.min(m, 500) * 15) / 500) : null,
    newScore: r2(Math.max(0, Math.min(1, (m - 300) / (1350 - 300))) * 24),
  })),
};

const outFile = path.join(ROOT, "docs", "analysis", "draft-explainer-cases.json");
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
console.error("เขียนตัวอย่างประกอบ:", path.relative(ROOT, outFile));

const f = (x, k = 2) => Number(x ?? 0).toFixed(k);
console.log("\n== โรงเรียนที่คะแนนเพิ่มมากที่สุด ==");
for (const g of gainers) console.log(` ${g.sc_id} ${g.province.padEnd(12)} เดิม ${f(g.oldTotal)} → ใหม่ ${f(g.newTotal)} (${g.delta > 0 ? "+" : ""}${f(g.delta)})`);
console.log("== โรงเรียนที่คะแนนลดมากที่สุด ==");
for (const l of losers) console.log(` ${l.sc_id} ${l.province.padEnd(12)} เดิม ${f(l.oldTotal)} → ใหม่ ${f(l.newTotal)} (${f(l.delta)})`);
console.log("== ความสูง 500 ม. พอดี ==", out.exactly500.count, "แห่ง · เฉลี่ยเดิม", f(out.exactly500.meanOld), "→ ใหม่", f(out.exactly500.meanNew));
if (out.solarCase) console.log("== กรณีโซลาร์+ไฟฟ้าภูมิภาค ==", out.solarCase.sc_id, "ไฟฟ้าเดิมได้", out.solarCase.oldItems.power.score, "คะแนน");
console.log("== บันไดคะแนนความสูง ==");
for (const e of out.elevationLadder) console.log(`  ${String(e.metres).padStart(5)} ม. → เดิม ${e.oldScore === null ? "ไม่ผ่านด่าน" : f(e.oldScore) + "/30"} · ใหม่ ${f(e.newScore)}/24`);
