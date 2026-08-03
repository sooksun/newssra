// เทียบ "ระดับ tile ที่มีภาพจริง" ของ Google Map Tiles API กับ Esri World Imagery ณ พิกัดที่กำหนด
// ตอบคำถามเดียว: ถ้าสลับไปใช้ Google ภาพจะคมขึ้นจริงกี่ระดับในพื้นที่ของโรงเรียนกลุ่มเป้าหมาย
//
// วิธีวัด (ต่างกันตาม provider เพราะ API คนละแบบ):
//   • Esri  — เรียก endpoint tilemap ซึ่งบอกตรง ๆ ว่า tile นั้น "มีจริง" หรือเป็นภาพขยาย (วิธีเดียวกับ
//             lib/map/esriImagery.ts ที่แอปใช้อยู่)
//   • Google — ขอ tile จริงแล้วดูขนาดไฟล์: Google ตอบ 200 เสมอแม้ zoom เกินภาพจริง แต่ tile ที่เป็น
//             ภาพขยาย/ว่างจะเล็กผิดปกติ จึงใช้เกณฑ์ขนาดไบต์เป็นตัวชี้ (ระบุ threshold ไว้ให้เห็นชัด
//             ไม่ซ่อนเป็นเวทมนตร์) — ตัวเลขนี้เป็น "ตัวบ่งชี้" ไม่ใช่คำตอบทางการจาก Google
//
// ใช้: node scripts/probe-imagery-levels.mjs [lat] [lng] [ชื่อจุด]
//      node scripts/probe-imagery-levels.mjs            # ใช้ชุดพิกัดตัวอย่าง 3 แบบภูมิประเทศ

import fs from "node:fs";
import path from "node:path";

const ESRI_BASE = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const MIN_LEVEL = 14;
const MAX_LEVEL = 21;
// tile ของ Google ที่เล็กกว่านี้ถือว่าไม่ใช่ภาพถ่ายจริง (ภาพขยาย/พื้นเรียบ) — วัดจาก tile จริงที่ zoom เกิน
const GOOGLE_MIN_REAL_TILE_BYTES = 3000;

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function tileXY(lat, lng, level) {
  const n = 2 ** level;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

/** เมตรต่อพิกเซลที่ละติจูดนั้น ในระดับ zoom ที่กำหนด (tile 256px) — ใช้แปลง "ระดับ" เป็นความคมที่จับต้องได้ */
function metersPerPixel(lat, level) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** level;
}

async function esriMaxRealLevel(lat, lng) {
  for (let level = MAX_LEVEL; level >= MIN_LEVEL; level--) {
    const { x, y } = tileXY(lat, lng, level);
    try {
      const res = await fetch(`${ESRI_BASE}/tilemap/${level}/${y}/${x}/1/1?f=json`);
      if (!res.ok) continue;
      const body = await res.json();
      if (Array.isArray(body.data) && body.data.some((v) => v === 1)) return level;
    } catch {
      /* ข้ามระดับที่เรียกไม่สำเร็จ */
    }
  }
  return null;
}

async function googleSession(key) {
  const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "th-TH", region: "TH" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createSession → HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()).session;
}

async function googleMaxRealLevel(session, key, lat, lng) {
  let best = null;
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    const { x, y } = tileXY(lat, lng, level);
    try {
      const res = await fetch(
        `https://tile.googleapis.com/v1/2dtiles/${level}/${x}/${y}?session=${session}&key=${key}`,
      );
      if (!res.ok) break;
      const bytes = (await res.arrayBuffer()).byteLength;
      if (bytes >= GOOGLE_MIN_REAL_TILE_BYTES) best = { level, bytes };
      else break;
    } catch {
      break;
    }
  }
  return best;
}

const SAMPLES = [
  { name: "ภูเขาสูง — อ.กัลยาณิวัฒนา เชียงใหม่", lat: 19.0455, lng: 98.2686 },
  { name: "หุบเขา — อ.ปาย แม่ฮ่องสอน", lat: 19.3583, lng: 98.4392 },
  { name: "พื้นราบห่างไกล — อ.บ่อเกลือ น่าน", lat: 19.1064, lng: 101.1636 },
];

loadEnv();
const key = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
if (!key) {
  console.error("ไม่พบ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ใน .env.local");
  process.exit(1);
}

const argLat = Number(process.argv[2]);
const argLng = Number(process.argv[3]);
const points =
  Number.isFinite(argLat) && Number.isFinite(argLng)
    ? [{ name: process.argv[4] || "จุดที่ระบุ", lat: argLat, lng: argLng }]
    : SAMPLES;

const session = await googleSession(key);
console.log(`Map Tiles API: ได้ session แล้ว (mapType=satellite)\n`);

for (const p of points) {
  const [esri, google] = await Promise.all([
    esriMaxRealLevel(p.lat, p.lng),
    googleMaxRealLevel(session, key, p.lat, p.lng),
  ]);
  const esriMpp = esri ? metersPerPixel(p.lat, esri) : null;
  const gMpp = google ? metersPerPixel(p.lat, google.level) : null;

  console.log(`${p.name}  (${p.lat}, ${p.lng})`);
  console.log(`  Esri   : ระดับสูงสุดที่มีภาพจริง = ${esri ?? "หาไม่พบ"}${esriMpp ? `  (~${esriMpp.toFixed(2)} ม./พิกเซล)` : ""}`);
  console.log(
    `  Google : ระดับสูงสุดที่มีภาพจริง = ${google?.level ?? "หาไม่พบ"}${gMpp ? `  (~${gMpp.toFixed(2)} ม./พิกเซล, tile ${google.bytes.toLocaleString()} ไบต์)` : ""}`,
  );
  if (esri && google) {
    const diff = google.level - esri;
    const sharper = esriMpp / gMpp;
    console.log(
      `  → ${diff > 0 ? `Google ละเอียดกว่า ${diff} ระดับ (คมขึ้น ~${sharper.toFixed(1)} เท่าต่อด้าน)` : diff === 0 ? "เท่ากัน" : `Esri ละเอียดกว่า ${-diff} ระดับ`}`,
    );
  }
  console.log("");
}
