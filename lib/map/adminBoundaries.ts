// เขตองค์กรปกครองส่วนท้องถิ่นรอบจุดวิเคราะห์ — overlay อ้างอิงบนแผนที่ 3 มิติ
//
// ขอบเขต: ดึงสดจาก OpenStreetMap (Overpass API) ฝั่ง client เมื่อผู้ใช้เปิดชั้นข้อมูลเอง
// ไม่บันทึกลงฐานข้อมูล ไม่ผูกกับคะแนน และไม่แตะ GisAutoScore.borderMunicipality
//
// ทำไมวาดเฉพาะเขตเทศบาล: OSM ไม่มี polygon ของ อบต. เพราะพื้นที่ อบต. คือ "ส่วนของตำบล
// ที่ไม่อยู่ในเขตเทศบาล" การวาดเขตตำบล (admin_level 8) แทนจะสื่อผิด เพราะตำบลเดียว
// คร่อมได้ทั้งเขตเทศบาลและเขต อบต.
//
// ⚠️ ข้อจำกัดที่ต้องสื่อสารเสมอ — OSM มีเขตเทศบาลไทยไม่ครบ
// วัดจริง (2026-08-05, ค้นผ่าน Nominatim): เทศบาลนครเชียงใหม่/เชียงราย/นครราชสีมา มี polygon
// แต่ เทศบาลเมืองแม่ฮ่องสอน · เมืองน่าน · เมืองลำพูน · เมืองพะเยา · เมืองแม่สาย ·
// ตำบลเวียงพางคำ มีแค่ node (place=town/city/municipality) หรือหมุดอาคารสำนักงาน — ไม่มีขอบเขต
// ดังนั้น "ไม่พบเขตในรัศมี" แปลว่า "OSM ยังไม่มีข้อมูล" เท่านั้น ห้ามตีความ (หรือแสดงผล)
// ว่าเป็นเขต อบต. เด็ดขาด — โรงเรียนจำนวนมากของโครงการนี้อยู่ในจังหวัดที่ข้อมูลยังขาด
//
// ลิขสิทธิ์ข้อมูล: ODbL 1.0 — หน้าที่แสดงผลต้องขึ้นเครดิต "© OpenStreetMap contributors"

import { polygonAreaM2, polygonCentroid } from "./geometry";

export type AdminKind = "nakhon" | "mueang" | "tambon" | "special";

export type LngLat = [number, number];

export interface AdminBoundary {
  /** ชื่อเต็ม — official_name ถ้ามี (node เก็บชื่อเต็มไว้ที่นี่) ไม่งั้นใช้ name */
  name: string;
  kind: AdminKind;
  /** วงขอบเขตชั้นนอก (role=outer) — [lng,lat][] ต่อวง; ว่างเมื่อ OSM มีแค่หมุด */
  rings: LngLat[][];
  /** true = OSM มีแค่หมุด ไม่มีขอบเขต — ต้องแสดงให้ผู้ใช้รู้ ไม่ใช่ซ่อนหรือเดาขอบเขตให้ */
  pointOnly: boolean;
  /** จุดวางป้ายชื่อ = centroid ของวงใหญ่สุด หรือพิกัดหมุดเมื่อไม่มีขอบเขต */
  labelLat: number;
  labelLng: number;
}

/** รัศมีที่ดึงข้อมูลรอบจุดวิเคราะห์ (ม.) — แก้ค่าที่นี่ที่เดียว */
export const ADMIN_FETCH_RADIUS_M = 15_000;

/** เครดิตที่ต้องแสดงเมื่อใช้ข้อมูลชุดนี้ (ODbL บังคับ) */
export const ADMIN_ATTRIBUTION = "© OpenStreetMap contributors";

export const ADMIN_KIND_LABELS: Record<AdminKind, string> = {
  nakhon: "เทศบาลนคร",
  mueang: "เทศบาลเมือง",
  tambon: "เทศบาลตำบล",
  special: "องค์กรปกครองรูปแบบพิเศษ",
};

// endpoint ชุดเดียวกับ scripts/fetch-borders.mjs — ลองตัวถัดไปเมื่อตัวแรกล้มเหลว/ถูกจำกัดอัตรา
const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const OVERPASS_TIMEOUT_MS = 30_000; // Overpass ช้าได้จริง 1–10 วิ เผื่อไว้กว้าง
const MIN_RING_POINTS = 4; // วงปิดต้องมีอย่างน้อย 4 จุด ไม่งั้นวาดไม่ได้

/**
 * ประเภท อปท. จากคำนำหน้าชื่อไทย — ชื่อที่ไม่เข้าเค้าคืน null เพื่อให้ผู้เรียกทิ้งทั้งรายการ
 * (แสดงประเภทผิดแย่กว่าไม่แสดง จึงไม่มีการเดา)
 */
