// ชั้นป่า 3 ชั้นสำหรับคัดกรองโรงเรียนพื้นที่สูง — pure, framework-free
//
// A. Forest Status  = สภาพพื้นที่ป่าจริง (เป้า: กรมป่าไม้ GIS) — Core Layer
// B. Forest Legal   = เขตตามกฎหมาย (ป่าสงวน/อุทยาน/…) — ตอนนี้ map จาก OSM forestBoundaries
// C. Forest Context = % ป่าในรัศมี 1/3/5 กม. + ระยะ + ชนิด — แยก "เมืองบนดอย" ออกจาก "ถิ่นป่า"
//
// ห้ามยุบเป็น forest = 0/1 ตัวเดียว
// สเปก: docs/superpowers/specs/2026-08-07-forest-three-layers-highland-design.md
//
// ห้าม import lib/gis.ts (กัน circular)

import type { ForestOverlayResult, ForestZoneKind } from "./map/forestBoundaries";
import { FOREST_KIND_LABELS } from "./map/forestBoundaries";

export const FOREST_LAYERS_VERSION = "fl-1";

/** รัศมีมาตรฐานสำหรับ % พื้นที่ป่า (ม.) */
export const FOREST_CONTEXT_RADII_M = [1_000, 3_000, 5_000] as const;

/** % ป่าใน 1 กม. ที่ถือว่า context แข็ง (ถูกล้อมด้วยป่า) — ปรับได้หลังสอบเทียบ */
export const FOREST_CONTEXT_STRONG_1KM_PCT = 40;
/** % ป่าใน 3 กม. ที่ถือว่า context แข็ง */
export const FOREST_CONTEXT_STRONG_3KM_PCT = 50;
/** % ป่าใน 1 กม. ระดับอ่อน (ต้องคู่ elev/access) */
export const FOREST_CONTEXT_WEAK_1KM_PCT = 15;

/** แหล่งชั้นสถานภาพ/proxy ป่า
 *  rfd-forest-cover = สภาพป่าจริงตามนิยามกรมป่าไม้ (core)
 *  rfd-national-reserved-forest = แนวเขตป่าสงวน (กฎหมาย) ใช้คำนวณ inside/ระยะ/% ชั่วคราว — ไม่ใช่สถานภาพป่าจริง
 */
export type ForestStatusAuthority = "rfd-forest-cover" | "rfd-national-reserved-forest" | "unknown";

/** แหล่งชั้นเขตตามกฎหมาย */
export type ForestLegalAuthority = "osm-reference" | "authoritative" | "unknown";

/** แหล่งชั้นชนิดป่า */
export type ForestTypeAuthority = "dnp-forest-type" | "unknown";

export type Binary01 = 0 | 1;

/** ชั้น A — สภาพพื้นที่ป่า (กรมป่าไม้) */
export interface ForestStatusLayer {
  /** 1 = จุดโรงเรียนทับ class ป่าตามนิยามกรมป่าไม้ */
  inside: Binary01 | null;
  /** ระยะถึงขอบป่าสถานภาพ (ม.); inside → 0 */
  distanceM: number | null;
  /** % พื้นที่ป่าในรัศมี 1/3/5 กม. */
  pct1km: number | null;
  pct3km: number | null;
  pct5km: number | null;
  /** ปี พ.ศ. ของชั้นข้อมูล (เช่น 2568) */
  yearBe: number | null;
  gridResolutionM: number | null;
  authority: ForestStatusAuthority;
  dataSource: string;
  attribution: string;
}

/** ชั้น B — เขตตามกฎหมาย */
export interface ForestLegalLayer {
  inside: Binary01 | null;
  distanceM: number | null;
  /** อุทยาน / เขตรักษาพันธุ์ / ห้ามล่า / วนอุทยาน / ชีวมณฑล ฯ (ไม่นับแค่สงวนอย่างเดียวก็ได้รวม) */
  protectedArea: Binary01 | null;
  /** ป่าสงวนแห่งชาติ */
  reserveForest: Binary01 | null;
  zones: Array<{ name: string; kind: ForestZoneKind; relation: "in" | "near"; distanceM: number }>;
  authority: ForestLegalAuthority;
  dataSource: string;
  attribution: string;
}

