// ตัวประมวลผล request GIS ที่ใช้ร่วมกัน — pure/framework-free (ห้าม import next/* หรือ node API)
// ดึงตรรกะ "วัตถุดิบดิบ → GisAnalysis ที่ผ่านการคำนวณ/clamp/finalize" ออกจาก route handler
// เพื่อให้ทั้ง legacy POST /api/assessments/[id]/gis และ endpoint /from-map (map-to-assessment autofill)
// เรียกใช้โค้ดชุดเดียวกัน — กัน logic drift ระหว่างสองทางเข้า
//
// หลักการเดิมยังอยู่ครบ: client ส่งวัตถุดิบ (พิกัด/ระยะ-เวลา OSRM ดิบ/ความสูงที่สุ่มจากเบราว์เซอร์) เท่านั้น
// server เป็นผู้คำนวณ ratio ทุกตัวใหม่เสมอ — ค่าที่ client คำนวณมาเองถูกทิ้งทั้งหมด

import {
  buildRouteAccess,
  buildRouteAnalysis,
  cleanAreaSummary,
  cleanHighestPoint,
  clampGisPayload,
  finalizeGisAnalysis,
  routePhysicsIssue,
  MAX_GIS_ROUTES,
  NO_ROUTE_REASONS,
} from "./gis";
import type { NoRouteReason, RawGisRouteInput } from "./gis";
import { cleanSectorConfig, cleanSectorElevations, SECTOR_RADIUS_M, SECTOR_RELIEF_K_M } from "./gis-sectors";
import { buildForestAnalysis, cleanForestAnalysis } from "./forest-layers";
import { cleanForestOverlay } from "./map/forestBoundaries";
import { GIS_DESTINATION_TYPES } from "./types";
import type {
  GisAnalysis,
  GisAreaSummary,
  GisDataSources,
  GisDestinationType,
  GisRadiusSummary,
  GisRouteAnalysis,
  GisSectorConfig,
  GisSectorElevation,
} from "./types";

export type GisRequestErrorCode = "INVALID_CENTER" | "INVALID_GIS";

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
  /** ธง 8 ทิศที่บันทึกไว้เดิม — ใช้ต่อเมื่อ payload รอบนี้ไม่ได้ส่งมา (กันข้อมูลหายเมื่อบันทึกคนละจังหวะ) */
  previousSectorElevations?: GisSectorElevation[] | undefined;
  previousSectorConfig?: GisSectorConfig | undefined;
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
    mountainPct: typeof r.mountainPct === "number" && Number.isFinite(r.mountainPct) ? r.mountainPct : null,
    elevationLossM: typeof r.elevationLossM === "number" && Number.isFinite(r.elevationLossM) ? r.elevationLossM : null,
    selected: r.selected === true,
    // ช่วงเดินเท้าต่อท้าย — ค่าดิบจากเครื่องคำนวณเส้นทาง (เมตร/วินาที) เหมือน roadDistanceM/durationS
    walkDistanceM: asNum(r.walkDistanceM),
    walkDurationS: asNum(r.walkDurationS),
    walkDestSnapM: asNum(r.walkDestSnapM),
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
 * throw GisRequestError เมื่อพิกัดศูนย์กลางใช้ไม่ได้ หรือ payload ผิดรูปแบบ
 *
 * ไม่มีเส้นทางศาลากลางจังหวัด "ไม่ใช่" ความผิดพลาดอีกต่อไป — บันทึกเป็น gis.routeAccess พร้อมเหตุผลแทน
 * (ดูเหตุผลที่คอมเมนต์ก่อนเรียก buildRouteAccess ด้านล่าง)
 */
