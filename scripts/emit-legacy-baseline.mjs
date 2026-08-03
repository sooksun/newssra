// ส่งออกค่าสถิติฐาน (จาก docs/analysis/legacy-item-stats.json) เป็นโมดูล TypeScript
// เพื่อให้โค้ดเกณฑ์ปี 2569 อ้างอิงตัวเลขจริงได้โดยไม่ต้องคัดลอกด้วยมือ
//   node scripts/emit-legacy-baseline.mjs   → lib/legacy-baseline.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "docs", "analysis", "legacy-item-stats.json");
const OUT = path.join(ROOT, "lib", "legacy-baseline.ts");

const d = JSON.parse(fs.readFileSync(IN, "utf8"));
const H = d.highland;
const I = d.island;

const j = (v) => JSON.stringify(v, null, 2);

const itemBaseline = (items) =>
  items.map((it) => ({
    no: it.no,
    key: it.key,
    short: it.short,
    group: it.group,
    max: it.max,
    meanScore: it.score.mean,
    sharePct: it.score.share,
    fullPct: it.score.fullPct,
    zeroPct: it.score.zeroPct,
    itemRestR: it.discrimination.itemRestCorr,
    D: it.discrimination.D,
    flipPct: it.impact.flipPct,
    verdict:
      it.score.share >= 90 && it.discrimination.D < 0.15
        ? "free"
        : it.score.zeroPct >= 70
          ? "floor"
          : it.discrimination.D >= 0.3
            ? "discriminating"
            : "weak",
  }));

const numericPercentiles = Object.fromEntries(
  H.bands.map((b) => [b.no, { short: b.short, unit: b.unit, percentiles: Object.fromEntries(b.percentiles.map((p) => [p.p, p.v])) }]),
);

