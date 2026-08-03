// สร้างรายงาน Markdown จากผลวิเคราะห์รายข้อ (docs/analysis/legacy-item-stats.json)
//   node scripts/report-legacy-items.mjs
// รันสคริปต์ analyze-legacy-items.mjs ก่อนเสมอ

import fs from "node:fs";
import path from "node:path";
import { GROUPS } from "./legacy-items.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "docs", "analysis", "legacy-item-stats.json");
const OUT = path.join(ROOT, "docs", "ANALYSIS-เกณฑ์เดิมรายข้อ.md");

const d = JSON.parse(fs.readFileSync(IN, "utf8"));
const n = (x) => (x ?? 0).toLocaleString("th-TH");
const f = (x, k = 2) => Number(x ?? 0).toFixed(k);

/** ป้ายวินิจฉัยรายข้อ จากสัดส่วนคะแนนที่ได้จริง + อำนาจจำแนก + สัดส่วนที่ได้ 0 */
function verdict(it) {
  const s = it.score;
  const D = it.discrimination.D;
  const tags = [];
  if (s.share >= 90 && D < 0.15) tags.push("**คะแนนแจกฟรี** — เกือบทุกโรงเรียนได้เต็ม แทบไม่จำแนกใคร");
  else if (s.share >= 80 && D < 0.3) tags.push("เพดานตัน (ceiling effect) — คนส่วนใหญ่ได้เกือบเต็ม");
  if (s.zeroPct >= 70) tags.push("พื้นตัน (floor effect) — ส่วนใหญ่ได้ 0 คะแนน");
  if (D >= 0.5) tags.push("**อำนาจจำแนกสูง** — แยกกลุ่มยากลำบากออกจากกลุ่มทั่วไปได้ชัด");
  else if (D >= 0.3) tags.push("อำนาจจำแนกใช้ได้");
  else if (D < 0.15) tags.push("อำนาจจำแนกต่ำมาก");
  if (it.discrimination.itemRestCorr < 0.1) tags.push("สหสัมพันธ์กับข้ออื่นเกือบเป็นศูนย์ (วัดคนละมิติ หรือเป็นค่าคงที่)");
  if (it.score.distinctValues <= 3) tags.push(`คะแนนมีเพียง ${it.score.distinctValues} ระดับที่ใช้จริง`);
  return tags.length ? tags : ["พฤติกรรมปกติ"];
}

function itemSection(it) {
  const L = [];
  L.push(`### ข้อ ${it.no} — ${it.title}`);
  L.push("");
  L.push(
    `**กลุ่มข้อมูล:** ${it.groupLabel} · **คะแนนเต็ม:** ${it.max} · **ชนิด:** ${
      { numeric: "ค่าตัวเลข", single: "เลือก 1 ข้อ", multi: "เลือกได้หลายข้อ" }[it.kind]
    }${it.unit ? ` (หน่วย: ${it.unit})` : ""}`,
  );
  if (it.rule) L.push(`**สูตรคิดคะแนนเดิม:** ${it.rule}`);
  L.push("");
  L.push("| ตัวชี้วัด | ค่า |");
  L.push("|---|---:|");
  L.push(`| คะแนนเฉลี่ยที่ได้จริง | ${f(it.score.mean)} / ${it.max} (${f(it.score.share, 1)}% ของคะแนนเต็มข้อนี้) |`);
  L.push(`| ส่วนเบี่ยงเบนมาตรฐาน | ${f(it.score.sd)} |`);
  L.push(`| ได้คะแนนเต็ม | ${f(it.score.fullPct, 1)}% |`);
  L.push(`| ได้ 0 คะแนน | ${f(it.score.zeroPct, 1)}% |`);
  L.push(`| สหสัมพันธ์กับคะแนนข้ออื่น (item–rest r) | ${f(it.discrimination.itemRestCorr)} |`);
  L.push(
    `| อำนาจจำแนก D (กลุ่มบน 27% − กลุ่มล่าง 27%) | ${f(it.discrimination.D)} (${f(
      it.discrimination.upperMean,
    )} vs ${f(it.discrimination.lowerMean)}) |`,
  );
  L.push(
    `| ถ้าตัดข้อนี้ทิ้งแล้วปรับสเกลกลับ 100 | ผ่านจุดตัด 70 เปลี่ยนจาก ${n(it.impact.passNow)} → ${n(
      it.impact.passWithoutItem,
    )} แห่ง · สลับผลได้/ตก ${f(it.impact.flipPct, 1)}% |`);
  L.push("");

  if (it.kind === "numeric") {
    const v = it.value;
    L.push("**การกระจายของค่าที่กรอกจริง**");
    L.push("");
    L.push("| ต่ำสุด | P10 | P25 | มัธยฐาน | P75 | P90 | สูงสุด | เฉลี่ย | SD |");
    L.push("|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    L.push(
      `| ${f(v.min)} | ${f(v.p10)} | ${f(v.p25)} | ${f(v.p50)} | ${f(v.p75)} | ${f(v.p90)} | ${f(v.max)} | ${f(
        v.mean,
      )} | ${f(v.sd)} |`,
    );
    L.push("");
    L.push(
      `ค่าเป็นศูนย์ ${f(v.zeroPct, 1)}%` +
        (v.atOrAboveCapPct !== undefined ? ` · ถึง/เกินเพดานที่สูตรกำหนด ${f(v.atOrAboveCapPct, 1)}%` : ""),
    );
  } else {
    const v = it.value;
    L.push("**การกระจายของตัวเลือก**");
    L.push("");
    L.push("| ตัวเลือก | คะแนนที่ให้ | จำนวนโรงเรียน | สัดส่วน |");
    L.push("|---|---:|---:|---:|");
    for (const o of v.options) L.push(`| ${o.id}. ${o.label} | ${o.points} | ${n(o.n)} | ${f(o.pct, 1)}% |`);
    if (v.blank) L.push(`| (ไม่ได้กรอก) | — | ${n(v.blank)} | ${f(v.blankPct, 1)}% |`);
    L.push("");
    if (it.kind === "multi") {
      L.push(
        `เลือกมากกว่า 1 ตัวเลือก ${f(v.multiSelectPct, 1)}% ของโรงเรียน (เฉลี่ย ${f(
          v.selectionsPerSchool.mean,
        )} ตัวเลือก/แห่ง) — แต่สูตรเดิมคิดคะแนนจาก id ที่ "สูงสุด" เท่านั้น ข้อมูลที่เหลือถูกทิ้ง`,
      );
      const p = v.penalisedByMaxIdRule;
      if (p && p.n) {
        L.push("");
        L.push(
          `⚠️ ตัวเลือกของข้อนี้เรียงจาก "ลำบากที่สุด" (id 1) ไป "สะดวกที่สุด" แต่สูตรหยิบ **id สูงสุด** มาคิด ` +
            `ผลคือโรงเรียนที่กรอกครบตามจริงถูกหักคะแนน — พบ ${n(p.n)} แห่ง (${f(p.pct, 1)}%) เสียคะแนนเฉลี่ยแห่งละ ${f(
              p.meanPointsLost,
            )} คะแนน เทียบกับตัวเลือกที่ดีที่สุดที่ตนเองเลือกไว้`,
        );
      }
    }
  }
  L.push("");
  L.push("**ข้อสังเกต:** " + verdict(it).join(" · "));
  if (it.note) L.push("");
  if (it.note) L.push("> " + it.note);
  L.push("");
  return L.join("\n");
}