export function buildGisFromMapRequest(input: unknown, context: GisRequestContext): GisRequestResult {
  if (!input || typeof input !== "object") {
    throw new GisRequestError("INVALID_GIS", "รูปแบบข้อมูล GIS ไม่ถูกต้อง");
  }
  const body = input as Record<string, unknown>;
  const center = body.center && typeof body.center === "object" ? (body.center as Record<string, unknown>) : {};
  const lat = asNum(center.lat);
  const lng = asNum(center.lng);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new GisRequestError("INVALID_CENTER", "พิกัดศูนย์กลางไม่ถูกต้อง");
  }

  const routes: GisRouteAnalysis[] = [];
  const droppedRoutes: string[] = [];
  // ระยะที่เครื่องคำนวณเส้นทาง snap ปลายทางไปจากโรงเรียน (ค่าดิบจาก client เหมือน roadDistanceM/durationS)
  let provinceDestSnapM: number | null = null;
  for (const item of Array.isArray(body.routes) ? body.routes.slice(0, MAX_GIS_ROUTES) : []) {
    const raw = toRawRoute(item);
    if (!raw) continue;
    const snap = asNum((item as Record<string, unknown>)?.destSnapM);
    if (raw.destinationType === "province_hall" && Number.isFinite(snap) && snap >= 0) {
      provinceDestSnapM = snap;
    }
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
  // สถานะการเข้าถึงด้วยถนน — server สรุปเองจากค่าดิบ ไม่รับ status/note จาก client
  //
  // เดิมที่นี่ throw NO_VALID_ROUTE เมื่อไม่มีเส้นทางศาลากลาง ทำให้โรงเรียนที่ถนนเข้าไม่ถึงจริง
  // (กลุ่มที่ควรได้คะแนนความยากลำบากสูงสุด) บันทึกแบบประเมินจากแผนที่ไม่ได้เลย — กลับหัวกลับหางกับ
  // เจตนาของเกณฑ์ ตอนนี้บันทึกได้ โดยเก็บ "เหตุผลที่ไม่มีเส้นทาง" ไว้เป็นหลักฐานแทนตัวเลขที่ไม่มีจริง
  const hasProvinceRoute = routes.some((route) => route.destinationType === "province_hall");
  const routeAccess = buildRouteAccess({
    hasProvinceRoute,
    destSnapM: provinceDestSnapM,
    noRouteReason: cleanNoRouteReason(body.noRouteReason),
    walkLeg: routes.find((route) => route.destinationType === "province_hall")?.walkLeg ?? null,
  });

  const source = center.source === "unit" || center.source === "search" ? center.source : "map-pin";
  const draft: GisAnalysis = {
    center: {
      lat,
      lng,
      source,
      confirmedAt: context.now,
      nearestProvinceName: context.provinceName,
    },
    elevation:
      body.elevation && typeof body.elevation === "object" ? (body.elevation as GisAnalysis["elevation"]) : null,
    routes,
    autoScore: null,
    // placeholder — ผู้เรียก (route handler) เป็นเจ้าของฟิลด์นี้เสมอและเขียนทับค่าจริงทันทีหลังเรียกฟังก์ชันนี้
    // (/gis คำนวณจาก willApply, /from-map คำนวณใน applyMapGisToState) จึงไม่มีประโยชน์ที่จะคำนวณค่าจริงที่นี่
    appliedToResponses: false,
    routeAccess,
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

  // ── ธงจุดสูงสุด/ต่ำสุด 8 ทิศ ───────────────────────────────────────────────
  // client ส่งได้เฉพาะพิกัด+ความสูงดิบของแต่ละจุด ส่วน relief / ส่วนต่างจากโรงเรียน / เกินเกณฑ์ K
  // คำนวณใหม่ที่นี่เสมอผ่าน cleanSectorElevations → deriveSectorMetrics
  // รัศมีและค่า K มาจากค่าคงที่ในโค้ดฝั่ง server เท่านั้น ไม่รับจาก client
  const rawSectorConfig = cleanSectorConfig(body.sectorConfig);
  const sectorElevations = cleanSectorElevations(
    body.sectorElevations,
    rawSectorConfig?.schoolElevationM ?? null,
    SECTOR_RELIEF_K_M,
  );
  if (sectorElevations) {
    draft.sectorElevations = sectorElevations;
    draft.sectorConfig = {
      radiusM: SECTOR_RADIUS_M,
      thresholdM: SECTOR_RELIEF_K_M,
      schoolElevationM: rawSectorConfig?.schoolElevationM ?? null,
      schoolElevationSource: rawSectorConfig?.schoolElevationSource ?? "route-profile",
    };
  } else if (context.previousSectorElevations) {
    draft.sectorElevations = context.previousSectorElevations;
    if (context.previousSectorConfig) draft.sectorConfig = context.previousSectorConfig;
  }

  // แนวเขตป่า (Legal) + ชั้นป่า 3 ชั้น — client ส่งผลทับซ้อน ไม่ใช่ geometry
  const forestOverlay = cleanForestOverlay(body.forestOverlay);
  if (forestOverlay) draft.forestOverlay = forestOverlay;
  const forestAnalysis =
    cleanForestAnalysis(body.forestAnalysis) ??
    (forestOverlay ? buildForestAnalysis({ legalOverlay: forestOverlay, calculatedAt: context.now }) : undefined);
  if (forestAnalysis) draft.forestAnalysis = forestAnalysis;

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

/** เหตุที่ไม่มีเส้นทางที่ client แจ้งมา — รับเฉพาะค่าในรายการ NO_ROUTE_REASONS (ไม่รับข้อความอิสระ) */
function cleanNoRouteReason(value: unknown): NoRouteReason | null {
  return typeof value === "string" && (NO_ROUTE_REASONS as readonly string[]).includes(value)
    ? (value as NoRouteReason)
    : null;
}
