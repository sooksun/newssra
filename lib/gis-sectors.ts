// จุดสูงสุด/ต่ำสุดของภูมิประเทศราย 8 ทิศ ในรัศมีรอบจุดที่ตั้งโรงเรียน
// pure / framework-free — ใช้ร่วมกันทั้ง client (วาดธงบนแผนที่) และ server (validate + คำนวณค่าที่ derive ได้ใหม่)
// นำเข้าได้เฉพาะ type และคณิตศาสตร์บริสุทธิ์ ห้าม import cesium / next / node API / lib/scoring.ts
//
// หลักการเดียวกับส่วน GIS อื่น: client ส่งได้เฉพาะ "ค่าดิบ" (พิกัด + ความสูงที่สุ่มจากเบราว์เซอร์)
// ส่วน relief / ส่วนต่างจากโรงเรียน / ถึงเกณฑ์ K server คำนวณใหม่เสมอ

import type { Bbox } from "./map/morphology";
import type { GisSectorConfig, GisSectorElevation, GisSectorKey, GisSectorPoint } from "./types";
import { SECTOR_KEYS } from "./types";

/** รัศมีวิเคราะห์รอบจุดที่ตั้ง (ม.) — แก้ค่าที่นี่ที่เดียว ห้าม hardcode ซ้ำที่อื่น */
export const SECTOR_RADIUS_M = 1000;

/** ค่า K (ม.): จุดที่ต่างจากความสูงโรงเรียนไม่ถึง ±K จะไม่ปักธงบนแผนที่ (ถือว่าราบจนไม่มีนัย)
 *  มีผลกับการแสดงผลเท่านั้น — ค่ายังถูกบันทึกครบทุกจุด และไม่มีผลต่อคะแนน 100 คะแนนทางการ */
export const SECTOR_RELIEF_K_M = 50;

/** ช่วงความสูงที่ยอมรับ (ม.) — ต้องตรงกับ GIS_LIMITS.elevationM ใน lib/gis.ts เสมอ
 *  ประกาศซ้ำที่นี่แทนการ import เพื่อไม่ให้เกิด import วนกัน (lib/gis.ts เรียกโมดูลนี้)
 *  — lib/gis-sectors.test.ts บังคับให้สองค่านี้เท่ากันตลอด */
const ELEVATION_RANGE_M = { min: -500, max: 9000 } as const;

/** ขอบ wedge: 45° ต่อทิศ โดยมีทิศนั้นอยู่กึ่งกลาง (N = 337.5°–22.5°) */
const SECTOR_ARC_DEG = 360 / SECTOR_KEYS.length;

export const SECTOR_LABELS_TH: Record<GisSectorKey, string> = {
  N: "เหนือ",
  NE: "ตะวันออกเฉียงเหนือ",
  E: "ตะวันออก",
  SE: "ตะวันออกเฉียงใต้",
  S: "ใต้",
  SW: "ตะวันตกเฉียงใต้",
  W: "ตะวันตก",
  NW: "ตะวันตกเฉียงเหนือ",
};

/** ข้อความบนป้ายธง (แยกบรรทัด) — ค่าที่เป็น null ไม่ขึ้นบรรทัดนั้น ไม่แทนด้วย 0 */
export function sectorFlagLines(title: string, point: GisSectorPoint, reliefM: number | null): string[] {
  const lines = [title];
  const delta =
    point.deltaFromSchoolM === null
      ? ""
      : ` (${point.deltaFromSchoolM >= 0 ? "+" : "−"}${Math.abs(point.deltaFromSchoolM).toLocaleString("th-TH")} ม.)`;
  lines.push(`${Math.round(point.elevationM).toLocaleString("th-TH")} ม.${delta}`);
  if (reliefM !== null) lines.push(`ต่างในทิศ ${Math.round(reliefM).toLocaleString("th-TH")} ม.`);
  return lines;
}

/** ทิศของ bearing (องศา 0=เหนือ วนตามเข็ม) — ขอบนับแบบ [ล่าง, บน) จึงไม่มีเซลล์ตกสองทิศหรือหลุดทั้งคู่ */
export function sectorForBearing(bearingDeg: number): GisSectorKey {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  const index = Math.floor((normalized + SECTOR_ARC_DEG / 2) / SECTOR_ARC_DEG) % SECTOR_KEYS.length;
  return SECTOR_KEYS[index];
}

function emptySector(sector: GisSectorKey): GisSectorElevation {
  return { sector, highest: null, lowest: null, reliefM: null, aboveThreshold: false };
}