/** ชั้น C ชนิดป่า (นิเวศ) */
export interface ForestTypeLayer {
  typeLabelTh: string | null;
  typeCode: string | null;
  authority: ForestTypeAuthority;
  dataSource: string;
  attribution: string;
}

/**
 * Flat metrics — ใช้ใน screen/รายงาน
 * null = ชั้นนั้นยังไม่มีข้อมูล (ห้ามตีความเป็น "ไม่ใช่ป่า")
 */
export interface ForestFlatMetrics {
  forest_inside: Binary01 | null;
  forest_distance_m: number | null;
  forest_1km_pct: number | null;
  forest_3km_pct: number | null;
  forest_5km_pct: number | null;
  forest_type: string | null;
  forest_type_code: string | null;
  protected_area: Binary01 | null;
  reserve_forest: Binary01 | null;
  legal_distance_m: number | null;
  /** แหล่งที่ใช้ forest_inside หลัก: status | legal | none */
  insideSource: "status" | "legal" | "none";
}

export type ForestContextStrength = "strong" | "weak" | "none" | "unknown";

export interface ForestAnalysis {
  version: string;
  status: ForestStatusLayer | null;
  legal: ForestLegalLayer | null;
  type: ForestTypeLayer | null;
  metrics: ForestFlatMetrics;
  /** strong/weak จาก % รัศมี เมื่อมี status; unknown ถ้าไม่มี status */
  contextStrength: ForestContextStrength;
  missing: string[];
  calculatedAt: string;
}

/** kind ที่นับเป็น "พื้นที่คุ้มครอง" (ไม่ใช่แค่ป่าสงวน) */
const PROTECTED_KINDS: ReadonlySet<ForestZoneKind> = new Set([
  "national_park",
  "wildlife_sanctuary",
  "non_hunting",
  "forest_park",
  "biosphere_reserve",
  "wetland_protected",
  "other_protected",
]);

/**
 * แปลงผล Legal จาก OSM/ทางการ (forestBoundaries) → ชั้น B
 */
export function legalLayerFromOverlay(overlay: ForestOverlayResult | null | undefined): ForestLegalLayer | null {
  if (!overlay) return null;
  if (overlay.status === "unknown") {
    return {
      inside: null,
      distanceM: null,
      protectedArea: null,
      reserveForest: null,
      zones: [],
      authority: overlay.dataAuthority === "authoritative" ? "authoritative" : "osm-reference",
      dataSource: overlay.dataSource,
      attribution: overlay.attribution,
    };
  }

  const inside: Binary01 = overlay.status === "in" ? 1 : 0;
  const inZones = overlay.zones.filter((z) => z.relation === "in");
  const nearOrIn = overlay.zones;
  const reserveForest: Binary01 = inZones.some((z) => z.kind === "national_reserved_forest") ? 1 : 0;
  const protectedArea: Binary01 = inZones.some((z) => PROTECTED_KINDS.has(z.kind)) ? 1 : 0;

  return {
    inside,
    distanceM: overlay.nearestDistanceM,
    protectedArea: nearOrIn.length ? protectedArea : inside === 1 ? 0 : 0,
    reserveForest,
    zones: overlay.zones.map((z) => ({
      name: z.name,
      kind: z.kind,
      relation: z.relation,
      distanceM: z.distanceM,
    })),
    authority: overlay.dataAuthority === "authoritative" ? "authoritative" : "osm-reference",
    dataSource: overlay.dataSource,
    attribution: overlay.attribution,
  };
}

/**
 * รวม 3 ชั้น → metrics + contextStrength
 * forest_inside ใช้ Status เป็นหลัก; ถ้าไม่มี status ถอย legal แต่ insideSource บอกชัด
 */
