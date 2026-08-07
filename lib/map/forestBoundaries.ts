// แนวเขตป่า / พื้นที่คุ้มครองรอบจุดวิเคราะห์ — overlay อ้างอิง + จำแนก in/near/out
//
// ขอบเขตเฟส 1: ดึงสดจาก OpenStreetMap (Overpass) ฝั่ง client เมื่อผู้ใช้เปิดชั้นข้อมูล
// ข้อมูล OSM ไม่ครบและไม่ใช่ชั้นประกาศราชการ — ใช้แสดงผลและหลักฐานอ้างอิงเท่านั้น
// ห้ามใช้เป็นประตูคัดกรอง/คะแนนเพียงลำพัง (ดู lib/highland-screen.ts + สเปก forest-boundary)
//
// สเปก: docs/superpowers/specs/2026-08-07-forest-boundary-highland-screen-design.md
// ลิขสิทธิ์ข้อมูล: ODbL 1.0 — หน้าที่แสดงผลต้องขึ้นเครดิต "© OpenStreetMap contributors"

import { pointInPolygon, polygonAreaM2, polygonCentroid } from "./geometry";
import { haversineM } from "./morphology";

export type LngLat = [number, number];

/**
 * ชนิดเขตป่า/พื้นที่คุ้มครองของไทย — ครอบคลุมประเภทหลักของกรมป่าไม้ / กรมอุทยานฯ
 * จำแนกจากชื่อไทย + แท็ก OSM (อ้างอิง — ไม่ใช่ชั้นประกาศราชการ)
 */
export type ForestZoneKind =
  | "national_reserved_forest" // ป่าสงวนแห่งชาติ
  | "national_park" // อุทยานแห่งชาติ
  | "wildlife_sanctuary" // เขตรักษาพันธุ์สัตว์ป่า
  | "non_hunting" // เขตห้ามล่าสัตว์ป่า
  | "forest_park" // วนอุทยาน
  | "botanical_garden" // สวนพฤกษศาสตร์
  | "arboretum" // สวนรุกขชาติ
  | "community_forest" // ป่าชุมชน
  | "mangrove_forest" // ป่าชายเลน
  | "biosphere_reserve" // เขตสงวนชีวมณฑล / UNESCO
  | "wetland_protected" // พื้นที่ชุ่มน้ำคุ้มครอง / แรมซาร์
  | "watershed_protected" // ลุ่มน้ำชั้น 1 / พื้นที่ต้นน้ำ
  | "other_protected" // พื้นที่คุ้มครอง/ป่าอื่นที่มีชื่อ
  | "unclassified";

export type ForestOverlayStatus = "in" | "near" | "out" | "unknown";

export type ForestDataAuthority = "osm-reference" | "authoritative";

export interface ForestBoundary {
  name: string;
  kind: ForestZoneKind;
  /** วง outer — [lng, lat][] */
  rings: LngLat[][];
  labelLat: number;
  labelLng: number;
}

export interface ForestZoneHit {
  name: string;
  kind: ForestZoneKind;
  relation: "in" | "near";
  distanceM: number;
}

/**
 * ผลทับซ้อนจุดโรงเรียนกับแนวเขตป่า — เก็บใน gis.forestOverlay ได้
 * (ไม่เก็บ geometry เขตทั้งก้อน)
 */
export interface ForestOverlayResult {
  version: string;
  status: ForestOverlayStatus;
  nearestDistanceM: number | null;
  zones: ForestZoneHit[];
  /** osm-reference = OSM/อ้างอิง · authoritative = ชั้นทางการ (ยังไม่มีในเฟส 1) */
  dataAuthority: ForestDataAuthority;
  dataSource: string;
  attribution: string;
  calculatedAt: string;
}

export const FOREST_OVERLAY_VERSION = "fo-2";
export const FOREST_NEAR_M = 1_000;
export const FOREST_FETCH_RADIUS_M = 15_000;
export const FOREST_ATTRIBUTION = "© OpenStreetMap contributors";
export const FOREST_DATA_SOURCE_OSM =
  "OpenStreetMap เขตป่า/คุ้มครองไทย (Overpass) — อ้างอิง ไม่ใช่ชั้นประกาศราชการ";