function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLng(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function inElevationRange(value: number): boolean {
  return value >= ELEVATION_RANGE_M.min && value <= ELEVATION_RANGE_M.max;
}

export interface SectorScanOptions {
  radiusM: number;
  /** ความสูงของโรงเรียนที่ใช้อ้างอิงส่วนต่าง — null = ไม่รู้ (deltaFromSchoolM จะเป็น null ทุกจุด) */
  schoolElevationM: number | null;
  thresholdM: number;
}

/**
 * สแกนกริดความสูง (row 0 = เหนือสุด, col 0 = ตะวันตกสุด) หาจุดสูงสุด/ต่ำสุดของแต่ละทิศ
 *
 * - ตัดเซลล์ที่ระยะจากจุดกึ่งกลาง > radiusM (วงกลมจริง ไม่ใช่กรอบสี่เหลี่ยม)
 * - ข้ามเซลล์ที่ค่าไม่ finite (สุ่ม terrain ไม่สำเร็จ) — ห้ามแทนด้วย 0
 * - เซลล์กึ่งกลางพอดีไม่นับเข้าทิศใด (ระยะ 0 ไม่มีทิศ)
 *
 * คืนครบ 8 ทิศเสมอ ทิศที่ไม่มีเซลล์ใช้ได้เลยจะมี highest/lowest/reliefM = null
 */
export function sectorElevationsFromGrid(
  grid: Float32Array | number[],
  n: number,
  widthM: number,
  bbox: Bbox,
  options: SectorScanOptions,
): GisSectorElevation[] {
  const sectors = new Map<GisSectorKey, GisSectorElevation>(SECTOR_KEYS.map((key) => [key, emptySector(key)]));
  if (!Number.isInteger(n) || n < 2 || !Number.isFinite(widthM) || widthM <= 0) {
    return SECTOR_KEYS.map((key) => sectors.get(key) as GisSectorElevation);
  }

  const cellM = widthM / (n - 1);
  const center = (n - 1) / 2;
  const radiusSq = options.radiusM * options.radiusM;

  for (let row = 0; row < n; row += 1) {
    // แกนเหนือ-ใต้: row เพิ่ม = ลงใต้ → ระยะทางเหนือเป็นบวกเมื่อ row < center
    const northM = (center - row) * cellM;
    for (let col = 0; col < n; col += 1) {
      const eastM = (col - center) * cellM;
      const distSq = northM * northM + eastM * eastM;
      if (distSq > radiusSq || distSq === 0) continue;

      const elevationM = grid[row * n + col];
      if (!Number.isFinite(elevationM)) continue;

      const bearingDeg = (Math.atan2(eastM, northM) * 180) / Math.PI;
      const key = sectorForBearing(bearingDeg);
      const current = sectors.get(key) as GisSectorElevation;
      const point: GisSectorPoint = {
        lat: bbox.north + ((bbox.south - bbox.north) * row) / (n - 1),
        lng: bbox.west + ((bbox.east - bbox.west) * col) / (n - 1),
        elevationM,
        deltaFromSchoolM: null,
        meetsThreshold: false,
      };
      if (!current.highest || elevationM > current.highest.elevationM) current.highest = point;
      if (!current.lowest || elevationM < current.lowest.elevationM) current.lowest = point;
    }
  }

  return deriveSectorMetrics(
    SECTOR_KEYS.map((key) => sectors.get(key) as GisSectorElevation),
    options.schoolElevationM,
    options.thresholdM,
  );
}

function derivePoint(
  point: GisSectorPoint | null,
  schoolElevationM: number | null,
  thresholdM: number,
): GisSectorPoint | null {
  if (!point) return null;
  const elevationM = Math.round(point.elevationM);
  const deltaFromSchoolM = schoolElevationM === null ? null : elevationM - Math.round(schoolElevationM);
  return {
    lat: point.lat,
    lng: point.lng,
    elevationM,
    deltaFromSchoolM,
    // เกณฑ์ K วัดจาก "ต่างจากความสูงโรงเรียน" ทั้งสองทาง (+K หรือ −K) จึงใช้ค่าสัมบูรณ์
    meetsThreshold: deltaFromSchoolM !== null && Math.abs(deltaFromSchoolM) >= thresholdM,
  };
}

/**
 * ปักธงจุดนี้บนแผนที่หรือไม่ — จุดที่ต่างจากโรงเรียนไม่ถึง ±K ไม่ปัก (ภูมิประเทศราบพอจนไม่มีนัย)
 *
 * ไม่รู้ความสูงโรงเรียน (deltaFromSchoolM = null) → ยังปัก เพราะยังพิสูจน์ไม่ได้ว่าต่ำกว่าเกณฑ์
 * การซ่อนโดยไม่มีฐานให้ตัดสินจะทำให้ผู้ใช้เข้าใจว่า "ตรงนั้นราบ" ทั้งที่แค่อ่านค่าอ้างอิงไม่ได้
 */
export function sectorFlagVisible(point: GisSectorPoint | null): boolean {
  if (!point) return false;
  return point.deltaFromSchoolM === null || point.meetsThreshold;
}

/**
 * คำนวณค่าที่ derive ได้ทั้งหมดใหม่จากค่าดิบ (พิกัด + ความสูงของจุดสูงสุด/ต่ำสุด)
 * server เรียกฟังก์ชันนี้เสมอ ไม่ว่า client จะส่ง reliefM/deltaFromSchoolM/meetsThreshold มาหรือไม่
 */
export function deriveSectorMetrics(
  sectors: readonly GisSectorElevation[],
  schoolElevationM: number | null,
  thresholdM: number,
): GisSectorElevation[] {
  return sectors.map((sector) => {
    const highest = derivePoint(sector.highest, schoolElevationM, thresholdM);
    const lowest = derivePoint(sector.lowest, schoolElevationM, thresholdM);
    const reliefM = highest && lowest ? highest.elevationM - lowest.elevationM : null;
    return {
      sector: sector.sector,
      highest,
      lowest,
      reliefM,
      // ทิศนี้มีธงขึ้นอย่างน้อยหนึ่งอันหรือไม่ (สรุปจากเกณฑ์รายจุด ไม่ใช่จาก relief)
      aboveThreshold: Boolean(highest?.meetsThreshold) || Boolean(lowest?.meetsThreshold),
    };
  });
}

function cleanPoint(value: unknown): GisSectorPoint | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (!isValidLat(p.lat) || !isValidLng(p.lng)) return null;
  if (typeof p.elevationM !== "number" || !Number.isFinite(p.elevationM) || !inElevationRange(p.elevationM))
    return null;
  // deltaFromSchoolM / meetsThreshold ไม่รับจากค่าดิบ — deriveSectorMetrics เป็นผู้คำนวณเสมอ
  return { lat: p.lat, lng: p.lng, elevationM: p.elevationM, deltaFromSchoolM: null, meetsThreshold: false };
}

