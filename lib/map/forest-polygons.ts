// ตัด polygon ชั้นป่าตามกรอบรอบจุดวิเคราะห์ ก่อนส่งให้ client วาด
// pure — ห้าม import cesium / next / node:fs (ทดสอบได้ด้วย node:test ล้วน)
//
// สเปก: docs/superpowers/specs/2026-08-08-forest-polygon-overlay-design.md

/** พิกัดหนึ่งจุด [lng, lat] — เรียงแบบเดียวกับไฟล์ cell และ GeoJSON */
export type LngLatPair = [number, number];

export interface LngLatBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface ForestPolygonFeature {
  rings: LngLatPair[][];
}

/** Cesium วาดรูปปิดไม่ได้ถ้ามีน้อยกว่า 4 จุด */
const MIN_RING_POINTS = 4;
/** 5 ตำแหน่ง ≈ 1.1 ม. — ละเอียดเกินพอสำหรับ overlay และลดขนาด payload ได้มาก */
const COORD_DECIMALS = 5;
const M_PER_DEG_LAT = 111_320;
/** กัน 1/cos ระเบิดใกล้ขั้วโลก (ไทยไม่เจอ แต่ฟังก์ชันต้องไม่คืนค่าอนันต์) */
const MIN_COS_LAT = 0.01;

function round5(value: number): number {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * กรอบสี่เหลี่ยมรอบจุด — ชดเชย cos(lat) ที่ลองจิจูด
 * อินพุตใช้ไม่ได้ (NaN / รัศมี ≤ 0) → null เพื่อให้ปลายทางตอบว่า "ไม่มีอะไรให้วาด" แทนการเดา
 */
export function boxAround(lat: number, lng: number, radiusM: number): LngLatBox | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!Number.isFinite(radiusM) || radiusM <= 0) return null;

  const dLat = radiusM / M_PER_DEG_LAT;
  const cos = Math.max(MIN_COS_LAT, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusM / (M_PER_DEG_LAT * cos);

  return { minLng: lng - dLng, minLat: lat - dLat, maxLng: lng + dLng, maxLat: lat + dLat };
}

function cleanRing(raw: unknown): LngLatPair[] | null {
  if (!Array.isArray(raw)) return null;
  const points: LngLatPair[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const lng = Number(entry[0]);
    const lat = Number(entry[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;
    points.push([round5(lng), round5(lat)]);
  }
  return points.length >= MIN_RING_POINTS ? points : null;
}

/**
 * กรอบของวงตัดกับกรอบที่ขอหรือไม่
 * ใช้กรอบตัดกรอบ ไม่ใช่ "มีจุดยอดอยู่ในกรอบ" — วงใหญ่ที่ครอบจุดวิเคราะห์ไว้ทั้งหมด
 * อาจไม่มีจุดยอดสักจุดอยู่ในรัศมี ซึ่งเป็นกรณีของโรงเรียนที่อยู่กลางผืนป่าใหญ่พอดี
 */
function ringTouchesBox(ring: readonly LngLatPair[], box: LngLatBox): boolean {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return !(maxLng < box.minLng || minLng > box.maxLng || maxLat < box.minLat || minLat > box.maxLat);
}

/**
 * กรองเฉพาะ polygon ที่แตะกรอบ แล้วคืนวงที่ทำความสะอาด + ปัดพิกัดแล้ว
 * เก็บ "ทั้งวง" ไม่ตัดกลางวงที่ขอบกรอบ — ตัดแล้วขอบผืนป่าจะกลายเป็นเส้นตรงปลอมตามกรอบ
 */
export function featuresInBox(
  features: readonly { rings?: unknown }[],
  box: LngLatBox | null,
): ForestPolygonFeature[] {
  if (!box || !Array.isArray(features)) return [];

  const out: ForestPolygonFeature[] = [];
  for (const feature of features) {
    const rawRings = Array.isArray(feature?.rings) ? feature.rings : [];
    const rings: LngLatPair[][] = [];
    for (const rawRing of rawRings) {
      const ring = cleanRing(rawRing);
      if (ring && ringTouchesBox(ring, box)) rings.push(ring);
    }
    if (rings.length > 0) out.push({ rings });
  }
  return out;
}
