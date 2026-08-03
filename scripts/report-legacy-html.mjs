// สร้างหน้านำเสนอผลวิเคราะห์ (HTML เดี่ยว ๆ เปิดได้เลย) จาก docs/analysis/legacy-item-stats.json
//   node scripts/report-legacy-html.mjs → docs/analysis/legacy-item-report.html

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "docs", "analysis", "legacy-item-stats.json");
const OUT = path.join(ROOT, "docs", "analysis", "legacy-item-report.html");

import {
  PAGE_STYLE,
  TOOLTIP_SCRIPT,
  esc,
  f,
  hbars,
  histBars,
  n,
  standalonePage,
} from "./html-charts.mjs";

const d = JSON.parse(fs.readFileSync(IN, "utf8"));
const H = d.highland;
const I = d.island;
const el = H.elevationRegimes;

/* ---------- ส่วนประกอบหน้า ---------- */

const freeItems = H.items.filter((i) => i.score.share >= 90 && i.discrimination.D < 0.15);
const freePoints = freeItems.reduce((s, i) => s + i.score.mean, 0);

const tiles = [
  { v: n(H.totals.n), l: "โรงเรียนพื้นที่สูงที่วิเคราะห์", s: `พื้นที่เกาะอีก ${n(I.totals.n)} แห่ง` },
  { v: f(H.totals.mean, 1), l: "คะแนนรวมเฉลี่ย (เต็ม 100)", s: `SD ${f(H.totals.sd, 1)} · มัธยฐาน ${f(H.totals.p50, 1)}` },
  { v: `${f(H.totals.cuts.find((c) => c.cut === 70).pct, 1)}%`, l: "ผ่านจุดตัด 70 คะแนน", s: `${n(H.totals.cuts.find((c) => c.cut === 70).pass)} แห่ง` },
  { v: f(freePoints, 1), l: "คะแนนที่แจกให้แทบทุกโรงเรียน", s: `จากข้อ ${freeItems.map((i) => i.no).join(", ")} รวมเต็ม ${freeItems.reduce((s, i) => s + i.max, 0)} คะแนน` },
  { v: `${f(H.totals.nearCut.pctInBand, 1)}%`, l: "อยู่ในช่วง 65–75 คะแนน", s: `${n(H.totals.nearCut["65-75"])} แห่ง — กลุ่มที่ผลพลิกง่ายที่สุด` },
  { v: `${f(H.reconcile.mismatchPct, 1)}%`, l: "คะแนนที่เก็บไว้ไม่ตรงกับสูตรปัจจุบัน", s: "เพราะสูตรข้อ 1 เปลี่ยนระหว่างรอบปี" },
];

const itemRows = H.items.map((it) => ({
  label: `${it.no}. ${it.short}`,
  value: it.score.share,
  max: 100,
  dp: 1,
  accent: it.score.share >= 90 && it.discrimination.D < 0.15,
  note: `เต็ม ${it.max} คะแนน · ได้จริงเฉลี่ย ${f(it.score.mean)}`,
}));

const discRows = [...H.items]
  .sort((a, b) => b.discrimination.D - a.discrimination.D)
  .map((it) => ({
    label: `${it.no}. ${it.short}`,
    value: it.discrimination.D,
    max: 1,
    dp: 2,
    accent: it.discrimination.D < 0.15,
    note: `คะแนนเต็มข้อนี้ ${it.max} · item–rest r = ${f(it.discrimination.itemRestCorr)}`,
  }));

const groupRows = H.groups.map((g) => ({
  label: g.label,
  value: g.utilisation,
  max: 100,
  dp: 1,
  accent: g.utilisation >= 90,
  note: `เต็ม ${g.maxScore} คะแนน · ได้จริง ${f(g.mean)}`,
}));