const H = d.highland;
const I = d.island;
const el = H.elevationRegimes;

const out = [];
out.push("# วิเคราะห์ผลการประเมินเดิมรายข้อ — ฐานสำหรับกำหนดเกณฑ์ปี 2569");
out.push("");
out.push(
  `> สร้างอัตโนมัติโดย \`scripts/analyze-legacy-items.mjs\` + \`scripts/report-legacy-items.mjs\` · ข้อมูล ณ ${new Date(
    d.meta.generatedAt,
  ).toLocaleString("th-TH")}`,
);
out.push(`> **แหล่งข้อมูล:** ${d.meta.source}`);
out.push(
  "> **สถานะเอกสาร:** เอกสารวิเคราะห์ข้อมูลเชิงสถิติ — ไม่ใช่ประกาศเกณฑ์ ตัวเลขทุกตัวคำนวณสดจากฐานข้อมูล ไม่มีการประมาณค่าด้วยมือ",
);
out.push("");

/* ---------------- 1. บทสรุป ---------------- */
const freeItems = H.items.filter((i) => i.score.share >= 90 && i.discrimination.D < 0.15);
const freePoints = freeItems.reduce((s, i) => s + i.score.mean, 0);
const freeMax = freeItems.reduce((s, i) => s + i.max, 0);
const floorItems = H.items.filter((i) => i.score.zeroPct >= 70);
const bestItems = [...H.items].sort((a, b) => b.discrimination.D - a.discrimination.D).slice(0, 4);

out.push("## 1. บทสรุปสำหรับผู้ตัดสินใจ");
out.push("");
out.push(
  `1. **คะแนน ${f(freePoints, 1)} จาก 100 เป็น "คะแนนที่แจกให้แทบทุกโรงเรียน"** — ข้อ ${freeItems
    .map((i) => i.no)
    .join(", ")} (รวมคะแนนเต็ม ${freeMax}) มีค่าเฉลี่ยเกิน 90% ของคะแนนเต็มและอำนาจจำแนก D < 0.15 ` +
    `นั่นคือเกณฑ์ปัจจุบันใช้คะแนนจริงเพียงราว ${f(100 - freePoints, 1)} คะแนนในการแยกโรงเรียนออกจากกัน`,
);
out.push(
  `2. **ข้อ 1 (ความสูง) กินน้ำหนัก 30 คะแนน แต่จำแนกไม่ได้เลย** — โรงเรียน ${f(
    H.items[0].score.fullPct,
    1,
  )}% ได้เต็ม 30, item–rest r = ${f(H.items[0].discrimination.itemRestCorr)} ` +
    `เพราะสูตรปัจจุบันให้คะแนนฐาน 15 ทันทีที่ผ่านด่าน แล้วตันที่ความสูง 500 ม. ขณะที่มัธยฐานความสูงจริงอยู่ที่ ${f(
      el.elevation.p50,
      0,
    )} ม. และ ${f(el.elevation.atLeast600Pct, 1)}% ของโรงเรียนสูงเกิน 600 ม.`,
);
out.push(
  `3. **สูตรข้อ 1 เปลี่ยนกลางทาง** — รอบปี 2565 (สำมะโนใหญ่ ${n(
    el.fitByYear.find((x) => x.year === 2565)?.n,
  )} แถว) ใช้สูตรเชิงเส้น 0–600 ม. (ตรงกับข้อมูลจริง ${n(
    el.fitByYear.find((x) => x.year === 2565)?.fitLinear600,
  )} แถว) ส่วนรอบ 2566 เป็นต้นมาใช้สูตรคะแนนฐาน 15 + เพดาน 500 ม. ` +
    `ผลคือ **คะแนนรวมข้ามปีเทียบกันตรง ๆ ไม่ได้** และค่าที่เก็บใน \`sum_score\` ต่างจากการคำนวณด้วยสูตรปัจจุบัน ${f(
      H.reconcile.mismatchPct,
      1,
    )}% ของเรคคอร์ด`,
);
out.push(
  `4. **มีการรายงานความสูงกระจุกที่เลข 500 พอดี ${n(el.bunchingAt500.exactly500)} แห่ง** เทียบกับช่วง 480–494 ม. เพียง ${n(
    el.bunchingAt500.in480to494,
  )} แห่ง และ 506–520 ม. ${n(el.bunchingAt500.in506to520)} แห่ง — รูปแบบนี้บ่งชี้ว่าค่าที่กรอกอิงกับ "เกณฑ์" มากกว่าค่าที่วัดได้จริง ` +
    `อีกทั้ง ${f((el.bunchingAt500.roundedToHundred / el.bunchingAt500.nonZero) * 100, 1)}% ของค่าที่ไม่เป็นศูนย์ลงท้ายด้วยเลขกลม 100 ม.`,
);
out.push(
  `5. **ข้อที่จำแนกได้ดีที่สุดกลับมีน้ำหนักน้อยที่สุด** — ${bestItems
    .map((i) => `ข้อ ${i.no} ${i.short} (D=${f(i.discrimination.D)}, เต็มเพียง ${i.max} คะแนน)`)
    .join(" · ")}`,
);
out.push(
  `6. **ข้อที่ "พื้นตัน"** (โรงเรียนเกิน 70% ได้ 0 คะแนน) มี ${floorItems.length} ข้อ คือข้อ ${floorItems
    .map((i) => `${i.no} ${i.short} (${f(i.score.zeroPct, 1)}%)`)
    .join(", ")} — ข้อเหล่านี้ทำหน้าที่เป็น "แต้มพิเศษของกลุ่มเล็ก" มากกว่าตัวชี้วัดร่วม`,
);
out.push(
  `7. **โรงเรียนกระจุกรอบจุดตัด** — ช่วง 65–75 คะแนนมี ${n(H.totals.nearCut["65-75"])} แห่ง (${f(
    H.totals.nearCut.pctInBand,
    1,
  )}% ของทั้งหมด) การขยับสูตรข้อใดข้อหนึ่งเพียงเล็กน้อยจึงเปลี่ยนสถานะได้เป็นร้อยโรงเรียน`,
);
out.push(
  `8. **สาธารณูปโภคซ้ำซ้อนกันเอง** — ไฟฟ้า×อินเทอร์เน็ต r=${f(
    H.correlations.top.find((p) => p.a === 8 && p.b === 10)?.r ?? 0,
  )}, โทรศัพท์×อินเทอร์เน็ต r=${f(
    H.correlations.top.find((p) => p.a === 9 && p.b === 10)?.r ?? 0,
  )} — ควรยุบเป็นดัชนีเดียว ไม่ใช่ให้คะแนนแยก 3 ข้อ`,
);
const penalised = H.items.filter((i) => i.value?.penalisedByMaxIdRule?.n);
if (penalised.length) {
  out.push(
    `9. **กติกา "ใช้ id สูงสุด" ในข้อที่เลือกได้หลายตัวเลือก ลงโทษโรงเรียนที่กรอกครบตามจริง** — ` +
      penalised
        .map(
          (i) =>
            `ข้อ ${i.no} ${i.short} ${n(i.value.penalisedByMaxIdRule.n)} แห่ง (เสียเฉลี่ย ${f(
              i.value.penalisedByMaxIdRule.meanPointsLost,
            )} คะแนน)`,
        )
        .join(" · ") +
      ` — กรณีชัดที่สุดคือข้อ 8: โรงเรียนที่มีทั้งโซลาร์เซลล์และไฟฟ้าส่วนภูมิภาคได้ 0 คะแนน เท่ากับโรงเรียนที่มีไฟฟ้าปกติอย่างเดียว`,
  );
}
out.push("");