export const FOREST_KIND_LABELS: Record<ForestZoneKind, string> = {
  national_reserved_forest: "ป่าสงวนแห่งชาติ",
  national_park: "อุทยานแห่งชาติ",
  wildlife_sanctuary: "เขตรักษาพันธุ์สัตว์ป่า",
  non_hunting: "เขตห้ามล่าสัตว์ป่า",
  forest_park: "วนอุทยาน",
  botanical_garden: "สวนพฤกษศาสตร์",
  arboretum: "สวนรุกขชาติ",
  community_forest: "ป่าชุมชน",
  mangrove_forest: "ป่าชายเลน",
  biosphere_reserve: "เขตสงวนชีวมณฑล",
  wetland_protected: "พื้นที่ชุ่มน้ำคุ้มครอง",
  watershed_protected: "ลุ่มน้ำชั้น 1 / พื้นที่ต้นน้ำ",
  other_protected: "พื้นที่คุ้มครอง/ป่าอื่น",
  unclassified: "พื้นที่คุ้มครอง (ไม่ระบุประเภท)",
};

/** รายการ kind ทั้งหมด — ใช้ sanitize + เทสต์ว่าครบ */
export const FOREST_ZONE_KINDS = Object.keys(FOREST_KIND_LABELS) as ForestZoneKind[];

/**
 * รูปแบบชื่อไทย/อังกฤษที่ใช้ดึงจาก OSM เพิ่มเติม
 * (เขตที่ยังไม่แท็ก boundary=protected_area แต่มีชื่อประเภทป่า)
 */
export const THAI_FOREST_NAME_REGEX =
  "ป่าสงวน|อุทยานแห่งชาติ|เขตรักษาพันธุ์|ห้ามล่า|วนอุทยาน|ป่าชุมชน|ป่าชายเลน|สวนพฤกษศาสตร์|สวนรุกขชาติ|เขตอนุรักษ์|เขตสงวนชีว|พื้นที่ชุ่มน้ำ|ลุ่มน้ำชั้น|National Park|Wildlife Sanctuary|Non[- ]?Hunting|Reserved Forest|Forest Park|Community Forest|Mangrove|Biosphere|Ramsar";

/** compiled จาก THAI_FOREST_NAME_REGEX */
const THAI_FOREST_NAME_TEST = new RegExp(THAI_FOREST_NAME_REGEX, "i");

export const FOREST_STATUS_LABELS: Record<ForestOverlayStatus, string> = {
  in: "อยู่ในแนวเขตป่า/พื้นที่คุ้มครอง",
  near: "ชิดแนวเขตป่า (≤ 1 กม.)",
  out: "นอกแนวเขตป่าในรัศมีที่ตรวจ",
  unknown: "ไม่มีข้อมูลแนวเขตป่าในรัศมีนี้",
};

// endpoint ชุดเดียวกับ adminBoundaries / fetch-borders
const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const OVERPASS_TIMEOUT_MS = 30_000;
const MIN_RING_POINTS = 4;

/**
 * จำแนกชนิดเขตจากชื่อไทย/อังกฤษ + แท็ก OSM
 * ลำดับ: ชื่อเฉพาะไทยก่อน → แท็ก protect_class / boundary → ชนิดทั่วไป
 */