export function classifyAdminKind(name: unknown): AdminKind | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.startsWith("เทศบาลนคร")) return "nakhon";
  if (trimmed.startsWith("เทศบาลเมือง")) return "mueang";
  if (trimmed.startsWith("เทศบาลตำบล")) return "tambon";
  if (trimmed.startsWith("กรุงเทพมหานคร") || trimmed.startsWith("เมืองพัทยา")) return "special";
  return null;
}

function toLngLat(raw: unknown): LngLat | null {
  const point = (raw ?? {}) as Record<string, unknown>;
  const lat = Number(point.lat);
  const lng = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

/**
 * แปลงผล Overpass (`out geom`) → รายการเขตที่วาดได้จริง — pure ทั้งหมด จึงทดสอบตรงได้
 *
 * ตัดทิ้งอย่างเงียบ ๆ: จุดที่ไม่ใช่ตัวเลขจำกัด/นอกช่วง, วงที่เหลือน้อยกว่า 4 จุด,
 * รายการที่ไม่เหลือวงใดเลย และรายการที่จำแนกประเภทไม่ได้ — Cesium ต้องไม่เจอ NaN
 * (วงในของเขตแบบโดนัทไม่ถูกวาด: overlay ไม่ต้องละเอียดถึงระดับนั้น และเส้นวงในทำให้ภาพรก)
 */
export function parseOverpassAdminBoundaries(raw: unknown): AdminBoundary[] {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const elements = Array.isArray(doc.elements) ? doc.elements : [];

  const parsed = elements.flatMap((entry): AdminBoundary[] => {
    const element = (entry ?? {}) as Record<string, unknown>;
    const tags = (element.tags ?? {}) as Record<string, unknown>;
    // official_name มาก่อนเสมอ: node เก็บชื่อเต็ม ("เทศบาลเมืองแม่ฮ่องสอน") ไว้ที่นี่
    // ส่วน name เป็นชื่อสั้น ("แม่ฮ่องสอน") ซึ่งจำแนกประเภทไม่ได้
    const officialName = typeof tags.official_name === "string" ? tags.official_name.trim() : "";
    const plainName = typeof tags.name === "string" ? tags.name.trim() : "";
    const name = classifyAdminKind(officialName) ? officialName : plainName;
    const kind = classifyAdminKind(name);
    if (!name || !kind) return [];

    // หมุด (node) — OSM ยังไม่มีขอบเขตของเทศบาลแห่งนี้ แสดงเป็นจุดพร้อมบอกตรง ๆ ว่าไม่มีขอบเขต
    if (element.type === "node") {
      const point = toLngLat({ lat: element.lat, lon: element.lon });
      if (!point) return [];
      return [{ name, kind, rings: [], pointOnly: true, labelLat: point[1], labelLng: point[0] }];
    }

    const members = Array.isArray(element.members) ? element.members : [];
    const rings = members.flatMap((memberRaw): LngLat[][] => {
      const member = (memberRaw ?? {}) as Record<string, unknown>;
      if (member.type !== "way" || member.role !== "outer") return [];
      const points = (Array.isArray(member.geometry) ? member.geometry : [])
        .map(toLngLat)
        .filter((point): point is LngLat => point !== null);
      return points.length >= MIN_RING_POINTS ? [points] : [];
    });
    if (rings.length === 0) return [];

    // ป้ายชื่อวางที่ centroid ของวงใหญ่สุด — วงย่อย (เกาะ/พื้นที่แยก) ไม่ควรดึงป้ายออกนอกตัวเมือง
    let largest = rings[0];
    let largestArea = polygonAreaM2(toLatLngPairs(rings[0]));
    for (const ring of rings.slice(1)) {
      const area = polygonAreaM2(toLatLngPairs(ring));
      if (area > largestArea) {
        largest = ring;
        largestArea = area;
      }
    }
    const [labelLat, labelLng] = polygonCentroid(toLatLngPairs(openRing(largest)));

    return [{ name, kind, rings, pointOnly: false, labelLat, labelLng }];
  });

  // เทศบาลแห่งเดียวกันอาจมีทั้ง relation (ขอบเขต) และ node (หมุด) — ขอบเขตชนะเสมอ
  // ไม่งั้นจะได้ป้ายชื่อซ้อนสองอันที่จุดเดียวกัน และหมุดจะอ้างผิดว่า "ไม่มีขอบเขต"
  const byName = new Map<string, AdminBoundary>();
  for (const area of parsed) {
    const existing = byName.get(area.name);
    if (!existing || (existing.pointOnly && !area.pointOnly)) byName.set(area.name, area);
  }
  return [...byName.values()];
}

/** geometry.ts ทำงานกับ [lat,lng] ส่วนข้อมูลแผนที่ที่ส่งให้ Cesium เป็น [lng,lat] */
function toLatLngPairs(ring: LngLat[]): [number, number][] {
  return ring.map(([lng, lat]) => [lat, lng]);
}

/**
 * ตัดจุดปิดวงที่ซ้ำกับจุดแรกออก ก่อนหา centroid
 *
 * OSM ปิดวงด้วยการซ้ำจุดแรกไว้ท้ายวง ถ้าไม่ตัดออก polygonCentroid (ค่าเฉลี่ยเลขคณิต)
 * จะถ่วงน้ำหนักมุมนั้นเป็นสองเท่า ทำให้ป้ายชื่อเยื้องออกจากกลางเขตจริงอย่างเห็นได้ในเขตใหญ่
 */
function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 2) return ring;
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  return firstLng === lastLng && firstLat === lastLat ? ring.slice(0, -1) : ring;
}