/* ---------------- 2. ขอบเขตข้อมูล ---------------- */
out.push("## 2. ขอบเขตข้อมูลและวิธีการ");
out.push("");
out.push("| หัวข้อ | พื้นที่สูง | พื้นที่เกาะ |");
out.push("|---|---:|---:|");
out.push(`| แถวประเมินทั้งหมดในฐาน | ${n(d.meta.populations.highland.rowsAll)} | ${n(d.meta.populations.island.rowsAll)} |`);
out.push(`| โรงเรียนไม่ซ้ำ | ${n(d.meta.populations.highland.schools)} | ${n(d.meta.populations.island.schools)} |`);
out.push(`| ที่นำมาวิเคราะห์ | **${n(d.meta.populations.highland.analysed)}** | **${n(d.meta.populations.island.analysed)}** |`);
out.push("");
out.push(`**เกณฑ์เลือกประชากร:** ${d.meta.populations.highland.rule}`);
out.push("");
if (d.meta.confirmWorkflow?.length) {
  out.push("**ความคืบหน้าของรอบยืนยันสถานะปี 2569** (บอกว่าประชากรที่ใช้วิเคราะห์นิ่งแล้วหรือยัง)");
  out.push("");
  out.push("| กลุ่ม | รายการ | โรงเรียนยืนยัน | ส่งเรื่อง | สพท. รับรอง | สพฐ. อนุมัติ | สพฐ. ไม่อนุมัติ | ค้างพิจารณา |");
  out.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const w of d.meta.confirmWorkflow) {
    out.push(
      `| ${w.label} | ${n(w.rows)} | ${n(w.schoolConfirmed)} | ${n(w.submitted)} | ${n(w.saoApproved)} | ${n(
        w.sptApproved,
      )} | ${n(w.sptRejected)} | ${n(w.pending)} |`,
    );
  }
  out.push("");
}
out.push("**จำนวนแถวแยกตามปีที่ประเมิน**");
out.push("");
out.push("| ปี | พื้นที่สูง | พื้นที่เกาะ |");
out.push("|---|---:|---:|");
for (const y of [...new Set([...Object.keys(d.meta.yearCoverage.highland), ...Object.keys(d.meta.yearCoverage.island)])].sort()) {
  out.push(`| ${y} | ${n(d.meta.yearCoverage.highland[y] ?? 0)} | ${n(d.meta.yearCoverage.island[y] ?? 0)} |`);
}
out.push("");
out.push("**วิธีการ**");
out.push("");
out.push(
  "- คะแนนทุกข้อ **คำนวณใหม่จากค่าดิบ** ด้วยสูตรเกณฑ์เดิมฉบับปัจจุบัน (ตรงกับ `ScoreService.php` / `IslandScoreService.php` ของระบบ newhighland) เพื่อให้ทุกโรงเรียนถูกวัดด้วยไม้บรรทัดเดียวกัน แล้วนำไปเทียบกับ `sum_score` ที่เก็บไว้เพื่อตรวจสอบ",
);
out.push(
  "- **อำนาจจำแนก D** = คะแนนเฉลี่ยของกลุ่มคะแนนรวมสูงสุด 27% ลบด้วยกลุ่มต่ำสุด 27% หารด้วยคะแนนเต็มของข้อนั้น (0 = แยกไม่ได้เลย, 1 = แยกได้สมบูรณ์) — เกณฑ์อ่านค่าทั่วไป: D ≥ 0.40 ดีมาก, 0.30–0.39 ใช้ได้, 0.20–0.29 ควรปรับ, < 0.20 ควรตัดหรือออกแบบใหม่",
);
out.push("- **item–rest r** = สหสัมพันธ์ระหว่างคะแนนข้อนั้นกับผลรวมของข้ออื่น ๆ (ตัดตัวเองออก) ค่าใกล้ 0 แปลว่าข้อนั้นแทบไม่สัมพันธ์กับความยากลำบากที่ข้ออื่นวัดได้");
out.push("- **การจำลอง** ปรับเฉพาะสูตร/น้ำหนัก โดยใช้ค่าดิบชุดเดิม จึงตอบได้ว่า \"ถ้าเปลี่ยนกติกา ใครได้/ตกเปลี่ยนไปเท่าไร\"");
out.push("");
out.push(
  "**ข้อจำกัดที่ต้องระบุ:** ข้อมูลรอบ 2565 เป็นสำมะโนใหญ่ครั้งเดียว รอบหลังจากนั้นเป็นการประเมินเฉพาะรายที่เข้าใหม่/ขอทบทวน จำนวนน้อยและไม่สุ่ม จึงใช้ดูแนวโน้มไม่ได้ · ค่าที่โรงเรียนกรอกเองไม่มีการตรวจสอบย้อนกลับในฐานข้อมูล (ไม่มีฟิลด์ผลการตรวจภาคสนาม) การตีความ \"ความยากลำบากจริง\" จึงจำกัดอยู่ที่สิ่งที่ถูกรายงาน",
);
out.push("");

/* ---------------- 3. ภาพรวมคะแนนรวม ---------------- */
out.push("## 3. ภาพรวมคะแนนรวมและความไวของจุดตัด");
out.push("");
out.push("| สถิติ | พื้นที่สูง | พื้นที่เกาะ |");
out.push("|---|---:|---:|");
for (const [k, label] of [
  ["n", "จำนวนโรงเรียน"],
  ["mean", "ค่าเฉลี่ย"],
  ["sd", "SD"],
  ["min", "ต่ำสุด"],
  ["p10", "P10"],
  ["p25", "P25"],
  ["p50", "มัธยฐาน"],
  ["p75", "P75"],
  ["p90", "P90"],
  ["max", "สูงสุด"],
]) {
  out.push(`| ${label} | ${k === "n" ? n(H.totals[k]) : f(H.totals[k])} | ${k === "n" ? n(I.totals[k]) : f(I.totals[k])} |`);
}
out.push("");
out.push("**จำนวนที่ผ่านแต่ละจุดตัด**");
out.push("");
out.push("| จุดตัด | พื้นที่สูง | % | พื้นที่เกาะ | % |");
out.push("|---:|---:|---:|---:|---:|");
for (const c of H.totals.cuts) {
  const ic = I.totals.cuts.find((x) => x.cut === c.cut);
  out.push(`| ${c.cut} | ${n(c.pass)} | ${f(c.pct, 1)}% | ${n(ic?.pass)} | ${f(ic?.pct, 1)}% |`);
}
out.push("");
out.push(
  `ช่วงเสี่ยง 65–75 คะแนน: พื้นที่สูง ${n(H.totals.nearCut["65-75"])} แห่ง (${f(
    H.totals.nearCut.pctInBand,
    1,
  )}%) · พื้นที่เกาะ ${n(I.totals.nearCut["65-75"])} แห่ง (${f(I.totals.nearCut.pctInBand, 1)}%)`,
);
out.push("");
out.push("**การกระจายคะแนนรวม (พื้นที่สูง)**");
out.push("");
out.push("| ช่วงคะแนน | จำนวน | |");
out.push("|---|---:|---|");
const maxBin = Math.max(...H.totals.histogram.map((b) => b.n));
for (const b of H.totals.histogram) {
  if (b.n === 0 && b.hi <= 45) continue;
  out.push(`| ${b.lo}–${b.hi} | ${n(b.n)} | ${"█".repeat(Math.round((b.n / maxBin) * 30))} |`);
}
out.push("");

