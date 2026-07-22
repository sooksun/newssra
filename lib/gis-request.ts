// ตัวประมวลผล request GIS ที่ใช้ร่วมกัน — pure/framework-free (ห้าม import next/* หรือ node API)
// ดึงตรรกะ "วัตถุดิบดิบ → GisAnalysis ที่ผ่านการคำนวณ/clamp/finalize" ออกจาก route handler
// เพื่อให้ทั้ง legacy POST /api/assessments/[id]/gis และ endpoint /from-map (map-to-assessment autofill)
// เรียกใช้โค้ดชุดเดียวกัน — กัน logic drift ระหว่างสองทางเข้า
//
// หลักการเดิมยังอยู่ครบ: client ส่งวัตถุดิบ (พิกัด/ระยะ-เวลา OSRM ดิบ/ความสูงที่สุ่มจากเบราว์เซอร์) เท่านั้น
// server เป็นผู้คำนวณ ratio ทุกตัวใหม่เสมอ — ค่าที่ client คำนวณมาเองถูกทิ้งทั้งหมด

import {
  buildRouteAnalysis,
  cleanAreaSummary,
  cleanHighestPoint,
  clampGisPayload,
  finalizeGisAnalysis,
  routePhysicsIssue,
  MAX_GIS_ROUTES,
} from "./gis";
import type { RawGisRouteInput } from "./gis";
import { GIS_DESTINATION_TYPES } from "./types";
import type {
  GisAnalysis,
  GisAreaSummary,
  GisDataSources,
  GisDestinationType,
  GisRadiusSummary,
  GisRouteAnalysis,
} from "./types";

export type GisRequestErrorCode = "INVALID_CENTER" | "INVALID_GIS" | "NO_VALID_ROUTE";

/** error ที่มี code คงที่ — ผู้เรียก (route handler) map เป็น HTTP status ได้เอง */
export class GisRequestError extends Error {
  constructor(
    public readonly code: GisRequestErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface GisRequestContext {
  provinceName: string;
  provinceAvgElev: number | null;
  now: string;
  previousAreaSummary: GisAreaSummary | undefined;
  /** true = ต้องมีเส้นทางศาลากลางจังหวัดที่ใช้ได้อย่างน้อย 1 เส้น (ใช้กับ /from-map); default false (legacy /gis) */
  requireProvinceRoute?: boolean;
}

export interface GisRequestResult {
  gis: GisAnalysis;
  droppedRoutes: string[];
}

function asNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

/** แปลง entry ดิบจาก payload เป็น RawGisRouteInput (ยังไม่ validate ตัวเลข — buildRouteAnalysis เป็นคนตัดสิน)
 * คัดลอกเฉพาะ: ประเภท/ชื่อปลายทาง, พิกัดปลายทาง, ระยะ-เวลาดิบ, ความสูงสะสมขึ้น/ลง, สถานะเลือก
 * ไม่รับ ratio/score/community class/timestamp ใด ๆ จาก client */
function toRawRoute(item: unknown): RawGisRouteInput | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  const destinationType = (GIS_DESTINATION_TYPES as readonly string[]).includes(r.destinationType as string)
    ? (r.destinationType as GisDestinationType)
    : "other";
  return {
    destinationType,
    destinationName: typeof r.destinationName === "string" ? r.destinationName.slice(0, 200) : "",
    destLat: asNum(r.destLat),
    destLng: asNum(r.destLng),
    roadDistanceM: asNum(r.roadDistanceM),
    durationS: asNum(r.durationS),
    elevationGainM: typeof r.elevationGainM === "number" && Number.isFinite(r.elevationGainM) ? r.elevationGainM : null,
    elevationLossM: typeof r.elevationLossM === "number" && Number.isFinite(r.elevationLossM) ? r.elevationLossM : null,
    selected: r.selected === true,
  };
}

/** จุดสูงสุดตามเส้นทาง (จาก item.highestPoint ดิบ) — validate ผ่าน cleanHighestPoint เดียวกับ sanitizeGis */
function cleanRouteHighestPoint(item: unknown) {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  return cleanHighestPoint(r.highestPoint);
}

/**
 * ประมวลผล payload GIS ดิบจาก client → GisAnalysis ที่คำนวณ/clamp/finalize ครบ
 * throw GisRequestError เมื่อพิกัดศูนย์กลางใช้ไม่ได้, payload ผิดรูปแบบ, หรือ (เมื่อ requireProvinceRoute)
 * ไม่มีเส้นทางศาลากลางจังหวัดที่ใช้ได้เลยสักเส้น
 */
export function buildGisFromMapRequest(input: unknown, context: GisRequestContext): GisRequestResult {
  if (!input || typeof input !== "object") {
    throw new GisRequestError("INVALID_GIS", "รูปแบบข้อมูล GIS ไม่ถูกต้อง");
  }
  const body = input as Record<string, unknown>;
  const center = body.center && typeof body.center === "object"
    ? (body.center as Record<string, unknown>)
    : {};
  const lat = asNum(center.lat);
  const lng = asNum(center.lng);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new GisRequestError("INVALID_CENTER", "พิกัดศูนย์กลางไม่ถูกต้อง");
  }

