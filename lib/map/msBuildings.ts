// ดึงผังอาคาร (building footprints) จาก Microsoft Global ML Building Footprints — ฟรี ไม่ต้องมี API key
// ที่มา: https://github.com/microsoft/GlobalMLBuildingFootprints
// server-only (ใช้ node:zlib/node:stream + mysql) — ห้าม import จาก client component
//
// โครงสร้างข้อมูลต้นทาง: แบ่งไฟล์ตาม quadkey (Bing tiling, zoom 9) แต่ละไฟล์คือ gzip ของ
// GeoJSON-Lines (1 บรรทัด = 1 Feature รูปหลายเหลี่ยมอาคาร) ไม่มี spatial index ภายในไฟล์
// จึงต้องสตรีมอ่านทั้งไฟล์ (~20 วิ ถึง ~2 นาที ต่อ quadkey ขึ้นกับความหนาแน่น)
//
// สถาปัตยกรรมความเร็ว (v2): "สตรีมครั้งเดียว → เก็บถาวรใน MySQL → คำขอถัดไปตอบจาก SQL ใน ~ร้อย ms"
//   - ตาราง map_buildings (จุดศูนย์กลาง + พื้นที่ + ความสูง, index (quadkey, lat)) + map_buildings_meta (quadkey ที่นำเข้าแล้ว)
//   - ทนต่อการรีสตาร์ต (ต่างจาก cache ใน memory เดิมที่หายทุกครั้ง) และแชร์ข้ามโปรเซส
//   - รูปอาคารที่ส่งกลับสังเคราะห์เป็นสี่เหลี่ยมจาก area_m2 (เก็บ ring จริง 8M+ อาคารจะกินหลาย GB โดยไม่จำเป็น
//     เพราะเครื่องมือนี้ใช้ "นับอาคาร→ประมาณประชากร" จุดศูนย์กลาง+ขนาดพอแล้ว)
//   - bbox ที่คร่อมรอยต่อ tile จะดึงทุก quadkey ที่เกี่ยว (สูงสุด 4) — แก้ bug เดิมที่นับตกขอบ tile ด้วย
//   - pre-warm ทั้งประเทศล่วงหน้า: npm run buildings:import (ดู scripts/import-buildings.ts)
//   - DB ใช้ไม่ได้ (เช่น สิทธิ์ไม่พอ) → fallback เส้นทางเดิม (สตรีม + cache ใน memory ต่อโปรเซส)

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import readline from "node:readline";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import type { Pool } from "mysql2/promise";
import { getPool } from "../db";
import { pointInPolygon } from "./geometry";

const DATASET_INDEX_URL = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv";
const INDEX_TTL_MS = 24 * 60 * 60 * 1000; // รีเฟรชดัชนีทุก 24 ชม.
const QUADKEY_ZOOM = 9;
const MAX_CACHED_QUADKEYS = 20; // (เส้นทาง fallback) กันหน่วยความจำบวมถ้ามีหลาย quadkey ถูกเรียกสะสม
const MAX_RETURNED_BUILDINGS = 3000;
const INSERT_BATCH_SIZE = 2000; // จำนวนแถวต่อหนึ่ง bulk INSERT ตอนนำเข้า

export interface BuildingFeature {
  lat: number;
  lng: number; // จุดศูนย์กลางโดยประมาณ (สำหรับกรอง/เรียงตามระยะทาง)
  ring: [number, number][]; // พิกัด [lng, lat] ของขอบอาคาร (จาก DB = สี่เหลี่ยมสังเคราะห์ตามพื้นที่จริงของอาคาร)
}

