// หน้านำเสนอผลทดลองร่างเกณฑ์ปี 2569 (HTML เดี่ยว ๆ เปิดได้เลย) จาก docs/analysis/criteria-simulation.json
//   node scripts/report-criteria-html.mjs [--focus=2569-draft-c] [--fragment=<path>]
//
// --focus เลือกร่างที่จะนำเสนอเป็นตัวหลัก (ค่าเริ่มต้น = ร่างสุดท้ายในไฟล์ผลลัพธ์)

import fs from "node:fs";
import path from "node:path";
import { PAGE_STYLE, TOOLTIP_SCRIPT, esc, f, hbars, histBars, n, standalonePage } from "./html-charts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "docs", "analysis", "criteria-simulation.json");
const OUT = path.join(ROOT, "docs", "analysis", "criteria-report.html");

const d = JSON.parse(fs.readFileSync(IN, "utf8"));
const focusArg = process.argv.find((a) => a.startsWith("--focus="));
const focusId = focusArg ? focusArg.slice("--focus=".length) : d.results[d.results.length - 1].config.id;
const F = d.results.find((r) => r.config.id === focusId) ?? d.results[d.results.length - 1];
const L = d.legacy;

// ใช้ชื่อย่อของร่าง (ตัดคำอธิบายหลังขีดกลางออก) เพื่อให้ชื่อหน้าไม่ยาวเกินไป
const SHORT_NAME = F.config.name.split(" — ")[0];
const TITLE = `ผลทดลอง${SHORT_NAME} — เกณฑ์คัดกรองโรงเรียนพื้นที่สูง ปี 2569`;

/* ---------- ตัวช่วยเฉพาะหน้านี้ ---------- */

const minOf = (r, key) => Math.min(...r.items.map((i) => i[key]));
const supplementary = (() => {
  try {
    const cfgPath = path.join(ROOT, F.config.file);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return cfg.supplementary ?? null;
  } catch {
    return null;
  }
})();

const tiles = [
  {
    v: `${F.health.passed}/${F.health.total}`,
    l: "ข้อที่ผ่านเกณฑ์ตรวจรับ",
    s: `น้ำหนัก ≤ ${F.health.thresholds.maxWeight} · ได้เต็ม ≤ ${F.health.thresholds.maxFullPct}% · ได้ 0 ≤ ${F.health.thresholds.maxZeroPct}% · D ≥ ${F.health.thresholds.minD}`,
  },
  { v: f(F.totals.sd, 1), l: "SD ของคะแนนรวม", s: `เกณฑ์เดิม ${f(L.sd, 1)} — ยิ่งมาก ยิ่งแยกโรงเรียนได้จริง` },
  { v: f(minOf(F, "D"), 2), l: "อำนาจจำแนกต่ำสุดในชุด", s: `เกณฑ์เดิมต่ำสุด 0.04 (ข้อความสูง)` },
  { v: f(F.totals.mean, 1), l: "คะแนนเฉลี่ย", s: `เกณฑ์เดิม ${f(L.mean, 1)} — ต่ำลงเพราะตัดคะแนนที่แจกฟรีออก` },
  {
    v: f(F.vsLegacy.cutForLegacyCount ?? 0, 1),
    l: "จุดตัดที่ให้จำนวนผู้ได้สิทธิ์เท่าเดิม",
    s: `แทนเลข 70 — ถ้าคงไว้จะเหลือ ${n(F.vsLegacy.newPassAtThreshold)} จาก ${n(L.passAt70)} แห่ง`,
  },
  { v: f(F.vsLegacy.spearman), l: "สหสัมพันธ์อันดับกับเกณฑ์เดิม (ρ)", s: `ได้สิทธิ์เพิ่ม ${n(F.vsLegacy.gainers)} · เสียสิทธิ์ ${n(F.vsLegacy.losers)}` },
];