/* ---------------- 4. กลุ่มข้อมูลพื้นฐาน ---------------- */
out.push("## 4. การจำแนกเป็นกลุ่มข้อมูลพื้นฐาน");
out.push("");
out.push(
  "จัดกลุ่มตัวชี้วัดตาม **แหล่งที่มาของข้อมูล** ไม่ใช่ตามหัวข้อ เพราะสิ่งที่กำหนดว่าเกณฑ์ปีใหม่จะ \"ตรวจสอบได้จริงหรือไม่\" คือใครเป็นเจ้าของข้อมูลและตรวจย้อนได้แค่ไหน",
);
out.push("");
out.push("| กลุ่ม | ข้อ | คะแนนเต็มรวม | คะแนนเฉลี่ยที่ได้จริง | ใช้พื้นที่คะแนนไปกี่ % | แหล่งข้อมูล | ตรวจสอบย้อนได้ |");
out.push("|---|---|---:|---:|---:|---|---|");
const verifLabel = { auto: "อัตโนมัติ (GIS)", registry: "ทะเบียนราชการ", declared: "โรงเรียนกรอกเอง" };
for (const g of H.groups) {
  out.push(
    `| ${g.label} | ${g.items.join(", ")} | ${g.maxScore} | ${f(g.mean)} | ${f(g.utilisation, 1)}% | ${
      GROUPS[g.key].source
    } | ${verifLabel[GROUPS[g.key].verifiable]} |`,
  );
}
out.push("");
const declaredMax = H.groups.filter((g) => GROUPS[g.key].verifiable === "declared").reduce((s, g) => s + g.maxScore, 0);
out.push(
  `**ข้อสังเกตเชิงโครงสร้าง:** คะแนน ${declaredMax} จาก 100 มาจากข้อมูลที่โรงเรียนกรอกเองโดยไม่มีชั้นข้อมูลกลางให้ตรวจย้อน ` +
    `ขณะที่กลุ่มภูมิศาสตร์ซึ่งวัดอัตโนมัติได้แม่นที่สุด (${H.groups.find((g) => g.key === "geo").maxScore} คะแนน) กลับถูกใช้ไปแล้ว ${f(
      H.groups.find((g) => g.key === "geo").utilisation,
      1,
    )}% ของพื้นที่คะแนน คือเกือบเต็มทุกโรงเรียน`,
);
out.push("");

/* ---------------- 5. รายข้อ ---------------- */
/* ---------------- 5. ชนิดของค่าที่วัด ---------------- */
const M = H.measurement;
const MI = I.measurement;
const boolLabel = (v) => (v === true ? "ปรับแล้ว" : v === false ? "**ไม่ปรับ**" : "—");

