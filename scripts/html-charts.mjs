// ชิ้นส่วนที่ใช้ร่วมกันของหน้านำเสนอ HTML — กราฟ SVG แบบ inline, ชุดสีที่ตรวจ contrast/CVD แล้ว และโครงหน้า
// ใช้โดย scripts/report-legacy-html.mjs และ scripts/report-criteria-html.mjs

export const n = (x) => Number(x ?? 0).toLocaleString("th-TH");
export const f = (x, k = 2) => Number(x ?? 0).toFixed(k);
export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------- ชิ้นส่วนกราฟ (SVG แบบ inline ไม่พึ่งไลบรารีภายนอก) ---------- */

/** แท่งแนวนอน: rows = [{label, value, max, note, accent}] */
export function hbars(rows, { unit = "", width = 640, rowH = 26, labelW = 190, valueW = 66 } = {}) {
  const max = Math.max(...rows.map((r) => r.max ?? r.value), 1);
  const plotW = width - labelW - valueW;
  const h = rows.length * rowH + 8;
  const bars = rows
    .map((r, i) => {
      const y = i * rowH + 4;
      const w = Math.max(2, (r.value / max) * plotW);
      const track = r.max ? (r.max / max) * plotW : 0;
      const color = r.accent ? "var(--series-2)" : "var(--series-1)";
      return `
      <g class="bar" tabindex="0" data-tip="${esc(r.label)} — ${f(r.value)}${unit}${r.note ? " · " + esc(r.note) : ""}">
        <text class="lbl" x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle">${esc(r.label)}</text>
        ${track ? `<rect class="track" x="${labelW}" y="${y + 5}" width="${track}" height="${rowH - 14}" rx="4"/>` : ""}
        <rect x="${labelW}" y="${y + 5}" width="${w}" height="${rowH - 14}" rx="4" fill="${color}"/>
        <text class="val" x="${labelW + plotW + 8}" y="${y + rowH / 2}" dominant-baseline="middle">${f(r.value, r.dp ?? 2)}${unit}</text>
      </g>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${h}" role="img" aria-label="แผนภูมิแท่งแนวนอน">${bars}</svg>`;
}

/** ฮิสโทแกรมแนวตั้ง: bins = [{lo,hi,n}] · markAt = ค่าที่ต้องการขีดเส้น */
export function histBars(bins, { width = 680, height = 220, markAt = null, markLabel = "", unitLabel = "" } = {}) {
  const padL = 44;
  const padB = 34;
  const padT = 12;
  const plotW = width - padL - 12;
  const plotH = height - padB - padT;
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const bw = plotW / bins.length;
  const lo = bins[0].lo;
  const hi = bins[bins.length - 1].hi;
  const bars = bins
    .map((b, i) => {
      const bh = (b.n / maxN) * plotH;
      const x = padL + i * bw + 1.5;
      const y = padT + plotH - bh;
      const inMark = markAt !== null && b.lo >= markAt;
      return `<g class="bar" tabindex="0" data-tip="${b.lo}–${b.hi}${unitLabel} · ${n(b.n)} แห่ง">
        <rect x="${f(x, 1)}" y="${f(y, 1)}" width="${f(bw - 3, 1)}" height="${f(Math.max(bh, 1), 1)}" rx="4"
              fill="${inMark ? "var(--series-2)" : "var(--series-1)"}"/>
      </g>`;
    })
    .join("");
  const ticks = bins
    .filter((_, i) => i % Math.ceil(bins.length / 7) === 0)
    .map((b, k, arr) => {
      const i = bins.indexOf(b);
      const x = padL + i * bw;
      return `<text class="tick" x="${f(x, 1)}" y="${height - padB + 16}" text-anchor="middle">${b.lo}</text>`;
    })
    .join("");
  const markX = markAt === null ? null : padL + ((markAt - lo) / (hi - lo)) * plotW;
  const mark =
    markX === null
      ? ""
      : `<line class="cut" x1="${f(markX, 1)}" x2="${f(markX, 1)}" y1="${padT}" y2="${padT + plotH}"/>
         <text class="cutlbl" x="${f(markX + 6, 1)}" y="${padT + 12}">${esc(markLabel)}</text>`;
  const yTicks = [0, 0.5, 1]
    .map((t) => {
      const y = padT + plotH - t * plotH;
      return `<line class="grid" x1="${padL}" x2="${padL + plotW}" y1="${f(y, 1)}" y2="${f(y, 1)}"/>
              <text class="tick" x="${padL - 8}" y="${f(y + 4, 1)}" text-anchor="end">${n(Math.round(t * maxN))}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="ฮิสโทแกรม">${yTicks}${bars}${mark}${ticks}</svg>`;
}

/**
 * แท่งคู่แนวนอนสำหรับเทียบสองชุดค่า — rows = [{label, a, b, note}]
 * ชุด a ใช้สีที่ 1 · ชุด b ใช้สีที่ 2 (ต้องมี legend กำกับว่าอันไหนคืออะไรเสมอ)
 */
export function pairedBars(rows, { width = 660, rowH = 34, labelW = 150, valueW = 108, max = null, unit = "" } = {}) {
  const top = max ?? Math.max(...rows.flatMap((r) => [r.a, r.b]), 1);
  const plotW = width - labelW - valueW;
  const h = rows.length * rowH + 8;
  const bars = rows
    .map((r, i) => {
      const y = i * rowH + 4;
      const bh = (rowH - 16) / 2;
      const wa = Math.max(1, (r.a / top) * plotW);
      const wb = Math.max(1, (r.b / top) * plotW);
      return `
      <g class="bar" tabindex="0" data-tip="${esc(r.label)} — เดิม ${f(r.a)}${unit} · ใหม่ ${f(r.b)}${unit}${r.note ? " · " + esc(r.note) : ""}">
        <text class="lbl" x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle">${esc(r.label)}</text>
        <rect x="${labelW}" y="${y + 4}" width="${f(wa, 1)}" height="${f(bh, 1)}" rx="3" fill="var(--series-1)"/>
        <rect x="${labelW}" y="${y + 6 + bh}" width="${f(wb, 1)}" height="${f(bh, 1)}" rx="3" fill="var(--series-2)"/>
        <text class="val" x="${labelW + plotW + 8}" y="${y + rowH / 2}" dominant-baseline="middle">${f(r.a, r.dp ?? 1)} → ${f(r.b, r.dp ?? 1)}</text>
      </g>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${h}" role="img" aria-label="แผนภูมิแท่งคู่เปรียบเทียบ">${bars}</svg>`;
}

/** CSS ของหน้านำเสนอ รวมโหมดสว่าง/มืด (ต้องวางไว้บนสุดของ body) */
export const PAGE_STYLE = `<style>
  .viz-root{
    color-scheme: light;
    --surface-0:#f6f5f2; --surface-1:#fcfcfb; --border:#e2e0da;
    --text-primary:#0b0b0b; --text-secondary:#52514e; --text-muted:#7c7a73;
    --series-1:#2a78d6; --series-2:#eb6834; --track:#e8e6e0;
    --good:#00713a; --warn:#b9430f;
  }
  @media (prefers-color-scheme: dark){
    :root:where(:not([data-theme="light"])) .viz-root{
      color-scheme: dark;
      --surface-0:#111110; --surface-1:#1a1a19; --border:#33332f;
      --text-primary:#ffffff; --text-secondary:#c3c2b7; --text-muted:#96958b;
      --series-1:#3987e5; --series-2:#d95926; --track:#2b2b28;
      --good:#4fbf8a; --warn:#f08a5c;
    }
  }
  :root[data-theme="dark"] .viz-root{
    color-scheme: dark;
    --surface-0:#111110; --surface-1:#1a1a19; --border:#33332f;
    --text-primary:#ffffff; --text-secondary:#c3c2b7; --text-muted:#96958b;
    --series-1:#3987e5; --series-2:#d95926; --track:#2b2b28;
    --good:#4fbf8a; --warn:#f08a5c;
  }

  .viz-root{
    background:var(--surface-0); color:var(--text-primary);
    font-family:"IBM Plex Sans Thai","Noto Sans Thai",-apple-system,"Segoe UI",sans-serif;
    line-height:1.6; padding:32px 20px 72px; max-width:1080px; margin:0 auto;
    font-size:15px;
  }
  .viz-root h1,.viz-root h2,.viz-root h3{text-wrap:balance}
  .viz-root h1{font-size:1.7rem; line-height:1.3; margin:0 0 8px; letter-spacing:-0.01em}
  .viz-root h2{font-size:1.15rem; margin:44px 0 4px; letter-spacing:-0.005em}
  .viz-root h3{font-size:0.98rem; margin:24px 0 6px; color:var(--text-secondary); font-weight:600}
  .viz-root p{margin:8px 0; color:var(--text-secondary)}
  .lead{color:var(--text-secondary); font-size:0.95rem}
  .src{font-size:0.82rem; color:var(--text-muted); border-left:3px solid var(--border); padding-left:12px; margin:16px 0 0}

  .tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin:24px 0 8px}
  .tile{background:var(--surface-1); border:1px solid var(--border); border-radius:12px; padding:14px 16px}
  .tile .v{font-size:1.7rem; font-weight:650; letter-spacing:-0.02em; font-variant-numeric:tabular-nums}
  .tile .l{font-size:0.85rem; color:var(--text-secondary); margin-top:2px}
  .tile .s{font-size:0.76rem; color:var(--text-muted); margin-top:4px}

  .card{background:var(--surface-1); border:1px solid var(--border); border-radius:12px; padding:16px 18px; margin:12px 0}
  .scroll{overflow-x:auto}
  svg.chart{display:block; width:100%; height:auto; overflow:visible}
  svg .lbl{font-size:11.5px; fill:var(--text-secondary)}
  svg .val{font-size:11.5px; fill:var(--text-primary); font-variant-numeric:tabular-nums}
  svg .tick{font-size:10.5px; fill:var(--text-muted); font-variant-numeric:tabular-nums}
  svg .track{fill:var(--track)}
  svg .grid{stroke:var(--border); stroke-width:1}
  svg .cut{stroke:var(--text-primary); stroke-width:2; stroke-dasharray:4 3; opacity:.7}
  svg .cutlbl{font-size:10.5px; fill:var(--text-primary)}
  svg .bar{cursor:default; outline:none}
  svg .bar:hover rect:not(.track){opacity:.82}
  svg .bar:focus-visible rect:not(.track){opacity:.82; stroke:var(--text-primary); stroke-width:2; paint-order:stroke}

  table{border-collapse:collapse; width:100%; font-size:0.85rem; margin:8px 0}
  th,td{text-align:left; padding:7px 10px; border-bottom:1px solid var(--border); vertical-align:top}
  th{font-weight:600; color:var(--text-secondary); font-size:0.8rem; white-space:nowrap}
  td.num,th.num{text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap}
  td.muted{color:var(--text-muted)}
  td.warn{color:var(--warn); font-weight:600}
  td.good{color:var(--good); font-weight:600}
  tbody tr:hover{background:var(--surface-0)}

  ol.findings{padding-left:20px; margin:12px 0}
  ol.findings li{margin:10px 0; color:var(--text-secondary)}
  ol.findings b{color:var(--text-primary)}
  .legend{display:flex; gap:16px; flex-wrap:wrap; font-size:0.8rem; color:var(--text-secondary); margin:6px 0 10px}
  .legend span{display:inline-flex; align-items:center; gap:6px}
  .swatch{width:12px; height:12px; border-radius:3px; display:inline-block}
  #tip{position:fixed; pointer-events:none; z-index:50; background:var(--text-primary); color:var(--surface-1);
       font-size:12px; padding:6px 9px; border-radius:7px; opacity:0; transition:opacity .1s; max-width:280px}
  @media (prefers-reduced-motion: reduce){ #tip{transition:none} }
  .foot{margin-top:48px; font-size:0.8rem; color:var(--text-muted); border-top:1px solid var(--border); padding-top:16px}
</style>`;

/** สคริปต์ tooltip ที่ใช้ร่วมกัน (วางไว้ท้าย body คู่กับ <div id="tip">) */
export const TOOLTIP_SCRIPT = `<script>
(() => {
  const tip = document.getElementById("tip");
  const show = (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    tip.textContent = el.dataset.tip;
    tip.style.opacity = "1";
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 300, (e.clientX || r.left) + 12);
    const y = (e.clientY || r.top) + 16;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  };
  const hide = () => { tip.style.opacity = "0"; };
  document.addEventListener("mousemove", (e) => (e.target.closest("[data-tip]") ? show(e) : hide()));
  document.addEventListener("focusin", show);
  document.addEventListener("focusout", hide);
})();
</script>`;

/** ห่อเนื้อหาเป็นไฟล์ HTML สมบูรณ์สำหรับเปิดจากเครื่อง — ต้องมี meta charset ไม่งั้นภาษาไทยเพี้ยนเมื่อเสิร์ฟผ่าน Apache */
export function standalonePage(title, body) {
  return [
    "<!doctype html>",
    '<html lang="th">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + title + "</title>",
    "<style>*{box-sizing:border-box}html,body{margin:0;padding:0}</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
