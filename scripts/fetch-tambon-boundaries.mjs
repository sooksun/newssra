// สร้าง public/geo/tambon/*.json — ขอบเขตตำบล (ADM3) แยกรายจังหวัด
//
// ทำไมต้องมีชั้นนี้: หน้าแผนที่เคยมีแต่เขตเทศบาลจาก OpenStreetMap ซึ่งครอบคลุมไม่ครบ
// (เทศบาลเมืองส่วนใหญ่ไม่มีขอบเขตใน OSM) จังหวัดที่โครงการนี้สนใจที่สุดจึงไม่มีเส้นอะไรเลย
// ขอบเขตตำบลชุดนี้ครบทั้งประเทศ 7,425 ตำบล และตอบได้จริงว่า "จุดที่ตั้งอยู่ในตำบลใด อำเภอใด"
//
// ⚠️ ขอบเขตตำบล ≠ เขต อปท. — ตำบลหนึ่งอาจถูกแบ่งระหว่างเทศบาลกับ อบต. ชั้นนี้จึงตอบ
// "อยู่ตำบลไหน" ได้ แต่ตอบ "อยู่ในเขตเทศบาลหรือไม่" ไม่ได้ (ข้อมูลขอบเขต อปท. ไม่มีเผยแพร่)
//
// แหล่งข้อมูล: COD-AB Thailand (ADM3) กรมแผนที่ทหาร (RTSD) เผยแพร่ผ่าน OCHA/HDX
//   https://data.humdata.org/dataset/cod-ab-tha  — สัญญาอนุญาต CC BY-IGO (ต้องแสดงเครดิต)
// ไฟล์ต้นทางที่ดึงคือชุดที่ลดรูปแล้วของ COD-AB รุ่น 2022-01-21 (ไฟล์ทางการเป็น zip 437 MB
// ซึ่งเกินความจำเป็นของ overlay นี้มาก) — ตรวจ provenance ได้จากชื่อไฟล์ tha_admbnda_adm3_rtsd_*
//
// รัน: node scripts/fetch-tambon-boundaries.mjs [--tolerance 50] [--out public/geo/tambon]

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { roundCoords, simplify } from "./geo-simplify.mjs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/prasertcbs/thailand_gis/master/tambon_simplify/tha_admbnda_adm3_rtsd_20220121_geo.json";

export const ATTRIBUTION = "ขอบเขตตำบล: COD-AB Thailand (RTSD) เผยแพร่โดย OCHA/HDX — CC BY-IGO";

/** วงที่เหลือน้อยกว่านี้วาดเป็นพื้นที่ไม่ได้ ตัดทิ้ง */
const MIN_RING_POINTS = 4;

function parseArgs(argv) {
  const args = { tolerance: 50, out: "public/geo/tambon" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tolerance") args.tolerance = Number(argv[++i]);
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  if (!Number.isFinite(args.tolerance) || args.tolerance < 0) {
    throw new Error(`--tolerance ต้องเป็นตัวเลข >= 0 (ได้ ${args.tolerance})`);
  }
  return args;
}

async function fetchSource() {
  process.stdout.write(`ดาวน์โหลดขอบเขตตำบลจาก COD-AB…\n`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ: HTTP ${response.status}`);
  return response.json();
}

/** วงนอกของ feature (รองรับทั้ง Polygon และ MultiPolygon) — ไม่เก็บวงใน (เกาะในเขต) */
function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates?.[0]].filter(Boolean);
  if (geometry.type === "MultiPolygon") return (geometry.coordinates ?? []).map((poly) => poly[0]).filter(Boolean);
  return [];
}

function bboxOf(rings) {
  let north = -Infinity;
  let south = Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lat > north) north = lat;
      if (lat < south) south = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
  }
  return { north, south, west, east };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = await fetchSource();
  const features = Array.isArray(doc?.features) ? doc.features : [];
  if (features.length === 0) throw new Error("ไฟล์ต้นทางไม่มี features — ยกเลิก");

  const byProvince = new Map();
  let dropped = 0;

  for (const feature of features) {
    const p = feature?.properties ?? {};
    const provinceCode = typeof p.ADM1_PCODE === "string" ? p.ADM1_PCODE : "";
    const provinceName = typeof p.ADM1_TH === "string" ? p.ADM1_TH : "";
    const tambonName = typeof p.ADM3_TH === "string" ? p.ADM3_TH : "";
    const amphoeName = typeof p.ADM2_TH === "string" ? p.ADM2_TH : "";
    if (!provinceCode || !provinceName || !tambonName) {
      dropped += 1;
      continue;
    }

    const rings = outerRings(feature.geometry)
      .map((ring) => roundCoords(simplify(ring.map(([lng, lat]) => [lng, lat]), args.tolerance)))
      .filter((ring) => ring.length >= MIN_RING_POINTS);
    if (rings.length === 0) {
      dropped += 1;
      continue;
    }

    if (!byProvince.has(provinceCode)) {
      byProvince.set(provinceCode, { code: provinceCode, name: provinceName, tambons: [] });
    }
    byProvince.get(provinceCode).tambons.push({
      name: tambonName,
      amphoe: amphoeName,
      code: typeof p.ADM3_PCODE === "string" ? p.ADM3_PCODE : "",
      rings,
    });
  }

  const outDir = resolve(process.cwd(), args.out);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const index = [];
  let totalBytes = 0;
  let totalTambons = 0;

  for (const province of [...byProvince.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    const payload = {
      attribution: ATTRIBUTION,
      province: province.name,
      provinceCode: province.code,
      tambons: province.tambons,
    };
    const json = JSON.stringify(payload);
    writeFileSync(resolve(outDir, `${province.code}.json`), json);
    totalBytes += Buffer.byteLength(json);
    totalTambons += province.tambons.length;
    index.push({
      code: province.code,
      name: province.name,
      tambonCount: province.tambons.length,
      // bbox ให้ client เลือกไฟล์ที่ต้องโหลดจากพิกัด โดยไม่ต้องจับคู่ชื่อจังหวัด
      // (พื้นที่ชายแดนจังหวัดอาจตกใน bbox หลายจังหวัด — client โหลดได้มากกว่าหนึ่ง)
      bbox: bboxOf(province.tambons.flatMap((t) => t.rings)),
    });
  }

  writeFileSync(resolve(outDir, "index.json"), JSON.stringify({ attribution: ATTRIBUTION, provinces: index }));

  process.stdout.write(
    `เขียน ${index.length} จังหวัด · ${totalTambons.toLocaleString("th-TH")} ตำบล · ` +
      `${(totalBytes / 1024 / 1024).toFixed(1)} MB (ตัดทิ้ง ${dropped} รายการ)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
