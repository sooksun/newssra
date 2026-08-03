// หน้านำเสนอคำอธิบายร่างเกณฑ์ — ขยายความว่าเปลี่ยนอะไร เพราะอะไร ผลเป็นอย่างไร พร้อมตัวอย่างโรงเรียนจริง
//   node scripts/report-explainer-html.mjs [--fragment=<path>]
//
// อ่านจาก: draft-explainer-cases.json (ตัวอย่างจริง) + criteria-simulation.json (สถิติร่าง)
//          + legacy-item-stats.json (พฤติกรรมเกณฑ์เดิม) + ไฟล์ร่างเอง (นิยามข้อ + บัญชี supplementary)

import fs from "node:fs";
import path from "node:path";
import {
  PAGE_STYLE,
  TOOLTIP_SCRIPT,
  esc,
  f,
  hbars,
  histBars,
  n,
  pairedBars,
  standalonePage,
} from "./html-charts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "docs", "analysis", "draft-explainer.html");

const C = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "analysis", "draft-explainer-cases.json"), "utf8"));
const SIM = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "analysis", "criteria-simulation.json"), "utf8"));
const LEG = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "analysis", "legacy-item-stats.json"), "utf8"));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, C.config.file), "utf8"));
const R = SIM.results.find((r) => r.config.id === C.config.id) ?? SIM.results[SIM.results.length - 1];

const TITLE = "อธิบายร่าง ค — เปลี่ยนอะไร เพราะอะไร ผลเป็นอย่างไร";
function legacyItem(no) { return LEG.highland.items.find((i) => i.no === no); }
function draftItem(id) { return R.items.find((i) => i.id === id); }

/* ---------- ส่วนประกอบ ---------- */

const tiles = [
  { v: "16 → 5", l: "จำนวนตัวชี้วัดที่ให้คะแนน", s: "แบบฟอร์มยังถามเท่าเดิม — คำตอบหลายข้อถูกรวมเป็นดัชนีเดียวก่อนคิดคะแนน" },
  {
    v: `${C.legacyHealth.passed}/${C.legacyHealth.total} → ${R.health.passed}/${R.health.total}`,
    l: "ข้อที่ผ่านเกณฑ์ตรวจรับ",
    s: `เกณฑ์เดิมมีข้อที่ตัน/จำแนกไม่ได้ ${C.legacyHealth.failing.length} ข้อ รวมน้ำหนัก ${C.legacyHealth.failingWeight} คะแนน`,
  },
  { v: `${f(LEG.highland.totals.sd, 1)} → ${f(R.totals.sd, 1)}`, l: "SD ของคะแนนรวม", s: "ยิ่งมาก ยิ่งแยกโรงเรียนออกจากกันได้จริง" },
  { v: `0.04 → ${f(Math.min(...R.items.map((i) => i.D)), 2)}`, l: "อำนาจจำแนกต่ำสุดในชุด", s: "ไม่มีข้อไหนเป็นคะแนนแจกฟรีเหลืออยู่" },
];

const mapRows = [
  { old: "ข้อ 1 ความสูง", w: 30, to: "G1 — สูตรใหม่ ไม่มีคะแนนฐาน", nw: 24 },
  { old: "ข้อ 7 น้ำ · 8 ไฟฟ้า · 9 โทรศัพท์ · 10 อินเทอร์เน็ต", w: 15, to: "U1 — ดัชนีความรุนแรงของการขาดแคลนโครงสร้างพื้นฐาน", nw: 22 },
  { old: "ข้อ 4 ถนน · 5 ระยะทาง · 6 ขนส่งสาธารณะ", w: 15, to: "A1 — ดัชนีความรุนแรงของอุปสรรคการเดินทาง", nw: 20 },
  { old: "ข้อ 11 ร้อยละนักเรียนชาติพันธุ์", w: 5, to: "L1 — คงเดิม เพิ่มน้ำหนัก", nw: 20 },
  { old: "ข้อ 13 นักเรียนยากจน", w: 5, to: "L3 — เปลี่ยนเพดานจาก 50% เป็น 100%", nw: 14 },
  { old: "ข้อ 2 ชายแดน · 3 เขต อปท. · 12 กลุ่มชาติพันธุ์ · 14 พักนอน · 15 สาขา · 16 ประกาศคลัง", w: 30, to: "ย้ายไปบัญชีรายการประกอบ — ต้องมีมติว่าจะใช้ในบทบาทใด", nw: 0 },
];

