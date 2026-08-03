// ทดลองชุดเกณฑ์ที่เสนอกับข้อมูลจริง ก่อนตัดสินใจใช้จริง
//
//   node scripts/simulate-criteria.mjs scripts/criteria/2569-draft-a.json
//   node scripts/simulate-criteria.mjs <config...> --md      # เขียนรายงาน Markdown ด้วย
//
// เทียบผลกับ "เกณฑ์เดิม" เสมอ: ใครได้/ตกเปลี่ยนไปเท่าไร ลำดับพลิกหรือไม่ และจุดตัดใดให้จำนวนเท่าเดิม
// อ่านข้อมูลอย่างเดียว ไม่เขียนฐานข้อมูล

import fs from "node:fs";
import path from "node:path";
import { connectLegacy, describeSource } from "./legacy-db.mjs";
import { calcHighland, num, r2 } from "./legacy-score.mjs";
import { scoreWithConfig, validateConfig, configMaxScore, readVariable } from "./criteria-model.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "analysis");
const LEGACY_PASS = 70;

const args = process.argv.slice(2);
const WRITE_MD = args.includes("--md");
const configPaths = args.filter((a) => !a.startsWith("--"));
if (!configPaths.length) {
  console.error("ใช้: node scripts/simulate-criteria.mjs <ไฟล์ config.json> [--md]");
  process.exit(1);
}

/* ------------------------------ สถิติพื้นฐาน ------------------------------ */
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * (p / 100);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let n0 = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    n0 += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? n0 / Math.sqrt(da * db) : 0;
}
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
const histogram = (values, edges) => {
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
};

/* ------------------------------ โหลดข้อมูล ------------------------------ */
const { conn, cfg } = await connectLegacy();
const SOURCE = await describeSource(conn, cfg);
console.error("แหล่งข้อมูล:", SOURCE);

const [highRows] = await conn.query("SELECT * FROM highland_eval");
const [hillRows] = await conn.query("SELECT * FROM highland_eval_hilltrib");
const [confirmRows] = await conn.query(
  "SELECT sc_id FROM school_confirm WHERE acadyears = 2569 AND area_type = 1",
);
const [schoolRows] = await conn.query("SELECT sc_id, provinces FROM master_school");
await conn.end();

const provinceOf = new Map(schoolRows.map((s) => [String(s.sc_id), String(s.provinces || "").trim()]));
const confirmed = new Set(confirmRows.map((c) => String(c.sc_id)));

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
for (const r of highRows) {
  const k = String(r.sc_id);
  if (!latest.has(k) || num(r.acadyears) > num(latest.get(k).acadyears)) latest.set(k, r);
}
const pop = [...latest.values()].filter((r) => confirmed.has(String(r.sc_id)));
const rows = pop.map((r) => ({ row: r, hill: hilltribFor(r.sc_id, r.acadyears) }));
const legacyTotals = rows.map(({ row, hill }) => calcHighland(row, hill).sum_score);
const legacyPass = legacyTotals.filter((t) => t >= LEGACY_PASS).length;

console.error(`ประชากร ${rows.length} โรงเรียน · เกณฑ์เดิมผ่าน 70 คะแนน ${legacyPass} แห่ง`);