export interface BuildingFootprintsResult {
  features: BuildingFeature[];
  truncated: boolean;
  quadkey: string;
  // จำนวนอาคารสะสมในแต่ละรัศมี (ระบุผ่าน ringRadiiM) — นับจากอาคารในรัศมีทั้งหมด "ก่อน" ตัดด้วย MAX_RETURNED_BUILDINGS
  ringCounts: { radiusM: number; buildingCount: number }[];
  // จำนวนอาคารจริงในรูปที่วาด (point-in-polygon) — นับจากชุดเต็ม "ก่อน" ตัดด้วย MAX_RETURNED_BUILDINGS
  // (features ที่ส่งกลับถูกจำกัดจำนวนเพื่อ render จึงนับเองฝั่ง client ต่ำกว่าจริงในพื้นที่หนาแน่น); null = ไม่ได้ส่ง polygon มา
  polygonCount: number | null;
}

interface DatasetIndexEntry {
  location: string;
  quadkey: string;
  url: string;
}

let indexCache: { entries: DatasetIndexEntry[]; fetchedAt: number } | null = null;

async function loadDatasetIndex(): Promise<DatasetIndexEntry[]> {
  if (indexCache && Date.now() - indexCache.fetchedAt < INDEX_TTL_MS) return indexCache.entries;
  const res = await fetch(DATASET_INDEX_URL);
  if (!res.ok) throw new Error(`โหลดดัชนี Microsoft Building Footprints ไม่สำเร็จ (HTTP ${res.status})`);
  const text = await res.text();
  const lines = text.split("\n").slice(1); // ข้าม header: Location,QuadKey,Url,Size,UploadDate
  const entries: DatasetIndexEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    entries.push({ location: parts[0], quadkey: parts[1], url: parts[2] });
  }
  indexCache = { entries, fetchedAt: Date.now() };
  return entries;
}

/** quadkey ทั้งหมดของประเทศไทยจากดัชนี Microsoft — ใช้โดย scripts/import-buildings.ts (pre-warm ทั้งประเทศ) */
export async function listThailandQuadkeys(): Promise<string[]> {
  const index = await loadDatasetIndex();
  return [...new Set(index.filter((e) => e.location === "Thailand").map((e) => e.quadkey))].sort();
}

function tileXY(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function tileToQuadKey(x: number, y: number, z: number): string {
  let quadKey = "";
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    quadKey += digit;
  }
  return quadKey;
}

/** quadkey ทุกอันที่ bbox (จุดกลาง±รัศมี) คาบเกี่ยว — สูงสุด 4 อันที่ z9 สำหรับรัศมี ≤5 กม. (แก้การนับตกขอบ tile) */
function quadkeysForBbox(lat: number, lng: number, radiusM: number): string[] {
  const dLat = radiusM / 110540;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const a = tileXY(lat + dLat, lng - dLng, QUADKEY_ZOOM); // มุมบนซ้าย (y เล็ก)
  const b = tileXY(lat - dLat, lng + dLng, QUADKEY_ZOOM); // มุมล่างขวา (y ใหญ่)
  const keys: string[] = [];
  for (let x = a.x; x <= b.x; x++) {
    for (let y = a.y; y <= b.y; y++) keys.push(tileToQuadKey(x, y, QUADKEY_ZOOM));
  }
  return keys;
}

// ── ตัวแยกวิเคราะห์สตรีม (ใช้ร่วมทั้งเส้นทาง DB และ fallback) ─────────────────────────

interface ParsedBuilding {
  lat: number;
  lng: number;
  areaM2: number;
  heightM: number | null;
  ring: [number, number][];
}

/** พื้นที่รูปหลายเหลี่ยม (ตร.ม.) แบบ equirectangular รอบ centroid — พอเพียงสำหรับอาคารขนาดเล็ก */
function ringAreaM2(ring: [number, number][], lat0: number): number {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(sum) / 2;
}

