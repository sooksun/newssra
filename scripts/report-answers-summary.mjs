// แจกแจงคำตอบรายข้อทุกข้อ (ภาพรวมทั้งกลุ่มตัวอย่าง) + จัดอันดับว่าข้อใดมีผลต่อคะแนนประเมินมากที่สุด
//
//   node scripts/report-answers-summary.mjs
//
// ผลลัพธ์: docs/ANALYSIS-แจกแจงคำตอบรายข้อ.md · docs/analysis/answers-summary.json
//          docs/analysis/answers-summary.csv (รูปแบบยาว สำหรับทำ pivot)
//
// ต่างจาก ANALYSIS-การตอบรายข้อรายปี.md ตรงที่ไฟล์นั้นแยกตามรอบปี ส่วนไฟล์นี้เป็นภาพรวมของ
// ประชากรเดียวกับที่ใช้คิดคะแนน (รอบล่าสุดของแต่ละโรงเรียนที่ยืนยันสถานะปี 2569) จึงเทียบกับคะแนนได้ตรง

import fs from "node:fs";
import path from "node:path";
import { loadLegacyPopulation } from "./legacy-population.mjs";
import { HIGHLAND_ITEMS, ISLAND_ITEMS } from "./legacy-items.mjs";
import { HIGHLAND_MEASURES, ISLAND_MEASURES, MEASURE_TYPES } from "./legacy-measures.mjs";
import { calcHighland, calcIsland, num, r2 } from "./legacy-score.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "analysis");
const PASS = 70;