export function classifyForestZoneKind(name: unknown, tags?: Record<string, unknown>): ForestZoneKind {
  const n = typeof name === "string" ? name.trim() : "";
  const lower = n.toLowerCase();
  const protectClass = tags && typeof tags.protect_class === "string" ? tags.protect_class.trim() : "";
  const leisure = tags && typeof tags.leisure === "string" ? tags.leisure.trim() : "";
  const boundary = tags && typeof tags.boundary === "string" ? tags.boundary.trim() : "";
  const landuse = tags && typeof tags.landuse === "string" ? tags.landuse.trim() : "";
  const natural = tags && typeof tags.natural === "string" ? tags.natural.trim() : "";
  const protectionTitle =
    tags && typeof tags.protection_title === "string" ? tags.protection_title.trim() : "";
  const designation = tags && typeof tags.designation === "string" ? tags.designation.trim() : "";
  const combined = `${n} ${protectionTitle} ${designation}`;

  // --- ชื่อ/คำนำหน้าไทย (เฉพาะก่อน) ---
  if (n.includes("อุทยานแห่งชาติ") || n.includes("อุทยานแห่ง ชาติ") || /national\s*park/i.test(n)) {
    // "วนอุทยาน" มีคำว่าอุทยาน — ต้องกันก่อน national_park
    if (n.includes("วนอุทยาน") || /forest\s*park/i.test(n)) return "forest_park";
    return "national_park";
  }
  if (n.includes("วนอุทยาน") || /forest\s*park/i.test(n)) return "forest_park";
  if (n.includes("เขตรักษาพันธุ์") || n.includes("รักษาพันธุ์สัตว์ป่า") || /wildlife\s*sanctuary/i.test(n)) {
    return "wildlife_sanctuary";
  }
  if (n.includes("ห้ามล่า") || /non[-\s]?hunting/i.test(n)) return "non_hunting";
  if (n.includes("ป่าสงวน") || /reserved\s*forest/i.test(n) || /national\s*reserved\s*forest/i.test(n)) {
    return "national_reserved_forest";
  }
  if (n.includes("สวนพฤกษศาสตร์") || /botanic(al)?\s*garden/i.test(n)) return "botanical_garden";
  if (n.includes("สวนรุกขชาติ") || /arboretum/i.test(n)) return "arboretum";
  if (n.includes("ป่าชุมชน") || /community\s*forest/i.test(n)) return "community_forest";
  if (n.includes("ป่าชายเลน") || n.includes("ชายเลน") || /mangrove/i.test(n) || natural === "wetland") {
    if (n.includes("ชายเลน") || /mangrove/i.test(n)) return "mangrove_forest";
  }
  if (
    n.includes("เขตสงวนชีว") ||
    n.includes("สงวนชีวมณฑล") ||
    /biosphere/i.test(n) ||
    protectClass === "6"
  ) {
    return "biosphere_reserve";
  }
  if (
    n.includes("พื้นที่ชุ่มน้ำ") ||
    n.includes("แรมซาร์") ||
    /ramsar/i.test(n) ||
    /wetland/i.test(lower)
  ) {
    return "wetland_protected";
  }
  if (
    n.includes("ลุ่มน้ำชั้น") ||
    n.includes("พื้นที่ต้นน้ำ") ||
    n.includes("ชั้นคุณภาพลุ่มน้ำ") ||
    /watershed/i.test(n) ||
    /class\s*1\s*watershed/i.test(n)
  ) {
    return "watershed_protected";
  }
  if (n.includes("เขตอนุรักษ์") || n.includes("ป่าอนุรักษ์")) return "other_protected";

  // --- แท็ก OSM ---
  if (boundary === "national_park") return "national_park";
  if (protectClass === "2") return "national_park";
  if (protectClass === "1" || protectClass === "1a" || protectClass === "1b") return "wildlife_sanctuary";
  if (protectClass === "4" || protectClass === "5") {
    // IUCN IV/V — habitat / protected landscape → คุ้มครองอื่น เว้นชื่อจะชี้ชนิดไทยแล้ว
    if (combined.includes("ห้ามล่า")) return "non_hunting";
    return "other_protected";
  }
  if (leisure === "nature_reserve") return "other_protected";
  if (natural === "wetland" || natural === "mangrove") {
    return natural === "mangrove" ? "mangrove_forest" : "wetland_protected";
  }
  if ((landuse === "forest" || landuse === "forestry") && n.length > 0) return "other_protected";

  if (n.length > 0 || boundary === "protected_area" || protectClass !== "" || protectionTitle !== "") {
    return "unclassified";
  }
  return "unclassified";
}