/* ------------------------------ รันแต่ละชุดเกณฑ์ ------------------------------ */
const results = [];
for (const p of configPaths) {
  const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, p), "utf8"));
  const errors = validateConfig(config);
  if (errors.length) {
    console.error(`\n❌ ${p} ไม่ผ่านการตรวจโครงสร้าง:`);
    for (const e of errors) console.error("   -", e);
    process.exitCode = 1;
    continue;
  }

  const scored = rows.map(({ row, hill }) => scoreWithConfig(config, row, hill));
  const gated = scored.filter((s) => !s.gate.passed).length;
  const totals = scored.map((s) => s.effectiveTotal);
  const totalsGatePassed = scored.filter((s) => s.gate.passed).map((s) => s.total);
  const threshold = config.passThreshold ?? 70;

  const cuts = [50, 55, 60, 65, 70, 75, 80].map((c) => ({
    cut: c,
    pass: totals.filter((t) => t >= c).length,
    pct: r2((totals.filter((t) => t >= c).length / totals.length) * 100),
  }));
  const sortedDesc = [...totals].sort((a, b) => b - a);
  const cutForLegacyCount = legacyPass > 0 && legacyPass <= sortedDesc.length ? r2(sortedDesc[legacyPass - 1]) : null;

  // เส้นแบ่งระดับที่ "เทียบเท่า" ของเดิม — คะแนนในการกระจายใหม่ที่ให้จำนวนโรงเรียนแต่ละกลุ่มเท่าเกณฑ์เดิม
  // (ข้อเสนอ 10: ปรับสูตรแล้วต้องปรับเส้นแบ่งตาม ไม่งั้นจำนวนคนในแต่ละกลุ่มเปลี่ยนโดยไม่ตั้งใจ)
  const LEGACY_LEVEL_MINS = [70, 60, 50];
  const equivalentLevels = LEGACY_LEVEL_MINS.map((min) => {
    const count = legacyTotals.filter((t) => t >= min).length;
    const equivalent = count > 0 && count <= sortedDesc.length ? r2(sortedDesc[count - 1]) : null;
    return { legacyMin: min, legacyCount: count, equivalentMin: equivalent };
  });

  const passNew = totals.map((t) => t >= threshold);
  const passOld = legacyTotals.map((t) => t >= LEGACY_PASS);
  const gainers = passNew.filter((v, i) => v && !passOld[i]).length;
  const losers = passNew.filter((v, i) => !v && passOld[i]).length;

  // อำนาจจำแนกรายข้อของชุดเกณฑ์ใหม่
  const itemStats = config.items.map((it) => {
    const s = scored.map((x) => x.scores[it.id]);
    const rest = scored.map((x, i) => totals[i] - s[i]);
    const order = s.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
    const k = Math.max(1, Math.round(s.length * 0.27));
    const up = mean(order.slice(0, k).map((i) => s[i]));
    const low = mean(order.slice(-k).map((i) => s[i]));
    const rawValues = rows.map(({ row, hill }) => readVariable(it.variable, row, hill));
    return {
      id: it.id,
      title: it.title,
      group: it.group ?? null,
      variable: it.variable,
      max: it.max,
      mean: r2(mean(s)),
      sd: r2(sd(s)),
      share: r2((mean(s) / it.max) * 100),
      zeroPct: r2((s.filter((x) => x === 0).length / s.length) * 100),
      fullPct: r2((s.filter((x) => x >= it.max - 0.001).length / s.length) * 100),
      itemRestCorr: r2(pearson(s, rest)),
      D: r2((up - low) / it.max),
      valueMedian: r2(pct(rawValues, 50)),
      // การกระจายของค่าดิบที่ป้อนเข้าข้อนี้ — ใช้ดูว่าตัวแปรที่เลือกมา "แปรผันจริง" หรือไม่
      valueDistribution: (() => {
        const uniq = [...new Set(rawValues.map((v) => r2(v)))].sort((a, b) => a - b);
        if (uniq.length <= 15) {
          return uniq.map((v) => ({
            label: String(v),
            lo: v,
            hi: v,
            n: rawValues.filter((x) => r2(x) === v).length,
          }));
        }
        const lo = Math.min(...rawValues);
        const hi = Math.max(...rawValues);
        const step = (hi - lo) / 10 || 1;
        return Array.from({ length: 10 }, (_, i) => {
          const a = lo + i * step;
          const b = i === 9 ? hi : lo + (i + 1) * step;
          return {
            label: `${r2(a)}–${r2(b)}`,
            lo: r2(a),
            hi: r2(b),
            n: rawValues.filter((x) => x >= a && (i === 9 ? x <= b : x < b)).length,
          };
        });
      })(),
    };
  });

  // ตรวจสุขภาพรายข้อ — เกณฑ์ตรวจรับที่ได้จากข้อค้นพบของเกณฑ์เดิม (ดู docs/RECOMMENDATIONS-เกณฑ์2569.md)
  const HEALTH = {
    maxWeight: 25, // ไม่ให้ข้อเดียวกำหนดผลมากเกินไป (เกณฑ์เดิมข้อ 1 = 30)
    maxFullPct: 60, // เพดานตัน — คนได้เต็มเกินนี้แปลว่าข้อนั้นแจกคะแนน ไม่ได้จำแนก
    maxZeroPct: 70, // พื้นตัน — คนได้ 0 เกินนี้แปลว่าเป็นแต้มพิเศษของกลุ่มเล็ก
    minD: 0.2, // อำนาจจำแนกขั้นต่ำที่ยอมรับได้
  };
  const health = itemStats.map((it) => {
    const issues = [];
    if (it.max > HEALTH.maxWeight) issues.push(`น้ำหนักเกิน ${HEALTH.maxWeight} คะแนน`);
    if (it.fullPct > HEALTH.maxFullPct) issues.push(`ได้เต็ม ${it.fullPct}% (เพดานตัน)`);
    if (it.zeroPct > HEALTH.maxZeroPct) issues.push(`ได้ 0 คะแนน ${it.zeroPct}% (พื้นตัน)`);
    if (it.D < HEALTH.minD) issues.push(`D = ${it.D} ต่ำกว่า ${HEALTH.minD}`);
    return { id: it.id, title: it.title, max: it.max, D: it.D, fullPct: it.fullPct, zeroPct: it.zeroPct, issues };
  });
  const healthSummary = {
    thresholds: HEALTH,
    passed: health.filter((h) => !h.issues.length).length,
    total: health.length,
    failing: health.filter((h) => h.issues.length),
  };

  const provinces = new Map();
  rows.forEach(({ row }, i) => {
    const p2 = provinceOf.get(String(row.sc_id)) || "(ไม่ระบุ)";
    if (!provinces.has(p2)) provinces.set(p2, []);
    provinces.get(p2).push({ neu: totals[i], old: legacyTotals[i] });
  });

  const result = {
    config: {
      id: config.id ?? path.basename(p, ".json"),
      name: config.name,
      version: config.version ?? null,
      status: config.status ?? null,
      note: config.note ?? null,
      fullScore: configMaxScore(config),
      passThreshold: threshold,
      file: path.relative(ROOT, path.resolve(ROOT, p)).replace(/\\/g, "/"),
    },
    population: rows.length,
    gate: {
      failed: gated,
      failedPct: r2((gated / rows.length) * 100),
      reasons: (config.gates ?? []).map((g) => ({
        id: g.id,
        label: g.label ?? g.id,
        failed: rows.filter(({ row, hill }) => {
          const v = readVariable(g.variable, row, hill);
          return g.op === ">=" ? !(v >= g.value) : g.op === ">" ? !(v > g.value) : v !== g.value;
        }).length,
      })),
    },
    totals: {
      n: totals.length,
      mean: r2(mean(totals)),
      sd: r2(sd(totals)),
      p10: r2(pct(totals, 10)),
      p25: r2(pct(totals, 25)),
      p50: r2(pct(totals, 50)),
      p75: r2(pct(totals, 75)),
      p90: r2(pct(totals, 90)),
      meanAmongGatePassed: r2(mean(totalsGatePassed)),
      histogram: histogram(totals, Array.from({ length: 21 }, (_, i) => i * 5)),
    },
    cuts,
    levels: (config.levels ?? []).map((l) => ({
      key: l.key,
      label: l.label ?? String(l.key),
      n: scored.filter((s) => s.level === l.key).length,
    })),
    vsLegacy: {
      legacyPassAt70: legacyPass,
      newPassAtThreshold: totals.filter((t) => t >= threshold).length,
      gainers,
      losers,
      changedPct: r2(((gainers + losers) / rows.length) * 100),
      spearman: spearman(legacyTotals, totals),
      pearson: r2(pearson(legacyTotals, totals)),
      cutForLegacyCount,
      equivalentLevels,
    },
    items: itemStats,
    health: healthSummary,
    provinces: [...provinces.entries()]
      .map(([province, list]) => ({
        province,
        n: list.length,
        meanNew: r2(mean(list.map((x) => x.neu))),
        meanOld: r2(mean(list.map((x) => x.old))),
        passNew: list.filter((x) => x.neu >= threshold).length,
        passOld: list.filter((x) => x.old >= LEGACY_PASS).length,
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 15),
  };
  results.push(result);

  console.log(`\n=== ${config.name} (${result.config.id}) ===`);
  console.log(
    `คะแนนเฉลี่ย ${result.totals.mean} (SD ${result.totals.sd}) · มัธยฐาน ${result.totals.p50} · ` +
      `ไม่ผ่านด่านคัดกรอง ${result.gate.failed} แห่ง (${result.gate.failedPct}%)`,
  );
  console.log(
    `ผ่านจุดตัด ${threshold}: ${result.vsLegacy.newPassAtThreshold} แห่ง (เกณฑ์เดิม ${legacyPass}) · ` +
      `ได้สิทธิ์เพิ่ม ${gainers} · เสียสิทธิ์ ${losers} · ρ=${result.vsLegacy.spearman} · ` +
      `จุดตัดที่ให้จำนวนเท่าเดิม = ${cutForLegacyCount}`,
  );
  console.log();
  for (const h of healthSummary.failing) console.log();
  console.log(`ตรวจสุขภาพรายข้อ: ผ่านเกณฑ์ตรวจรับ ${healthSummary.passed}/${healthSummary.total} ข้อ`);
  for (const h of healthSummary.failing) console.log(`  ⚠ ${h.id} ${h.title} — ${h.issues.join(" · ")}`);
  console.log("รายข้อ:");
  for (const it of itemStats) {
    console.log(
      `  ${it.id.padEnd(3)} ${it.title.slice(0, 34).padEnd(36)} เต็ม ${String(it.max).padStart(2)} ` +
        `เฉลี่ย ${String(it.mean).padStart(6)} (${String(it.share).padStart(5)}%) 0คะแนน ${String(it.zeroPct).padStart(5)}% ` +
        `เต็ม ${String(it.fullPct).padStart(5)}% r=${it.itemRestCorr} D=${it.D}`,
    );
  }
}

/* ------------------------------ บันทึกผล ------------------------------ */
fs.mkdirSync(OUT_DIR, { recursive: true });
const jsonOut = path.join(OUT_DIR, "criteria-simulation.json");
fs.writeFileSync(
  jsonOut,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: SOURCE,
      population: rows.length,
      legacy: {
        passAt70: legacyPass,
        mean: r2(mean(legacyTotals)),
        sd: r2(sd(legacyTotals)),
        p25: r2(pct(legacyTotals, 25)),
        p50: r2(pct(legacyTotals, 50)),
        p75: r2(pct(legacyTotals, 75)),
        histogram: histogram(legacyTotals, Array.from({ length: 21 }, (_, i) => i * 5)),
        levels: [70, 60, 50].map((min) => ({ min, n: legacyTotals.filter((t) => t >= min).length })),
      },
      results,
    },
    null,
    2,
  ),
  "utf8",
);
console.error("\nเขียนผลลัพธ์:", path.relative(ROOT, jsonOut));

