// ตรวจว่า Google Photorealistic 3D Tiles มี mesh จริงที่พิกัดหนึ่ง ๆ หรือไม่ ก่อนตัดสินใจลงแรงพัฒนา
//
// ทำไมต้องตรวจ: Photorealistic 3D Tiles ครอบคลุมเป็น "หย่อม" (เมืองใหญ่เป็นหลัก) ไม่ได้คลุมทั้งโลก
// พื้นที่ที่ไม่มี mesh จะไม่มี error — tileset แค่ไม่มี child ครอบพิกัดนั้น แล้วจอจะว่างเปล่า
// ระบบนี้ประเมินโรงเรียนพื้นที่ห่างไกล จึงต้องรู้ก่อนว่าพื้นที่เป้าหมายมีข้อมูลจริงไหม
//
// วิธีตรวจ: ไล่ tileset ลงตามลำดับชั้น เลือกเฉพาะ child ที่ boundingVolume ครอบพิกัดเป้าหมาย
// รองรับทั้ง box (OBB ในระบบพิกัด ECEF — Google ใช้ที่ชั้นบน) และ region (lat/lng เรเดียน)
// ความสูงของจุดทดสอบไม่ทราบแน่ จึงกวาดหลายค่า (0–3000 ม.) แล้วถือว่า "อยู่ใน" ถ้าค่าใดค่าหนึ่งผ่าน
//
// จุดควบคุมในชุดตัวอย่างคือกรุงเทพฯ ซึ่งรู้ว่ามี coverage — ถ้าจุดนั้นไม่ผ่านแปลว่า probe เองมีปัญหา
// ไม่ใช่ว่าพื้นที่ไม่มีข้อมูล
//
// ใช้: node scripts/probe-google-3dtiles.mjs [lat] [lng] [ชื่อจุด]
//      node scripts/probe-google-3dtiles.mjs        # ชุดตัวอย่าง + จุดควบคุม

import fs from "node:fs";
import path from "node:path";

const BASE = "https://tile.googleapis.com";
const MAX_DEPTH = 30;
const TEST_HEIGHTS_M = [0, 500, 1000, 1500, 2000, 3000];

// WGS84
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const rad = (deg) => (deg * Math.PI) / 180;

/** lat/lng/height → พิกัด ECEF (เมตร) แบบ WGS84 — ต้องใช้เพราะ boundingVolume.box ของ Google อยู่ในระบบนี้ */
function toEcef(latDeg, lngDeg, h) {
  const phi = rad(latDeg);
  const lam = rad(lngDeg);
  const sinPhi = Math.sin(phi);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  return [
    (N + h) * Math.cos(phi) * Math.cos(lam),
    (N + h) * Math.cos(phi) * Math.sin(lam),
    (N * (1 - WGS84_E2) + h) * sinPhi,
  ];
}

/** box = [cx,cy,cz, ux,uy,uz, vx,vy,vz, wx,wy,wz] — center + เวกเตอร์ครึ่งแกน 3 ตัว (สเปก 3D Tiles) */
function boxContains(box, p) {
  if (!Array.isArray(box) || box.length < 12) return false;
  const d = [p[0] - box[0], p[1] - box[1], p[2] - box[2]];
  for (let a = 0; a < 3; a++) {
    const ax = box[3 + a * 3];
    const ay = box[4 + a * 3];
    const az = box[5 + a * 3];
    const dot = d[0] * ax + d[1] * ay + d[2] * az;
    const len2 = ax * ax + ay * ay + az * az;
    if (len2 === 0) return false;
    if (Math.abs(dot) > len2) return false; // |d·u| ต้องไม่เกิน |u|² จึงจะอยู่ในช่วงครึ่งแกนนั้น
  }
  return true;
}

/** region = [west, south, east, north, minH, maxH] หน่วยเรเดียน */
function regionContains(region, latRad, lngRad) {
  if (!Array.isArray(region) || region.length < 4) return false;
  const [west, south, east, north] = region;
  return lngRad >= west && lngRad <= east && latRad >= south && latRad <= north;
}

function volumeContains(tile, target) {
  const bv = tile?.boundingVolume;
  if (!bv) return false;
  if (bv.region) return regionContains(bv.region, target.latRad, target.lngRad);
  if (bv.box) return target.ecefs.some((p) => boxContains(bv.box, p));
  return false;
}