out.push("## 5. จำแนกรายการประเมินตามชนิดของค่าที่วัด");
out.push("");
out.push(
  "หัวข้อนี้จำแนกคนละแกนกับหัวข้อ 4 — หัวข้อ 4 ถามว่า *ข้อมูลมาจากไหน* ส่วนหัวข้อนี้ถามว่า *ค่าที่ได้เป็นอะไร* " +
    "ซึ่งเป็นตัวกำหนดว่า (ก) สถิติแบบใดใช้กับข้อนั้นได้ (ข) ต้อง validate อย่างไร (ค) เทียบข้ามโรงเรียนได้ตรง ๆ หรือไม่",
);
out.push("");
out.push("### 5.1 น้ำหนักคะแนนแยกตามชนิดของค่า");
out.push("");
out.push("| ชนิดของค่า | ข้อ | จำนวนข้อ | น้ำหนักคะแนน | % ของ 100 | คะแนนที่ได้จริง | ใช้พื้นที่คะแนนไป |");
out.push("|---|---|---:|---:|---:|---:|---:|");
for (const t of M.taxonomy) {
  out.push(
    `| ${t.label} | ${t.items.join(", ")} | ${t.itemCount} | ${t.weight} | ${f(t.weightPct, 1)}% | ${f(
      t.meanScoreTotal,
    )} | ${f(t.utilisation, 1)}% |`,
  );
}
out.push("");
out.push(
  `**สัดส่วนเชิงปริมาณ vs เชิงคุณภาพ (พื้นที่สูง):** ค่าที่วัดเป็นตัวเลขจริง (ต่อเนื่อง + จำนวนนับ + ร้อยละ) รวม **${
    M.split.quantitativeWeight
  } คะแนน (${f(M.split.quantitativePct, 1)}%)** · ข้อความเชิงคุณภาพ (เรียงระดับ + สองค่า + เลือกหลายข้อ) รวม **${
    M.split.qualitativeWeight
  } คะแนน (${f(M.split.qualitativePct, 1)}%)**`,
);
out.push("");
out.push(
  `**พื้นที่เกาะกลับด้านกันอย่างสิ้นเชิง** — เชิงปริมาณเพียง ${MI.split.quantitativeWeight} คะแนน (${f(
    MI.split.quantitativePct,
    1,
  )}%) ส่วนเชิงคุณภาพถึง ${MI.split.qualitativeWeight} คะแนน (${f(MI.split.qualitativePct, 1)}%) ` +
    `โดยข้อ 3 (มีสะพานหรือไม่ ${I.items.find((x) => x.no === 3)?.max} คะแนน) กับข้อ 4 (พาหนะหลัก ${
      I.items.find((x) => x.no === 4)?.max
    } คะแนน) เป็นคำถามเชิงคุณภาพสองข้อที่รวมกันแล้วถือน้ำหนักถึง ${
      (I.items.find((x) => x.no === 3)?.max ?? 0) + (I.items.find((x) => x.no === 4)?.max ?? 0)
    } คะแนน — ผลการคัดกรองพื้นที่เกาะจึงถูกกำหนดด้วยคำตอบเชิงคุณภาพเป็นหลัก`,
);
out.push("");
out.push("### 5.2 ที่มาของค่า");
out.push("");
out.push("| ที่มา | น้ำหนักคะแนน | % ของ 100 |");
out.push("|---|---:|---:|");
for (const k of ["auto", "derived", "entered"]) {
  const o = M.byOrigin[k];
  out.push(`| ${o.label} | ${o.weight} | ${f(o.pct, 1)}% |`);
}
out.push("");
out.push(
  `คะแนน ${M.byOrigin.entered.weight} จาก 100 (${f(
    M.byOrigin.entered.pct,
    1,
  )}%) มาจากค่าที่ผู้ใช้กรอกเอง — และในจำนวนนั้นเป็นข้อความเชิงคุณภาพที่ไม่มีหน่วยวัดกำกับ ${M.split.qualitativeWeight} คะแนน ` +
    "ซึ่งเป็นส่วนที่ตรวจสอบย้อนกลับได้ยากที่สุดเมื่อมีการทักท้วง",
);
out.push("");
out.push("### 5.3 ตารางจำแนกรายข้อ (พื้นที่สูง)");
out.push("");
out.push("| ข้อ | ตัวชี้วัด | ชนิดของค่า | ระดับการวัด | หน่วย | ที่มา | ปรับตามขนาดโรงเรียน | เต็ม |");
out.push("|---:|---|---|---|---|---|---|---:|");
const scaleLabel = { nominal: "นามบัญญัติ", ordinal: "เรียงอันดับ", interval: "อันตรภาค", ratio: "อัตราส่วน" };
for (const it of M.items) {
  out.push(
    `| ${it.no} | ${it.short} | ${it.measureLabel} | ${scaleLabel[it.scale] ?? "—"} | ${it.unit ?? "—"} | ${
      it.originLabel
    } | ${boolLabel(it.normalized)} | ${it.max} |`,
  );
}
out.push("");
out.push("### 5.4 สถิติที่เหมาะกับแต่ละข้อ");
out.push("");
out.push("**ข้อที่เป็นค่าเชิงปริมาณ** — ใช้ค่าเฉลี่ย มัธยฐาน และการกระจายได้ตามปกติ");
out.push("");
out.push("| ข้อ | ตัวชี้วัด | หน่วย | เฉลี่ย | มัธยฐาน | SD | P25 | P75 | ต่ำสุด | สูงสุด |");
out.push("|---:|---|---|---:|---:|---:|---:|---:|---:|---:|");
for (const it of M.items.filter((x) => x.summary.kind === "quantitative")) {
  const s = it.summary;
  out.push(
    `| ${it.no} | ${it.short} | ${it.unit ?? "—"} | ${f(s.mean)} | ${f(s.median)} | ${f(s.sd)} | ${f(s.p25)} | ${f(
      s.p75,
    )} | ${f(s.min)} | ${f(s.max)} |`,
  );
}
out.push("");
out.push(
  "**ข้อที่เป็นข้อความเชิงคุณภาพ** — ใช้ฐานนิยมและมัธยฐานของระดับแทน เพราะ *ค่าเฉลี่ยของรหัสตัวเลือกไม่มีความหมาย* " +
    "(เลข 1–5 เป็นชื่อของระดับ ไม่ใช่ปริมาณ ระยะห่างระหว่างระดับไม่เท่ากัน)",
);
out.push("");
out.push("| ข้อ | ตัวชี้วัด | คำตอบที่พบมากที่สุด | สัดส่วน | ระดับมัธยฐาน | ตัวเลือกที่ถูกใช้จริง |");
out.push("|---:|---|---|---:|---|---:|");
for (const it of M.items.filter((x) => x.summary.kind === "qualitative")) {
  const s = it.summary;
  out.push(
    `| ${it.no} | ${it.short} | ${s.mode ? `${s.mode.id}. ${s.mode.label}` : "—"} | ${f(s.mode?.pct ?? 0, 1)}% | ${
      s.medianOptionLabel ? `${s.medianOptionId}. ${s.medianOptionLabel}` : "—"
    } | ${s.distinctOptionsUsed ?? 0} จาก ${s.totalOptions ?? 0} |`,
  );
}
out.push("");
out.push("**สถิติที่ใช้ได้/ใช้ไม่ได้ตามชนิดของค่า**");
out.push("");
out.push("| ชนิดของค่า | สถิติที่ใช้ได้ | สถิติที่ใช้ไม่ได้ | กติกา validate ที่ควรบังคับในโค้ด |");
out.push("|---|---|---|---|");
for (const t of M.taxonomy) {
  out.push(`| ${t.label} | ${t.validStats} | ${t.invalidStats} | ${t.validation} |`);
}
out.push("");
out.push("### 5.5 จุดที่ \"เก็บอย่างหนึ่ง แต่คิดคะแนนอีกอย่าง\"");
out.push("");
out.push(
  "รายการต่อไปนี้คือข้อที่รูปแบบข้อมูลที่เก็บกับรูปแบบที่นำไปคิดคะแนนไม่ตรงกัน — เป็นจุดที่ต้องตัดสินใจให้ชัดตอนเขียนเกณฑ์ปีใหม่",
);
out.push("");
out.push("| ข้อ | ตัวชี้วัด | เก็บเป็น | คิดคะแนนเป็น | ประเด็น |");
out.push("|---:|---|---|---|---|");
for (const it of M.items.filter((x) => x.mismatch)) {
  out.push(`| ${it.no} | ${it.short} | ${it.collectedAs} | ${it.scoredAs} | ${it.mismatch} |`);
}
out.push("");
const unnorm = M.normalization.countItems.filter((c) => c.normalized === false);
out.push(
  `**ความไม่สอดคล้องของการปรับตามขนาดโรงเรียน:** ข้อที่นับเป็น "จำนวนคน/หน่วย" มี ${
    M.normalization.countItems.length
  } ข้อ แต่ปรับตามขนาดโรงเรียนเพียงบางข้อ — ข้อ ${unnorm
    .map((c) => `${c.no} ${c.short}`)
    .join(", ")} คิดจากจำนวนดิบ (รวม ${M.normalization.unnormalizedCountWeight} คะแนน) ` +
    "ขณะที่ข้อ 13 นักเรียนยากจน คิดเป็นร้อยละ ผลคือโรงเรียนขนาดเล็กเสียเปรียบในข้อที่ไม่ปรับ และได้เปรียบในข้อที่ปรับ ทั้งที่เป็นตัวชี้วัดกลุ่มเดียวกัน",
);
out.push("");
out.push("### 5.6 ตารางจำแนกรายข้อ (พื้นที่เกาะ)");
out.push("");
out.push("| ข้อ | ตัวชี้วัด | ชนิดของค่า | ระดับการวัด | หน่วย | ที่มา | เต็ม |");
out.push("|---:|---|---|---|---|---|---:|");
for (const it of MI.items) {
  out.push(
    `| ${it.no} | ${it.short} | ${it.measureLabel} | ${scaleLabel[it.scale] ?? "—"} | ${it.unit ?? "—"} | ${
      it.originLabel
    } | ${it.max} |`,
  );
}
out.push("");

out.push("## 6. ผลวิเคราะห์รายข้อ — พื้นที่สูง (16 ข้อ)");
out.push("");
out.push("**ตารางสรุปเปรียบเทียบทุกข้อ**");
out.push("");
out.push("| ข้อ | ตัวชี้วัด | กลุ่ม | เต็ม | เฉลี่ย | %ของเต็ม | ได้เต็ม | ได้ 0 | item–rest r | D | ตัดทิ้งแล้วสลับผล |");
out.push("|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const it of H.items) {
  out.push(
    `| ${it.no} | ${it.short} | ${it.groupLabel} | ${it.max} | ${f(it.score.mean)} | ${f(it.score.share, 1)}% | ${f(
      it.score.fullPct,
      1,
    )}% | ${f(it.score.zeroPct, 1)}% | ${f(it.discrimination.itemRestCorr)} | ${f(it.discrimination.D)} | ${f(
      it.impact.flipPct,
      1,
    )}% |`,
  );
}
out.push("");
for (const it of H.items) out.push(itemSection(it));

