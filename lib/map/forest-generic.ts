// ป่าทั่วไปจาก OpenStreetMap (natural=wood / landuse=forest) — overlay สำหรับ "ดู" เท่านั้น
//
// แยกจาก lib/map/forestBoundaries.ts โดยเจตนา ไม่ใช่เพื่อจัดระเบียบไฟล์:
// ผลของ classifyForestOverlay() ในไฟล์นั้นถูกเก็บเป็นหลักฐานประกอบเกณฑ์ (gis.forestOverlay)
// ป่าทั่วไปใน OSM ไม่ใช่เขตประกาศและไม่ใช่ชั้นสภาพป่าราชการ ถ้าปนเข้าไปจะกลายเป็นหลักฐานปลอม
//
// ข้อมูล ODbL 1.0 — หน้าที่แสดงผลต้องขึ้นเครดิต "© OpenStreetMap contributors"
// สเปก: docs/superpowers/specs/2026-08-08-forest-polygon-overlay-design.md

import { OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_MS } from "./forestBoundaries";

/** วง [lng, lat][] — ไม่มีชื่อ ไม่มีชนิด เพราะ OSM ป่าทั่วไปส่วนใหญ่ไม่มีแท็กชื่อ */
export interface GenericForestArea {
  rings: [number, number][][];
}

export const GENERIC_FOREST_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

const MIN_RING_POINTS = 4;
const CACHE_LIMIT = 20;
const cache = new Map<string, GenericForestArea[]>();

function cacheKey(lat: number, lng: number, radiusM: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)},${Math.round(radiusM)}`;
}

export function overpassGenericForestQuery(lat: number, lng: number, radiusM: number): string {
  const at = `around:${Math.round(radiusM)},${lat},${lng}`;
  return [
    "[out:json][timeout:28];(",
    `way["natural"="wood"](${at});`,
    `way["landuse"="forest"](${at});`,
    `relation["natural"="wood"](${at});`,
    `relation["landuse"="forest"](${at});`,
    ");out geom;",
  ].join("");
}

function toRing(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const points: [number, number][] = [];
  for (const entry of raw) {
    const point = (entry ?? {}) as Record<string, unknown>;
    const lat = Number(point.lat);
    const lng = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push([lng, lat]);
  }
  return points.length >= MIN_RING_POINTS ? points : null;
}

export function parseOverpassGenericForest(raw: unknown): GenericForestArea[] {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const elements = Array.isArray(doc.elements) ? doc.elements : [];

  const areas: GenericForestArea[] = [];
  for (const entry of elements) {
    const element = (entry ?? {}) as Record<string, unknown>;

    if (element.type === "way") {
      const ring = toRing(element.geometry);
      if (ring) areas.push({ rings: [ring] });
      continue;
    }

    if (element.type !== "relation") continue;
    const members = Array.isArray(element.members) ? element.members : [];
    const rings: [number, number][][] = [];
    for (const memberRaw of members) {
      const member = (memberRaw ?? {}) as Record<string, unknown>;
      if (member.type !== "way") continue;
      // OSM ระบุ role ไว้ชัด จึงตัด inner ออกได้จริง (ต่างจากชุด shapefile กรมป่าไม้ ดูสเปก §6)
      if (member.role !== "outer" && member.role !== "") continue;
      const ring = toRing(member.geometry);
      if (ring) rings.push(ring);
    }
    if (rings.length > 0) areas.push({ rings });
  }
  return areas;
}

export async function fetchGenericForest(
  lat: number,
  lng: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<GenericForestArea[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("พิกัดสำหรับดึงพื้นที่ป่าไม่ถูกต้อง");
  }

  const key = cacheKey(lat, lng, radiusM);
  const cached = cache.get(key);
  if (cached) return cached;

  const query = overpassGenericForestQuery(lat, lng, radiusM);
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const timeout = AbortSignal.timeout(OVERPASS_TIMEOUT_MS);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`Overpass ตอบ ${response.status}`);
      const areas = parseOverpassGenericForest(await response.json());
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, areas);
      return areas;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `โหลดพื้นที่ป่าจาก OpenStreetMap ไม่สำเร็จ: ${lastError.message}`
      : "โหลดพื้นที่ป่าจาก OpenStreetMap ไม่สำเร็จ",
  );
}
