// สร้าง public/geo/lao-offices.json — ทะเบียนองค์กรปกครองส่วนท้องถิ่น (อปท.) ทั่วประเทศ
//
// ทำไมต้องมี: OpenStreetMap มีหมุดเทศบาลแบบมีบ้างไม่มีบ้าง ทะเบียนนี้มาจากกรมส่งเสริมการปกครอง
// ท้องถิ่น (สถ.) ซึ่งเป็นเจ้าของเรื่องโดยตรง และครบทั้ง 7,849 แห่ง
//
// ⚠️ เป็น "จุดที่ตั้งสำนักงาน + ขนาดพื้นที่ตามทะเบียน" ไม่ใช่ขอบเขต
// จึงบอกไม่ได้ว่าพิกัดหนึ่งอยู่ในเขต อปท. ใด — ข้อมูลขอบเขต อปท. ไม่มีหน่วยงานใดเผยแพร่แบบเปิด
// (ตรวจแล้ว 2026-08-05: data.go.th 0 ชุด, สถ. มีแต่จุด, COD-AB ลึกสุดแค่ตำบล,
//  กรมโยธาธิการฯ ขายเป็นรายกรณี) ห้ามนำจุด+พื้นที่ไปสร้างวงกลมแทนขอบเขต
//
// แหล่งข้อมูล: DLA Open Data "ข้อมูลที่ตั้งและพื้นที่ของ อปท." — สัญญาอนุญาต Open Data Common
//   https://opendata.dla.go.th/dataset/dlads_05_01
//
// รัน: node scripts/fetch-lao-offices.mjs [--out public/geo/lao-offices.json]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SOURCE_URL =
  "https://opendata.dla.go.th/dataset/1a668c66-c6d6-4c94-bc0f-e57c81813eb8/resource/" +
  "e9d61e15-d28f-467e-a018-98e0647ef2f4/download/re01_9112566tambon.csv";

export const ATTRIBUTION = "ทะเบียน อปท.: กรมส่งเสริมการปกครองท้องถิ่น (DLA Open Data)";

/** ประเภท อปท. ที่รับ — อบจ. ไม่เอา เพราะครอบทั้งจังหวัด วาดเป็นหมุดจุดเดียวแล้วสื่อผิด */
const KEEP_TYPES = new Set(["เทศบาลนคร", "เทศบาลเมือง", "เทศบาลตำบล", "อบต.", "ท้องถิ่นรูปแบบพิเศษ"]);

// ตั้งชื่อ thesaban_tambon (ไม่ใช่ tambon เฉย ๆ) เพื่อไม่ให้สับสนกับ "ขอบเขตตำบล" ซึ่งเป็นคนละเรื่อง
const TYPE_KEYS = {
  เทศบาลนคร: "nakhon",
  เทศบาลเมือง: "mueang",
  เทศบาลตำบล: "thesaban_tambon",
  "อบต.": "sao",
  ท้องถิ่นรูปแบบพิเศษ: "special",
};

function parseArgs(argv) {
  const args = { out: "public/geo/lao-offices.json" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

/** แยก CSV ทีละแถว รองรับค่าที่มีเครื่องหมายคำพูดครอบและมีจุลภาคข้างใน */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ค่าว่างต้องออกมาเป็น null ไม่ใช่ 0 — Number("") คืน 0 ซึ่งผ่าน isFinite
// (ถ้าปล่อยไว้ ทะเบียนที่ไม่ระบุขนาดพื้นที่จะกลายเป็น "0 ตร.กม." ซึ่งเป็นข้อมูลเท็จ)
function num(value) {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write("ดาวน์โหลดทะเบียน อปท. จาก สถ.…\n");
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ: HTTP ${response.status}`);
  const rows = parseCsv(await response.text());
  if (rows.length < 2) throw new Error("ไฟล์ต้นทางว่าง — ยกเลิก");

  // คอลัมน์: จังหวัด, อำเภอ, ตำบล, รหัส อปท., ประเภท อปท., อปท., ..., ขนาดพื้นที่, LAT, LONG, เว็บไซต์
  //
  // ⚠️ คอลัมน์ "ตำบล" ใช้ไม่ได้: ไฟล์ต้นทางจับคู่ทุก อปท. ในอำเภอกับทุกตำบลในอำเภอนั้น
  // (cartesian join) จึงดูเหมือนบอกได้ว่าตำบลไหนอยู่ใต้ อปท. ใด ทั้งที่บอกไม่ได้ — เรา dedupe
  // ด้วยรหัส อปท. แล้วทิ้งคอลัมน์ตำบลไป
  const I = { province: 0, amphoe: 1, code: 3, type: 4, name: 5, areaKm2: 9, lat: 10, lng: 11 };

  const byCode = new Map();
  let skippedType = 0;
  for (const row of rows.slice(1)) {
    if (row.length <= I.lng) continue;
    const code = row[I.code]?.trim();
    const type = row[I.type]?.trim();
    if (!code || byCode.has(code)) continue;
    if (!KEEP_TYPES.has(type)) {
      skippedType += 1;
      continue;
    }
    byCode.set(code, {
      code,
      kind: TYPE_KEYS[type],
      name: row[I.name]?.trim() ?? "",
      province: row[I.province]?.trim() ?? "",
      amphoe: row[I.amphoe]?.trim() ?? "",
      areaKm2: num(row[I.areaKm2]),
      lat: num(row[I.lat]),
      lng: num(row[I.lng]),
    });
  }

  const all = [...byCode.values()];
  // พิกัดที่ใช้วางหมุดได้จริงต้องอยู่ในกรอบประเทศไทยคร่าว ๆ — ทะเบียนมีทั้งช่องว่างและค่า 0
  const located = all.filter(
    (o) => o.lat !== null && o.lng !== null && o.lat > 5 && o.lat < 21 && o.lng > 96 && o.lng < 106,
  );

  const payload = {
    attribution: ATTRIBUTION,
    // บันทึกไว้ให้ UI บอกผู้ใช้ได้ตรง ๆ ว่าทะเบียนมีกี่แห่ง แต่วางหมุดได้กี่แห่ง
    registeredCount: all.length,
    offices: located.map((o) => ({
      code: o.code,
      kind: o.kind,
      name: o.name,
      province: o.province,
      amphoe: o.amphoe,
      areaKm2: o.areaKm2,
      lat: Math.round(o.lat * 1e5) / 1e5,
      lng: Math.round(o.lng * 1e5) / 1e5,
    })),
  };

  const outPath = resolve(process.cwd(), args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const json = JSON.stringify(payload);
  writeFileSync(outPath, json);

  const byKind = located.reduce((acc, o) => ({ ...acc, [o.kind]: (acc[o.kind] ?? 0) + 1 }), {});
  process.stdout.write(
    `ทะเบียน ${all.length.toLocaleString("th-TH")} แห่ง · มีพิกัดใช้ได้ ${located.length.toLocaleString("th-TH")} แห่ง · ` +
      `${(Buffer.byteLength(json) / 1024).toFixed(0)} KB\n` +
      `แยกประเภท: ${JSON.stringify(byKind)} (ข้ามประเภทที่ไม่เอา ${skippedType.toLocaleString("th-TH")} แถว)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