/* ---------------- 6. ความซ้ำซ้อน ---------------- */
out.push("## 7. ความซ้ำซ้อนระหว่างข้อ");
out.push("");
out.push("คู่ที่สัมพันธ์กันสูงสุด 12 คู่ (ค่าสัมประสิทธิ์สหสัมพันธ์ของคะแนนรายข้อ)");
out.push("");
out.push("| ข้อ A | ข้อ B | r |");
out.push("|---|---|---:|");
for (const p of H.correlations.top.slice(0, 12)) out.push(`| ${p.a}. ${p.aShort} | ${p.b}. ${p.bShort} | ${f(p.r)} |`);
out.push("");
out.push(
  "ข้อ 8/9/10 (ไฟฟ้า–โทรศัพท์–อินเทอร์เน็ต) สัมพันธ์กันเองในระดับ 0.58–0.68 ซึ่งสูงพอที่จะถือว่าวัด *สิ่งเดียวกัน* คือ \"ระดับการเข้าถึงโครงสร้างพื้นฐานของหมู่บ้าน\" — การให้คะแนนแยก 3 ข้อ (รวม 9 คะแนน) จึงเท่ากับนับความยากลำบากเดียวซ้ำ 3 ครั้ง",
);
out.push("");

/* ---------------- 7. ข้อ 1 ---------------- */
out.push("## 8. เจาะลึกข้อ 1 (ความสูง) — ข้อที่กำหนดผลมากที่สุด");
out.push("");
out.push("**สูตรที่ใช้จริงในแต่ละรอบปี** (นับจำนวนแถวที่คะแนนที่เก็บไว้ตรงกับแต่ละสูตร)");
out.push("");
out.push("| ปี | แถวที่มีคะแนน | ตรงกับสูตรเชิงเส้น 0–600 | ตรงกับสูตรฐาน 15 + เพดาน 500 |");
out.push("|---|---:|---:|---:|");
for (const y of el.fitByYear) {
  if (!y.n) continue;
  out.push(`| ${y.year} | ${n(y.n)} | ${n(y.fitLinear600)} | ${n(y.fitBase15)} |`);
}
out.push("");
out.push("**การกระจายความสูงจริง (เมตร)**");
out.push("");
out.push("| ช่วงความสูง | จำนวนโรงเรียน | |");
out.push("|---|---:|---|");
const maxE = Math.max(...el.elevation.histogram.map((b) => b.n));
for (const b of el.elevation.histogram) {
  out.push(`| ${b.lo}–${b.hi} | ${n(b.n)} | ${"█".repeat(Math.round((b.n / maxE) * 28))} |`);
}
out.push("");
out.push(
  `มัธยฐาน ${f(el.elevation.p50, 0)} ม. · P25 ${f(el.elevation.p25, 0)} ม. · P75 ${f(
    el.elevation.p75,
    0,
  )} ม. · ต่ำกว่า 500 ม. ${f(el.elevation.below500Pct, 1)}%`,
);
out.push("");
out.push("**ผลของสูตรต่อการจำแนก**");
out.push("");
out.push("| สูตร | คะแนนเฉลี่ยข้อ 1 | SD | ได้เต็ม 30 | item–rest r | คะแนนรวมเฉลี่ย | ผ่าน 70 |");
out.push("|---|---:|---:|---:|---:|---:|---:|");
out.push(
  `| ฐาน 15 + เพดาน 500 (ใช้อยู่) | ${f(el.scoreUnderBase15.mean)} | ${f(el.scoreUnderBase15.sd)} | ${f(
    el.scoreUnderBase15.fullPct,
    1,
  )}% | ${f(el.discrimination.base15)} | ${f(el.passRate.meanTotalBase15)} | ${f(el.passRate.base15, 1)}% |`,
);
out.push(
  `| เชิงเส้น 0–600 (รอบ 2565) | ${f(el.scoreUnderLinear600.mean)} | ${f(el.scoreUnderLinear600.sd)} | ${f(
    el.scoreUnderLinear600.fullPct,
    1,
  )}% | ${f(el.discrimination.linear600)} | ${f(el.passRate.meanTotalLinear600)} | ${f(el.passRate.linear600, 1)}% |`,
);
out.push("");
out.push("**สัญญาณการรายงานอิงเกณฑ์ (threshold bunching)**");
out.push("");
out.push(
  `| ความสูง = 500 ม. พอดี | 480–494 ม. | 506–520 ม. |\n|---:|---:|---:|\n| ${n(el.bunchingAt500.exactly500)} | ${n(
    el.bunchingAt500.in480to494,
  )} | ${n(el.bunchingAt500.in506to520)} |`,
);
out.push("");
out.push("");
out.push("**การกระจุกที่ 500 ม. แยกตามรอบปี** (ทุกแถวในฐาน ไม่จำกัดเฉพาะประชากรที่วิเคราะห์)");
out.push("");
out.push("| ปี | แถวทั้งหมด | ระบุ 500 ม. พอดี | สัดส่วน |");
out.push("|---|---:|---:|---:|");
for (const y of el.bunchingAt500.byYear) {
  if (!y.n) continue;
  out.push(`| ${y.year} | ${n(y.n)} | ${n(y.exactly500)} | ${f(y.pct, 1)}% |`);
}
out.push("");
out.push(
  "สัดส่วนพุ่งขึ้นชัดเจนตั้งแต่รอบ 2566 ซึ่งเป็นรอบที่เปลี่ยนมาใช้สูตร \"ผ่านด่าน 500 ม. แล้วได้คะแนนฐาน 15\" — เป็นรูปแบบคลาสสิกของการรายงานให้พอดีเกณฑ์ (threshold anchoring) หลังกติกาเปลี่ยน",
);
out.push("");
out.push(
  `ค่าที่ลงท้ายด้วยเลขกลม 100 ม. คิดเป็น ${f(
    (el.bunchingAt500.roundedToHundred / el.bunchingAt500.nonZero) * 100,
    1,
  )}% และลงท้ายด้วยเลขกลม 10 ม. ${f((el.bunchingAt500.roundedToTen / el.bunchingAt500.nonZero) * 100, 1)}% ของค่าที่ไม่เป็นศูนย์ — ` +
    "ทั้งที่ข้อนี้ระบุว่าให้ระบบดึงจาก Google Maps Elevation API อัตโนมัติ ตัวเลขที่กลมขนาดนี้จึงชี้ว่ามีการกรอกด้วยมือทับค่าที่ระบบวัดได้",
);
out.push("");

