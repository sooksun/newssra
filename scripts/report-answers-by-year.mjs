// การแจกแจงคำตอบรายข้อ แยกตามรอบปีที่ประเมิน — จำนวนและร้อยละของทุกตัวเลือก/ทุกช่วงค่า
//
//   node scripts/report-answers-by-year.mjs
//
// ผลลัพธ์: docs/ANALYSIS-การตอบรายข้อรายปี.md · docs/analysis/answers-by-year.json
//          docs/analysis/answers-by-year.csv (รูปแบบยาว เอาไปทำ pivot ใน Excel ได้ทันที)
//
// ใช้ "ทุกแถวในฐาน" แยกตามปี ไม่ใช่ประชากรที่คัดแล้วเหมือนรายงานหลัก — เพราะคำถามคือ
// "รอบนั้น ๆ โรงเรียนตอบอะไรบ้าง" จึงต้องนับทุกแถวที่ถูกกรอกในรอบนั้นจริง ๆ

import fs from "node:fs";
import path from "node:path";
import { connectLegacy, describeSource } from "./legacy-db.mjs";
import { HIGHLAND_ITEMS, ISLAND_ITEMS } from "./legacy-items.mjs";
import { HIGHLAND_MEASURES, ISLAND_MEASURES } from "./legacy-measures.mjs";
import { num, r2 } from "./legacy-score.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "analysis");

/** ช่วงค่าสำหรับข้อที่เป็นตัวเลข — กำหนดไว้ให้สื่อความหมาย ไม่ใช่แบ่งเท่า ๆ กันแบบอัตโนมัติ */
const BANDS = {
  highland: {
    1: { unit: "เมตร", edges: [0, 1, 500, 700, 1000, 1300, Infinity], labels: ["0 (ไม่มีข้อมูล)", "1–499", "500–699", "700–999", "1,000–1,299", "≥ 1,300"] },
    4: { unit: "กิโลเมตร", edges: [0, 0.01, 2, 5, 10, Infinity], labels: ["0 (ไม่มีเส้นทางลำบาก)", "0.01–1.99", "2–4.99", "5–9.99", "≥ 10"] },
    5: { unit: "กิโลเมตร", edges: [0, 1, 50, 100, 150, 200, Infinity], labels: ["0 (ไม่มีข้อมูล)", "1–49", "50–99", "100–149", "150–199", "≥ 200"] },
    11: { unit: "ร้อยละ", edges: [0, 0.01, 25, 50, 75, 99.99, Infinity], labels: ["0%", "0.01–24.99%", "25–49.99%", "50–74.99%", "75–99.99%", "100%"] },
    12: { unit: "กลุ่ม", edges: [0, 1, 2, 3, 4, 5, Infinity], labels: ["0 กลุ่ม", "1 กลุ่ม", "2 กลุ่ม", "3 กลุ่ม", "4 กลุ่ม", "≥ 5 กลุ่ม"] },
    13: { unit: "คน", edges: [0, 1, 21, 51, 101, 201, Infinity], labels: ["0 คน", "1–20", "21–50", "51–100", "101–200", "≥ 201"] },
    14: { unit: "คน", edges: [0, 1, 11, 31, 51, Infinity], labels: ["0 คน", "1–10", "11–30", "31–50", "≥ 51"] },
    15: { unit: "แห่ง", edges: [0, 1, 2, 3, Infinity], labels: ["ไม่มีสาขา", "1 แห่ง", "2 แห่ง", "≥ 3 แห่ง"] },
  },
  island: {
    5: { unit: "กิโลเมตร", edges: [0, 0.01, 5, 10, 20, Infinity], labels: ["0", "0.01–4.99", "5–9.99", "10–19.99", "≥ 20"] },
    6: { unit: "กิโลเมตร", edges: [0, 0.01, 5, 10, 20, Infinity], labels: ["0", "0.01–4.99", "5–9.99", "10–19.99", "≥ 20"] },
    7: { unit: "นาที", edges: [0, 1, 30, 60, 90, Infinity], labels: ["0", "1–29", "30–59", "60–89", "≥ 90"] },
    8: { unit: "บาท", edges: [0, 1, 50, 100, 300, 500, Infinity], labels: ["0", "1–49", "50–99", "100–299", "300–499", "≥ 500"] },
    15: { unit: "คน", edges: [0, 1, 11, 31, 51, Infinity], labels: ["0 คน", "1–10", "11–30", "31–50", "≥ 51"] },
  },
};