/**
 * องค์ประกอบนี้เป็นเขตป่า/คุ้มครองที่ควรรับเข้าชั้น (pure — ใช้ใน parse)
 * @param elementType relation รับชื่อประเภทป่าได้กว้างกว่า way (กันถนน/อาคารที่ชื่อคล้าย)
 */
export function isForestOrProtectedElement(
  tags: Record<string, unknown>,
  name: string,
  elementType: "relation" | "way" | string = "relation",
): boolean {
  const boundary = typeof tags.boundary === "string" ? tags.boundary : "";
  const protectClass = typeof tags.protect_class === "string" ? tags.protect_class : "";
  const leisure = typeof tags.leisure === "string" ? tags.leisure : "";
  const landuse = typeof tags.landuse === "string" ? tags.landuse : "";
  const natural = typeof tags.natural === "string" ? tags.natural : "";
  const protectionTitle = typeof tags.protection_title === "string" ? tags.protection_title : "";
  const designation = typeof tags.designation === "string" ? tags.designation : "";
  const area = tags.area === "yes" || tags.area === true;

  if (boundary === "protected_area" || boundary === "national_park" || boundary === "forest") return true;
  if (protectClass !== "") return true;
  if (leisure === "nature_reserve") return true;
  if (protectionTitle !== "" || designation !== "") return true;
  if ((landuse === "forest" || landuse === "forestry") && name.length > 0) return true;
  if ((natural === "wetland" || natural === "mangrove") && name.length > 0) return true;
  if (natural === "wood" && name.length > 0 && (area || elementType === "relation")) return true;

  // ชื่อตรงประเภทป่าไทย — relation รับได้; way ต้องมี area/landuse/natural กันชื่อถนน
  if (name.length > 0 && THAI_FOREST_NAME_TEST.test(name)) {
    if (elementType === "relation") return true;
    if (area || landuse !== "" || natural !== "" || boundary !== "") return true;
  }
  return false;
}

function toLngLat(raw: unknown): LngLat | null {
  const point = (raw ?? {}) as Record<string, unknown>;
  const lat = Number(point.lat);
  const lng = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

function toLatLngPairs(ring: LngLat[]): [number, number][] {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 2) return ring;
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  return firstLng === lastLng && firstLat === lastLat ? ring.slice(0, -1) : ring;
}