/** กรอบสี่เหลี่ยมที่ครอบวงกลมรัศมี radiusM รอบจุด — Overpass รับ bbox เป็น (south,west,north,east) */
export function boundingBox(lat: number, lng: number, radiusM: number): [number, number, number, number] {
  const dLat = radiusM / 110_540;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

export function overpassQuery(lat: number, lng: number, radiusM: number): string {
  const [south, west, north, east] = boundingBox(lat, lng, radiusM);
  const bbox = [south, west, north, east].map((v) => v.toFixed(5)).join(",");
  // คัดด้วย "ชื่อขึ้นต้นว่าเทศบาล" ไม่ใช่ admin_level เพราะ OSM ไทยแท็กระดับไม่สม่ำเสมอ:
  // วัดจริงพบเทศบาลนครอยู่ที่ level 7 แต่ "เทศบาลตำบลแม่จัน" ถูกแท็กเป็น level 6 (ระดับเดียวกับอำเภอ)
  // การล็อก level=7 จึงทั้งพลาดของที่มีจริง และการรับ level=6 ทั้งหมดก็จะลากขอบเขตอำเภอเข้ามาปน
  //
  // ต้องถามทั้ง name และ official_name เพราะสองแบบเก็บชื่อคนละที่ (วัดจริง 2026-08-05):
  //   relation เทศบาลนครเชียงใหม่ → name = "เทศบาลนครเชียงใหม่"
  //   node     เทศบาลเมืองแม่ฮ่องสอน → name = "แม่ฮ่องสอน", official_name = "เทศบาลเมืองแม่ฮ่องสอน"
  // และต้องถาม node ด้วย ไม่ใช่แค่ relation เพราะเทศบาลเมือง/ตำบลจำนวนมากยังไม่มีขอบเขตใน OSM
  return [
    "[out:json][timeout:25];(",
    `relation["boundary"="administrative"]["name"~"^เทศบาล"](${bbox});`,
    `relation["boundary"="administrative"]["official_name"~"^เทศบาล"](${bbox});`,
    `node["place"]["name"~"^เทศบาล"](${bbox});`,
    `node["place"]["official_name"~"^เทศบาล"](${bbox});`,
    ");out geom;",
  ].join("");
}

// cache ต่อพิกัดปัดเศษ ~1 กม. — เปิด/ปิดชั้นข้อมูลซ้ำที่จุดเดิมไม่ยิง Overpass ใหม่
// (บริการฟรีมีการจำกัดอัตรา และผลลัพธ์เขตปกครองแทบไม่เปลี่ยนระหว่างเซสชัน)
const cache = new Map<string, AdminBoundary[]>();

function cacheKey(lat: number, lng: number, radiusM: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)},${radiusM}`;
}

/**
 * ดึงเขตเทศบาลรอบจุดจาก Overpass — โยน Error เมื่อทุก endpoint ล้มเหลว
 * (ผู้เรียกใน CesiumMap เป็นผู้จับแล้วแสดงข้อความ ตามแบบเดียวกับ lib/map/mapApi.ts)
 *
 * "ไม่พบเขตเทศบาลเลย" ไม่ใช่ข้อผิดพลาด — คืน [] เพราะทั้งบริเวณเป็นเขต อบต. ซึ่งเป็นคำตอบที่ถูกต้อง
 */
export async function fetchAdminBoundaries(
  lat: number,
  lng: number,
  radiusM: number = ADMIN_FETCH_RADIUS_M,
  signal?: AbortSignal,
): Promise<AdminBoundary[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("พิกัดสำหรับดึงเขตปกครองไม่ถูกต้อง");
  }

  const key = cacheKey(lat, lng, radiusM);
  const cached = cache.get(key);
  if (cached) return cached;

  const query = overpassQuery(lat, lng, radiusM);
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
      const boundaries = parseOverpassAdminBoundaries(await response.json());
      cache.set(key, boundaries);
      return boundaries;
    } catch (error) {
      // ผู้ใช้/effect ยกเลิกเอง → หยุดทันที ไม่ต้องลอง endpoint สำรอง
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `โหลดเขตปกครองไม่สำเร็จ: ${lastError.message}`
      : "โหลดเขตปกครองจาก OpenStreetMap ไม่สำเร็จ",
  );
}