export function buildForestAnalysis(parts: {
  status?: ForestStatusLayer | null;
  legal?: ForestLegalLayer | null;
  type?: ForestTypeLayer | null;
  /** backward compat: map จาก forestOverlay เดิม */
  legalOverlay?: ForestOverlayResult | null;
  calculatedAt?: string;
}): ForestAnalysis {
  const calculatedAt = parts.calculatedAt ?? new Date().toISOString();
  const status = parts.status ?? null;
  const legal = parts.legal ?? legalLayerFromOverlay(parts.legalOverlay) ?? null;
  const type = parts.type ?? null;

  const missing: string[] = [];
  if (!status) missing.push("ชั้นสภาพพื้นที่ป่า (กรมป่าไม้) ยังไม่มี");
  if (!legal) missing.push("ชั้นเขตตามกฎหมายยังไม่มี");
  if (!type) missing.push("ชั้นชนิดป่ายังไม่มี");

  let forest_inside: Binary01 | null = null;
  let forest_distance_m: number | null = null;
  let insideSource: ForestFlatMetrics["insideSource"] = "none";

  if (status && status.inside !== null) {
    forest_inside = status.inside;
    forest_distance_m = status.distanceM;
    insideSource = "status";
  } else if (legal && legal.inside !== null) {
    forest_inside = legal.inside;
    forest_distance_m = legal.distanceM;
    insideSource = "legal";
  }

  const metrics: ForestFlatMetrics = {
    forest_inside,
    forest_distance_m,
    forest_1km_pct: status?.pct1km ?? null,
    forest_3km_pct: status?.pct3km ?? null,
    forest_5km_pct: status?.pct5km ?? null,
    forest_type: type?.typeLabelTh ?? null,
    forest_type_code: type?.typeCode ?? null,
    protected_area: legal?.protectedArea ?? null,
    reserve_forest: legal?.reserveForest ?? null,
    legal_distance_m: legal?.distanceM ?? null,
    insideSource,
  };

  const contextStrength = deriveContextStrength(status);

  return {
    version: FOREST_LAYERS_VERSION,
    status,
    legal,
    type,
    metrics,
    contextStrength,
    missing,
    calculatedAt,
  };
}

export function deriveContextStrength(status: ForestStatusLayer | null): ForestContextStrength {
  if (!status) return "unknown";
  const p1 = status.pct1km;
  const p3 = status.pct3km;
  if (status.inside === 1) return "strong";
  if (p1 === null && p3 === null) {
    if (status.distanceM !== null && status.distanceM <= 1_000) return "weak";
    return "none";
  }
  if (
    (p1 !== null && p1 >= FOREST_CONTEXT_STRONG_1KM_PCT) ||
    (p3 !== null && p3 >= FOREST_CONTEXT_STRONG_3KM_PCT)
  ) {
    return "strong";
  }
  if (p1 !== null && p1 >= FOREST_CONTEXT_WEAK_1KM_PCT) return "weak";
  if (status.distanceM !== null && status.distanceM <= 1_000) return "weak";
  return "none";
}

/**
 * “เมืองบนดอย” — สูงจริงแต่บริบทรอบไม่ใช่ป่า
 * ใช้ review flag ไม่ตัด elev gate
 */
export function isHighElevLowForestContext(input: {
  elevGate: boolean;
  largeCommunity: boolean;
  forest1kmPct: number | null;
}): boolean {
  if (!input.elevGate || !input.largeCommunity) return false;
  if (input.forest1kmPct === null) return false;
  return input.forest1kmPct < FOREST_CONTEXT_WEAK_1KM_PCT;
}

function clampPct(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || v > 100) return null;
  return Math.round(v * 10) / 10;
}

function clamp01(n: unknown): Binary01 | null {
  if (n === 0 || n === 1) return n;
  if (n === true) return 1;
  if (n === false) return 0;
  return null;
}

function clampDist(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || v > 500_000) return null;
  return Math.round(v);
}