  const routes: GisRouteAnalysis[] = [];
  const droppedRoutes: string[] = [];
  for (const item of Array.isArray(body.routes) ? body.routes.slice(0, MAX_GIS_ROUTES) : []) {
    const raw = toRawRoute(item);
    if (!raw) continue;
    const route = buildRouteAnalysis(lat, lng, raw, context.now);
    if (!route) {
      droppedRoutes.push(`เส้นทางไป${raw.destinationName || "จุดหมาย"}: ข้อมูลระยะทาง/เวลา/พิกัดใช้ไม่ได้`);
      continue;
    }
    const issue = routePhysicsIssue(route.roadDistanceKm, route.straightDistanceKm, route.averageSpeedKmh);
    if (issue) {
      droppedRoutes.push(`เส้นทางไป${route.destinationName || "จุดหมาย"}: ${issue}`);
      continue;
    }
    routes.push({ ...route, highestPoint: cleanRouteHighestPoint(item) });
  }
  if (context.requireProvinceRoute && !routes.some((route) => route.destinationType === "province_hall")) {
    throw new GisRequestError("NO_VALID_ROUTE", "ยังไม่มีเส้นทางจากศาลากลางจังหวัดที่ใช้ได้");
  }

  const source = center.source === "unit" || center.source === "search" ? center.source : "map-pin";
  const draft: GisAnalysis = {
    center: {
      lat,
      lng,
      source,
      confirmedAt: context.now,
      nearestProvinceName: context.provinceName,
    },
    elevation: body.elevation && typeof body.elevation === "object"
      ? (body.elevation as GisAnalysis["elevation"])
      : null,
    routes,
    autoScore: null,
    // placeholder — ผู้เรียก (route handler) เป็นเจ้าของฟิลด์นี้เสมอและเขียนทับค่าจริงทันทีหลังเรียกฟังก์ชันนี้
    // (/gis คำนวณจาก willApply, /from-map คำนวณใน applyMapGisToState) จึงไม่มีประโยชน์ที่จะคำนวณค่าจริงที่นี่
    appliedToResponses: false,
    savedAt: context.now,
  };
  const incomingArea = cleanAreaSummary(body.areaSummary);
  if (incomingArea) draft.areaSummary = incomingArea;
  else if (context.previousAreaSummary) draft.areaSummary = context.previousAreaSummary;
  if (Array.isArray(body.radiusSummaries)) {
    draft.radiusSummaries = body.radiusSummaries as GisRadiusSummary[];
  }
  if (body.dataSources && typeof body.dataSources === "object") {
    draft.dataSources = body.dataSources as GisDataSources;
  }

  const clamped = clampGisPayload(draft);
  if (!clamped) throw new GisRequestError("INVALID_GIS", "ข้อมูล GIS ไม่ถูกต้อง");
  return {
    gis: finalizeGisAnalysis(clamped, {
      provinceAvgElev: context.provinceAvgElev,
      calculatedAt: context.now,
    }),
    droppedRoutes,
  };
}