const bandOf = (value, band) => {
  for (let i = band.edges.length - 2; i >= 0; i--) {
    if (value >= band.edges[i]) return i;
  }
  return 0;
};

/** แจกแจงคำตอบของข้อหนึ่ง ในรอบปีหนึ่ง */
function distribute(item, measure, band, rows) {
  const n = rows.length;
  if (band) {
    const counts = new Array(band.labels.length).fill(0);
    let blank = 0;
    for (const r of rows) {
      const raw = r[item.key];
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        blank++;
        continue;
      }
      counts[bandOf(num(raw), band)]++;
    }
    const values = rows.map((r) => num(r[item.key])).filter((v) => Number.isFinite(v));
    const sorted = [...values].sort((a, b) => a - b);
    return {
      kind: "numeric",
      unit: band.unit,
      n,
      categories: band.labels.map((label, i) => ({ key: label, label, n: counts[i], pct: r2((counts[i] / Math.max(1, n)) * 100) })),
      blank: { n: blank, pct: r2((blank / Math.max(1, n)) * 100) },
      stats: {
        mean: r2(values.reduce((s, x) => s + x, 0) / Math.max(1, values.length)),
        median: sorted.length ? r2(sorted[Math.floor((sorted.length - 1) / 2)]) : 0,
        min: sorted.length ? r2(sorted[0]) : 0,
        max: sorted.length ? r2(sorted[sorted.length - 1]) : 0,
      },
    };
  }

  // ข้อเชิงคุณภาพ — นับตามตัวเลือก (ข้อที่เลือกได้หลายข้อจะนับซ้ำได้ ผลรวมจึงเกิน 100%)
  const counts = new Map();
  let blank = 0;
  let multi = 0;
  for (const r of rows) {
    const raw = String(r[item.key] ?? "").trim();
    if (raw === "" || raw === "0") {
      blank++;
      continue;
    }
    const ids = item.kind === "multi" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [raw];
    if (ids.length > 1) multi++;
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    kind: "categorical",
    multiSelect: item.kind === "multi",
    n,
    categories: Object.entries(item.options ?? {}).map(([id, o]) => ({
      key: id,
      label: `${id}. ${o.label}`,
      points: o.points,
      n: counts.get(id) ?? 0,
      pct: r2(((counts.get(id) ?? 0) / Math.max(1, n)) * 100),
    })),
    blank: { n: blank, pct: r2((blank / Math.max(1, n)) * 100) },
    multiSelected: { n: multi, pct: r2((multi / Math.max(1, n)) * 100) },
  };
}

function buildArea(areaKey, items, measures, rowsAll, hillBy) {
  const years = [...new Set(rowsAll.map((r) => num(r.acadyears)))].sort((a, b) => a - b);
  const yearRows = Object.fromEntries(years.map((y) => [y, rowsAll.filter((r) => num(r.acadyears) === y)]));

  return {
    years: years.map((y) => ({ year: y, n: yearRows[y].length })),
    items: items.map((item) => {
      const band = BANDS[areaKey]?.[item.no] ?? null;
      // ข้อ 11/12 ของพื้นที่สูงต้องคำนวณจากตาราง hilltrib ของรอบปีนั้น ๆ ก่อน
      const prep = (rows) =>
        areaKey === "highland" && (item.no === 11 || item.no === 12)
          ? rows.map((r) => {
              const hl = hillBy.get(`${r.sc_id}|${r.acadyears}`) ?? [];
              const sum = hl.reduce((s, h) => s + num(h.hilltrib_number), 0);
              const stu = Math.max(1, num(r.stu_sum));
              return { ...r, [item.key]: item.no === 11 ? Math.min((sum * 100) / stu, 100) : hl.length };
            })
          : rows;
      return {
        no: item.no,
        key: item.key,
        short: item.short,
        title: item.title,
        max: item.max,
        measure: measures[item.no]?.measure ?? null,
        unit: band?.unit ?? item.unit ?? null,
        byYear: Object.fromEntries(years.map((y) => [y, distribute(item, measures[item.no], band, prep(yearRows[y]))])),
      };
    }),
  };
}