function buildUrl(uri, key, session) {
  const url = new URL(uri.startsWith("http") ? uri : BASE + (uri.startsWith("/") ? uri : "/" + uri));
  url.searchParams.set("key", key);
  if (session && !url.searchParams.has("session")) url.searchParams.set("session", session);
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 140)}`);
  return res.json();
}

function sessionFrom(uri) {
  const m = typeof uri === "string" ? /[?&]session=([^&]+)/.exec(uri) : null;
  return m ? m[1] : null;
}

// เพดานจำนวน sub-tileset ที่ยอมโหลดต่อการตรวจหนึ่งจุด — กันการไล่ทั้ง octree จนยิงคำขอไม่รู้จบ
const MAX_SUBTILESETS = 40;

async function probe(lat, lng, key) {
  const target = {
    latRad: rad(lat),
    lngRad: rad(lng),
    ecefs: TEST_HEIGHTS_M.map((h) => toEcef(lat, lng, h)),
  };

  const rootNode = (await fetchJson(`${BASE}/v1/3dtiles/root.json?key=${key}`)).root;
  if (!volumeContains(rootNode, target)) {
    return { depth: 0, glbTiles: 0, bestGeometricError: null, outsideRoot: true, subtilesetsFetched: 0 };
  }

  let session = null;
  let maxDepth = 0;
  let glbTiles = 0;
  let bestGeometricError = Infinity;
  let subtilesetsFetched = 0;

  // ไล่ทุกกิ่งที่ boundingVolume ครอบพิกัด (ไม่ใช่แค่กิ่งเดียว) — octree ของ Google มีกล่องซ้อนทับกัน
  // การเลือกกิ่งเดียวจะพลาดสาขาที่มีข้อมูลจริง ซึ่งเป็นสาเหตุที่จุดควบคุม (กรุงเทพฯ) ตกในรอบก่อน
  async function walk(node, depth) {
    if (depth > MAX_DEPTH || subtilesetsFetched > MAX_SUBTILESETS) return;
    if (depth > maxDepth) maxDepth = depth;

    const uri = node?.content?.uri;
    session = session ?? sessionFrom(uri);
    if (typeof uri === "string" && /\.glb(\?|$)/i.test(uri)) {
      glbTiles++;
      if (Number.isFinite(node.geometricError)) bestGeometricError = Math.min(bestGeometricError, node.geometricError);
    }
    if (typeof uri === "string" && /\.json(\?|$)/i.test(uri) && subtilesetsFetched < MAX_SUBTILESETS) {
      try {
        const sub = await fetchJson(buildUrl(uri, key, session));
        subtilesetsFetched++;
        const subRoot = sub.root ?? sub;
        if (volumeContains(subRoot, target)) await walk(subRoot, depth + 1);
      } catch {
        /* sub-tileset โหลดไม่ได้ — ข้ามกิ่งนี้ */
      }
    }

    for (const child of node?.children ?? []) {
      if (subtilesetsFetched > MAX_SUBTILESETS) return;
      if (volumeContains(child, target)) await walk(child, depth + 1);
    }
  }

  await walk(rootNode, 0);
  return {
    depth: maxDepth,
    glbTiles,
    bestGeometricError: Number.isFinite(bestGeometricError) ? bestGeometricError : null,
    outsideRoot: false,
    subtilesetsFetched,
  };
}

const SAMPLES = [
  { name: "[ควบคุม] สยามสแควร์ กรุงเทพฯ", lat: 13.7452, lng: 100.5342 },
  { name: "บ้านพญาไพร เชียงราย (แบบประเมิน 315)", lat: 20.321466, lng: 99.619007 },
  { name: "อ.กัลยาณิวัฒนา เชียงใหม่", lat: 19.0455, lng: 98.2686 },
  { name: "อ.บ่อเกลือ น่าน", lat: 19.1064, lng: 101.1636 },
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

for (const p of points) {
  console.log(`${p.name}  (${p.lat}, ${p.lng})`);
  try {
    const r = await probe(p.lat, p.lng, key);
    if (r.outsideRoot) {
      console.log("  ❌ พิกัดอยู่นอกขอบเขต root ของ tileset");
    } else if (r.depth === 0) {
      console.log("  ❌ ไม่มี child ใดครอบพิกัดนี้ → ไม่มี mesh 3D ที่จุดนี้");
    } else {
      const ge = Number.isFinite(r.bestGeometricError) ? `${Number(r.bestGeometricError).toFixed(1)} ม.` : "ไม่ทราบ";
      console.log(
        `  ลงลึกได้ ${r.depth} ชั้น · โหลด sub-tileset ${r.subtilesetsFetched} ครั้ง · tile ที่มี .glb = ${r.glbTiles}`,
      );
      console.log(`  geometricError ที่ละเอียดสุด ≈ ${ge}  (ยิ่งน้อย = mesh ยิ่งละเอียด)`);
      console.log(`  ${r.glbTiles > 0 ? "✅ มี mesh 3D จริงที่จุดนี้" : "⚠️ ไล่ลงได้แต่ยังไม่เจอ .glb"}`);
    }
  } catch (e) {
    console.log(`  ⚠️ ตรวจไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
  }
  console.log("");
}