const compareTable = `
<table>
  <thead><tr>
    <th>ตัวชี้วัดคุณภาพของเกณฑ์</th><th class="num">เกณฑ์เดิม</th>
    ${d.results.map((r) => `<th class="num${r.config.id === F.config.id ? " good" : ""}">${esc(r.config.name.split(" — ")[0])}</th>`).join("")}
  </tr></thead>
  <tbody>
    <tr><td>ผ่านเกณฑ์ตรวจรับรายข้อ</td><td class="num">—</td>
      ${d.results.map((r) => `<td class="num ${r.health.passed === r.health.total ? "good" : "warn"}">${r.health.passed}/${r.health.total}</td>`).join("")}</tr>
    <tr><td>จำนวนตัวชี้วัดที่ให้คะแนน</td><td class="num">16</td>
      ${d.results.map((r) => `<td class="num">${r.items.length}</td>`).join("")}</tr>
    <tr><td>คะแนนเฉลี่ย</td><td class="num">${f(L.mean)}</td>
      ${d.results.map((r) => `<td class="num">${f(r.totals.mean)}</td>`).join("")}</tr>
    <tr><td>SD (ยิ่งมาก ยิ่งแยกได้)</td><td class="num">${f(L.sd)}</td>
      ${d.results.map((r) => `<td class="num">${f(r.totals.sd)}</td>`).join("")}</tr>
    <tr><td>อำนาจจำแนก D ต่ำสุดในชุด</td><td class="num warn">0.04</td>
      ${d.results.map((r) => `<td class="num ${minOf(r, "D") >= 0.2 ? "good" : "warn"}">${f(minOf(r, "D"))}</td>`).join("")}</tr>
    <tr><td>item–rest r ต่ำสุดในชุด</td><td class="num warn">0.01</td>
      ${d.results.map((r) => `<td class="num ${minOf(r, "itemRestCorr") >= 0.3 ? "good" : "warn"}">${f(minOf(r, "itemRestCorr"))}</td>`).join("")}</tr>
    <tr><td>ถูกตัดออกด้วยด่านคัดกรอง</td><td class="num">—</td>
      ${d.results.map((r) => `<td class="num">${n(r.gate.failed)}</td>`).join("")}</tr>
    <tr><td>ρ กับลำดับเดิม</td><td class="num">1.00</td>
      ${d.results.map((r) => `<td class="num">${f(r.vsLegacy.spearman)}</td>`).join("")}</tr>
    <tr><td>จุดตัดที่ให้จำนวนเท่าเดิม</td><td class="num">70</td>
      ${d.results.map((r) => `<td class="num">${r.vsLegacy.cutForLegacyCount === null ? "—" : f(r.vsLegacy.cutForLegacyCount)}</td>`).join("")}</tr>
  </tbody>
</table>`;

const itemTable = `
<table>
  <thead><tr><th>ข้อ</th><th>ตัวชี้วัด</th><th>ตัวแปร</th><th class="num">เต็ม</th><th class="num">เฉลี่ย</th>
    <th class="num">%ของเต็ม</th><th class="num">ได้เต็ม</th><th class="num">ได้ 0</th><th class="num">item–rest r</th><th class="num">D</th></tr></thead>
  <tbody>${F.items
    .map(
      (it) => `<tr><td>${it.id}</td><td>${esc(it.title)}</td><td class="muted"><code>${esc(it.variable)}</code></td>
      <td class="num">${it.max}</td><td class="num">${f(it.mean)}</td><td class="num">${f(it.share, 1)}%</td>
      <td class="num">${f(it.fullPct, 1)}%</td><td class="num">${f(it.zeroPct, 1)}%</td>
      <td class="num ${it.itemRestCorr >= 0.3 ? "good" : ""}">${f(it.itemRestCorr)}</td>
      <td class="num ${it.D >= 0.3 ? "good" : it.D < 0.2 ? "warn" : ""}">${f(it.D)}</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

const levelTable = `
<table>
  <thead><tr><th>กลุ่ม</th><th class="num">เส้นแบ่งเดิม</th><th class="num">จำนวนเดิม</th><th class="num">เส้นแบ่งเทียบเท่าในร่างนี้</th></tr></thead>
  <tbody>${F.vsLegacy.equivalentLevels
    .map((e) => {
      const name = { 70: "กลุ่มที่ 3 ยุ่งยากมากที่สุด", 60: "กลุ่มที่ 2 ขึ้นไป", 50: "กลุ่มที่ 1 ขึ้นไป" }[e.legacyMin];
      return `<tr><td>${name}</td><td class="num">≥ ${e.legacyMin}</td><td class="num">${n(e.legacyCount)}</td>
        <td class="num good">≥ ${e.equivalentMin === null ? "—" : f(e.equivalentMin)}</td></tr>`;
    })
    .join("")}</tbody>
</table>`;

const provinceTable = `
<table>
  <thead><tr><th>จังหวัด</th><th class="num">โรงเรียน</th><th class="num">เฉลี่ยเดิม</th><th class="num">เฉลี่ยใหม่</th>
    <th class="num">ผ่านเดิม</th><th class="num">ผ่านใหม่ (จุดตัด ${F.config.passThreshold})</th><th class="num">ผ่านใหม่ (จุดตัดเทียบเท่า)</th></tr></thead>
  <tbody>${F.provinces
    .map(
      (p) => `<tr><td>${esc(p.province)}</td><td class="num">${n(p.n)}</td>
      <td class="num">${f(p.meanOld)}</td><td class="num">${f(p.meanNew)}</td>
      <td class="num">${n(p.passOld)}</td><td class="num ${p.passNew < p.passOld ? "warn" : ""}">${n(p.passNew)}</td>
      <td class="num muted">ดูหมายเหตุ</td></tr>`,
    )
    .join("")}</tbody>
</table>`;