function pickName(tags: Record<string, unknown>): string {
  for (const key of ["name:th", "official_name", "name", "short_name"] as const) {
    const v = tags[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
  }
  return "";
}

/** แปลงผล Overpass out geom → รายการเขตที่วาด/วัดได้ — pure */
export function parseOverpassForestBoundaries(raw: unknown): ForestBoundary[] {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const elements = Array.isArray(doc.elements) ? doc.elements : [];

  const parsed = elements.flatMap((entry): ForestBoundary[] => {
    const element = (entry ?? {}) as Record<string, unknown>;
    if (element.type !== "relation" && element.type !== "way") return [];
    const tags = (element.tags ?? {}) as Record<string, unknown>;
    const name = pickName(tags);
    // ต้องมีสัญญาณว่าเป็นเขตป่า/คุ้มครอง — กัน relation ปกครอง/อื่นที่พลาดมา
    const elementType = typeof element.type === "string" ? element.type : "";
    if (!isForestOrProtectedElement(tags, name, elementType)) return [];
    if (!name) return []; // ไม่มีชื่อ → ป้าย/หลักฐานใช้ไม่ได้

    let rings: LngLat[][] = [];
    if (element.type === "way") {
      const points = (Array.isArray(element.geometry) ? element.geometry : [])
        .map(toLngLat)
        .filter((p): p is LngLat => p !== null);
      if (points.length >= MIN_RING_POINTS) rings = [points];
    } else {
      const members = Array.isArray(element.members) ? element.members : [];
      rings = members.flatMap((memberRaw): LngLat[][] => {
        const member = (memberRaw ?? {}) as Record<string, unknown>;
        if (member.type !== "way" || (member.role !== "outer" && member.role !== "")) return [];
        const points = (Array.isArray(member.geometry) ? member.geometry : [])
          .map(toLngLat)
          .filter((p): p is LngLat => p !== null);
        return points.length >= MIN_RING_POINTS ? [points] : [];
      });
    }
    if (rings.length === 0) return [];

    const kind = classifyForestZoneKind(name, tags);

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

    return [{ name, kind, rings, labelLat, labelLng }];
  });

  // ชื่อซ้ำ — เก็บรายการที่มีพื้นที่รวมใหญ่กว่า (นับจาก ring แรก)
  const byName = new Map<string, ForestBoundary>();
  for (const zone of parsed) {
    const existing = byName.get(zone.name);
    if (!existing) {
      byName.set(zone.name, zone);
      continue;
    }
    const areaNew = zone.rings.reduce((s, r) => s + polygonAreaM2(toLatLngPairs(r)), 0);
    const areaOld = existing.rings.reduce((s, r) => s + polygonAreaM2(toLatLngPairs(r)), 0);
    if (areaNew > areaOld) byName.set(zone.name, zone);
  }
  return [...byName.values()];
}

/** bbox รอบจุด (south, west, north, east) — ใช้ชุดเดียวกับ adminBoundaries */
export function boundingBox(lat: number, lng: number, radiusM: number): [number, number, number, number] {
  const dLat = radiusM / 110_540;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

export function overpassForestQuery(lat: number, lng: number, radiusM: number): string {
  const [south, west, north, east] = boundingBox(lat, lng, radiusM);
  const bbox = [south, west, north, east].map((v) => v.toFixed(5)).join(",");
  // ดึงเขตป่า/คุ้มครองไทยหลายชนิด: แท็กมาตรฐาน + ชื่อประเภทไทย/อังกฤษ
  // จำกัด named landuse=forest / natural เพื่อไม่ดึงป่าไม่มีชื่อทั้ง bbox
  const nameFilter = THAI_FOREST_NAME_REGEX;
  return [
    "[out:json][timeout:28];(",
    // แท็กคุ้มครองมาตรฐาน
    `relation["boundary"="protected_area"](${bbox});`,
    `relation["boundary"="national_park"](${bbox});`,
    `relation["boundary"="forest"](${bbox});`,
    `relation["protect_class"](${bbox});`,
    `relation["leisure"="nature_reserve"](${bbox});`,
    `relation["protection_title"](${bbox});`,
    // ชื่อประเภทป่าไทย/อังกฤษ (แม้แท็ก boundary ยังไม่ครบ)
    `relation["name"~"${nameFilter}",i](${bbox});`,
    `relation["name:th"~"${nameFilter}"](${bbox});`,
    `relation["official_name"~"${nameFilter}",i](${bbox});`,
    // way ปิด
    `way["boundary"="protected_area"](${bbox});`,
    `way["boundary"="national_park"](${bbox});`,
    `way["leisure"="nature_reserve"](${bbox});`,
    `way["landuse"="forest"]["name"](${bbox});`,
    `way["landuse"="forestry"]["name"](${bbox});`,
    `way["natural"="mangrove"](${bbox});`,
    `way["natural"="wetland"]["name"](${bbox});`,
    `way["name"~"${nameFilter}",i](${bbox});`,
    `way["name:th"~"${nameFilter}"](${bbox});`,
    ");out geom;",
  ].join("");
}

/** ระยะจากจุด (lat,lng) ถึงขอบ polygon ใกล้สุด (ม.) — ถ้าอยู่ภายในคืน 0 */
export function distancePointToRingM(lat: number, lng: number, ringLngLat: LngLat[]): number {
  const latLngRing = toLatLngPairs(openRing(ringLngLat));
  if (latLngRing.length < 3) return Number.POSITIVE_INFINITY;
  if (pointInPolygon([lat, lng], latLngRing)) return 0;

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0, j = latLngRing.length - 1; i < latLngRing.length; j = i++) {
    const [lat1, lng1] = latLngRing[j];
    const [lat2, lng2] = latLngRing[i];
    const d = distancePointToSegmentM(lat, lng, lat1, lng1, lat2, lng2);
    if (d < min) min = d;
  }
  return min;
}

/**
 * ระยะจุดถึงเส้นตรงบนระนาบ equirectangular รอบจุด (แม่นพอสำหรับ ≤15 กม.)
 */
export function distancePointToSegmentM(
  lat: number,
  lng: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const px = (lng - lng1) * mPerDegLng;
  const py = (lat - lat1) * mPerDegLat;
  const dx = (lng2 - lng1) * mPerDegLng;
  const dy = (lat2 - lat1) * mPerDegLat;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-6) return haversineM(lat, lng, lat1, lng1);
  let t = (px * dx + py * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const closestLat = lat1 + (t * dy) / mPerDegLat;
  const closestLng = lng1 + (t * dx) / mPerDegLng;
  return haversineM(lat, lng, closestLat, closestLng);
}

export function distancePointToBoundaryM(lat: number, lng: number, boundary: ForestBoundary): number {
  let min = Number.POSITIVE_INFINITY;
  for (const ring of boundary.rings) {
    const d = distancePointToRingM(lat, lng, ring);
    if (d < min) min = d;
  }
  return min;
}

/**
 * จำแนกทับซ้อนจุดกับรายการเขตที่โหลดมาแล้ว
 * - zones ว่าง + loaded=true → out (มีข้อมูลในรัศมีแล้วแต่ไม่ทับ)
 * - loaded=false → unknown (ยังไม่โหลด/ล้มเหลว — ห้ามตีความว่านอกเขต)
 */
export function classifyForestOverlay(
  lat: number,
  lng: number,
  zones: readonly ForestBoundary[],
  options?: {
    nearM?: number;
    loaded?: boolean;
    dataAuthority?: ForestDataAuthority;
    calculatedAt?: string;
  },
): ForestOverlayResult {
  const nearM = options?.nearM ?? FOREST_NEAR_M;
  const loaded = options?.loaded !== false;
  const dataAuthority = options?.dataAuthority ?? "osm-reference";
  const calculatedAt = options?.calculatedAt ?? new Date().toISOString();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return emptyOverlay("unknown", dataAuthority, calculatedAt);
  }

  if (!loaded) {
    return emptyOverlay("unknown", dataAuthority, calculatedAt);
  }

  if (zones.length === 0) {
    // โหลดสำเร็จแต่ไม่พบเขตใน bbox — ยังไม่รู้ทั้งประเทศ จึงใช้ unknown ไม่ใช่ out
    // (สเปก: ไม่พบใน Overpass ≠ อยู่นอกป่าทั่วประเทศ)
    return emptyOverlay("unknown", dataAuthority, calculatedAt);
  }

  const hits: ForestZoneHit[] = [];
  let nearest: number | null = null;

  for (const zone of zones) {
    const d = distancePointToBoundaryM(lat, lng, zone);
    if (!Number.isFinite(d)) continue;
    if (nearest === null || d < nearest) nearest = d;
    if (d === 0) {
      hits.push({ name: zone.name, kind: zone.kind, relation: "in", distanceM: 0 });
    } else if (d <= nearM) {
      hits.push({ name: zone.name, kind: zone.kind, relation: "near", distanceM: Math.round(d) });
    }
  }

  hits.sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name, "th"));

  let status: ForestOverlayStatus;
  if (hits.some((h) => h.relation === "in")) status = "in";
  else if (hits.some((h) => h.relation === "near")) status = "near";
  else status = "out";

  return {
    version: FOREST_OVERLAY_VERSION,
    status,
    nearestDistanceM: nearest === null ? null : Math.round(nearest),
    zones: hits,
    dataAuthority,
    dataSource: dataAuthority === "authoritative" ? "ชั้นเขตป่าทางการ" : FOREST_DATA_SOURCE_OSM,
    attribution: FOREST_ATTRIBUTION,
    calculatedAt,
  };
}