/* --------------------------------- main --------------------------------- */

const { conn, cfg } = await connectLegacy();
const SOURCE = await describeSource(conn, cfg);
console.error("แหล่งข้อมูล:", SOURCE);

const [highRows] = await conn.query("SELECT * FROM highland_eval");
const [islandRows] = await conn.query("SELECT * FROM island_eval");
const [hillRows] = await conn.query("SELECT * FROM highland_eval_hilltrib");
await conn.end();

const hillBy = new Map();
for (const h of hillRows) {
  const k = `${h.sc_id}|${h.acadyears}`;
  if (!hillBy.has(k)) hillBy.set(k, []);
  hillBy.get(k).push(h);
}

// ตัดรอบปีที่มีแถวเดียว (ข้อมูลตกค้าง) ออกจากตาราง เพื่อไม่ให้ร้อยละ 100% ลวงตา
const MIN_ROWS = 2;
const highUsable = highRows.filter((r) => highRows.filter((x) => x.acadyears === r.acadyears).length >= MIN_ROWS);
const dropped = highRows.length - highUsable.length;

const result = {
  generatedAt: new Date().toISOString(),
  source: SOURCE,
  note:
    "นับทุกแถวที่ถูกกรอกในแต่ละรอบปี (ไม่ใช่ประชากรที่คัดแล้วแบบรายงานหลัก) — " +
    "ข้อที่เลือกได้หลายตัวเลือก ผลรวมร้อยละจะเกิน 100 เพราะหนึ่งโรงเรียนนับได้หลายตัวเลือก",
  droppedSingleRowYears: dropped,
  highland: buildArea("highland", HIGHLAND_ITEMS, HIGHLAND_MEASURES, highUsable, hillBy),
  island: buildArea("island", ISLAND_ITEMS, ISLAND_MEASURES, islandRows, hillBy),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "answers-by-year.json"), JSON.stringify(result, null, 2), "utf8");

/* ---- CSV รูปแบบยาว สำหรับทำ pivot ---- */
const csv = ["area,year,item_no,item_short,measure,category,label,points,n,pct"];
const csvEsc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
for (const [areaKey, areaLabel] of [
  ["highland", "พื้นที่สูง"],
  ["island", "พื้นที่เกาะ"],
]) {
  for (const item of result[areaKey].items) {
    for (const [year, dist] of Object.entries(item.byYear)) {
      for (const c of dist.categories) {
        csv.push(
          [
            csvEsc(areaLabel),
            year,
            item.no,
            csvEsc(item.short),
            csvEsc(item.measure),
            csvEsc(c.key),
            csvEsc(c.label),
            c.points ?? "",
            c.n,
            c.pct,
          ].join(","),
        );
      }
      if (dist.blank.n) {
        csv.push(
          [csvEsc(areaLabel), year, item.no, csvEsc(item.short), csvEsc(item.measure), csvEsc("blank"), csvEsc("(ไม่ได้กรอก)"), "", dist.blank.n, dist.blank.pct].join(","),
        );
      }
    }
  }
}
// BOM เพื่อให้ Excel บน Windows อ่านภาษาไทยถูกต้อง
fs.writeFileSync(path.join(OUT_DIR, "answers-by-year.csv"), "﻿" + csv.join("\r\n"), "utf8");