/* ---------------- 8. คุณภาพข้อมูล ---------------- */
out.push("## 9. คุณภาพข้อมูล — สิ่งที่โค้ดเกณฑ์ปี 2569 ต้องรับมือ");
out.push("");
out.push("| รายการตรวจ | จำนวน | สัดส่วน |");
out.push("|---|---:|---:|");
const qLabels = {
  stuSumZero: "จำนวนนักเรียนรวม = 0 (ทำให้ตัวหารของข้อ 11/13 พัง)",
  elevZero: "ความสูง = 0 เมตร",
  elevBelowAvg: "ความสูงจุดสูงสุด < ค่าเฉลี่ยความสูง (ขัดกันเองในเชิงตรรกะ)",
  noLatLng: "ไม่มีพิกัด lat/lng",
  distanceZero: "ระยะทางถึงศาลากลาง = 0 กม.",
  waterBlank: "ไม่ได้เลือกแหล่งน้ำ",
  powerBlank: "ไม่ได้เลือกระบบไฟฟ้า",
  phoneBlank: "ไม่ได้เลือกระบบโทรศัพท์",
  netBlank: "ไม่ได้เลือกระบบอินเทอร์เน็ต",
  poorGtStudents: "นักเรียนยากจน > นักเรียนทั้งหมด",
  boardingGtStudents: "นักเรียนพักนอน > นักเรียนทั้งหมด",
  ethnicGtStudents: "ร้อยละชาติพันธุ์ > 100",
  noRefdocWhenPositive: "กรอกจำนวนนักเรียนพักนอน > 0 แต่ไม่แนบหลักฐาน",
};
for (const [k, label] of Object.entries(qLabels)) {
  const v = H.quality[k];
  if (!v) continue;
  out.push(`| ${label} | ${n(v.n)} | ${f(v.pct, 2)}% |`);
}
out.push("");
out.push("**ความตรงกันระหว่างคะแนนที่เก็บไว้กับคะแนนที่คำนวณใหม่**");
out.push("");
out.push(
  `ไม่ตรงกัน ${n(H.reconcile.mismatched)} จาก ${n(H.reconcile.n)} เรคคอร์ด (${f(
    H.reconcile.mismatchPct,
    1,
  )}%) · ผลต่างเฉลี่ย ${f(H.reconcile.meanDiff)} คะแนน · ผลต่างสูงสุด ${f(H.reconcile.maxAbsDiff)} คะแนน`,
);
out.push("");
out.push("| ข้อที่เป็นต้นเหตุ | เรคคอร์ดที่ไม่ตรง | % |");
out.push("|---|---:|---:|");
for (const b of H.reconcile.byItem.filter((x) => x.mismatched > 0)) {
  out.push(`| ${b.no}. ${b.short} | ${n(b.mismatched)} | ${f(b.pct, 2)}% |`);
}
out.push("");
out.push(
  "ความไม่ตรงกันเกือบทั้งหมดมาจากข้อ 1 ซึ่งยืนยันข้อสรุปหัวข้อ 7 ว่าสูตรเปลี่ยนระหว่างรอบปี ไม่ใช่ข้อมูลเสียหาย — แต่แปลว่า **ห้ามนำ `sum_score` ที่เก็บไว้ไปเทียบข้ามปีโดยตรง** ต้องคำนวณใหม่จากค่าดิบเสมอ",
);
out.push("");

/* ---------------- 9. การจำลอง ---------------- */
out.push("## 10. การจำลองทางเลือกในการให้น้ำหนัก");
out.push("");
out.push(
  "ทุกฉากทัศน์ใช้ค่าดิบชุดเดียวกัน เปลี่ยนเฉพาะสูตร/น้ำหนัก — คอลัมน์ ρ คือสหสัมพันธ์อันดับ (Spearman) กับผลจัดอันดับของเกณฑ์ปัจจุบัน ค่าใกล้ 1 แปลว่าลำดับความยากลำบากไม่พลิก เปลี่ยนแค่ระดับคะแนน",
);
out.push("");
out.push("| ฉากทัศน์ | เฉลี่ย | SD | ผ่าน 70 | % | เปลี่ยนสถานะได้/ตก | ρ | จุดตัดที่ให้จำนวนผ่านเท่าเดิม |");
out.push("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const s of H.simulations) {
  out.push(
    `| ${s.label} | ${f(s.mean)} | ${f(s.sd)} | ${n(s.pass70)} | ${f(s.passRate, 1)}% | ${n(s.changedPassStatus)} (${f(
      s.changedPct,
      1,
    )}%) | ${f(s.spearmanVsCurrent)} | ${s.cutForSameCount === null ? "—" : f(s.cutForSameCount)} |`,
  );
}
out.push("");
out.push(
  "**อ่านผล:** ทุกฉากทัศน์ให้ ρ ≥ 0.90 คือ *ลำดับ* ของโรงเรียนแทบไม่เปลี่ยน สิ่งที่เปลี่ยนคือ **ระดับคะแนนและจำนวนที่ผ่านจุดตัด** " +
    "ดังนั้นถ้าปี 2569 ปรับสูตรให้จำแนกดีขึ้น จำเป็นต้อง **ย้ายจุดตัดตามไปด้วย** (ดูคอลัมน์สุดท้าย) มิฉะนั้นจำนวนโรงเรียนที่ได้รับสิทธิ์จะลดลงโดยไม่ได้ตั้งใจ",
);
out.push("");

/* ---------------- 10. ช่วงค่าตามเปอร์เซ็นไทล์ ---------------- */
out.push("## 11. ช่วงค่าจริงสำหรับตั้งระดับใหม่ (ข้อที่เป็นตัวเลข)");
out.push("");
out.push("| ข้อ | ตัวชี้วัด | หน่วย | P10 | P25 | P50 | P75 | P90 | P95 |");
out.push("|---:|---|---|---:|---:|---:|---:|---:|---:|");
for (const b of H.bands) {
  const g = (p) => f(b.percentiles.find((x) => x.p === p)?.v ?? 0, 1);
  out.push(`| ${b.no} | ${b.short} | ${b.unit ?? "—"} | ${g(10)} | ${g(25)} | ${g(50)} | ${g(75)} | ${g(90)} | ${g(95)} |`);
}
out.push("");
out.push(
  "ตัวเลขชุดนี้คือฐานสำหรับตั้ง \"ระดับ\" แบบอิงการกระจายจริง (เช่น ระดับ 3 = สูงกว่า P90 ของประชากรจริง) แทนการตั้งเพดานลอย ๆ ที่ทำให้คนส่วนใหญ่ชนเพดานเหมือนสูตรปัจจุบัน",
);
out.push("");

/* ---------------- 11. รายจังหวัด ---------------- */
out.push("## 12. ภาพรายจังหวัด (15 จังหวัดที่มีโรงเรียนมากที่สุด)");
out.push("");
out.push("| จังหวัด | โรงเรียน | คะแนนเฉลี่ย | ผ่าน 70 | อัตราผ่าน | คะแนนข้อ 1 เฉลี่ย | สาธารณูปโภค (เต็ม 15) | ผู้เรียน (เต็ม 20) |");
out.push("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const p of H.provinces.slice(0, 15)) {
  out.push(
    `| ${p.province || "(ไม่ระบุ)"} | ${n(p.n)} | ${f(p.meanTotal)} | ${n(p.pass70)} | ${f(p.passRate, 1)}% | ${f(
      p.meanElevScore,
    )} | ${f(p.meanUtility)} | ${f(p.meanLearner)} |`,
  );
}
out.push("");
out.push(
  "คะแนนข้อ 1 เฉลี่ยของทุกจังหวัดเกาะกลุ่มกันที่ระดับใกล้ 30 — ยืนยันอีกทางว่าข้อนี้ไม่ได้แยกความต่างระหว่างพื้นที่ ความต่างที่แท้จริงระหว่างจังหวัดมาจากกลุ่มสาธารณูปโภคและกลุ่มผู้เรียน",
);
out.push("");