function emptyOverlay(
  status: ForestOverlayStatus,
  dataAuthority: ForestDataAuthority,
  calculatedAt: string,
): ForestOverlayResult {
  return {
    version: FOREST_OVERLAY_VERSION,
    status,
    nearestDistanceM: null,
    zones: [],
    dataAuthority,
    dataSource: dataAuthority === "authoritative" ? "ชั้นเขตป่าทางการ" : FOREST_DATA_SOURCE_OSM,
    attribution: FOREST_ATTRIBUTION,
    calculatedAt,
  };
}

/** sanitize / clamp ผลที่เก็บใน gis — ไม่รับ geometry */
export function cleanForestOverlay(value: unknown): ForestOverlayResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const status = v.status;
  if (status !== "in" && status !== "near" && status !== "out" && status !== "unknown") return undefined;
  const dataAuthority: ForestDataAuthority = v.dataAuthority === "authoritative" ? "authoritative" : "osm-reference";
  const rawZones = Array.isArray(v.zones) ? v.zones : [];
  const zones: ForestZoneHit[] = [];
  for (const raw of rawZones.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const z = raw as Record<string, unknown>;
    const name = typeof z.name === "string" ? z.name.trim().slice(0, 200) : "";
    if (!name) continue;
    const kind = FOREST_ZONE_KINDS.includes(z.kind as ForestZoneKind)
      ? (z.kind as ForestZoneKind)
      : "unclassified";
    const relation = z.relation === "in" || z.relation === "near" ? z.relation : null;
    if (!relation) continue;
    const distanceM = Number(z.distanceM);
    if (!Number.isFinite(distanceM) || distanceM < 0 || distanceM > 100_000) continue;
    zones.push({ name, kind, relation, distanceM: Math.round(distanceM) });
  }
  const nearestRaw = Number(v.nearestDistanceM);
  const nearestDistanceM =
    Number.isFinite(nearestRaw) && nearestRaw >= 0 && nearestRaw <= 100_000 ? Math.round(nearestRaw) : null;

  return {
    version: typeof v.version === "string" && v.version.trim() ? v.version.trim().slice(0, 20) : FOREST_OVERLAY_VERSION,
    status,
    nearestDistanceM: status === "unknown" ? null : nearestDistanceM,
    zones,
    dataAuthority,
    dataSource:
      typeof v.dataSource === "string" && v.dataSource.trim()
        ? v.dataSource.trim().slice(0, 300)
        : dataAuthority === "authoritative"
          ? "ชั้นเขตป่าทางการ"
          : FOREST_DATA_SOURCE_OSM,
    attribution:
      typeof v.attribution === "string" && v.attribution.trim()
        ? v.attribution.trim().slice(0, 200)
        : FOREST_ATTRIBUTION,
    calculatedAt: typeof v.calculatedAt === "string" ? v.calculatedAt.slice(0, 40) : "",
  };
}