/** สตรีมอ่านไฟล์ gzip GeoJSON-Lines หนึ่งไฟล์ เรียก onBatch ทุก ๆ INSERT_BATCH_SIZE อาคาร (ไม่สะสมทั้งไฟล์ในหน่วยความจำ) */
async function streamQuadkeyFile(url: string, onBatch: (batch: ParsedBuilding[]) => Promise<void>): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) return;
  const nodeStream = Readable.fromWeb(res.body as NodeWebReadableStream<Uint8Array>);
  const gunzip = createGunzip();
  const rl = readline.createInterface({ input: nodeStream.pipe(gunzip) });
  let batch: ParsedBuilding[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const feature = JSON.parse(line) as {
        geometry?: { coordinates?: [number, number][][] };
        properties?: { height?: number };
      };
      const ring = feature.geometry?.coordinates?.[0];
      if (!ring || ring.length < 3) continue;
      let sx = 0;
      let sy = 0;
      for (const [x, y] of ring) {
        sx += x;
        sy += y;
      }
      const lng = sx / ring.length;
      const lat = sy / ring.length;
      const h = feature.properties?.height;
      batch.push({
        lat,
        lng,
        areaM2: Math.round(ringAreaM2(ring, lat) * 100) / 100,
        heightM: typeof h === "number" && h > 0 ? h : null, // MS ใช้ -1 = ไม่ทราบ
        ring,
      });
      if (batch.length >= INSERT_BATCH_SIZE) {
        await onBatch(batch);
        batch = [];
      }
    } catch {
      // แถวเสีย/parse ไม่ได้ — ข้ามแถวนั้น ไม่ทำให้ไฟล์ทั้งก้อนล้ม
    }
  }
  if (batch.length) await onBatch(batch);
}

// ── ชั้นเก็บถาวรใน MySQL ────────────────────────────────────────────────────────