const itemTable = `
<table>
  <thead><tr>
    <th>ข้อ</th><th>ตัวชี้วัด</th><th>กลุ่มข้อมูล</th><th class="num">เต็ม</th><th class="num">เฉลี่ย</th>
    <th class="num">%ของเต็ม</th><th class="num">ได้เต็ม</th><th class="num">ได้ 0</th>
    <th class="num">item–rest r</th><th class="num">D</th><th class="num">ตัดทิ้งแล้วสลับผล</th>
  </tr></thead>
  <tbody>
    ${H.items
      .map(
        (it) => `<tr>
      <td class="num">${it.no}</td><td>${esc(it.short)}</td><td class="muted">${esc(it.groupLabel)}</td>
      <td class="num">${it.max}</td><td class="num">${f(it.score.mean)}</td>
      <td class="num">${f(it.score.share, 1)}%</td><td class="num">${f(it.score.fullPct, 1)}%</td>
      <td class="num">${f(it.score.zeroPct, 1)}%</td>
      <td class="num">${f(it.discrimination.itemRestCorr)}</td>
      <td class="num ${it.discrimination.D < 0.15 ? "warn" : it.discrimination.D >= 0.3 ? "good" : ""}">${f(it.discrimination.D)}</td>
      <td class="num">${f(it.impact.flipPct, 1)}%</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>`;

const simTable = `
<table>
  <thead><tr><th>ฉากทัศน์</th><th class="num">เฉลี่ย</th><th class="num">SD</th><th class="num">ผ่าน 70</th><th class="num">%</th><th class="num">เปลี่ยนสถานะ</th><th class="num">ρ</th><th class="num">จุดตัดที่ให้จำนวนเท่าเดิม</th></tr></thead>
  <tbody>${H.simulations
    .map(
      (s) => `<tr><td>${esc(s.label)}</td><td class="num">${f(s.mean)}</td><td class="num">${f(s.sd)}</td>
      <td class="num">${n(s.pass70)}</td><td class="num">${f(s.passRate, 1)}%</td>
      <td class="num">${n(s.changedPassStatus)} (${f(s.changedPct, 1)}%)</td>
      <td class="num">${f(s.spearmanVsCurrent)}</td>
      <td class="num">${s.cutForSameCount === null ? "—" : f(s.cutForSameCount)}</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

const bunchTable = `
<table>
  <thead><tr><th>รอบปี</th><th class="num">แถวประเมิน</th><th class="num">ระบุความสูง 500 ม. พอดี</th><th class="num">สัดส่วน</th></tr></thead>
  <tbody>${el.bunchingAt500.byYear
    .filter((y) => y.n)
    .map(
      (y) =>
        `<tr><td>${y.year}</td><td class="num">${n(y.n)}</td><td class="num">${n(y.exactly500)}</td><td class="num ${
          y.pct > 30 ? "warn" : ""
        }">${f(y.pct, 1)}%</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

const provinceTable = `
<table>
  <thead><tr><th>จังหวัด</th><th class="num">โรงเรียน</th><th class="num">คะแนนเฉลี่ย</th><th class="num">ผ่าน 70</th><th class="num">อัตราผ่าน</th><th class="num">คะแนนข้อ 1</th><th class="num">สาธารณูปโภค /15</th><th class="num">ผู้เรียน /20</th></tr></thead>
  <tbody>${H.provinces
    .slice(0, 15)
    .map(
      (p) => `<tr><td>${esc(p.province || "(ไม่ระบุ)")}</td><td class="num">${n(p.n)}</td>
      <td class="num">${f(p.meanTotal)}</td><td class="num">${n(p.pass70)}</td><td class="num">${f(p.passRate, 1)}%</td>
      <td class="num">${f(p.meanElevScore)}</td><td class="num">${f(p.meanUtility)}</td><td class="num">${f(p.meanLearner)}</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

const corrTable = `
<table>
  <thead><tr><th>ข้อ A</th><th>ข้อ B</th><th class="num">r</th></tr></thead>
  <tbody>${H.correlations.top
    .slice(0, 10)
    .map(
      (p) =>
        `<tr><td>${p.a}. ${esc(p.aShort)}</td><td>${p.b}. ${esc(p.bShort)}</td><td class="num ${
          Math.abs(p.r) >= 0.5 ? "warn" : ""
        }">${f(p.r)}</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

const qualityRows = [
  ["stuSumZero", "จำนวนนักเรียนรวม = 0"],
  ["elevZero", "ความสูง = 0 เมตร"],
  ["elevBelowAvg", "ความสูงจุดสูงสุด < ค่าเฉลี่ยความสูง"],
  ["noLatLng", "ไม่มีพิกัด lat/lng"],
  ["distanceZero", "ระยะทางถึงศาลากลาง = 0 กม."],
  ["waterBlank", "ไม่ได้เลือกแหล่งน้ำ"],
  ["poorGtStudents", "นักเรียนยากจน > นักเรียนทั้งหมด"],
  ["boardingGtStudents", "นักเรียนพักนอน > นักเรียนทั้งหมด"],
  ["noRefdocWhenPositive", "กรอกนักเรียนพักนอน > 0 แต่ไม่แนบหลักฐาน"],
]
  .filter(([k]) => H.quality[k])
  .map(([k, label]) => `<tr><td>${label}</td><td class="num">${n(H.quality[k].n)}</td><td class="num">${f(H.quality[k].pct, 2)}%</td></tr>`)
  .join("");

const body = `${PAGE_STYLE}
<div class="viz-root">
  <h1>สถิติผลการประเมินเดิมรายข้อ — ฐานสำหรับกำหนดเกณฑ์โรงเรียนพื้นที่สูง ปี 2569</h1>
  <p class="lead">วิเคราะห์แบบประเมิน 16 ข้อของพื้นที่สูงและ 15 ข้อของพื้นที่เกาะจากฐานข้อมูล <code>ssrainfo_ssra</code>
  โดยคำนวณคะแนนใหม่จากค่าดิบทุกแถวด้วยสูตรเดียวกัน เพื่อดูว่าแต่ละข้อ <em>ทำงานจริงแค่ไหน</em> ก่อนนำไปออกแบบเกณฑ์ปีใหม่</p>
  <p class="src">แหล่งข้อมูล: ${esc(d.meta.source)} · ประชากร: พื้นที่สูง ${n(H.totals.n)} แห่ง / พื้นที่เกาะ ${n(I.totals.n)} แห่ง
  (รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะที่ยืนยันสถานะปี 2569) · สร้างเมื่อ ${new Date(d.meta.generatedAt).toLocaleString("th-TH")}<br>
  เอกสารวิเคราะห์เชิงสถิติ ไม่ใช่ประกาศเกณฑ์ — ตัวเลขทุกตัวคำนวณสดจากฐานข้อมูล</p>

  <div class="tiles">
    ${tiles.map((t) => `<div class="tile"><div class="v">${t.v}</div><div class="l">${t.l}</div><div class="s">${t.s}</div></div>`).join("")}
  </div>

  <h2>1. ข้อค้นพบหลัก</h2>
  <ol class="findings">
    <li><b>เกณฑ์ปัจจุบันใช้พื้นที่คะแนนจริงเพียงประมาณ ${f(100 - freePoints, 0)} จาก 100 คะแนน</b> —
      ข้อ ${freeItems.map((i) => i.no).join(", ")} (รวมเต็ม ${freeItems.reduce((s, i) => s + i.max, 0)} คะแนน)
      โรงเรียนได้เฉลี่ยเกิน 90% ของคะแนนเต็มและแทบไม่จำแนกใครออกจากใคร</li>
    <li><b>ข้อ 1 (ความสูง) ถือน้ำหนัก 30 คะแนน แต่มีอำนาจจำแนก D = ${f(H.items[0].discrimination.D)}</b> —
      ${f(H.items[0].score.fullPct, 1)}% ได้เต็ม เพราะสูตรให้คะแนนฐาน 15 ทันทีที่ผ่านด่าน แล้วตันที่ 500 ม.
      ขณะที่มัธยฐานความสูงจริงคือ ${f(el.elevation.p50, 0)} ม.</li>
    <li><b>สูตรข้อ 1 เปลี่ยนระหว่างรอบปี</b> — รอบ 2565 ใช้สูตรเชิงเส้น 0–600 ม. รอบ 2566 เป็นต้นมาใช้คะแนนฐาน 15 + เพดาน 500 ม.
      ทำให้ ${f(H.reconcile.mismatchPct, 1)}% ของเรคคอร์ดมีคะแนนที่เก็บไว้ไม่ตรงกับสูตรปัจจุบัน และเทียบข้ามปีตรง ๆ ไม่ได้</li>
    <li><b>มีการรายงานความสูงเท่ากับ 500 ม. พอดีมากผิดปกติ</b> — สูงสุดในรอบ 2566 ที่ ${f(
      el.bunchingAt500.byYear.find((y) => y.year === 2566)?.pct ?? 0,
      1,
    )}% ของแถวทั้งหมด ซึ่งเป็นรอบแรกที่เปลี่ยนมาใช้เกณฑ์ 500 ม.</li>
    <li><b>ข้อที่จำแนกได้ดีที่สุดกลับได้น้ำหนักน้อยที่สุด</b> —
      ${[...H.items].sort((a, b) => b.discrimination.D - a.discrimination.D).slice(0, 3).map((i) => `ข้อ ${i.no} ${esc(i.short)} (D=${f(i.discrimination.D)}, เต็ม ${i.max})`).join(" · ")}</li>
    <li><b>ไฟฟ้า–โทรศัพท์–อินเทอร์เน็ตวัดสิ่งเดียวกัน</b> — สหสัมพันธ์ระหว่างกัน 0.58–0.68 แต่ให้คะแนนแยกกัน 3 ข้อ รวม 9 คะแนน</li>
    ${
      H.items.filter((i) => i.value?.penalisedByMaxIdRule?.n).length
        ? `<li><b>กติกา “ใช้ id สูงสุด” ลงโทษโรงเรียนที่กรอกครบตามจริง</b> —
      ${H.items
        .filter((i) => i.value?.penalisedByMaxIdRule?.n)
        .map((i) => `ข้อ ${i.no} ${esc(i.short)} ${n(i.value.penalisedByMaxIdRule.n)} แห่ง`)
        .join(" · ")}
      กรณีชัดที่สุดคือข้อ 8: โรงเรียนที่มีทั้งโซลาร์เซลล์และไฟฟ้าส่วนภูมิภาคได้ 0 คะแนน เท่ากับโรงเรียนที่มีไฟฟ้าปกติอย่างเดียว</li>`
        : ""
    }
  </ol>

  <h2>2. คะแนนรวมและความไวของจุดตัด</h2>
  <div class="card">
    <h3>การกระจายคะแนนรวม (พื้นที่สูง ${n(H.totals.n)} แห่ง)</h3>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> ต่ำกว่าจุดตัด 70</span>
      <span><i class="swatch" style="background:var(--series-2)"></i> ตั้งแต่ 70 ขึ้นไป</span>
    </div>
    ${histBars(H.totals.histogram.filter((b) => b.hi > 30), { markAt: 70, markLabel: "จุดตัด 70", unitLabel: " คะแนน" })}
    <p>ช่วง 65–75 คะแนนมี ${n(H.totals.nearCut["65-75"])} แห่ง (${f(H.totals.nearCut.pctInBand, 1)}%) —
    การขยับสูตรข้อใดข้อหนึ่งเพียงเล็กน้อยเปลี่ยนสถานะได้เป็นร้อยโรงเรียน</p>
  </div>
  <div class="card scroll">
    <h3>จำนวนที่ผ่านแต่ละจุดตัด</h3>
    <table>
      <thead><tr><th>จุดตัด</th><th class="num">พื้นที่สูง</th><th class="num">%</th><th class="num">พื้นที่เกาะ</th><th class="num">%</th></tr></thead>
      <tbody>${H.totals.cuts
        .map((c) => {
          const ic = I.totals.cuts.find((x) => x.cut === c.cut);
          return `<tr><td class="num">${c.cut}</td><td class="num">${n(c.pass)}</td><td class="num">${f(c.pct, 1)}%</td><td class="num">${n(ic?.pass)}</td><td class="num">${f(ic?.pct, 1)}%</td></tr>`;
        })
        .join("")}</tbody>
    </table>
  </div>

  <h2>3. แต่ละข้อใช้พื้นที่คะแนนไปเท่าไร</h2>
  <div class="card">
    <h3>สัดส่วนคะแนนที่โรงเรียนได้จริง เทียบกับคะแนนเต็มของข้อนั้น (%)</h3>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-2)"></i> ได้เกือบเต็มทุกแห่ง + จำแนกไม่ได้ (คะแนนแจกฟรี)</span>
      <span><i class="swatch" style="background:var(--series-1)"></i> ข้ออื่น</span>
    </div>
    ${hbars(itemRows, { unit: "%" })}
  </div>
  <div class="card">
    <h3>อำนาจจำแนก D รายข้อ (เรียงจากมากไปน้อย)</h3>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-2)"></i> D &lt; 0.15 — แทบไม่จำแนก</span>
      <span><i class="swatch" style="background:var(--series-1)"></i> ข้ออื่น</span>
    </div>
    ${hbars(discRows)}
    <p>D คือคะแนนเฉลี่ยของกลุ่มคะแนนรวมสูงสุด 27% ลบกลุ่มต่ำสุด 27% หารด้วยคะแนนเต็มของข้อนั้น
    (≥0.40 ดีมาก · 0.30–0.39 ใช้ได้ · &lt;0.20 ควรออกแบบใหม่)</p>
  </div>
  <div class="card scroll">
    <h3>ตารางสถิติครบทุกข้อ</h3>
    ${itemTable}
  </div>

  <h2>4. กลุ่มข้อมูลพื้นฐาน</h2>
  <div class="card">
    <h3>สัดส่วนพื้นที่คะแนนที่ถูกใช้ไปจริงในแต่ละกลุ่ม (%)</h3>
    ${hbars(groupRows, { unit: "%", labelW: 210 })}
    <div class="scroll">
    <table>
      <thead><tr><th>กลุ่ม</th><th>ข้อ</th><th class="num">คะแนนเต็ม</th><th class="num">ได้จริงเฉลี่ย</th><th>แหล่งข้อมูล</th><th>ตรวจย้อนได้</th></tr></thead>
      <tbody>${H.groups
        .map(
          (g) =>
            `<tr><td>${esc(g.label)}</td><td class="num">${g.items.join(", ")}</td><td class="num">${g.maxScore}</td>
             <td class="num">${f(g.mean)}</td><td class="muted">${esc(g.source)}</td>
             <td>${{ auto: "อัตโนมัติ (GIS)", registry: "ทะเบียนราชการ", declared: "โรงเรียนกรอกเอง" }[g.verifiable]}</td></tr>`,
        )
        .join("")}</tbody>
    </table>
    </div>
  </div>

  <h2>5. จำแนกตามชนิดของค่าที่วัด</h2>
  <p>หัวข้อก่อนหน้าถามว่า <em>ข้อมูลมาจากไหน</em> · หัวข้อนี้ถามว่า <em>ค่าที่ได้เป็นอะไร</em> —
  ซึ่งเป็นตัวกำหนดว่าสถิติแบบใดใช้กับข้อนั้นได้ ต้อง validate อย่างไร และเทียบข้ามโรงเรียนได้ตรง ๆ หรือไม่</p>
  <div class="tiles">
    <div class="tile"><div class="v">${f(H.measurement.split.quantitativePct, 0)}%</div>
      <div class="l">พื้นที่สูง — คะแนนจากค่าเชิงปริมาณ</div>
      <div class="s">${H.measurement.split.quantitativeWeight} คะแนน (ค่าวัดต่อเนื่อง + จำนวนนับ + ร้อยละ)</div></div>
    <div class="tile"><div class="v">${f(H.measurement.split.qualitativePct, 0)}%</div>
      <div class="l">พื้นที่สูง — คะแนนจากข้อความเชิงคุณภาพ</div>
      <div class="s">${H.measurement.split.qualitativeWeight} คะแนน (เรียงระดับ + สองค่า + เลือกหลายข้อ)</div></div>
    <div class="tile"><div class="v">${f(I.measurement.split.qualitativePct, 0)}%</div>
      <div class="l">พื้นที่เกาะ — คะแนนจากข้อความเชิงคุณภาพ</div>
      <div class="s">${I.measurement.split.qualitativeWeight} คะแนน — กลับด้านกับพื้นที่สูง</div></div>
    <div class="tile"><div class="v">${f(H.measurement.byOrigin.entered.pct, 0)}%</div>
      <div class="l">พื้นที่สูง — คะแนนจากค่าที่ผู้ใช้กรอกเอง</div>
      <div class="s">ระบบวัดให้เอง ${f(H.measurement.byOrigin.auto.pct, 0)}% · คำนวณจากข้อมูลอื่น ${f(H.measurement.byOrigin.derived.pct, 0)}%</div></div>
  </div>
  <div class="card">
    <h3>น้ำหนักคะแนนแยกตามชนิดของค่า (พื้นที่สูง)</h3>
    ${hbars(
      H.measurement.taxonomy.map((t) => ({
        label: t.label,
        value: t.weight,
        max: 100,
        dp: 0,
        accent: !["continuous", "count", "percent", "mean"].includes(t.key),
        note: `ข้อ ${t.items.join(", ")} · ใช้พื้นที่คะแนนไป ${f(t.utilisation, 1)}%`,
      })),
      { unit: " คะแนน", labelW: 230 },
    )}
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> ค่าเชิงปริมาณ (วัดเป็นหน่วยได้)</span>
      <span><i class="swatch" style="background:var(--series-2)"></i> ข้อความเชิงคุณภาพ</span>
    </div>
  </div>
  <div class="card scroll">
    <h3>ตารางจำแนกรายข้อ — พื้นที่สูง</h3>
    <table>
      <thead><tr><th>ข้อ</th><th>ตัวชี้วัด</th><th>ชนิดของค่า</th><th>ระดับการวัด</th><th>หน่วย</th><th>ที่มา</th><th>ปรับตามขนาดโรงเรียน</th><th class="num">เต็ม</th></tr></thead>
      <tbody>${H.measurement.items
        .map((it) => {
          const scaleLabel = { nominal: "นามบัญญัติ", ordinal: "เรียงอันดับ", interval: "อันตรภาค", ratio: "อัตราส่วน" };
          const norm =
            it.normalized === true
              ? '<span class="good">ปรับแล้ว</span>'
              : it.normalized === false
                ? '<span class="warn">ไม่ปรับ</span>'
                : '<span class="muted">—</span>';
          return `<tr><td class="num">${it.no}</td><td>${esc(it.short)}</td><td>${esc(it.measureLabel ?? "—")}</td>
            <td class="muted">${scaleLabel[it.scale] ?? "—"}</td><td class="muted">${esc(it.unit ?? "—")}</td>
            <td class="muted">${esc(it.originLabel ?? "—")}</td><td>${norm}</td><td class="num">${it.max}</td></tr>`;
        })
        .join("")}</tbody>
    </table>
  </div>
  <div class="card scroll">
    <h3>สถิติที่ใช้ได้กับแต่ละชนิดของค่า</h3>
    <table>
      <thead><tr><th>ชนิดของค่า</th><th>ใช้ได้</th><th>ใช้ไม่ได้</th><th>กติกา validate ที่ควรบังคับในโค้ด</th></tr></thead>
      <tbody>${H.measurement.taxonomy
        .map(
          (t) =>
            `<tr><td>${esc(t.label)}</td><td class="muted">${esc(t.validStats)}</td><td class="muted">${esc(
              t.invalidStats,
            )}</td><td class="muted">${esc(t.validation)}</td></tr>`,
        )
        .join("")}</tbody>
    </table>
    <p>ข้อความเชิงคุณภาพใช้ <b>ฐานนิยม</b> และ <b>มัธยฐานของระดับ</b> แทนค่าเฉลี่ย เพราะรหัสตัวเลือก 1–5 เป็นชื่อของระดับ ไม่ใช่ปริมาณ
    ระยะห่างระหว่างระดับไม่เท่ากันและวัดไม่ได้ — การเฉลี่ยรหัสจึงให้ตัวเลขที่ไม่มีความหมาย</p>
  </div>
  <div class="card scroll">
    <h3>จุดที่ “เก็บอย่างหนึ่ง แต่คิดคะแนนอีกอย่าง”</h3>
    <table>
      <thead><tr><th>ข้อ</th><th>ตัวชี้วัด</th><th>เก็บเป็น</th><th>คิดคะแนนเป็น</th><th>ประเด็น</th></tr></thead>
      <tbody>${H.measurement.items
        .filter((it) => it.mismatch)
        .map(
          (it) =>
            `<tr><td class="num">${it.no}</td><td>${esc(it.short)}</td><td class="muted">${esc(
              it.collectedAs ?? "—",
            )}</td><td class="muted">${esc(it.scoredAs ?? "—")}</td><td>${esc(it.mismatch)}</td></tr>`,
        )
        .join("")}</tbody>
    </table>
  </div>

  <h2>6. เจาะลึกข้อ 1 — ความสูง</h2>
  <div class="card">
    <h3>ความสูงจริงของโรงเรียน (เมตร)</h3>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> ต่ำกว่าเกณฑ์ 500 ม.</span>
      <span><i class="swatch" style="background:var(--series-2)"></i> ตั้งแต่ 500 ม. ขึ้นไป</span>
    </div>
    ${histBars(el.elevation.histogram, { markAt: 500, markLabel: "เกณฑ์ 500 ม.", unitLabel: " ม." })}
    <p>มัธยฐาน ${f(el.elevation.p50, 0)} ม. · P25 ${f(el.elevation.p25, 0)} ม. · P75 ${f(el.elevation.p75, 0)} ม. ·
    ต่ำกว่า 500 ม. ${f(el.elevation.below500Pct, 1)}% — สูตรที่ตันตั้งแต่ 500 ม. จึงมองไม่เห็นความต่างของโรงเรียนส่วนใหญ่</p>
  </div>
  <div class="card scroll">
    <h3>การรายงานความสูงเท่ากับ 500 ม. พอดี แยกตามรอบปี</h3>
    ${bunchTable}
    <p>สัดส่วนพุ่งขึ้นตั้งแต่รอบ 2566 ซึ่งเป็นรอบที่เปลี่ยนมาใช้สูตร "ผ่านด่าน 500 ม. แล้วได้คะแนนฐาน 15" —
    รูปแบบของการรายงานให้พอดีเกณฑ์ ทั้งที่ข้อนี้ระบุให้ระบบดึงค่าจาก Google Maps Elevation API อัตโนมัติ</p>
  </div>
  <div class="card scroll">
    <h3>ผลของสูตรสองแบบต่อการจำแนก</h3>
    <table>
      <thead><tr><th>สูตร</th><th class="num">คะแนนเฉลี่ยข้อ 1</th><th class="num">SD</th><th class="num">ได้เต็ม 30</th><th class="num">item–rest r</th><th class="num">คะแนนรวมเฉลี่ย</th><th class="num">ผ่าน 70</th></tr></thead>
      <tbody>
        <tr><td>ฐาน 15 + เพดาน 500 ม. (ใช้อยู่)</td><td class="num">${f(el.scoreUnderBase15.mean)}</td><td class="num">${f(el.scoreUnderBase15.sd)}</td>
          <td class="num">${f(el.scoreUnderBase15.fullPct, 1)}%</td><td class="num warn">${f(el.discrimination.base15)}</td>
          <td class="num">${f(el.passRate.meanTotalBase15)}</td><td class="num">${f(el.passRate.base15, 1)}%</td></tr>
        <tr><td>เชิงเส้น 0–600 ม. (รอบ 2565)</td><td class="num">${f(el.scoreUnderLinear600.mean)}</td><td class="num">${f(el.scoreUnderLinear600.sd)}</td>
          <td class="num">${f(el.scoreUnderLinear600.fullPct, 1)}%</td><td class="num good">${f(el.discrimination.linear600)}</td>
          <td class="num">${f(el.passRate.meanTotalLinear600)}</td><td class="num">${f(el.passRate.linear600, 1)}%</td></tr>
      </tbody>
    </table>
  </div>

  <h2>7. ความซ้ำซ้อนระหว่างข้อ</h2>
  <div class="card scroll">
    <h3>คู่ที่สัมพันธ์กันสูงสุด 10 คู่</h3>
    ${corrTable}
  </div>

  <h2>8. ถ้าปรับน้ำหนัก จะเกิดอะไรขึ้น</h2>
  <div class="card scroll">
    ${simTable}
    <p>ρ คือสหสัมพันธ์อันดับ (Spearman) กับผลจัดอันดับของเกณฑ์ปัจจุบัน — ทุกฉากทัศน์ให้ ρ ≥ 0.90
    แปลว่า <em>ลำดับ</em> ความยากลำบากแทบไม่เปลี่ยน สิ่งที่เปลี่ยนคือระดับคะแนนและจำนวนที่ผ่าน
    ดังนั้นการปรับสูตรต้องย้ายจุดตัดตามไปด้วย (คอลัมน์สุดท้าย) ไม่เช่นนั้นจำนวนโรงเรียนที่ได้สิทธิ์จะลดลงโดยไม่ตั้งใจ</p>
  </div>

  <h2>9. คุณภาพข้อมูลที่โค้ดเกณฑ์ใหม่ต้องรับมือ</h2>
  <div class="card scroll">
    <table>
      <thead><tr><th>รายการตรวจ</th><th class="num">จำนวน</th><th class="num">สัดส่วน</th></tr></thead>
      <tbody>${qualityRows}</tbody>
    </table>
  </div>

  <h2>10. ภาพรายจังหวัด</h2>
  <div class="card scroll">
    ${provinceTable}
    <p>คะแนนข้อ 1 เฉลี่ยของทุกจังหวัดเกาะกลุ่มใกล้ 30 เท่ากันหมด — ความต่างที่แท้จริงระหว่างจังหวัดมาจากกลุ่มสาธารณูปโภคและกลุ่มผู้เรียน</p>
  </div>

  <p class="foot">สร้างจาก <code>scripts/analyze-legacy-items.mjs</code> → <code>scripts/report-legacy-html.mjs</code> ·
  รายงานฉบับข้อความ: <code>docs/ANALYSIS-เกณฑ์เดิมรายข้อ.md</code> ·
  ค่าคงที่สำหรับโค้ดเกณฑ์: <code>lib/legacy-baseline.ts</code></p>
</div>
<div id="tip" role="status"></div>
${TOOLTIP_SCRIPT}
`;

const TITLE = "สถิติผลประเมินเดิมรายข้อ — ฐานกำหนดเกณฑ์โรงเรียนพื้นที่สูง ปี 2569";

// ไฟล์เต็มสำหรับเปิดจากเครื่อง (ต้องมี meta charset ไม่งั้นภาษาไทยเพี้ยนเมื่อเสิร์ฟผ่าน Apache)
const standalone = standalonePage(TITLE, body);
fs.writeFileSync(OUT, standalone, "utf8");
console.error("เขียนหน้านำเสนอ:", path.relative(ROOT, OUT));

// ชิ้นส่วนสำหรับนำไปเผยแพร่เป็นหน้าเว็บ (ไม่มี doctype/head — ตัวเผยแพร่ครอบให้เอง)
const fragOut = process.argv.find((a) => a.startsWith("--fragment="));
if (fragOut) {
  const p = fragOut.slice("--fragment=".length);
  fs.writeFileSync(p, `<title>${TITLE}</title>\n${body}`, "utf8");
  console.error("เขียนชิ้นส่วนเผยแพร่:", p);
}