const cache = new Map<string, ForestBoundary[]>();

function cacheKey(lat: number, lng: number, radiusM: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)},${radiusM}`;
}

/**
 * ดึงแนวเขตป่ารอบจุดจาก Overpass — โยน Error เมื่อทุก endpoint ล้มเหลว
 * คืน [] เมื่อโหลดสำเร็จแต่ไม่พบเขต (ผู้เรียกต้อง classify เป็น unknown ไม่ใช่ out ทั้งประเทศ)
 */
export async function fetchForestBoundaries(
  lat: number,
  lng: number,
  radiusM: number = FOREST_FETCH_RADIUS_M,
  signal?: AbortSignal,
): Promise<ForestBoundary[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("พิกัดสำหรับดึงแนวเขตป่าไม่ถูกต้อง");
  }

  const key = cacheKey(lat, lng, radiusM);
  const cached = cache.get(key);
  if (cached) return cached;

  const query = overpassForestQuery(lat, lng, radiusM);
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
      const boundaries = parseOverpassForestBoundaries(await response.json());
      cache.set(key, boundaries);
      return boundaries;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `โหลดแนวเขตป่าไม่สำเร็จ: ${lastError.message}`
      : "โหลดแนวเขตป่าจาก OpenStreetMap ไม่สำเร็จ",
  );
}

/** ล้าง cache (เทสต์ / รีเฟรชชั้น) */
export function clearForestBoundaryCache(): void {
  cache.clear();
}