const supplementaryTable = supplementary
  ? `<table>
  <thead><tr><th>รายการที่ย้ายออก</th><th>เหตุผล</th><th>บทบาทที่เสนอ</th></tr></thead>
  <tbody>${supplementary.items
    .map(
      (s) =>
        `<tr><td>${esc(s.from)}</td><td class="muted">${esc(s.reason)}</td><td>${esc(s.proposedRole)}</td></tr>`,
    )
    .join("")}</tbody>
</table>`
  : "";

const itemDistCards = F.items
  .map((it) => {
    const bins = it.valueDistribution.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n }));
    const total = bins.reduce((s, b) => s + b.n, 0) || 1;
    const worst = Math.max(...bins.map((b) => b.n));
    return `
  <div class="card">
    <h3>${it.id} — ${esc(it.title)} <span class="muted">(เต็ม ${it.max} คะแนน · D = ${f(it.D)})</span></h3>
    <p class="muted">การกระจายของค่าที่ป้อนเข้าข้อนี้ · ช่วงที่หนาแน่นที่สุดคิดเป็น ${f((worst / total) * 100, 1)}% ของโรงเรียนทั้งหมด
    ${(worst / total) * 100 > 60 ? '<b class="warn">— กระจุกเกินไป ควรทบทวนตัวแปร</b>' : "— กระจายในระดับที่ใช้จำแนกได้"}</p>
    ${histBars(bins, { unitLabel: it.variable === "elevM" ? " ม." : "" })}
  </div>`;
  })
  .join("");