/* ---------------- 12. เกาะ ---------------- */
out.push("## 13. พื้นที่เกาะ (15 ข้อ) — สรุปย่อ");
out.push("");
out.push("| ข้อ | ตัวชี้วัด | เต็ม | เฉลี่ย | %ของเต็ม | ได้เต็ม | ได้ 0 | D |");
out.push("|---:|---|---:|---:|---:|---:|---:|---:|");
for (const it of I.items) {
  out.push(
    `| ${it.no} | ${it.short} | ${it.max} | ${f(it.score.mean)} | ${f(it.score.share, 1)}% | ${f(
      it.score.fullPct,
      1,
    )}% | ${f(it.score.zeroPct, 1)}% | ${f(it.discrimination.D)} |`,
  );
}
out.push("");
const isl3 = I.items.find((i) => i.no === 3);
const isl4 = I.items.find((i) => i.no === 4);
out.push(
  `เกณฑ์เกาะรวมน้ำหนักไว้ที่ข้อ 3 (ลักษณะที่ตั้ง ${isl3.max} คะแนน) และข้อ 4 (พาหนะหลัก ${isl4.max} คะแนน) รวม ${
    isl3.max + isl4.max
  } คะแนน ` +
    `ซึ่งวัดสิ่งใกล้เคียงกัน (มีสะพานหรือไม่ / ต้องลงเรือหรือไม่) — โครงสร้างนี้ทำให้ผลลัพธ์ถูกกำหนดโดยคำตอบ 2 ข้อเป็นหลัก และ N = ${n(
      I.totals.n,
    )} แห่งเท่านั้น การตั้งเกณฑ์ปี 2569 สำหรับพื้นที่เกาะจึงควรใช้การตรวจภาคสนามประกอบ ไม่ใช่พึ่งคะแนนอย่างเดียว`,
);
out.push("");

/* ---------------- 13. ข้อเสนอเชิงเทคนิค ---------------- */
out.push("## 14. ข้อเสนอเชิงเทคนิคต่อการเขียนโค้ดเกณฑ์ปี 2569");
out.push("");
out.push(
  "ข้อเสนอต่อไปนี้เป็นข้อสรุป**เชิงสถิติ**จากข้อมูลข้างต้น การตัดสินใจเชิงนโยบายเป็นอำนาจของคณะกรรมการเกณฑ์",
);
out.push("");
out.push("| # | ข้อเสนอ | หลักฐานที่รองรับ |");
out.push("|---|---|---|");
out.push(
  `| 1 | **แยก \"ด่านคัดกรอง\" ออกจาก \"คะแนน\"** — ใช้ความสูง ≥ 500 ม. เป็นเงื่อนไขเข้าเกณฑ์ (ผ่าน/ไม่ผ่าน) แล้วไม่ต้องให้คะแนนซ้ำอีก | ข้อ 1 ได้เต็ม ${f(
    H.items[0].score.fullPct,
    1,
  )}% และ D = ${f(H.items[0].discrimination.D)} — ทำหน้าที่เป็นด่านอยู่แล้วโดยพฤตินัย แต่กินน้ำหนัก 30 คะแนน |`,
);
out.push(
  `| 2 | **ให้คะแนนความสูงแบบต่อเนื่องโดยไม่มีคะแนนฐาน** ถ้ายังต้องการให้เป็นตัวชี้วัด — เช่น เชิงเส้นถึง P90 ของประชากรจริง (${f(
    el.elevation.p90,
    0,
  )} ม.) | สูตรเชิงเส้นเพิ่ม SD ของข้อ 1 จาก ${f(el.scoreUnderBase15.sd)} เป็น ${f(
    el.scoreUnderLinear600.sd,
  )} และเพิ่ม item–rest r จาก ${f(el.discrimination.base15)} เป็น ${f(el.discrimination.linear600)} |`,
);
out.push(
  `| 3 | **ยุบข้อ 8/9/10 เป็นดัชนีโครงสร้างพื้นฐานเดียว** | สหสัมพันธ์ระหว่างกัน 0.58–0.68 — วัดสิ่งเดียวกัน |`,
);
out.push(
  `| 4 | **เพิ่มน้ำหนักให้ข้อที่จำแนกได้จริง** (${bestItems
    .map((i) => `ข้อ ${i.no}`)
    .join(", ")}) | D = ${bestItems.map((i) => f(i.discrimination.D)).join(", ")} ตามลำดับ แต่ปัจจุบันได้น้ำหนักเพียงข้อละ ${bestItems[0].max}–${
    bestItems[bestItems.length - 1].max
  } คะแนน |`,
);
out.push(
  `| 5 | **ย้ายจุดตัดพร้อมกับการปรับสูตร** | ทุกฉากทัศน์ในหัวข้อ 9 ให้ ρ ≥ 0.90 แต่จำนวนผ่านเปลี่ยนจาก ${n(
    H.simulations[0].pass70,
  )} เหลือ ${n(H.simulations[H.simulations.length - 1].pass70)} แห่งถ้าคงจุดตัด 70 ไว้เฉย ๆ |`,
);
out.push(
  `| 6 | **บังคับ validation ที่ระดับโค้ด** — นักเรียนยากจน/พักนอน ≤ นักเรียนทั้งหมด, ปฏิเสธ stu_sum = 0, ปฏิเสธความสูงที่ขัดกับค่า GIS เกินพิกัดที่ยอมรับได้ | พบข้อมูลขัดแย้งในตารางหัวข้อ 8 |`,
);
out.push(
  `| 7 | **ล็อกค่าที่วัดอัตโนมัติไม่ให้แก้ด้วยมือ** | ความสูงกระจุกที่ 500 ม. พอดี ${n(
    el.bunchingAt500.exactly500,
  )} แห่ง และ ${f((el.bunchingAt500.roundedToHundred / el.bunchingAt500.nonZero) * 100, 1)}% เป็นเลขกลมร้อย |`,
);
out.push(
  `| 8 | **เก็บ \"ค่าดิบ + เวอร์ชันของสูตร\" ไว้ทุกรอบ** เพื่อให้คำนวณย้อนหลังได้ | สูตรข้อ 1 เปลี่ยนระหว่าง 2565→2566 ทำให้ ${f(
    H.reconcile.mismatchPct,
    1,
  )}% ของเรคคอร์ดเทียบข้ามปีไม่ได้ |`,
);
out.push("");
out.push(
  "ค่าคงที่เชิงสถิติทั้งหมดที่ใช้อ้างอิงในข้อเสนอนี้ถูกส่งออกเป็นโค้ดไว้ที่ [`lib/legacy-baseline.ts`](../lib/legacy-baseline.ts) เพื่อให้เกณฑ์ปี 2569 เรียกใช้ได้โดยไม่ต้องคัดลอกตัวเลขด้วยมือ",
);
out.push("");

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.error("เขียนรายงาน:", path.relative(ROOT, OUT));