const mapTable = `
<table>
  <thead><tr><th>ข้อในเกณฑ์เดิม</th><th class="num">น้ำหนักเดิม</th><th>กลายเป็นอะไรในร่าง ค</th><th class="num">น้ำหนักใหม่</th></tr></thead>
  <tbody>${mapRows
    .map(
      (r) =>
        `<tr><td>${esc(r.old)}</td><td class="num">${r.w}</td><td>${esc(r.to)}</td><td class="num ${
          r.nw === 0 ? "muted" : ""
        }">${r.nw === 0 ? "—" : r.nw}</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

const ladderRows = C.elevationLadder.map((e) => ({
  label: `${n(e.metres)} ม.`,
  a: e.oldScore ?? 0,
  b: e.newScore,
  dp: 2,
  note: e.oldScore === null ? "ไม่ผ่านด่านของเกณฑ์เดิม" : "",
}));

const ladderTable = `
<table>
  <thead><tr><th class="num">ความสูงจริง</th><th class="num">คะแนนเดิม (เต็ม 30)</th><th class="num">คะแนนใหม่ (เต็ม 24)</th></tr></thead>
  <tbody>${C.elevationLadder
    .map(
      (e) =>
        `<tr><td class="num">${n(e.metres)} ม.</td><td class="num ${e.oldScore === 30 ? "warn" : ""}">${
          e.oldScore === null ? "ไม่ผ่านด่าน = 0" : f(e.oldScore)
        }</td><td class="num">${f(e.newScore)}</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

/** การ์ดตัวอย่างโรงเรียนจริง — แสดงการคิดคะแนนทีละข้อ */
function caseCard(c, heading, lead) {
  const oi = c.oldItems;
  return `
  <div class="card">
    <h3>${esc(heading)}</h3>
    <p class="muted">รหัส ${esc(c.sc_id)} · ${esc(c.province)} · รอบประเมิน ${c.year} · นักเรียน ${n(c.students)} คน</p>
    <p>${lead}</p>
    <div class="scroll">
    <table>
      <thead><tr><th>ตัวชี้วัด</th><th>ค่าที่กรอก</th><th class="num">เกณฑ์เดิม</th><th class="num">ร่าง ค</th></tr></thead>
      <tbody>
        <tr><td>ความสูง</td><td>${n(oi.elev.value)} ม.</td>
          <td class="num">${f(oi.elev.score)} / 30</td>
          <td class="num">${f(c.newItems.find((v) => v.id === "G1")?.score ?? 0)} / 24</td></tr>
        <tr><td>สาธารณูปโภค (น้ำ/ไฟ/โทร/เน็ต)</td>
          <td class="muted">น้ำ [${esc(oi.water.value)}] · ไฟ [${esc(oi.power.value)}] · โทร [${esc(oi.phone.value)}] · เน็ต [${esc(oi.net.value)}]</td>
          <td class="num">${f(oi.water.score + oi.power.score + oi.phone.score + oi.net.score)} / 15</td>
          <td class="num">${f(c.newItems.find((v) => v.id === "U1")?.score ?? 0)} / 22 <span class="muted">(ดัชนี ${
            c.newItems.find((v) => v.id === "U1")?.value ?? 0
          })</span></td></tr>
        <tr><td>การเดินทาง (ถนน/ระยะทาง/ขนส่ง)</td><td class="muted">รวม 3 ข้อ</td>
          <td class="num muted">แยกกัน 3 ข้อ</td>
          <td class="num">${f(c.newItems.find((v) => v.id === "A1")?.score ?? 0)} / 20 <span class="muted">(ดัชนี ${
            c.newItems.find((v) => v.id === "A1")?.value ?? 0
          })</span></td></tr>
        <tr><td>นักเรียนกลุ่มชาติพันธุ์</td><td>${f(c.newItems.find((v) => v.id === "L1")?.value ?? 0)}%</td>
          <td class="num muted">เต็ม 5</td>
          <td class="num">${f(c.newItems.find((v) => v.id === "L1")?.score ?? 0)} / 20</td></tr>
        <tr><td>นักเรียนยากจน</td><td>${n(oi.poor.count)} คน (${f(oi.poor.pct)}%)</td>
          <td class="num">${f(oi.poor.score)} / 5</td>
          <td class="num">${f(c.newItems.find((v) => v.id === "L3")?.score ?? 0)} / 14</td></tr>
        <tr><td>ประกาศกระทรวงการคลัง</td><td>${oi.treasury.value === 1 ? "ใช่" : "ไม่ใช่"}</td>
          <td class="num">${f(oi.treasury.score)} / 5</td>
          <td class="num muted">ไม่คิดคะแนน</td></tr>
        <tr><td><b>คะแนนรวม</b></td><td></td>
          <td class="num"><b>${f(c.oldTotal)}</b> ${c.oldPass ? '<span class="good">ผ่าน</span>' : '<span class="warn">ไม่ผ่าน</span>'}</td>
          <td class="num"><b>${f(c.newTotal)}</b> ${c.newPass ? '<span class="good">ผ่าน</span>' : '<span class="warn">ไม่ผ่าน</span>'}</td></tr>
      </tbody>
    </table>
    </div>
    <p class="muted">จุดตัดที่ใช้เทียบ: เกณฑ์เดิม ${C.cuts.old} · ร่าง ค ใช้จุดตัดเทียบเท่า ${f(C.cuts.newEquivalent)}</p>
  </div>`;
}

