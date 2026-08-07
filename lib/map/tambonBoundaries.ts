// ขอบเขตตำบล (ADM3) รอบจุดวิเคราะห์ — โหลดจากไฟล์นิ่งใน public/geo/tambon/
//
// ไฟล์ถูกสร้างไว้ล่วงหน้าโดย scripts/fetch-tambon-boundaries.mjs (COD-AB / RTSD ผ่าน OCHA)
// โมดูลนี้จึงมีหน้าที่แค่ "ตรวจไฟล์ที่โหลดมา + หาว่าจุดอยู่ตำบลใด" — ไม่คำนวณเรขาคณิตใหม่
// แนวทางเดียวกับ lib/map/borders.ts (client-safe ห้าม import cesium)
//
// ⚠️ ขอบเขตตำบล ≠ เขต อปท. ตำบลหนึ่งอาจถูกแบ่งระหว่างเทศบาลกับ อบต.
// ชั้นนี้ตอบได้ว่า "อยู่ตำบลใด" เท่านั้น ห้ามนำไปสรุปว่าอยู่ในเขตเทศบาลหรือเขต อบต.

import { pointInPolygon } from "./geometry";

export type LngLat = [number, number];

export interface TambonBoundary {
  name: string;
  amphoe: string;
  code: string;
  rings: LngLat[][];
}

export interface TambonProvinceDoc {
  attribution: string;
  province: string;
  provinceCode: string;
  tambons: TambonBoundary[];
}

export interface TambonProvinceIndexEntry {
  code: string;
  name: string;
  tambonCount: number;
  bbox: { north: number; south: number; west: number; east: number };
}

/** วงปิดต้องมีอย่างน้อย 4 จุดจึงจะวาดเป็นพื้นที่ได้ */
const MIN_RING_POINTS = 4;

function toLngLat(raw: unknown): LngLat | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lng = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

/**
 * ตรวจไฟล์จังหวัดที่โหลดมา — ทิ้งพิกัดที่ใช้ไม่ได้และวงที่สั้นเกินกว่าจะวาด
 * (Cesium ต้องไม่เจอ NaN — กติกาเดียวกับ parseSharedBorders)
 */
export function parseTambonProvince(raw: unknown): TambonProvinceDoc | null {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const province = typeof doc.province === "string" ? doc.province : "";
  const provinceCode = typeof doc.provinceCode === "string" ? doc.provinceCode : "";
  if (!province || !provinceCode) return null;

  const list = Array.isArray(doc.tambons) ? doc.tambons : [];
  const tambons = list.flatMap((entry): TambonBoundary[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "";
    if (!name) return [];
    const rings = (Array.isArray(item.rings) ? item.rings : []).flatMap((ring): LngLat[][] => {
      const points = (Array.isArray(ring) ? ring : []).map(toLngLat).filter((p): p is LngLat => p !== null);
      return points.length >= MIN_RING_POINTS ? [points] : [];
    });
    if (rings.length === 0) return [];
    return [
      {
        name,
        amphoe: typeof item.amphoe === "string" ? item.amphoe : "",
        code: typeof item.code === "string" ? item.code : "",
        rings,
      },
    ];
  });

  if (tambons.length === 0) return null;
  return {
    attribution: typeof doc.attribution === "string" ? doc.attribution : "",
    province,
    provinceCode,
    tambons,
  };
}

export function parseTambonIndex(raw: unknown): TambonProvinceIndexEntry[] {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(doc.provinces) ? doc.provinces : [];
  return list.flatMap((entry): TambonProvinceIndexEntry[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const code = typeof item.code === "string" ? item.code : "";
    const bbox = (item.bbox ?? {}) as Record<string, unknown>;
    // ตรวจว่าเป็นตัวเลขจริงก่อนแปลง — Number(null)/Number("") คืน 0 ซึ่งผ่าน isFinite
    // แล้วจะได้ bbox ที่ครอบพิกัด (0,0) กลางมหาสมุทร ทำให้เลือกไฟล์จังหวัดผิด
    const raws = [bbox.north, bbox.south, bbox.west, bbox.east];
    if (!code || raws.some((v) => typeof v !== "number" || !Number.isFinite(v))) return [];
    const nums = raws as number[];
    const [north, south, west, east] = nums;
    return [
      {
        code,
        name: typeof item.name === "string" ? item.name : "",
        tambonCount: Number.isFinite(Number(item.tambonCount)) ? Number(item.tambonCount) : 0,
        bbox: { north, south, west, east },
      },
    ];
  });
}

/**
 * จังหวัดที่ต้องโหลดสำหรับพิกัดหนึ่ง — เลือกจาก bbox ไม่ใช่ชื่อจังหวัด
 *
 * เลือกด้วย bbox เพราะชื่อจังหวัดที่แผนที่รู้มาจากคนละแหล่ง (ทะเบียนโรงเรียน/ศาลากลางใกล้สุด)
 * ซึ่งสะกดต่างจาก COD-AB ได้ และจุดใกล้รอยต่อจังหวัดต้องโหลดมากกว่าหนึ่งจังหวัดอยู่แล้ว
 */
export function provincesForPoint(
  index: readonly TambonProvinceIndexEntry[],
  lat: number,
  lng: number,
  paddingDeg = 0.05,
): TambonProvinceIndexEntry[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return index.filter(
    (p) =>
      lat >= p.bbox.south - paddingDeg &&
      lat <= p.bbox.north + paddingDeg &&
      lng >= p.bbox.west - paddingDeg &&
      lng <= p.bbox.east + paddingDeg,
  );
}

/** ตำบลที่มีจุดนี้อยู่ข้างใน — null = ไม่อยู่ในตำบลใดของชุดที่ส่งมา */
export function findTambonAt(tambons: readonly TambonBoundary[], lat: number, lng: number): TambonBoundary | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const tambon of tambons) {
    for (const ring of tambon.rings) {
      // geometry.ts ใช้ [lat,lng] ส่วนข้อมูลที่เก็บเป็น [lng,lat]
      if (
        pointInPolygon(
          [lat, lng],
          ring.map(([lng2, lat2]) => [lat2, lng2]),
        )
      )
        return tambon;
    }
  }
  return null;
}

const TAMBON_BASE = "/geo/tambon";

let indexCache: TambonProvinceIndexEntry[] | null = null;
const provinceCache = new Map<string, TambonProvinceDoc | null>();

export async function loadTambonIndex(signal?: AbortSignal): Promise<TambonProvinceIndexEntry[]> {
  if (indexCache) return indexCache;
  const response = await fetch(`${TAMBON_BASE}/index.json`, { signal });
  if (!response.ok) throw new Error(`โหลดดัชนีขอบเขตตำบลไม่สำเร็จ (HTTP ${response.status})`);
  indexCache = parseTambonIndex(await response.json());
  return indexCache;
}

export async function loadTambonProvince(code: string, signal?: AbortSignal): Promise<TambonProvinceDoc | null> {
  if (provinceCache.has(code)) return provinceCache.get(code) ?? null;
  const response = await fetch(`${TAMBON_BASE}/${encodeURIComponent(code)}.json`, { signal });
  if (!response.ok) throw new Error(`โหลดขอบเขตตำบล ${code} ไม่สำเร็จ (HTTP ${response.status})`);
  const doc = parseTambonProvince(await response.json());
  provinceCache.set(code, doc);
  return doc;
}