/* ---- รายงาน Markdown ---- */
const n = (x) => Number(x ?? 0).toLocaleString("th-TH");
const f = (x, k = 1) => Number(x ?? 0).toFixed(k);
const L = [];
L.push("# การแจกแจงคำตอบรายข้อ แยกตามรอบปีที่ประเมิน");
L.push("");
L.push(`> สร้างโดย \`scripts/report-answers-by-year.mjs\` · ${new Date().toLocaleString("th-TH")}`);
L.push(`> **แหล่งข้อมูล:** ${SOURCE}`);
L.push(`> ${result.note}`);
L.push("");
L.push("## วิธีอ่าน");
L.push("");
L.push("- ตัวเลขในตารางคือ **ร้อยละของแถวในรอบปีนั้น** และมี (จำนวนแถว) กำกับในวงเล็บ");
L.push("- ข้อที่เลือกได้หลายตัวเลือก (ข้อ 7–10 ของพื้นที่สูง) ผลรวมแต่ละคอลัมน์จะ **เกิน 100%** เพราะหนึ่งโรงเรียนนับได้หลายตัวเลือก");
L.push("- ข้อที่เป็นตัวเลขถูกจัดเป็นช่วงค่าที่สื่อความหมาย พร้อมค่าเฉลี่ยและมัธยฐานกำกับใต้ตาราง");
L.push("");
L.push(
  "**ข้อควรระวังที่สำคัญที่สุด:** รอบ 2565 เป็นสำมะโนใหญ่ครั้งเดียว (N มากกว่าพันแถว) " +
    "ส่วนรอบหลังจากนั้นเป็นเฉพาะโรงเรียนที่เข้าใหม่หรือขอทบทวน ซึ่งมีจำนวนน้อยและ **ไม่ได้สุ่ม** " +
    "ร้อยละของรอบ 2566–2569 จึงสะท้อนลักษณะของกลุ่มที่มาขอประเมินใหม่ ไม่ใช่ภาพรวมของโรงเรียนทั้งหมด และห้ามนำมาอ่านเป็นแนวโน้มข้ามปี",
);
L.push("");