if (WRITE_MD) {
  const n = (x) => Number(x ?? 0).toLocaleString("th-TH");
  const f = (x, k = 2) => Number(x ?? 0).toFixed(k);
  const L = [];
  L.push("# ผลทดลองชุดเกณฑ์ที่เสนอ กับข้อมูลจริง");
  L.push("");
  L.push(`> สร้างโดย \`scripts/simulate-criteria.mjs\` · ${new Date().toLocaleString("th-TH")}`);
  L.push(`> แหล่งข้อมูล: ${SOURCE} · ประชากร ${n(rows.length)} โรงเรียนพื้นที่สูงที่ยืนยันสถานะปี 2569`);
  L.push(`> เกณฑ์เดิมที่ใช้เทียบ: คะแนนเฉลี่ย ${f(mean(legacyTotals))} · ผ่านจุดตัด 70 จำนวน ${n(legacyPass)} แห่ง`);
  L.push("> **สถานะ:** ผลการคำนวณเชิงเทคนิค ไม่ใช่ข้อเสนอที่ผ่านความเห็นชอบ");
  L.push("");
  for (const r of results) {
    L.push(`## ${r.config.name}`);
    L.push("");
    L.push(`\`${r.config.file}\` · คะแนนเต็ม ${r.config.fullScore} · จุดตัด ${r.config.passThreshold}`);
    if (r.config.status) L.push(`สถานะ: ${r.config.status}`);
    L.push("");
    if (r.config.note) {
      L.push(`> ${r.config.note}`);
      L.push("");
    }
    L.push("### ผลรวม");
    L.push("");
    L.push("| ตัวชี้วัด | ค่า |");
    L.push("|---|---:|");
    L.push(`| คะแนนเฉลี่ย | ${f(r.totals.mean)} (SD ${f(r.totals.sd)}) |`);
    L.push(`| มัธยฐาน / P25 / P75 | ${f(r.totals.p50)} / ${f(r.totals.p25)} / ${f(r.totals.p75)} |`);
    L.push(`| ไม่ผ่านด่านคัดกรอง | ${n(r.gate.failed)} แห่ง (${f(r.gate.failedPct, 1)}%) |`);
    L.push(`| ผ่านจุดตัด ${r.config.passThreshold} | ${n(r.vsLegacy.newPassAtThreshold)} แห่ง (เกณฑ์เดิม ${n(legacyPass)}) |`);
    L.push(`| ได้สิทธิ์เพิ่ม / เสียสิทธิ์ | ${n(r.vsLegacy.gainers)} / ${n(r.vsLegacy.losers)} (รวมเปลี่ยน ${f(r.vsLegacy.changedPct, 1)}%) |`);
    L.push(`| สหสัมพันธ์อันดับกับเกณฑ์เดิม (ρ) | ${f(r.vsLegacy.spearman)} |`);
    L.push(`| จุดตัดที่ให้จำนวนผ่านเท่าเกณฑ์เดิม | ${r.vsLegacy.cutForLegacyCount ?? "—"} |`);
    L.push("");
    L.push("### เส้นแบ่งระดับที่เทียบเท่าของเดิม");
    L.push("");
    L.push(
      "ถ้าต้องการให้จำนวนโรงเรียนในแต่ละกลุ่มเท่ากับเกณฑ์เดิม ต้องย้ายเส้นแบ่งไปที่คะแนนต่อไปนี้ — " +
        "การคงเลข 70/60/50 ไว้เฉย ๆ หลังเปลี่ยนสูตร เท่ากับเปลี่ยนจำนวนผู้ได้สิทธิ์แต่ละกลุ่มโดยไม่ได้ตั้งใจ",
    );
    L.push("");
    L.push("| กลุ่ม | เส้นแบ่งเดิม | จำนวนเดิม | เส้นแบ่งเทียบเท่าในเกณฑ์นี้ |");
    L.push("|---|---:|---:|---:|");
    const levelNames = { 70: "กลุ่มที่ 3 ยุ่งยากมากที่สุด", 60: "กลุ่มที่ 2 ขึ้นไป", 50: "กลุ่มที่ 1 ขึ้นไป" };
    for (const e of r.vsLegacy.equivalentLevels) {
      L.push(
        `| ${levelNames[e.legacyMin]} | ≥ ${e.legacyMin} | ${n(e.legacyCount)} | **≥ ${
          e.equivalentMin === null ? "—" : f(e.equivalentMin)
        }** |`,
      );
    }
    L.push("");
    L.push("### จำนวนที่ผ่านแต่ละจุดตัด");
    L.push("");
    L.push("| จุดตัด | ผ่าน | % |");
    L.push("|---:|---:|---:|");
    for (const c of r.cuts) L.push(`| ${c.cut} | ${n(c.pass)} | ${f(c.pct, 1)}% |`);
    L.push("");
    L.push("### ผลตรวจสุขภาพรายข้อ");
    L.push("");
    L.push(
      `ผ่านเกณฑ์ตรวจรับ **${r.health.passed} จาก ${r.health.total} ข้อ** ` +
        `(เกณฑ์: น้ำหนัก ≤ ${r.health.thresholds.maxWeight} คะแนน · ได้เต็ม ≤ ${r.health.thresholds.maxFullPct}% · ` +
        `ได้ 0 คะแนน ≤ ${r.health.thresholds.maxZeroPct}% · D ≥ ${r.health.thresholds.minD})`,
    );
    L.push("");
    if (r.health.failing.length) {
      L.push("| ข้อ | ตัวชี้วัด | ประเด็นที่ไม่ผ่าน |");
      L.push("|---|---|---|");
      for (const h of r.health.failing) L.push(`| ${h.id} | ${h.title} | ${h.issues.join(" · ")} |`);
      L.push("");
    }
    L.push("### พฤติกรรมรายข้อของชุดเกณฑ์นี้");
    L.push("");
    L.push("| id | ตัวชี้วัด | ตัวแปร | เต็ม | เฉลี่ย | %ของเต็ม | ได้เต็ม | ได้ 0 | item–rest r | D |");
    L.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const it of r.items) {
      L.push(
        `| ${it.id} | ${it.title} | \`${it.variable}\` | ${it.max} | ${f(it.mean)} | ${f(it.share, 1)}% | ${f(
          it.fullPct,
          1,
        )}% | ${f(it.zeroPct, 1)}% | ${f(it.itemRestCorr)} | ${f(it.D)} |`,
      );
    }
    L.push("");
    L.push("### ผลกระทบรายจังหวัด (15 จังหวัดที่มีโรงเรียนมากที่สุด)");
    L.push("");
    L.push("| จังหวัด | โรงเรียน | เฉลี่ยเดิม | เฉลี่ยใหม่ | ผ่านเดิม | ผ่านใหม่ |");
    L.push("|---|---:|---:|---:|---:|---:|");
    for (const p2 of r.provinces) {
      L.push(
        `| ${p2.province} | ${n(p2.n)} | ${f(p2.meanOld)} | ${f(p2.meanNew)} | ${n(p2.passOld)} | ${n(p2.passNew)} |`,
      );
    }
    L.push("");
  }
  const mdOut = path.join(ROOT, "docs", "ANALYSIS-ผลทดลองเกณฑ์2569.md");
  fs.writeFileSync(mdOut, L.join("\n"), "utf8");
  console.error("เขียนรายงาน:", path.relative(ROOT, mdOut));
}