const sizeTable = `
<table>
  <thead><tr><th>ขนาดโรงเรียน</th><th class="num">จำนวน</th><th class="num">คะแนนเฉลี่ยเดิม</th><th class="num">คะแนนเฉลี่ยร่าง ค</th></tr></thead>
  <tbody>${C.sizeBias.bands
    .map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${n(b.n)}</td><td class="num">${f(b.meanOld)}</td><td class="num">${f(b.meanNew)}</td></tr>`)
    .join("")}</tbody>
</table>`;

const supplementaryTable = CFG.supplementary
  ? `<table>
  <thead><tr><th>รายการที่ย้ายออก</th><th>เหตุผล</th><th>บทบาทที่เสนอ</th></tr></thead>
  <tbody>${CFG.supplementary.items
    .map((s) => `<tr><td>${esc(s.from)}</td><td class="muted">${esc(s.reason)}</td><td>${esc(s.proposedRole)}</td></tr>`)
    .join("")}</tbody>
</table>`
  : "";

const notFixed = [
  ["ข้อเสนอ 1 — แยกคุณสมบัติออกจากคะแนน", "ร่าง ค เลือกไม่ตั้งด่านคัดกรอง (ร่าง ก ตัดโรงเรียนต่ำกว่า 500 ม. ออก 184 แห่ง) — ยังเป็นการตัดสินใจเชิงนโยบายที่ค้างอยู่"],
  ["ข้อเสนอ 3 — สูตรมีเวอร์ชัน", "ทำแล้วบางส่วน (สูตรอยู่ในไฟล์ JSON ที่มีเลขเวอร์ชัน) แต่ยังต้องเพิ่มคอลัมน์ scoring_version ในฐานข้อมูล"],
  ["ข้อเสนอ 4 — ล็อกค่าที่ GIS วัดเอง", "ต้องแก้ที่แบบฟอร์มและฐานข้อมูล ไม่ใช่ที่สูตร"],
  ["ข้อเสนอ 11 — สอบเทียบกับกลุ่มผู้ยื่นใหม่", "ยังไม่ได้ทำ — กลุ่มผู้ยื่นรอบ 2569 มี 84.9% ที่อยู่ต่ำกว่า 500 ม."],
  ["ดัชนีการเดินทางยังกระจุกที่ค่า 2 (41%)", "ปรับได้อีกโดยเพิ่มสัญญาณย่อยหรือขยับจุดตัดระยะทาง"],
  ["หน่วยการประเมิน", "ยังเป็นระดับรหัสโรงเรียน ไม่ใช่จุดจัดการศึกษา ตามที่เอกสาร GAPS ข้อ A3 เสนอ"],
];

const body = `${PAGE_STYLE}
<div class="viz-root">
  <h1>${esc(TITLE)}</h1>
  <p class="lead">ขยายความจากบรรทัดสรุปในไฟล์ร่าง — แต่ละการเปลี่ยนแปลงอธิบาย 4 ชั้น
  คือ <b>สูตรเดิมเขียนว่าอย่างไร → หลักฐานว่ามันพังตรงไหน → สูตรใหม่เขียนว่าอย่างไร → ผลที่วัดได้</b></p>
  <p class="src">แหล่งข้อมูล: ${esc(C.source)} · ประชากร ${n(C.population)} โรงเรียนพื้นที่สูงที่ยืนยันสถานะปี 2569 ·
  สร้างเมื่อ ${new Date(C.generatedAt).toLocaleString("th-TH")}<br>
  ${esc(CFG.status ?? "")} — ตัวอย่างโรงเรียนทุกกรณีดึงจากข้อมูลจริง ไม่ได้เขียนขึ้นเอง</p>

  <div class="tiles">
    ${tiles.map((t) => `<div class="tile"><div class="v">${t.v}</div><div class="l">${t.l}</div><div class="s">${t.s}</div></div>`).join("")}
  </div>

  <h2>0. ภาพรวม — จาก 16 ข้อ เหลือ 5 ตัวชี้วัด</h2>
  <div class="card scroll">
    ${mapTable}
    <p>สิ่งที่หายไปไม่ใช่ <em>คำถาม</em> แต่เป็น <em>ช่องให้คะแนนแยกกัน</em> — คำตอบหลายข้อถูกรวมเป็นดัชนีเดียวก่อนคิดคะแนน</p>
  </div>

  <h2>1. ความสูง — ตัดคะแนนฐาน ไล่ระดับถึงเปอร์เซ็นไทล์ที่ 90 ของจริง</h2>
  <div class="card">
    <h3>ปัญหาเดิมซ้อนกันสองชั้น</h3>
    <p><b>ชั้นที่หนึ่ง</b> — ให้คะแนนฐาน 15 จาก 30 ทันทีที่ผ่านด่าน โดยไม่ต้องสูงกว่าใคร<br>
    <b>ชั้นที่สอง</b> — เพดานอยู่ที่ 500 ม. แต่โรงเรียนที่ผ่านด่านย่อมสูง ≥ 500 ม. อยู่แล้ว จึงชนเพดานทันที</p>
    <p>ผลคือโรงเรียน <b>${f(legacyItem(1).score.fullPct, 1)}%</b> ได้ 30 เต็ม ไม่ว่าจะอยู่ที่ 500 ม. หรือ 1,819 ม. ·
    อำนาจจำแนก D = ${f(legacyItem(1).discrimination.D, 2)} · สหสัมพันธ์กับข้ออื่น r = ${f(legacyItem(1).discrimination.itemRestCorr, 2)}</p>
    <h3>เทียบคะแนนที่ระดับความสูงต่าง ๆ</h3>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> เกณฑ์เดิม (เต็ม 30)</span>
      <span><i class="swatch" style="background:var(--series-2)"></i> ร่าง ค (เต็ม 24)</span>
    </div>
    ${pairedBars(ladderRows, { max: 30, unit: " คะแนน", labelW: 110 })}
    <div class="scroll">${ladderTable}</div>
    <p>แถวที่ 500 ม. คือหัวใจของปัญหา — เกณฑ์เดิมมองว่าโรงเรียนที่ 500 ม. กับ 1,819 ม. ลำบากเท่ากันทุกประการ</p>
    <p><b>ผลที่ได้:</b> ข้อนี้เปลี่ยนจาก D = ${f(legacyItem(1).discrimination.D, 2)} เป็น <b>D = ${f(draftItem("G1").D, 2)}</b>
    และ item–rest r จาก ${f(legacyItem(1).discrimination.itemRestCorr, 2)} เป็น ${f(draftItem("G1").itemRestCorr, 2)}</p>
    <p class="muted"><b>ผลข้างเคียงที่ต้องรู้:</b> โรงเรียน ${n(C.exactly500.count)} แห่งที่รายงานความสูง 500 ม. พอดี
    มีคะแนนรวมเฉลี่ยลดจาก ${f(C.exactly500.meanOld)} เหลือ ${f(C.exactly500.meanNew)} —
    กลุ่มนี้คือกลุ่มที่การกระจุกตัวผิดปกติชี้ว่าตัวเลขอาจถูกกรอกให้พอดีเกณฑ์
    <b>ต้องวัดความสูงจริงใหม่ก่อนบังคับใช้เกณฑ์ใด ๆ กับกลุ่มนี้</b></p>
  </div>

  <h2>2. ประกาศกระทรวงการคลัง — ตัดออกจากคะแนน ทั้งที่จำแนกได้ดีที่สุด</h2>
  <div class="card">
    <p>ข้อ 16 มีสถิติดีที่สุดในเกณฑ์เดิมทุกด้าน — D = ${f(legacyItem(16).discrimination.D, 2)} สูงสุด และกินส่วนแบ่งความแปรปรวนของคะแนนรวมมากที่สุด
    ถ้าดูตัวเลขอย่างเดียวควรเพิ่มน้ำหนักด้วยซ้ำ</p>
    <p>ปัญหาอยู่ที่ <b>ที่มา</b> ของอำนาจจำแนกนั้น — คำถามคือ "เป็นโรงเรียนพื้นที่พิเศษตามประกาศกระทรวงการคลังหรือไม่"
    ซึ่งเป็น <em>ผลของการตัดสินใจครั้งก่อน</em> ไม่ใช่การวัดสภาพความลำบากในปัจจุบัน</p>
    <div class="card" style="background:var(--surface-0)">
      <p style="margin:0"><code>เคยได้รับการประกาศ → ได้ 5 คะแนน → คะแนนรวมสูง → ผ่านการคัดกรอง → ได้รับการประกาศต่อ → ได้ 5 คะแนนอีก …</code></p>
    </div>
    <p>เกณฑ์ที่ให้น้ำหนักกับข้อนี้มาก จึงไม่ได้ตรวจว่าโรงเรียนลำบากจริงหรือไม่ แต่กำลัง
    <b>รับรองการตัดสินใจของตัวเองในอดีต</b> ทำให้ความผิดพลาดในรอบก่อนถูกส่งต่อไปโดยไม่มีใครตรวจพบ</p>
    <h3>เอาไปใช้ทำอะไรแทน</h3>
    <p>ใช้เป็น <b>ตัวสอบทานผล</b> — หลังคำนวณด้วยเกณฑ์ใหม่แล้วนำไปเทียบกับรายชื่อตามประกาศคลัง</p>
    <ul class="findings">
      <li>คะแนนใหม่สูง <b>แต่ไม่อยู่ในประกาศ</b> → ตรวจว่าตกหล่นจากประกาศเดิมหรือไม่</li>
      <li><b>อยู่ในประกาศ</b> แต่คะแนนใหม่ต่ำ → ตรวจว่าสภาพเปลี่ยนไปแล้ว หรือเกณฑ์ใหม่มองข้ามปัจจัยบางอย่าง</li>
    </ul>
  </div>

  <h2>3. สาธารณูปโภค — ยุบ 4 ข้อเป็นดัชนีความรุนแรงเดียว</h2>
  <div class="card">
    <p>ข้อ 8 ไฟฟ้า · 9 โทรศัพท์ · 10 อินเทอร์เน็ต สหสัมพันธ์กันเอง <b>0.58–0.68</b> — ทั้งสามข้อวัดสิ่งเดียวกัน
    คือระดับการเข้าถึงโครงสร้างพื้นฐานของหมู่บ้าน การให้คะแนนแยกกันจึงนับความลำบากเดียวซ้ำ 3 ครั้ง</p>
    <h3>ทางที่ลองแล้วไม่ได้ผล</h3>
    <p>ตอนแรกออกแบบเป็น <b>การนับจำนวนด้านที่ขาดแคลน</b> (0–4 ด้าน) แต่พอคำนวณกับข้อมูลจริงพบว่ากระจุกที่ค่า 1 ถึง <b>73%</b>
    เพราะ 91.5% ของโรงเรียนใช้น้ำที่ไม่ใช่ประปาเหมือนกันหมด ดัชนีเลยกลายเป็นค่าคงที่ — แก้ปัญหาเดิมไม่ได้เลย</p>
    <h3>สูตรที่ใช้จริง — ถ่วงน้ำหนักตามระดับความขาดแคลน</h3>
    <div class="scroll">
    <table>
      <thead><tr><th>ด้าน</th><th>ระดับความขาดแคลน → คะแนนดัชนี</th></tr></thead>
      <tbody>
        <tr><td>น้ำ</td><td>ธรรมชาติล้วน = 2 · บ่อ/สระ/บาดาล = 1 · ประปา = 0</td></tr>
        <tr><td>ไฟฟ้า</td><td>ต้องพึ่งพลังงานทางเลือก = 2 · ไฟฟ้าส่วนภูมิภาค = 0</td></tr>
        <tr><td>โทรศัพท์</td><td>ไม่มีสัญญาณ = 3 · ดาวเทียมเท่านั้น = 2 · มือถือ = 1 · พื้นฐาน = 0</td></tr>
        <tr><td>อินเทอร์เน็ต</td><td>ไม่มีเครือข่าย = 3 · ดาวเทียมเท่านั้น = 2 · ไร้สาย = 1 · Fiber = 0</td></tr>
      </tbody>
    </table>
    </div>
    <p class="muted">หลักคิด: การไม่มีสัญญาณโทรศัพท์เลย (กระทบความปลอดภัยและการติดต่อฉุกเฉิน) รุนแรงกว่าการใช้น้ำจากลำธาร จึงให้ 3 กับ 2 ตามลำดับ</p>
    <h3>การกระจายของดัชนีที่ได้ (0–10)</h3>
    ${histBars(draftItem("U1").valueDistribution.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n })))}
    <p>ไม่มีช่วงไหนเกิน 32% — ดัชนีนี้แยกโรงเรียนออกจากกันได้จริง ให้ D = ${f(draftItem("U1").D, 2)} และ item–rest r = ${f(draftItem("U1").itemRestCorr, 2)}</p>
  </div>

  <h2>4. กติกาตัวเลือก — เลิกลงโทษโรงเรียนที่กรอกครบ</h2>
  <div class="card">
    <p>ข้อ 7–10 เลือกได้หลายตัวเลือก แต่สูตรเดิมคิดคะแนนจาก <b>id ที่มีค่าสูงสุด</b> ปัญหาคือตัวเลือกเรียงจาก
    "ลำบากที่สุด" (id 1) ไป "สะดวกที่สุด" การหยิบ id สูงสุดจึงเท่ากับหยิบตัวเลือกที่ให้คะแนนต่ำที่สุด</p>
    <p>ผลคือ <b>ยิ่งกรอกครบตามความจริง ยิ่งเสียคะแนน</b> — พบ 1,024 ครั้งในสี่ข้อรวมกัน
    (แหล่งน้ำ 320 · ไฟฟ้า 93 · โทรศัพท์ 201 · อินเทอร์เน็ต 410)</p>
    ${
      C.solarCase
        ? caseCard(
            C.solarCase,
            "กรณีตัวอย่าง — โรงเรียนที่มีทั้งโซลาร์เซลล์และไฟฟ้าส่วนภูมิภาค",
            `กรอกว่ามีทั้งพลังงานทางเลือก (id 1) และไฟฟ้าส่วนภูมิภาค (id 2) สูตรเดิมหยิบ id 2 มาคิด จึงได้ <b>0 คะแนน</b>
             จากข้อไฟฟ้า เท่ากับโรงเรียนที่มีไฟฟ้าส่วนภูมิภาคอย่างเดียว — ข้อมูลที่กรอกเพิ่มมาไม่ได้ช่วยอะไรเลย
             ในร่าง ค ค่าดัชนีความขาดแคลนได้ ${C.solarCase.newItems.find((v) => v.id === "U1")?.value ?? 0} จาก 10`,
          )
        : ""
    }
    <div class="card">
      <h3>บังคับด้วยการทดสอบอัตโนมัติ</h3>
      <p>คุณสมบัติ <b>"เพิ่มข้อมูลที่เป็นจริง คะแนนต้องไม่ลดลง"</b> ไม่ได้อยู่แค่ในเอกสาร แต่เขียนเป็นเทสต์ใน
      <code>tests/criteria-model.test.ts</code> — เพิ่มสัญญาณความขาดแคลนทีละอย่างแล้วยืนยันว่าค่าดัชนีไม่ลดลงเลย
      ถ้าใครเขียนสูตรใหม่ที่ละเมิดคุณสมบัตินี้ <code>npm test</code> จะฟ้องทันที</p>
    </div>
  </div>

  <h2>5. การเดินทาง — ทำไมปรับน้ำหนักถึงแก้ไม่ได้</h2>
  <div class="card">
    <div class="scroll">
    <table>
      <thead><tr><th>ข้อเดิม</th><th>อาการ</th><th>สาเหตุ</th></tr></thead>
      <tbody>
        <tr><td>4 ถนนรถสองล้อไปไม่ได้</td><td class="warn">${f(legacyItem(4).score.zeroPct, 1)}% ได้ 0 คะแนน (พื้นตัน)</td><td class="muted">โรงเรียนส่วนใหญ่ไม่มีเส้นทางแบบนั้น</td></tr>
        <tr><td>6 ขนส่งสาธารณะ</td><td class="warn">${f(legacyItem(6).score.fullPct, 1)}% ได้เต็ม (เพดานตัน)</td><td class="muted">ส่วนใหญ่ตอบว่า "ไม่มีรถประจำทาง" เหมือนกันหมด</td></tr>
        <tr><td>5 ระยะทางถึงศาลากลาง</td><td class="warn">${f(legacyItem(5).score.fullPct, 1)}% ชนเพดาน 80 กม.</td><td class="muted">เพดานต่ำกว่ามัธยฐานจริง (106 กม.)</td></tr>
      </tbody>
    </table>
    </div>
    <p>ไม่ว่าจะให้น้ำหนักเท่าไร ข้อที่คนตอบเหมือนกัน 80–90% ก็ยังแยกใครไม่ได้
    <b>เพราะปัญหาอยู่ที่ตัวแปร ไม่ใช่ที่น้ำหนัก</b> การเพิ่มน้ำหนักให้ข้อที่ทุกคนได้เท่ากันมีผลเดียวคือบวกค่าคงที่ให้ทุกคน</p>
    <h3>สูตรที่ใช้จริง</h3>
    <div class="scroll">
    <table>
      <thead><tr><th>สัญญาณ</th><th>ระดับ → คะแนนดัชนี</th></tr></thead>
      <tbody>
        <tr><td>ถนนที่รถสองล้อไปไม่ได้</td><td>&gt; 5 กม. = 3 · 2–5 กม. = 2 · &gt; 0 = 1 · ไม่มี = 0</td></tr>
        <tr><td>ขนส่งสาธารณะ</td><td>ไม่มีรถประจำทาง = 2 · ≤ 2 เที่ยว/วัน = 1 · มากกว่านั้น = 0</td></tr>
        <tr><td>ระยะทางถึงศาลากลาง</td><td>≥ 184 กม. (P90) = 3 · ≥ 146 (P75) = 2 · ≥ 106 (P50) = 1</td></tr>
      </tbody>
    </table>
    </div>
    <p class="muted">จุดตัดของระยะทางใช้เปอร์เซ็นไทล์จริงของประชากร แทนตัวเลขกลม เพื่อให้แต่ละระดับมีคนอยู่จริง</p>
    <h3>การกระจายของดัชนีที่ได้ (0–8)</h3>
    ${histBars(draftItem("A1").valueDistribution.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n })))}
    <p>จากสามข้อที่แยกกันแล้วใช้ไม่ได้เลย กลายเป็นดัชนีเดียวที่ให้ D = ${f(draftItem("A1").D, 2)} และ item–rest r = ${f(draftItem("A1").itemRestCorr, 2)}
    <span class="muted">— ค่า 2 ยังหนาแน่นที่ 41% ปรับได้อีกโดยเพิ่มสัญญาณย่อยหรือขยับจุดตัดระยะทาง</span></p>
  </div>

  <h2>6. ตัวชี้วัดผู้เรียน — ใช้ร้อยละทุกข้อ และขยับเพดานตามการกระจายจริง</h2>
  <div class="card scroll">
    <table>
      <thead><tr><th>ข้อ</th><th>เก็บเป็น</th><th>เกณฑ์เดิมคิดคะแนนเป็น</th><th>ร่าง ค</th></tr></thead>
      <tbody>
        <tr><td>13 นักเรียนยากจน</td><td>จำนวนคน</td><td><b>ร้อยละ</b> เพดาน 50%</td><td>ร้อยละ เพดาน 100%</td></tr>
        <tr><td>14 นักเรียนพักนอน</td><td>จำนวนคน</td><td class="warn"><b>จำนวนคน</b> เพดาน 50 คน</td><td class="muted">ย้ายออกจากคะแนนหลัก</td></tr>
      </tbody>
    </table>
    <p>สองข้อนี้อยู่กลุ่มเดียวกันแต่ใช้ฐานคนละแบบ — โรงเรียน 60 คนที่นักเรียนพักนอนทั้งโรงเรียน
    ได้คะแนนเท่ากับโรงเรียน 800 คนที่มีพักนอน 50 คน</p>
    <p><b>เหตุผลที่ขยับเพดานนักเรียนยากจน:</b> มัธยฐานจริงคือ 60% และ ${f(legacyItem(13).score.fullPct, 1)}% ของโรงเรียนชนเพดาน 50% เดิม
    พอขยับเป็น 100% สัดส่วนที่ได้เต็มลดเหลือ ${f(draftItem("L3").fullPct, 1)}% และ D เพิ่มจาก ${f(
      legacyItem(13).discrimination.D,
      2,
    )} เป็น ${f(draftItem("L3").D, 2)}</p>
  </div>

  <h2>7. ตัวอย่างจริง — คำนวณทีละข้อ</h2>
  ${caseCard(
    C.gainers[0],
    "โรงเรียนที่คะแนนเพิ่มมากที่สุด",
    `เดิม "ตกเกณฑ์" ทั้งที่อยู่สูง ${n(C.gainers[0].oldItems.elev.value)} ม. นักเรียนเป็นกลุ่มชาติพันธุ์ทั้งหมด ยากจนทั้งหมด และมีทั้งโซลาร์เซลล์ —
     เพราะเกณฑ์เดิมให้ 0 คะแนนกับข้อไฟฟ้าและอินเทอร์เน็ต (กติกา id สูงสุด) และไม่ให้เครดิตกับความสูงที่เกิน 500 ม.`,
  )}
  ${caseCard(
    C.losers[0],
    "โรงเรียนที่คะแนนลดมากที่สุด",
    `ไม่ผ่านเกณฑ์ทั้งเดิมและใหม่ แต่ตัวเลขต่างกัน ${f(Math.abs(C.losers[0].delta))} คะแนน — จุดสำคัญคือเกณฑ์เดิมให้
     ${f(C.losers[0].oldItems.elev.score)} คะแนนกับความสูง ${n(C.losers[0].oldItems.elev.value)} ม. ผ่านช่องทาง "สูงกว่าค่าเฉลี่ยของเส้นทาง"
     ทั้งที่ ${n(C.losers[0].oldItems.elev.value)} ม. ไม่ใช่พื้นที่สูงตามความเข้าใจทั่วไป`,
  )}
  ${caseCard(
    C.highestSchool,
    "โรงเรียนที่อยู่สูงที่สุดในฐานข้อมูล",
    `อยู่สูงที่สุดตามฐานข้อมูลนี้ แต่ได้คะแนนความสูงเท่ากับโรงเรียนที่ 500 ม. ในเกณฑ์เดิม (30 เต็มทั้งคู่)
     ในร่าง ค ได้ 24 เต็ม ขณะที่โรงเรียนที่ 500 ม. ได้ 4.57 — ความต่าง 19.43 คะแนนนี้คือสิ่งที่เกณฑ์เดิมมองไม่เห็น`,
  )}

  <h2>8. ตรวจผลข้างเคียง — ลำเอียงตามขนาดโรงเรียนหรือไม่</h2>
  <div class="card scroll">
    <p>เนื่องจากตัวชี้วัดสองข้อใช้ร้อยละของนักเรียน จึงต้องตรวจว่าโรงเรียนเล็กได้เปรียบผิดปกติหรือไม่</p>
    ${sizeTable}
    <p>สหสัมพันธ์ระหว่างคะแนนกับจำนวนนักเรียน: เกณฑ์เดิม ${f(C.sizeBias.corrOld, 2)} · ร่าง ค ${f(C.sizeBias.corrNew, 2)}
    — ทั้งสองค่าใกล้ศูนย์ แปลว่า <b>ไม่มีความลำเอียงเชิงระบบตามขนาด</b></p>
    <p class="muted">ตัวอย่างในหัวข้อ 7 ที่เป็นโรงเรียน ${n(C.gainers[0].students)} คนได้ ${f(C.gainers[0].newTotal)} คะแนน
    จึงเป็นกรณีเฉพาะราย ไม่ใช่อาการของความลำเอียง — แต่คณะกรรมการควรพิจารณาว่าโรงเรียนขนาดเท่านี้ควรอยู่ในกลุ่มคะแนนสูงสุดหรือไม่
    ซึ่งเป็นคำถามเชิงนโยบาย</p>
  </div>

  ${
    CFG.supplementary
      ? `<h2>9. รายการที่ย้ายออกจากคะแนนหลัก</h2>
  <div class="card scroll">
    <p>${esc(CFG.supplementary.note)}</p>
    ${supplementaryTable}
  </div>`
      : ""
  }

  <h2>10. สิ่งที่ร่าง ค ยังไม่ได้แก้</h2>
  <div class="card scroll">
    <table>
      <thead><tr><th>ประเด็น</th><th>สถานะ</th></tr></thead>
      <tbody>${notFixed.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="muted">${esc(b)}</td></tr>`).join("")}</tbody>
    </table>
  </div>

  <p class="foot">สร้างจาก <code>scripts/explain-draft.mjs</code> → <code>scripts/report-explainer-html.mjs</code> ·
  ฉบับข้อความ: <code>docs/EXPLAINER-ร่างค.md</code> ·
  ไฟล์ร่าง: <code>${esc(C.config.file)}</code> ·
  ข้อเสนอที่อ้างอิง: <code>docs/RECOMMENDATIONS-เกณฑ์2569.md</code></p>
</div>
<div id="tip" role="status"></div>
${TOOLTIP_SCRIPT}
`;

fs.writeFileSync(OUT, standalonePage(TITLE, body), "utf8");
console.error("เขียนหน้านำเสนอ:", path.relative(ROOT, OUT));

const fragArg = process.argv.find((a) => a.startsWith("--fragment="));
if (fragArg) {
  const p = fragArg.slice("--fragment=".length);
  fs.writeFileSync(p, `<title>${TITLE}</title>\n${body}`, "utf8");
  console.error("เขียนชิ้นส่วนเผยแพร่:", p);
}