const BUILDINGS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS map_buildings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quadkey VARCHAR(12) NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  area_m2 DOUBLE NOT NULL DEFAULT 0,
  height_m DOUBLE NULL,
  PRIMARY KEY (id),
  KEY idx_qk_lat (quadkey, lat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const BUILDINGS_META_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS map_buildings_meta (
  quadkey VARCHAR(12) NOT NULL,
  building_count INT UNSIGNED NOT NULL DEFAULT 0,
  imported_at VARCHAR(40) NOT NULL DEFAULT '',
  PRIMARY KEY (quadkey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

let tablesReady: Promise<Pool> | null = null;

/** สร้างตารางเก็บถาวร (idempotent) แล้วคืน pool — โยน error ถ้า DB ใช้ไม่ได้ (ผู้เรียกจะ fallback) */
function ensureBuildingTables(): Promise<Pool> {
  if (!tablesReady) {
    tablesReady = (async () => {
      const pool = await getPool();
      await pool.query(BUILDINGS_SCHEMA_SQL);
      await pool.query(BUILDINGS_META_SCHEMA_SQL);
      return pool;
    })();
    tablesReady.catch(() => {
      tablesReady = null; // ให้ลองใหม่คำขอถัดไป (เช่น เพิ่งเปิด MySQL ทีหลัง)
    });
  }
  return tablesReady;
}

// กันนำเข้า quadkey เดียวกันพร้อมกันหลายคำขอในโปรเซสเดียว (ข้ามโปรเซสมี DELETE-ก่อน-INSERT เป็น idempotency)
const importPromises = new Map<string, Promise<void>>();

/** นำเข้าอาคารทั้ง quadkey ลง MySQL (สตรีม + bulk INSERT เป็นชุด) — จ่ายราคาแพงครั้งเดียวต่อ quadkey ตลอดชีพ
 *  คืนจำนวนอาคารที่นำเข้า; quadkey ที่ไม่มีไฟล์ในดัชนี (เช่น ทะเล) จะถูกบันทึก meta = 0 เพื่อไม่ให้ลองซ้ำ */
export async function importQuadkeyToDb(quadkey: string, log?: (msg: string) => void): Promise<number> {
  const pool = await ensureBuildingTables();
  const index = await loadDatasetIndex();
  const matches = index.filter((e) => e.quadkey === quadkey);

  // เริ่มจากลบของเดิมของ quadkey นี้ (ถ้ามี) — ทำให้การนำเข้าซ้ำ/นำเข้าที่เคยพังกลางคัน idempotent
  await pool.query("DELETE FROM map_buildings WHERE quadkey = ?", [quadkey]);

  let total = 0;
  for (const match of matches) {
    await streamQuadkeyFile(match.url, async (batch) => {
      const values = batch.map((b) => [quadkey, b.lat, b.lng, b.areaM2, b.heightM]);
      await pool.query("INSERT INTO map_buildings (quadkey, lat, lng, area_m2, height_m) VALUES ?", [values]);
      total += batch.length;
      log?.(`  ${quadkey}: ${total.toLocaleString()} อาคาร…`);
    });
  }

  await pool.query(
    `INSERT INTO map_buildings_meta (quadkey, building_count, imported_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE building_count = VALUES(building_count), imported_at = VALUES(imported_at)`,
    [quadkey, total, new Date().toISOString()],
  );
  return total;
}

/** ให้แน่ใจว่า quadkey นำเข้าแล้ว (มีใน meta) — คำขอพร้อมกันสำหรับ quadkey ใหม่เดียวกันแชร์ promise เดียว */
async function ensureQuadkeyImported(pool: Pool, quadkey: string): Promise<void> {
  const [rows] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
    "SELECT quadkey FROM map_buildings_meta WHERE quadkey = ? LIMIT 1",
    [quadkey],
  );
  if (rows.length) return;

  let promise = importPromises.get(quadkey);
  if (!promise) {
    promise = importQuadkeyToDb(quadkey).then(() => undefined);
    importPromises.set(quadkey, promise);
    promise.finally(() => importPromises.delete(quadkey));
  }
  await promise;
}

/** สังเคราะห์ขอบสี่เหลี่ยมจากพื้นที่จริงของอาคาร (ใช้วาดบนแผนที่ — จุดศูนย์กลาง/การนับไม่กระทบ) */
function syntheticRing(lat: number, lng: number, areaM2: number): [number, number][] {
  const half = Math.max(Math.sqrt(Math.max(areaM2, 36)), 6) / 2; // ขั้นต่ำ 6x6 ม. ให้มองเห็นบนแผนที่
  const dLat = half / 110540;
  const dLng = half / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
  ];
}

// ── เส้นทาง fallback (DB ใช้ไม่ได้): สตรีม + cache ใน memory ต่อโปรเซส — พฤติกรรมเดิมก่อน v2 ──

const quadkeyCache = new Map<string, Promise<ParsedBuilding[]>>();
const quadkeyCacheOrder: string[] = [];

function loadQuadkeyBuildingsInMemory(quadkey: string): Promise<ParsedBuilding[]> {
  const cached = quadkeyCache.get(quadkey);
  if (cached) return cached;

  const promise = (async () => {
    const index = await loadDatasetIndex();
    const matches = index.filter((e) => e.quadkey === quadkey);
    const features: ParsedBuilding[] = [];
    for (const match of matches) {
      await streamQuadkeyFile(match.url, async (batch) => {
        features.push(...batch);
      });
    }
    return features;
  })();

  quadkeyCache.set(quadkey, promise);
  quadkeyCacheOrder.push(quadkey);
  if (quadkeyCacheOrder.length > MAX_CACHED_QUADKEYS) {
    const evict = quadkeyCacheOrder.shift();
    if (evict) quadkeyCache.delete(evict);
  }
  promise.catch(() => {
    quadkeyCache.delete(quadkey);
    const idx = quadkeyCacheOrder.indexOf(quadkey);
    if (idx !== -1) quadkeyCacheOrder.splice(idx, 1);
  });

  return promise;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface Candidate {
  lat: number;
  lng: number;
  areaM2: number;
  ring: [number, number][] | null; // null = สังเคราะห์ตอนส่งออก (เส้นทาง DB)
  d: number;
}

/** ดึงผังอาคารรอบจุดที่กำหนด ภายในรัศมี radiusM (เมตร)
 *  เส้นทางหลัก: MySQL (เร็ว ~ร้อย ms, ทนรีสตาร์ต) — quadkey ที่ยังไม่เคยนำเข้าจะจ่ายราคาสตรีมครั้งเดียวตลอดชีพ
 *  (pre-warm ทั้งประเทศ: npm run buildings:import) — DB ใช้ไม่ได้ → fallback สตรีม + cache ใน memory แบบเดิม */
export async function fetchBuildingFootprints(
  lat: number,
  lng: number,
  radiusM: number,
  ringRadiiM: number[] = [],
  polygon: [number, number][] = [],
): Promise<BuildingFootprintsResult> {
  const centerQuadkey = tileToQuadKey(tileXY(lat, lng, QUADKEY_ZOOM).x, tileXY(lat, lng, QUADKEY_ZOOM).y, QUADKEY_ZOOM);
  const dLat = radiusM / 110540;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));

  let candidates: Candidate[];
  try {
    // ── เส้นทางหลัก: DB ──
    const pool = await ensureBuildingTables();
    const quadkeys = quadkeysForBbox(lat, lng, radiusM);
    for (const qk of quadkeys) await ensureQuadkeyImported(pool, qk);

    const [rows] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
      `SELECT lat, lng, area_m2 FROM map_buildings
        WHERE quadkey IN (?) AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
      [quadkeys, lat - dLat, lat + dLat, lng - dLng, lng + dLng],
    );
    candidates = rows
      .map((r) => ({
        lat: r.lat as number,
        lng: r.lng as number,
        areaM2: r.area_m2 as number,
        ring: null,
        d: haversineM(lat, lng, r.lat, r.lng),
      }))
      .filter((c) => c.d <= radiusM);
  } catch (error) {
    // ── fallback: DB ใช้ไม่ได้ — สตรีม quadkey กลาง + cache ใน memory (พฤติกรรมเดิม) ──
    console.warn(
      "[buildings] DB path unavailable, falling back to streaming:",
      error instanceof Error ? error.message : error,
    );
    const all = await loadQuadkeyBuildingsInMemory(centerQuadkey);
    candidates = all
      .map((b) => ({ lat: b.lat, lng: b.lng, areaM2: b.areaM2, ring: b.ring, d: haversineM(lat, lng, b.lat, b.lng) }))
      .filter((c) => c.d <= radiusM);
  }

  candidates.sort((a, b) => a.d - b.d);

  // นับจำนวนอาคารต่อรัศมีจากผู้สมัครทั้งหมด "ก่อน" ตัดด้วย MAX_RETURNED_BUILDINGS —
  // กันปัญหานับต่ำกว่าจริงในพื้นที่หนาแน่นที่มีอาคารเกินจำนวนที่ส่งไป render บนแผนที่
  const ringCounts = ringRadiiM.map((r) => ({
    radiusM: r,
    buildingCount: candidates.filter((c) => c.d <= r).length,
  }));

  // นับอาคารในรูปที่วาดจากชุดเต็ม (เช่นเดียวกับ ringCounts) — ต้องนับ"ก่อน"ตัดด้วย MAX_RETURNED_BUILDINGS
  // ไม่งั้นพื้นที่เมืองหนาแน่นจะถูกนับตันที่ 3000 แล้วจำแนกเป็นชนบทผิด ๆ
  const polygonCount =
    polygon.length >= 3 ? candidates.filter((c) => pointInPolygon([c.lat, c.lng], polygon)).length : null;

  const truncated = candidates.length > MAX_RETURNED_BUILDINGS;
  const features: BuildingFeature[] = candidates.slice(0, MAX_RETURNED_BUILDINGS).map((c) => ({
    lat: c.lat,
    lng: c.lng,
    ring: c.ring ?? syntheticRing(c.lat, c.lng, c.areaM2),
  }));
  return { features, truncated, quadkey: centerQuadkey, ringCounts, polygonCount };
}