/* ------------------------------ สถิติ ------------------------------ */
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const variance = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};
const sd = (a) => Math.sqrt(variance(a));
const cov = (a, b) => {
  if (a.length < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
};
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * (p / 100);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

/** ช่วงค่าสำหรับข้อที่เป็นตัวเลข */
const BANDS = {
  highland: {
    1: { edges: [0, 1, 500, 700, 1000, 1300, Infinity], labels: ["0 (ไม่มีข้อมูล)", "1–499", "500–699", "700–999", "1,000–1,299", "≥ 1,300"] },
    4: { edges: [0, 0.01, 2, 5, 10, Infinity], labels: ["0 (ไม่มีเส้นทางลำบาก)", "0.01–1.99", "2–4.99", "5–9.99", "≥ 10"] },
    5: { edges: [0, 1, 50, 100, 150, 200, Infinity], labels: ["0 (ไม่มีข้อมูล)", "1–49", "50–99", "100–149", "150–199", "≥ 200"] },
    11: { edges: [0, 0.01, 25, 50, 75, 99.99, Infinity], labels: ["0%", "0.01–24.99%", "25–49.99%", "50–74.99%", "75–99.99%", "100%"] },
    12: { edges: [0, 1, 2, 3, 4, 5, Infinity], labels: ["0 กลุ่ม", "1 กลุ่ม", "2 กลุ่ม", "3 กลุ่ม", "4 กลุ่ม", "≥ 5 กลุ่ม"] },
    13: { edges: [0, 1, 21, 51, 101, 201, Infinity], labels: ["0 คน", "1–20", "21–50", "51–100", "101–200", "≥ 201"] },
    14: { edges: [0, 1, 11, 31, 51, Infinity], labels: ["0 คน", "1–10", "11–30", "31–50", "≥ 51"] },
    15: { edges: [0, 1, 2, 3, Infinity], labels: ["ไม่มีสาขา", "1 แห่ง", "2 แห่ง", "≥ 3 แห่ง"] },
  },
  island: {
    5: { edges: [0, 0.01, 5, 10, 20, Infinity], labels: ["0", "0.01–4.99", "5–9.99", "10–19.99", "≥ 20"] },
    6: { edges: [0, 0.01, 5, 10, 20, Infinity], labels: ["0", "0.01–4.99", "5–9.99", "10–19.99", "≥ 20"] },
    7: { edges: [0, 1, 30, 60, 90, Infinity], labels: ["0", "1–29", "30–59", "60–89", "≥ 90"] },
    8: { edges: [0, 1, 50, 100, 300, 500, Infinity], labels: ["0", "1–49", "50–99", "100–299", "300–499", "≥ 500"] },
    15: { edges: [0, 1, 11, 31, 51, Infinity], labels: ["0 คน", "1–10", "11–30", "31–50", "≥ 51"] },
  },
};
const bandOf = (v, band) => {
  for (let i = band.edges.length - 2; i >= 0; i--) if (v >= band.edges[i]) return i;
  return 0;
};

/* ------------------------------ วิเคราะห์หนึ่งพื้นที่ ------------------------------ */

function analyse(areaKey, items, measures, rows, calcFn) {
  const scored = rows.map(({ row, hill }) => (areaKey === "highland" ? calcFn(row, hill) : calcFn(row)));
  const totals = scored.map((s) => s.sum_score);
  const varTotal = variance(totals);
  const n = rows.length;

  const out = items.map((item) => {
    const band = BANDS[areaKey]?.[item.no] ?? null;
    const m = measures[item.no] ?? {};
    const scores = scored.map((s) => num(s[item.scoreKey]));

    // ข้อ 11/12 ของพื้นที่สูงเป็นค่าที่ระบบคำนวณ ไม่ได้อยู่ในคอลัมน์ดิบ
    const rawOf = ({ row, hill }, i) =>
      areaKey === "highland" && item.no === 11
        ? num(scored[i].pct11)
        : areaKey === "highland" && item.no === 12
          ? num(scored[i].groups12)
          : num(row[item.key]);

    const base = {
      no: item.no,
      key: item.key,
      title: item.title,
      short: item.short,
      max: item.max,
      measure: m.measure ?? null,
      measureLabel: MEASURE_TYPES[m.measure]?.label ?? null,
      unit: m.unit ?? item.unit ?? null,
      rule: item.rule ?? null,
      n,
      score: {
        mean: r2(mean(scores)),
        sd: r2(sd(scores)),
        sharePct: item.max ? r2((mean(scores) / item.max) * 100) : 0,
        zeroPct: r2((scores.filter((s) => s === 0).length / n) * 100),
        fullPct: item.max ? r2((scores.filter((s) => s >= item.max - 0.001).length / n) * 100) : 0,
      },
      impact: {
        // สัดส่วนของความแปรปรวนของคะแนนรวมที่มาจากข้อนี้ — ผลรวมทุกข้อเท่ากับ 100% พอดี
        varianceSharePct: varTotal > 0 ? r2((cov(scores, totals) / varTotal) * 100) : 0,
        contribution: r2(mean(scores)),
        // ถ้าตัดข้อนี้ทิ้งแล้วปรับสเกลกลับ 100 จะมีกี่ % ที่สลับผลได้/ตกที่จุดตัด 70
        flipPct: (() => {
          if (item.max <= 0 || item.max >= 100) return 0;
          const scale = 100 / (100 - item.max);
          let flips = 0;
          for (let i = 0; i < n; i++) {
            const before = totals[i] >= PASS;
            const after = (totals[i] - scores[i]) * scale >= PASS;
            if (before !== after) flips++;
          }
          return r2((flips / n) * 100);
        })(),
        D: (() => {
          if (!item.max) return 0;
          const order = scores.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
          const k = Math.max(1, Math.round(n * 0.27));
          const up = mean(order.slice(0, k).map((i) => scores[i]));
          const low = mean(order.slice(-k).map((i) => scores[i]));
          return r2((up - low) / item.max);
        })(),
      },
    };

    if (band) {
      const values = rows.map(rawOf);
      const counts = new Array(band.labels.length).fill(0);
      for (const v of values) counts[bandOf(v, band)]++;
      base.kind = "numeric";
      base.answers = band.labels.map((label, i) => ({
        label,
        n: counts[i],
        pct: r2((counts[i] / n) * 100),
      }));
      base.stats = {
        mean: r2(mean(values)),
        median: r2(pct(values, 50)),
        sd: r2(sd(values)),
        min: r2(Math.min(...values)),
        max: r2(Math.max(...values)),
        p25: r2(pct(values, 25)),
        p75: r2(pct(values, 75)),
        p90: r2(pct(values, 90)),
      };
    } else {
      const counts = new Map();
      let blank = 0;
      let multi = 0;
      for (const { row } of rows) {
        const raw = String(row[item.key] ?? "").trim();
        if (raw === "" || raw === "0") {
          blank++;
          continue;
        }
        const ids = item.kind === "multi" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [raw];
        if (ids.length > 1) multi++;
        for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      base.kind = "categorical";
      base.multiSelect = item.kind === "multi";
      base.multiSelectedPct = r2((multi / n) * 100);
      base.answers = Object.entries(item.options ?? {}).map(([id, o]) => ({
        id: Number(id),
        label: `${id}. ${o.label}`,
        points: o.points,
        n: counts.get(id) ?? 0,
        pct: r2(((counts.get(id) ?? 0) / n) * 100),
      }));
      base.blank = { n: blank, pct: r2((blank / n) * 100) };
    }
    return base;
  });

  return {
    n,
    totals: {
      mean: r2(mean(totals)),
      sd: r2(sd(totals)),
      variance: r2(varTotal),
      pass70: totals.filter((t) => t >= PASS).length,
    },
    items: out,
  };
}

/**
 * ข้อควรระวังในการอ่านสถิติของบางข้อ — สถิติสูงไม่ได้แปลว่าเป็นตัวชี้วัดที่ดีเสมอไป
 * ต้องกำกับไว้ ไม่งั้นตารางจัดอันดับจะถูกอ่านผิด
 */
const CAVEATS = {
  highland: {
    16: "อำนาจจำแนกสูงเพราะข้อนี้ **เป็นผลของการประกาศครั้งก่อน** ไม่ใช่การวัดความลำบากจริง — การเพิ่มน้ำหนักจะทำให้เกณฑ์รับรองการตัดสินใจเดิมของตัวเองเป็นวงจร ควรใช้เป็นตัวสอบทานผลแทน",
    11: "กระจุกตัวที่ปลายบน (45.2% ได้เต็ม เพราะนักเรียนเป็นกลุ่มชาติพันธุ์ 100%) — ควรจัดเป็นช่วงแทนสัดส่วนเชิงเส้น",
    1: "ตัวเลข *สลับผลได้/ตก* สูงที่สุด (24.3%) เพราะข้อนี้กินน้ำหนัก 30 คะแนน การตัดทิ้งจึงกระทบคะแนนทุกคนพร้อมกัน ไม่ใช่เพราะข้อนี้จำแนกได้ดี — ดูที่ D=0.04 ประกอบเสมอ",
  },
  island: {
    3: "คำถามใช่/ไม่ใช่ข้อเดียวถือน้ำหนัก 16 คะแนน ผลจึงถูกกำหนดด้วยคำตอบเดียว",
    4: "ข้อเชิงคุณภาพข้อเดียวถือน้ำหนักสูงสุดของเกณฑ์ (20 คะแนน)",
  },
};

/** ข้อเสนอว่าควรคงข้อนั้นไว้หรือไม่ — อิงจากผลต่อคะแนนและอำนาจจำแนก */
function verdictOf(it, areaKey) {
  if (areaKey === "highland" && it.no === 16) {
    return {
      key: "keep-nomore",
      label: "คงไว้ แต่ห้ามเพิ่มน้ำหนัก",
      why: `มีผลต่อคะแนนสูงสุด (${it.impact.varianceSharePct}%) แต่เป็นวงจรย้อนกลับ — ดูข้อควรระวัง`,
    };
  }
  const v = it.impact.varianceSharePct;
  const D = it.impact.D;
  const s = it.score;
  if (v >= 15 && D < 0.15)
    return {
      key: "fix",
      label: "คงไว้แต่ต้องแก้สูตร",
      why: `กินความแปรปรวนของคะแนนรวม ${v}% แต่จำแนกไม่ได้ (D=${D}) — น้ำหนักมากโดยไม่ได้ทำหน้าที่`,
    };
  if (D >= 0.3 && v >= 5)
    return { key: "keep", label: "คงไว้ — เป็นแกนหลัก", why: `จำแนกได้ดี (D=${D}) และมีผลต่อคะแนนจริง ${v}%` };
  if (D >= 0.3)
    return { key: "keep-weight", label: "คงไว้ และควรเพิ่มน้ำหนัก", why: `จำแนกได้ดี (D=${D}) แต่ให้น้ำหนักเพียง ${it.max} คะแนน` };
  if (D >= 0.2) return { key: "review", label: "ทบทวนสูตร", why: `อำนาจจำแนกพอใช้ (D=${D}) แต่ยังไม่ถึงเกณฑ์ที่ดี` };
  if (s.zeroPct >= 70)
    return { key: "move", label: "ย้ายออกจากคะแนนหลัก", why: `${s.zeroPct}% ได้ 0 คะแนน — เป็นแต้มพิเศษของกลุ่มเล็ก ไม่ใช่ตัวชี้วัดร่วม` };
  if (s.fullPct >= 60)
    return { key: "move", label: "ย้ายไปเป็นเงื่อนไขคุณสมบัติ", why: `${s.fullPct}% ได้เต็ม — ทุกคนมีเหมือนกัน จึงไม่ได้จำแนกใคร` };
  return { key: "move", label: "ย้ายออกจากคะแนนหลัก", why: `D=${D} ต่ำเกินกว่าจะช่วยจำแนก` };
}

/* --------------------------------- main --------------------------------- */

const high = await loadLegacyPopulation({ areaType: 1 });
const island = await loadLegacyPopulation({ areaType: 2 });
console.error("แหล่งข้อมูล:", high.source);
console.error(`ประชากร: พื้นที่สูง ${high.rows.length} แห่ง · พื้นที่เกาะ ${island.rows.length} แห่ง`);

const H = analyse("highland", HIGHLAND_ITEMS, HIGHLAND_MEASURES, high.rows, calcHighland);
const I = analyse("island", ISLAND_ITEMS, ISLAND_MEASURES, island.rows, calcIsland);
for (const it of H.items) { it.verdict = verdictOf(it, "highland"); it.caveat = CAVEATS.highland[it.no] ?? null; }
for (const it of I.items) { it.verdict = verdictOf(it, "island"); it.caveat = CAVEATS.island[it.no] ?? null; }

const result = {
  generatedAt: new Date().toISOString(),
  source: high.source,
  rule: high.rule,
  note:
    "ร้อยละคำนวณจากจำนวนโรงเรียนทั้งหมดในกลุ่มตัวอย่าง · ข้อที่เลือกได้หลายตัวเลือกผลรวมเกิน 100% ได้ · " +
    "varianceSharePct = สัดส่วนความแปรปรวนของคะแนนรวมที่มาจากข้อนั้น (ผลรวมทุกข้อ = 100%)",
  highland: H,
  island: I,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "answers-summary.json"), JSON.stringify(result, null, 2), "utf8");

/* ---- CSV ---- */
const csv = ["area,item_no,item_short,measure,answer,points,n,pct,item_max,variance_share_pct,D"];
const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
for (const [key, label] of [
  ["highland", "พื้นที่สูง"],
  ["island", "พื้นที่เกาะ"],
]) {
  for (const it of result[key].items) {
    for (const a of it.answers) {
      csv.push(
        [q(label), it.no, q(it.short), q(it.measure), q(a.label), a.points ?? "", a.n, a.pct, it.max, it.impact.varianceSharePct, it.impact.D].join(","),
      );
    }
    if (it.blank?.n) {
      csv.push([q(label), it.no, q(it.short), q(it.measure), q("(ไม่ได้กรอก)"), "", it.blank.n, it.blank.pct, it.max, it.impact.varianceSharePct, it.impact.D].join(","));
    }
  }
}
fs.writeFileSync(path.join(OUT_DIR, "answers-summary.csv"), "﻿" + csv.join("\r\n"), "utf8");

/* ---- Markdown ---- */
const n = (x) => Number(x ?? 0).toLocaleString("th-TH");
const f = (x, k = 1) => Number(x ?? 0).toFixed(k);
const L = [];
L.push("# แจกแจงคำตอบรายข้อ และข้อเสนอว่าควรคงเกณฑ์ข้อใด");
L.push("");
L.push(`> สร้างโดย \`scripts/report-answers-summary.mjs\` · ${new Date().toLocaleString("th-TH")}`);
L.push(`> **แหล่งข้อมูล:** ${result.source}`);
L.push(`> **กลุ่มตัวอย่าง:** พื้นที่สูง ${n(H.n)} แห่ง · พื้นที่เกาะ ${n(I.n)} แห่ง — ${result.rule}`);
L.push("> **สถานะ:** เอกสารวิเคราะห์เชิงสถิติ ไม่ใช่ประกาศเกณฑ์");
L.push("");
L.push("## วิธีอ่าน");
L.push("");
L.push("- **ร้อยละ** คิดจากจำนวนโรงเรียนทั้งหมดในกลุ่มตัวอย่าง");
L.push("- ข้อที่เลือกได้หลายตัวเลือก (ข้อ 7–10 ของพื้นที่สูง) ผลรวมร้อยละจะ **เกิน 100%** เพราะหนึ่งโรงเรียนนับได้หลายตัวเลือก");
L.push("- ข้อที่เป็นตัวเลขแสดงทั้งการแจกแจงตามช่วง และค่าเฉลี่ย/มัธยฐาน/SD/เปอร์เซ็นไทล์");
L.push(
  "- **ส่วนแบ่งความแปรปรวน** = สัดส่วนของความแปรปรวนของคะแนนรวมที่มาจากข้อนั้น คำนวณจาก cov(คะแนนข้อนั้น, คะแนนรวม) ÷ var(คะแนนรวม) " +
    "ซึ่งผลรวมของทุกข้อเท่ากับ 100% พอดี — เป็นตัวชี้วัดที่ตรงที่สุดว่า \"ข้อนี้มีผลต่อคะแนนประเมินแค่ไหน\"",
);
L.push("");

for (const [areaKey, areaLabel, area] of [
  ["highland", "พื้นที่สูง", H],
  ["island", "พื้นที่เกาะ", I],
]) {
  L.push(`## ${areaLabel} — กลุ่มตัวอย่าง ${n(area.n)} แห่ง`);
  L.push("");
  L.push(
    `คะแนนรวมเฉลี่ย ${f(area.totals.mean, 2)} · SD ${f(area.totals.sd, 2)} · ผ่านจุดตัด 70 จำนวน ${n(area.totals.pass70)} แห่ง`,
  );
  L.push("");

  for (const it of area.items) {
    L.push(`### ข้อ ${it.no} — ${it.title}`);
    L.push("");
    L.push(
      `ชนิดของค่า: ${it.measureLabel ?? "—"}${it.unit ? ` (${it.unit})` : ""} · คะแนนเต็ม ${it.max}` +
        (it.rule ? ` · สูตร: ${it.rule}` : ""),
    );
    L.push("");
    if (it.kind === "categorical") {
      L.push(
        `| คำตอบ | คะแนนที่ได้ | จำนวน (แห่ง) | ร้อยละ |`,
      );
      L.push("|---|---:|---:|---:|");
      for (const a of it.answers) L.push(`| ${a.label} | ${a.points} | ${n(a.n)} | ${f(a.pct)}% |`);
      if (it.blank.n) L.push(`| *(ไม่ได้กรอก)* | 0 | ${n(it.blank.n)} | ${f(it.blank.pct)}% |`);
      L.push("");
      if (it.multiSelect) L.push(`เลือกมากกว่า 1 ตัวเลือก ${f(it.multiSelectedPct)}% ของกลุ่มตัวอย่าง`);
      if (it.multiSelect) L.push("");
    } else {
      L.push("| ช่วงค่า | จำนวน (แห่ง) | ร้อยละ |");
      L.push("|---|---:|---:|");
      for (const a of it.answers) L.push(`| ${a.label} | ${n(a.n)} | ${f(a.pct)}% |`);
      L.push("");
      L.push("| ค่าเฉลี่ย | มัธยฐาน | SD | P25 | P75 | P90 | ต่ำสุด | สูงสุด |");
      L.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
      L.push(
        `| ${f(it.stats.mean, 2)} | ${f(it.stats.median, 2)} | ${f(it.stats.sd, 2)} | ${f(it.stats.p25, 2)} | ${f(
          it.stats.p75,
          2,
        )} | ${f(it.stats.p90, 2)} | ${f(it.stats.min, 2)} | ${f(it.stats.max, 2)} |`,
      );
      L.push("");
    }
    L.push(
      `**คะแนนที่ได้จริง** เฉลี่ย ${f(it.score.mean, 2)} จาก ${it.max} (${f(it.score.sharePct)}% ของคะแนนเต็มข้อนี้) · ` +
        `ได้เต็ม ${f(it.score.fullPct)}% · ได้ 0 คะแนน ${f(it.score.zeroPct)}% · ` +
        `**ส่วนแบ่งความแปรปรวน ${f(it.impact.varianceSharePct)}%** · D = ${f(it.impact.D, 2)}`,
    );
    L.push("");
  }
}

/* ---- ตารางจัดอันดับ + ข้อเสนอ ---- */
L.push("## ข้อเสนอ — ควรคงเกณฑ์ข้อใดไว้ เรียงตามผลต่อคะแนนประเมิน");
L.push("");
L.push(
  "เรียงจาก **ส่วนแบ่งความแปรปรวนของคะแนนรวม** จากมากไปน้อย — ตัวเลขนี้ตอบตรง ๆ ว่าคะแนนที่โรงเรียนแต่ละแห่งได้ต่างกัน " +
    "มาจากข้อไหนเป็นหลัก (ผลรวมทุกข้อ = 100%) คอลัมน์ *สลับผลได้/ตก* คือถ้าตัดข้อนั้นทิ้งแล้วปรับสเกลกลับ 100 " +
    "จะมีโรงเรียนกี่ % ที่เปลี่ยนสถานะผ่าน/ไม่ผ่านที่จุดตัด 70",
);
L.push("");
L.push(
  "**สองคอลัมน์นี้ตอบคนละคำถาม และบางข้อให้คำตอบขัดกัน** — *ส่วนแบ่งความแปรปรวน* บอกว่าคะแนนที่ต่างกันระหว่างโรงเรียนมาจากข้อไหน " +
    "ส่วน *สลับผลได้/ตก* บอกว่าถ้าถอดข้อนั้นออกจะกระทบสถานะกี่แห่ง ข้อที่มีน้ำหนักมากแต่ทุกคนได้เท่ากัน (เช่น ข้อ 1 ความสูง) " +
    "จะมีค่าคอลัมน์หลังสูงโดยไม่ได้แปลว่าจำแนกได้ดี เพราะการถอดออกทำให้คะแนนของทุกคนขยับพร้อมกัน — ต้องดู D ประกอบเสมอ",
);
L.push("");

for (const [areaLabel, area] of [
  ["พื้นที่สูง", H],
  ["พื้นที่เกาะ", I],
]) {
  const ranked = [...area.items].sort((a, b) => b.impact.varianceSharePct - a.impact.varianceSharePct);
  L.push(`### ${areaLabel}`);
  L.push("");
  L.push("| อันดับ | ข้อ | ตัวชี้วัด | เต็ม | ส่วนแบ่งความแปรปรวน | สลับผลได้/ตก | D | ข้อเสนอ | เหตุผล |");
  L.push("|---:|---:|---|---:|---:|---:|---:|---|---|");
  ranked.forEach((it, i) => {
    L.push(
      `| ${i + 1} | ${it.no}${it.caveat ? " ⚠" : ""} | ${it.short} | ${it.max} | **${f(
        it.impact.varianceSharePct,
      )}%** | ${f(it.impact.flipPct)}% | ${f(it.impact.D, 2)} | ${it.verdict.label} | ${it.verdict.why} |`,
    );
  });
  L.push("");
  const caveated = ranked.filter((it) => it.caveat);
  if (caveated.length) {
    L.push("**⚠ ข้อควรระวังในการอ่านตารางนี้**");
    L.push("");
    for (const it of caveated) L.push(`- **ข้อ ${it.no} ${it.short}** — ${it.caveat}`);
    L.push("");
  }
  const groups = {};
  for (const it of ranked) (groups[it.verdict.key] ??= []).push(it);
  const order = [
    ["keep", "คงไว้ — เป็นแกนหลักของเกณฑ์"],
    ["keep-nomore", "คงไว้ แต่ห้ามเพิ่มน้ำหนัก"],
    ["keep-weight", "คงไว้ และควรเพิ่มน้ำหนัก"],
    ["fix", "คงไว้แต่ต้องแก้สูตรก่อน"],
    ["review", "ทบทวนสูตร"],
    ["move", "ย้ายออกจากคะแนนหลัก"],
  ];
  L.push("**สรุปเป็นกลุ่ม**");
  L.push("");
  for (const [k, label] of order) {
    if (!groups[k]?.length) continue;
    const sum = groups[k].reduce((s, it) => s + it.impact.varianceSharePct, 0);
    L.push(
      `- **${label}** — ข้อ ${groups[k].map((it) => `${it.no} ${it.short}`).join(", ")} (รวมส่วนแบ่งความแปรปรวน ${f(sum)}%)`,
    );
  }
  L.push("");
}

const top = [...H.items].sort((a, b) => b.impact.varianceSharePct - a.impact.varianceSharePct);
const keepers = top.filter((it) => ["keep", "keep-weight"].includes(it.verdict.key));
const movers = top.filter((it) => it.verdict.key === "move");
L.push("### อ่านผลโดยสรุป (พื้นที่สูง)");
L.push("");
L.push(
  `- ข้อที่ควร **คงไว้เป็นแกนหลัก** มี ${keepers.length} ข้อ คือข้อ ${keepers.map((it) => `${it.no} ${it.short}`).join(", ")} ` +
    `รวมส่วนแบ่งความแปรปรวน ${f(keepers.reduce((s, it) => s + it.impact.varianceSharePct, 0))}%`,
);
L.push(
  `- ข้อที่ควร **ย้ายออกจากคะแนนหลัก** มี ${movers.length} ข้อ รวมส่วนแบ่งเพียง ${f(
    movers.reduce((s, it) => s + it.impact.varianceSharePct, 0),
  )}% — ตัดออกแล้วคะแนนแทบไม่เปลี่ยนลำดับ แต่ทำให้เกณฑ์สั้นลงและอธิบายง่ายขึ้น`,
);
const fixers = top.filter((it) => it.verdict.key === "fix");
if (fixers.length) {
  L.push(
    `- ข้อที่ **กินน้ำหนักมากแต่ไม่ได้ทำหน้าที่** คือข้อ ${fixers
      .map((it) => `${it.no} ${it.short} (ส่วนแบ่ง ${f(it.impact.varianceSharePct)}% · D=${f(it.impact.D, 2)})`)
      .join(", ")} — ต้องแก้สูตรก่อน ไม่ใช่แค่ลดน้ำหนัก`,
  );
}
L.push("");
L.push(
  "> ข้อเสนอในตารางนี้เป็นข้อสรุป **เชิงสถิติ** จากพฤติกรรมของข้อมูลจริง " +
    "การตัดสินใจว่าจะคงหรือย้ายรายการใดออกจากเกณฑ์เป็นอำนาจของคณะกรรมการ — ดูข้อพิจารณาเชิงนโยบายใน " +
    "[RECOMMENDATIONS-เกณฑ์2569.md](./RECOMMENDATIONS-เกณฑ์2569.md)",
);
L.push("");

const mdOut = path.join(ROOT, "docs", "ANALYSIS-แจกแจงคำตอบรายข้อ.md");
fs.writeFileSync(mdOut, L.join("\n"), "utf8");
console.error("เขียนรายงาน:", path.relative(ROOT, mdOut));
console.error("เขียนข้อมูล :", path.relative(ROOT, path.join(OUT_DIR, "answers-summary.json")));
console.error("เขียน CSV   :", path.relative(ROOT, path.join(OUT_DIR, "answers-summary.csv")));

// ตรวจว่าส่วนแบ่งความแปรปรวนรวมกันได้ 100% จริง (กันสูตรผิดโดยไม่รู้ตัว)
for (const [label, area] of [
  ["พื้นที่สูง", H],
  ["พื้นที่เกาะ", I],
]) {
  const sum = area.items.reduce((s, it) => s + it.impact.varianceSharePct, 0);
  console.error(`ตรวจสอบ: ผลรวมส่วนแบ่งความแปรปรวน ${label} = ${sum.toFixed(2)}%`);
}