/** sanitize ชั้น status จาก JSON */
export function cleanForestStatusLayer(raw: unknown): ForestStatusLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const authority: ForestStatusAuthority =
    v.authority === "rfd-forest-cover"
      ? "rfd-forest-cover"
      : v.authority === "rfd-national-reserved-forest"
        ? "rfd-national-reserved-forest"
        : "unknown";
  return {
    inside: clamp01(v.inside),
    distanceM: clampDist(v.distanceM),
    pct1km: clampPct(v.pct1km),
    pct3km: clampPct(v.pct3km),
    pct5km: clampPct(v.pct5km),
    yearBe:
      typeof v.yearBe === "number" && Number.isFinite(v.yearBe) && v.yearBe >= 2500 && v.yearBe <= 2700
        ? Math.round(v.yearBe)
        : null,
    gridResolutionM: clampDist(v.gridResolutionM),
    authority,
    dataSource: typeof v.dataSource === "string" ? v.dataSource.slice(0, 300) : "",
    attribution: typeof v.attribution === "string" ? v.attribution.slice(0, 200) : "",
  };
}

export function cleanForestTypeLayer(raw: unknown): ForestTypeLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const label = typeof v.typeLabelTh === "string" ? v.typeLabelTh.trim().slice(0, 100) : null;
  const code = typeof v.typeCode === "string" ? v.typeCode.trim().slice(0, 40) : null;
  if (!label && !code) return null;
  return {
    typeLabelTh: label,
    typeCode: code,
    authority: v.authority === "dnp-forest-type" ? "dnp-forest-type" : "unknown",
    dataSource: typeof v.dataSource === "string" ? v.dataSource.slice(0, 300) : "",
    attribution: typeof v.attribution === "string" ? v.attribution.slice(0, 200) : "",
  };
}

export function cleanForestLegalLayer(raw: unknown): ForestLegalLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const authority: ForestLegalAuthority =
    v.authority === "authoritative" ? "authoritative" : v.authority === "osm-reference" ? "osm-reference" : "unknown";
  const zonesRaw = Array.isArray(v.zones) ? v.zones : [];
  const zones: ForestLegalLayer["zones"] = [];
  for (const z of zonesRaw.slice(0, 20)) {
    if (!z || typeof z !== "object") continue;
    const row = z as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 200) : "";
    if (!name) continue;
    const kind = (row.kind as ForestZoneKind) in FOREST_KIND_LABELS ? (row.kind as ForestZoneKind) : "unclassified";
    const relation = row.relation === "in" || row.relation === "near" ? row.relation : null;
    if (!relation) continue;
    const distanceM = clampDist(row.distanceM) ?? 0;
    zones.push({ name, kind, relation, distanceM });
  }
  return {
    inside: clamp01(v.inside),
    distanceM: clampDist(v.distanceM),
    protectedArea: clamp01(v.protectedArea),
    reserveForest: clamp01(v.reserveForest),
    zones,
    authority,
    dataSource: typeof v.dataSource === "string" ? v.dataSource.slice(0, 300) : "",
    attribution: typeof v.attribution === "string" ? v.attribution.slice(0, 200) : "",
  };
}

/**
 * sanitize ผลรวม 3 ชั้น — ถ้ามีแค่ legal/status บางส่วนยังรอด
 * ถ้าไม่มีอะไรเลย → undefined
 */
export function cleanForestAnalysis(raw: unknown): ForestAnalysis | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const status = cleanForestStatusLayer(v.status);
  const legal = cleanForestLegalLayer(v.legal);
  const type = cleanForestTypeLayer(v.type);
  if (!status && !legal && !type) return undefined;
  return buildForestAnalysis({
    status,
    legal,
    type,
    calculatedAt: typeof v.calculatedAt === "string" ? v.calculatedAt.slice(0, 40) : new Date().toISOString(),
  });
}

/** ป้าย context ภาษาไทย */
export function forestContextStrengthLabelTh(s: ForestContextStrength): string {
  switch (s) {
    case "strong":
      return "ถูกล้อมด้วยพื้นที่ป่า (บริบทแข็ง)";
    case "weak":
      return "มีพื้นที่ป่าในรัศมี (บริบทอ่อน)";
    case "none":
      return "บริบทรอบไม่ใช่พื้นที่ป่าชัดเจน";
    default:
      return "ยังไม่มีชั้นสภาพพื้นที่ป่า";
  }
}