const src = `// ค่าสถิติฐานจากผลการประเมินเดิม (ssrainfo_ssra) — ใช้เป็นข้อมูลอ้างอิงของเกณฑ์ปี 2569
//
// **ไฟล์นี้สร้างอัตโนมัติ — อย่าแก้ด้วยมือ**
// สร้างใหม่ด้วย: node scripts/analyze-legacy-items.mjs && node scripts/emit-legacy-baseline.mjs
//
// ที่มา: ${d.meta.source}
// ประชากร: พื้นที่สูง ${d.meta.populations.highland.analysed} แห่ง · พื้นที่เกาะ ${d.meta.populations.island.analysed} แห่ง
//          (${d.meta.populations.highland.rule})
// รายงานประกอบ: docs/ANALYSIS-เกณฑ์เดิมรายข้อ.md

export const LEGACY_BASELINE_META = ${j({
  generatedAt: d.meta.generatedAt,
  source: d.meta.source,
  passThreshold: d.meta.passThreshold,
  populations: d.meta.populations,
  yearCoverage: d.meta.yearCoverage,
})} as const;

/** สรุปพฤติกรรมรายข้อของเกณฑ์เดิม — verdict: free = แจกฟรี, floor = ส่วนใหญ่ได้ 0, discriminating = จำแนกได้, weak = อ่อน */
export const LEGACY_HIGHLAND_ITEM_BASELINE = ${j(itemBaseline(H.items))} as const;

export const LEGACY_ISLAND_ITEM_BASELINE = ${j(itemBaseline(I.items))} as const;

/** กลุ่มข้อมูลพื้นฐาน — คะแนนเต็มที่จัดสรรไว้ vs คะแนนที่ถูกใช้จริง */
export const LEGACY_GROUP_BASELINE = ${j(
  H.groups.map((g) => ({
    key: g.key,
    label: g.label,
    source: g.source,
    verifiable: g.verifiable,
    items: g.items,
    maxScore: g.maxScore,
    meanScore: g.mean,
    utilisationPct: g.utilisation,
  })),
)} as const;

/** การกระจายคะแนนรวมและจำนวนที่ผ่านแต่ละจุดตัด (พื้นที่สูง) */
export const LEGACY_TOTAL_DISTRIBUTION = ${j({
  n: H.totals.n,
  mean: H.totals.mean,
  sd: H.totals.sd,
  p10: H.totals.p10,
  p25: H.totals.p25,
  p50: H.totals.p50,
  p75: H.totals.p75,
  p90: H.totals.p90,
  cuts: H.totals.cuts,
  nearCut: H.totals.nearCut,
  histogram: H.totals.histogram,
})} as const;

/** การกระจายความสูงจริง + ผลของสูตรสองแบบ (ดูรายงานหัวข้อ 7) */
export const LEGACY_ELEVATION = ${j({
  percentiles: {
    p10: H.elevationRegimes.elevation.p10,
    p25: H.elevationRegimes.elevation.p25,
    p50: H.elevationRegimes.elevation.p50,
    p75: H.elevationRegimes.elevation.p75,
    p90: H.elevationRegimes.elevation.p90,
  },
  mean: H.elevationRegimes.elevation.mean,
  sd: H.elevationRegimes.elevation.sd,
  below500Pct: H.elevationRegimes.elevation.below500Pct,
  histogram: H.elevationRegimes.elevation.histogram,
  formulaFitByYear: H.elevationRegimes.fitByYear,
  bunchingAt500: H.elevationRegimes.bunchingAt500,
  underBase15: H.elevationRegimes.scoreUnderBase15,
  underLinear600: H.elevationRegimes.scoreUnderLinear600,
})} as const;

/** เปอร์เซ็นไทล์ของค่าดิบรายข้อที่เป็นตัวเลข — ใช้ตั้ง "ระดับ" แบบอิงการกระจายจริง */
export const LEGACY_NUMERIC_PERCENTILES = ${j(numericPercentiles)} as const;

/** ผลการจำลองทางเลือกน้ำหนัก (ดูรายงานหัวข้อ 9) */
export const LEGACY_WEIGHT_SIMULATIONS = ${j(
  H.simulations.map((s) => ({
    label: s.label,
    mean: s.mean,
    sd: s.sd,
    pass70: s.pass70,
    passRate: s.passRate,
    changedPassStatus: s.changedPassStatus,
    changedPct: s.changedPct,
    spearmanVsCurrent: s.spearmanVsCurrent,
    cutForSameCount: s.cutForSameCount,
  })),
)} as const;

/**
 * จำแนกรายการประเมินตาม "ชนิดของค่าที่วัด" — กำหนดว่าสถิติแบบใดใช้ได้ ต้อง validate อย่างไร
 * และเทียบข้ามโรงเรียนได้ตรง ๆ หรือไม่ (ดูรายงานหัวข้อ 5)
 */
export const LEGACY_MEASUREMENT = ${j({
  highland: {
    split: H.measurement.split,
    byOrigin: H.measurement.byOrigin,
    normalization: H.measurement.normalization,
    taxonomy: H.measurement.taxonomy.map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      validStats: t.validStats,
      invalidStats: t.invalidStats,
      validation: t.validation,
      items: t.items,
      weight: t.weight,
      weightPct: t.weightPct,
      utilisation: t.utilisation,
    })),
    items: H.measurement.items.map((i) => ({
      no: i.no,
      short: i.short,
      max: i.max,
      measure: i.measure,
      scale: i.scale,
      unit: i.unit,
      origin: i.origin,
      normalized: i.normalized,
      collectedAs: i.collectedAs,
      scoredAs: i.scoredAs,
      mismatch: i.mismatch,
    })),
  },
  island: {
    split: I.measurement.split,
    byOrigin: I.measurement.byOrigin,
    taxonomy: I.measurement.taxonomy.map((t) => ({
      key: t.key,
      label: t.label,
      items: t.items,
      weight: t.weight,
      weightPct: t.weightPct,
      utilisation: t.utilisation,
    })),
    items: I.measurement.items.map((i) => ({
      no: i.no,
      short: i.short,
      max: i.max,
      measure: i.measure,
      scale: i.scale,
      unit: i.unit,
      origin: i.origin,
      mismatch: i.mismatch,
    })),
  },
})} as const;

/** คุณภาพข้อมูลที่โค้ดเกณฑ์ใหม่ต้อง validate (สัดส่วนที่พบในข้อมูลเดิม) */
export const LEGACY_DATA_QUALITY = ${j(H.quality)} as const;

/**
 * ค่าที่กรอกอยู่ในเปอร์เซ็นไทล์ใดของประชากรจริง — ใช้แปลงค่าดิบเป็น "ระดับ" โดยอิงการกระจายจริง
 * คืนค่า 0–100 (โดยประมาณจากตารางเปอร์เซ็นไทล์ที่ส่งออกไว้)
 */
export function legacyPercentileOf(itemNo: number, value: number): number | null {
  const entry = (LEGACY_NUMERIC_PERCENTILES as Record<string, { percentiles: Record<string, number> }>)[String(itemNo)];
  if (!entry) return null;
  const points = Object.entries(entry.percentiles)
    .map(([p, v]) => ({ p: Number(p), v }))
    .sort((a, b) => a.p - b.p);
  if (value <= points[0].v) return points[0].p;
  for (let i = 1; i < points.length; i++) {
    if (value <= points[i].v) {
      const lo = points[i - 1];
      const hi = points[i];
      const t = hi.v === lo.v ? 0 : (value - lo.v) / (hi.v - lo.v);
      return Math.round(lo.p + (hi.p - lo.p) * t);
    }
  }
  return points[points.length - 1].p;
}

/** จุดตัดที่ทำให้จำนวนโรงเรียนผ่านเท่ากับจำนวนเป้าหมาย (อิงการกระจายคะแนนรวมเดิม) */
export function legacyCutForCount(target: number): number | null {
  const cuts = LEGACY_TOTAL_DISTRIBUTION.cuts;
  let best: { cut: number; diff: number } | null = null;
  for (const c of cuts) {
    const diff = Math.abs(c.pass - target);
    if (!best || diff < best.diff) best = { cut: c.cut, diff };
  }
  return best ? best.cut : null;
}
`;

fs.writeFileSync(OUT, src, "utf8");
console.error("เขียนโมดูล:", path.relative(ROOT, OUT));