for (const [areaKey, areaLabel, items] of [
  ["highland", "พื้นที่สูง", HIGHLAND_ITEMS],
  ["island", "พื้นที่เกาะ", ISLAND_ITEMS],
]) {
  const area = result[areaKey];
  L.push(`## ${areaLabel} (${items.length} ข้อ)`);
  L.push("");
  L.push("### ความครบถ้วนของการกรอกแต่ละรอบ");
  L.push("");
  L.push("| รอบปี | จำนวนแถว | ไม่ได้กรอกเฉลี่ยต่อข้อ | ข้อที่ถูกเว้นว่างมากที่สุด |");
  L.push("|---|---:|---:|---|");
  for (const y of area.years) {
    const blanks = area.items
      .map((it) => ({ no: it.no, short: it.short, pct: it.byYear[y.year].blank.pct }))
      .sort((a, b) => b.pct - a.pct);
    const avg = blanks.reduce((s, b) => s + b.pct, 0) / Math.max(1, blanks.length);
    const worst = blanks[0];
    L.push(
      `| ${y.year} | ${n(y.n)} | ${f(avg)}% | ${
        worst.pct > 0 ? `ข้อ ${worst.no} ${worst.short} (${f(worst.pct)}%)` : "— ไม่มีข้อที่ถูกเว้นว่าง"
      } |`,
    );
  }
  L.push("");
  if (areaKey === "highland") {
    const elev = area.items.find((it) => it.no === 1);
    const belowGate = (y) => {
      const d = elev.byYear[y];
      const cats = d.categories;
      const below = cats.filter((c) => c.label === "0 (ไม่มีข้อมูล)" || c.label === "1–499").reduce((s, c) => s + c.n, 0);
      return { pct: r2((below / Math.max(1, d.n)) * 100), median: d.stats.median };
    };
    L.push("**ข้อสังเกตจากการเทียบข้ามรอบ**");
    L.push("");
    L.push(
      "- **โรงเรียนที่เข้าประเมินในรอบหลัง ๆ อยู่ต่ำลงเรื่อย ๆ** — มัธยฐานความสูง " +
        area.years.map((y) => `${y.year}: ${f(belowGate(y.year).median, 0)} ม.`).join(" · ") +
        " และสัดส่วนที่ต่ำกว่าเกณฑ์ 500 ม. คือ " +
        area.years.map((y) => `${y.year}: ${f(belowGate(y.year).pct)}%`).join(" · ") +
        " — รอบหลังจึงเป็นกลุ่มก้ำกึ่งที่มาขอทบทวน ไม่ใช่ภาพรวมของโรงเรียนพื้นที่สูงทั้งหมด",
    );
    L.push(
      "- **ความครบถ้วนของข้อมูลแย่ลงตามรอบ** ตามตารางด้านบน — ยิ่งรอบหลัง ยิ่งมีข้อที่ถูกเว้นว่างมาก " +
        "ซึ่งกระทบการคิดคะแนนโดยตรง เพราะสูตรเดิมถือว่าช่องว่าง = 0 คะแนน ไม่ได้แยกระหว่าง \"ไม่มี\" กับ \"ไม่ได้กรอก\"",
    );
    L.push("");
  }
  const years = area.years.map((y) => y.year);
  const head = `| ตัวเลือก / ช่วงค่า | ${years.map((y) => `${y} (n=${n(area.years.find((x) => x.year === y).n)})`).join(" | ")} |`;
  const sep = `|---|${years.map(() => "---:").join("|")}|`;

  for (const item of area.items) {
    L.push(`### ข้อ ${item.no} — ${item.title}`);
    L.push("");
    const first = item.byYear[years[0]];
    L.push(
      `คะแนนเต็ม ${item.max}` +
        (item.unit ? ` · หน่วย ${item.unit}` : "") +
        (first.multiSelect ? " · **เลือกได้หลายตัวเลือก — ผลรวมคอลัมน์เกิน 100%**" : ""),
    );
    L.push("");
    L.push(head);
    L.push(sep);
    for (let ci = 0; ci < first.categories.length; ci++) {
      const cells = years.map((y) => {
        const c = item.byYear[y].categories[ci];
        return `${f(c.pct)}% (${n(c.n)})`;
      });
      L.push(`| ${first.categories[ci].label} | ${cells.join(" | ")} |`);
    }
    if (years.some((y) => item.byYear[y].blank.n > 0)) {
      L.push(
        `| *(ไม่ได้กรอก)* | ${years.map((y) => `${f(item.byYear[y].blank.pct)}% (${n(item.byYear[y].blank.n)})`).join(" | ")} |`,
      );
    }
    L.push("");
    if (first.kind === "numeric") {
      L.push(
        "ค่าเฉลี่ย / มัธยฐาน: " +
          years.map((y) => `**${y}** ${f(item.byYear[y].stats.mean, 2)} / ${f(item.byYear[y].stats.median, 2)}`).join(" · "),
      );
      L.push("");
    }
    if (first.multiSelect) {
      L.push(
        "เลือกมากกว่า 1 ตัวเลือก: " +
          years.map((y) => `**${y}** ${f(item.byYear[y].multiSelected.pct)}%`).join(" · "),
      );
      L.push("");
    }
  }
}

const mdOut = path.join(ROOT, "docs", "ANALYSIS-การตอบรายข้อรายปี.md");
fs.writeFileSync(mdOut, L.join("\n"), "utf8");
console.error("เขียนรายงาน:", path.relative(ROOT, mdOut));
console.error("เขียนข้อมูล :", path.relative(ROOT, path.join(OUT_DIR, "answers-by-year.json")));
console.error("เขียน CSV   :", path.relative(ROOT, path.join(OUT_DIR, "answers-by-year.csv")));
if (dropped) console.error(`(ตัดแถวของรอบปีที่มีข้อมูลเพียงแถวเดียวออก ${dropped} แถว)`);