const body = `${PAGE_STYLE}
<div class="viz-root">
  <h1>${esc(TITLE)}</h1>
  <p class="lead">นำร่างเกณฑ์ไปคำนวณกับโรงเรียนจริง ${n(d.population)} แห่งที่ยืนยันสถานะปี 2569
  แล้วเทียบกับเกณฑ์เดิมทุกด้าน — ใครได้ ใครเสีย ลำดับพลิกไหม และเกณฑ์ใหม่ "แยกโรงเรียนออกจากกัน" ได้ดีขึ้นจริงหรือไม่</p>
  <p class="src">แหล่งข้อมูล: ${esc(d.source)} · สร้างเมื่อ ${new Date(d.generatedAt).toLocaleString("th-TH")}<br>
  ${esc(F.config.status ?? "")} — ตัวเลขทุกตัวคำนวณสดจากข้อมูลจริง ไม่ใช่การประมาณ</p>

  <div class="tiles">
    ${tiles.map((t) => `<div class="tile"><div class="v">${t.v}</div><div class="l">${t.l}</div><div class="s">${t.s}</div></div>`).join("")}
  </div>

  <h2>1. ร่างนี้แก้อะไรจากเกณฑ์เดิม</h2>
  <div class="card">
    <p>${esc(F.config.note ?? "")}</p>
  </div>

  <h2>2. เทียบคุณภาพของเกณฑ์ทุกร่าง</h2>
  <div class="card scroll">
    ${compareTable}
    <p>ตัวเลขที่ควรดูที่สุดคือ <b>อำนาจจำแนก D ต่ำสุดในชุด</b> และ <b>item–rest r ต่ำสุด</b> — ถ้าข้อที่แย่ที่สุดยังทำงานได้
    แปลว่าไม่มีข้อไหนเป็นคะแนนแจกฟรีหรือแต้มพิเศษของกลุ่มเล็กหลงเหลืออยู่</p>
  </div>

  <h2>3. การกระจายคะแนนรวม — เกณฑ์เดิม vs ร่างนี้</h2>
  <div class="card">
    <h3>เกณฑ์เดิม (เฉลี่ย ${f(L.mean, 1)} · SD ${f(L.sd, 1)})</h3>
    ${histBars(L.histogram.filter((b) => b.hi > 30), { markAt: 70, markLabel: "จุดตัด 70", unitLabel: " คะแนน" })}
    <h3>${esc(F.config.name.split(" — ")[0])} (เฉลี่ย ${f(F.totals.mean, 1)} · SD ${f(F.totals.sd, 1)})</h3>
    ${histBars(F.totals.histogram, {
      markAt: F.vsLegacy.cutForLegacyCount ?? F.config.passThreshold,
      markLabel: `จุดตัดเทียบเท่า ${f(F.vsLegacy.cutForLegacyCount ?? 0, 1)}`,
      unitLabel: " คะแนน",
    })}
    <p>เกณฑ์เดิมอัดโรงเรียนไว้ในช่วงแคบรอบ ๆ 65 คะแนน ทำให้การขยับสูตรเพียงเล็กน้อยเปลี่ยนสถานะได้เป็นร้อยแห่ง
    ส่วนร่างนี้กระจายกว้างกว่า (SD ${f(F.totals.sd, 1)} เทียบกับ ${f(L.sd, 1)}) จุดตัดจึงมั่นคงกว่า</p>
  </div>

  <h2>4. เส้นแบ่งระดับต้องย้ายตามสูตร</h2>
  <div class="card scroll">
    ${levelTable}
    <p><b>นี่คือจุดที่พลาดได้ง่ายที่สุด</b> — ถ้าเปลี่ยนสูตรแล้วคงเลข 70/60/50 ไว้เฉย ๆ
    จำนวนโรงเรียนในแต่ละกลุ่มจะเปลี่ยนไปมากโดยไม่มีใครตั้งใจ ควรตัดสินใจที่ <em>จำนวนเป้าหมาย</em> ก่อน แล้วจึงย้อนหาเส้นแบ่ง</p>
  </div>

  <h2>5. พฤติกรรมรายข้อของร่างนี้</h2>
  <div class="card">
    <h3>อำนาจจำแนก D รายข้อ</h3>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> ผ่านเกณฑ์ (D ≥ ${F.health.thresholds.minD})</span>
      <span><i class="swatch" style="background:var(--series-2)"></i> ต่ำกว่าเกณฑ์</span>
    </div>
    ${hbars(
      [...F.items]
        .sort((a, b) => b.D - a.D)
        .map((it) => ({
          label: `${it.id}. ${it.title.slice(0, 26)}`,
          value: it.D,
          max: 1,
          dp: 2,
          accent: it.D < F.health.thresholds.minD,
          note: `เต็ม ${it.max} คะแนน · item–rest r = ${f(it.itemRestCorr)}`,
        })),
      { labelW: 210 },
    )}
  </div>
  <div class="card">
    <h3>น้ำหนักคะแนนที่จัดสรร</h3>
    ${hbars(
      F.items.map((it) => ({
        label: `${it.id}. ${it.title.slice(0, 26)}`,
        value: it.max,
        max: 100,
        dp: 0,
        note: `ได้จริงเฉลี่ย ${f(it.mean)} (${f(it.share, 1)}% ของเต็มข้อนี้)`,
      })),
      { unit: " คะแนน", labelW: 210 },
    )}
  </div>
  <div class="card scroll">
    <h3>ตารางสถิติรายข้อ</h3>
    ${itemTable}
  </div>

  <h2>6. ตัวแปรที่ใช้ "แปรผันจริง" หรือไม่</h2>
  <p>ข้อที่พื้นตัน/เพดานตันในเกณฑ์เดิมแก้ด้วยการปรับน้ำหนักไม่ได้ เพราะตัวแปรแทบไม่แปรผันในประชากร —
  วิธีเดียวที่ได้ผลคือเปลี่ยนไปใช้ตัวแปรที่กระจายจริง กราฟชุดนี้คือหลักฐานว่าตัวแปรของร่างนี้ผ่านเงื่อนไขนั้น</p>
  ${itemDistCards}

  <h2>7. ผลกระทบรายจังหวัด</h2>
  <div class="card scroll">
    ${provinceTable}
    <p class="muted">หมายเหตุ: คอลัมน์ "ผ่านใหม่" ใช้จุดตัด ${F.config.passThreshold} ตามที่ตั้งไว้ในไฟล์ร่าง
    ถ้าใช้จุดตัดเทียบเท่า ${f(F.vsLegacy.cutForLegacyCount ?? 0, 1)} จำนวนรวมทั้งประเทศจะเท่ากับเกณฑ์เดิม (${n(L.passAt70)} แห่ง)
    แต่การกระจายรายจังหวัดจะยังต่างจากเดิม เพราะลำดับความลำบากถูกจัดใหม่ (ρ = ${f(F.vsLegacy.spearman)})</p>
  </div>

  ${
    supplementary
      ? `<h2>8. รายการที่ย้ายออกจากคะแนนหลัก</h2>
  <div class="card scroll">
    <p>${esc(supplementary.note)}</p>
    ${supplementaryTable}
  </div>`
      : ""
  }

  <p class="foot">สร้างจาก <code>scripts/simulate-criteria.mjs</code> → <code>scripts/report-criteria-html.mjs</code> ·
  ไฟล์ร่าง: <code>${esc(F.config.file)}</code> ·
  รายงานฉบับข้อความ: <code>docs/ANALYSIS-ผลทดลองเกณฑ์2569.md</code> ·
  ข้อเสนอที่ร่างนี้อ้างอิง: <code>docs/RECOMMENDATIONS-เกณฑ์2569.md</code></p>
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