/**
 * ตรวจค่าดิบจาก client / DB → รายการทิศที่ใช้ได้ (ค่าที่ derive ได้ถูกคำนวณใหม่ทั้งหมด)
 * - ทิศนอกรายการ SECTOR_KEYS หรือทิศซ้ำ → ทิ้งรายการนั้น
 * - จุดที่พิกัด/ความสูงใช้ไม่ได้ → ทิ้งเฉพาะจุดนั้น (ไม่แทนด้วยค่าสมมติ)
 * - ไม่เหลือทิศที่มีข้อมูลเลย → undefined เพื่อให้แถวเก่าไม่งอก key นี้
 */
export function cleanSectorElevations(
  value: unknown,
  schoolElevationM: number | null,
  thresholdM: number,
): GisSectorElevation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<GisSectorKey>();
  const out: GisSectorElevation[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const sector = raw.sector as GisSectorKey;
    if (!SECTOR_KEYS.includes(sector) || seen.has(sector)) continue;
    seen.add(sector);
    out.push({
      sector,
      highest: cleanPoint(raw.highest),
      lowest: cleanPoint(raw.lowest),
      reliefM: null,
      aboveThreshold: false,
    });
  }

  if (!out.some((sector) => sector.highest || sector.lowest)) return undefined;
  // เรียงตามลำดับทิศมาตรฐานเสมอ เพื่อให้ตาราง/JSON ที่บันทึกอ่านเทียบกันได้ข้ามแถว
  out.sort((a, b) => SECTOR_KEYS.indexOf(a.sector) - SECTOR_KEYS.indexOf(b.sector));
  return deriveSectorMetrics(out, schoolElevationM, thresholdM);
}

/** ตรวจ config ที่อ่านกลับจาก DB — ค่าที่ใช้ไม่ได้ถอยไปใช้ค่าคงที่ปัจจุบัน (ยังอ่านตารางได้ ไม่ทิ้งข้อมูล) */
export function cleanSectorConfig(value: unknown): GisSectorConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const c = value as Record<string, unknown>;
  const radiusM = typeof c.radiusM === "number" && Number.isFinite(c.radiusM) && c.radiusM > 0 ? c.radiusM : null;
  const thresholdM =
    typeof c.thresholdM === "number" && Number.isFinite(c.thresholdM) && c.thresholdM >= 0 ? c.thresholdM : null;
  const school =
    typeof c.schoolElevationM === "number" &&
    Number.isFinite(c.schoolElevationM) &&
    inElevationRange(c.schoolElevationM)
      ? Math.round(c.schoolElevationM)
      : null;
  return {
    radiusM: radiusM ?? SECTOR_RADIUS_M,
    thresholdM: thresholdM ?? SECTOR_RELIEF_K_M,
    schoolElevationM: school,
    schoolElevationSource: c.schoolElevationSource === "grid-center" ? "grid-center" : "route-profile",
  };
}
