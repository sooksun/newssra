// เครื่องมือวิเคราะห์ GIS (pure function ล้วน) — ใช้ร่วมกันทั้ง client (แสดงผลทันที) และ server
// (คำนวณจริงตอนบันทึกผ่าน POST /api/assessments/[id]/gis) แบบเดียวกับ lib/scoring.ts
//
// ข้อควรระวังการ import: ห้าม import lib/scoring.ts (scoring import โมดูลนี้ — กัน circular import)
// และห้ามพึ่ง framework/node API ใด ๆ — ต้องรันได้ทั้งเบราว์เซอร์และ server

import { haversineM } from "./map/morphology";
import {
  computeCommunityClass as computeCommunityClassCore,
  suggestSettingTypeFromGis as suggestSettingTypeFromGisCore,
} from "./community-class";
import { settlementClass } from "./settlement";
import { GIS_DESTINATION_TYPES } from "./types";
import type {
  AssessmentState,
  GisAnalysis,
  GisAreaSummary,
  GisAutoScore,
  GisCommunityClass,
  GisDataSources,
  GisDestinationType,
  GisElevationInfo,
  GisRadiusSummary,
  GisRouteAnalysis,
  GisRouteHighestPoint,
  IndicatorId,
  ResponseData,
  ScoringVersion,
  SettingType,
} from "./types";

// Re-export community + settlement + legend (stable import path @/lib/gis for existing callers)
export {
  COMMUNITY_ACCESS_HARD_MIN,
  COMMUNITY_CLASS_VERSION,
  COMMUNITY_COMPOSITES,
  COMMUNITY_COMPOSITE_KEYS,
  COMMUNITY_DASHBOARD_LABELS,
  COMMUNITY_DASHBOARD_NONE_KEY,
  COMMUNITY_DASHBOARD_ORDER,
  COMMUNITY_LIST_UNINDEXED_KEY,
  COMMUNITY_LIST_UNINDEXED_LABEL,
  COMMUNITY_HIGHLAND_MIN_M,
  COMMUNITY_HIGH_MOUNTAIN_M,
  classifyCommunity,
  communityAxisATierLabelTh,
  isCommunityCompositeKey,
  isCommunityElevHigh,
  landformSuggestsHighland,
} from "./community-class";
export type { ClassifyCommunityInput, CommunityDashboardKey } from "./community-class";
export {
  SSRA_HILL_ELEV_MIN_M,
  SSRA_MOUNTAIN_ELEV_MIN_M,
  landformAppLabelNoteTh,
  landformThresholdLegendRows,
  officialElevBandTh,
} from "./landform-legend";
export { settlementClass } from "./settlement";
export type { SettlementTone } from "./settlement";
export {
  estimateWscClass,
  wscProxySuggestsFlat,
  wscProxySuggestsUpland,
  WSC_CLASS_LABELS,
} from "./wsc-proxy";
export type { WscClass, WscProxyResult } from "./wsc-proxy";

/** เวอร์ชันตารางเกณฑ์ GIS — เปลี่ยนเมื่อปรับ band/คะแนน เพื่อให้ตามรอยได้ว่าแถวไหนคิดด้วยเกณฑ์ชุดใด */
export const GIS_CRITERIA_VERSION = "gis-1";

/** wrapper: เติม accessSeverity จาก derive32Severity — API เดิม (gis, calculatedAt?) */
export function computeCommunityClass(gis: GisAnalysis, calculatedAt?: string): GisCommunityClass {
  return computeCommunityClassCore(gis, derive32Severity(gis), calculatedAt);
}

/** wrapper: เติม accessSeverity ให้ suggest */
export function suggestSettingTypeFromGis(gis: GisAnalysis): SettingType | null {
  return suggestSettingTypeFromGisCore(gis, derive32Severity(gis));
}

/** ความเร็วอ้างอิงพื้นที่ปกติ (กม./ชม.) — ฐานคำนวณ Travel Time Ratio ตาม PRD */
export const REFERENCE_SPEED_KMH = 60;

/** จำนวนเส้นทางวิเคราะห์สูงสุดต่อแบบประเมิน (ศาลากลาง + ปลายทางที่ผู้ใช้เพิ่ม) */
export const MAX_GIS_ROUTES = 5;

/** ขอบเขตค่าที่ยอมรับ — ใช้ทั้ง sanitizeGis และ test; ค่านอกช่วงถูก clamp หรือตัดทิ้ง */
export const GIS_LIMITS = {
  distanceKm: { min: 0, max: 2000 },
  travelTimeMin: { min: 0, max: 6000 },
  ratio: { min: 0, max: 50 },
  speedKmh: { min: 0, max: 200 },
  elevationM: { min: -500, max: 9000 },
  gainM: { min: 0, max: 20000 },
  slopePct: { min: 0, max: 1000 },
} as const;

/** เส้นทางที่ถนนสั้นกว่าเส้นตรงเกินค่านี้ = เป็นไปไม่ได้ทางฟิสิกส์ (เผื่อ error จากการ simplify geometry เล็กน้อย) */
export const ROAD_VS_STRAIGHT_TOLERANCE = 0.98;

/** ความเร็วเฉลี่ยเกินค่านี้ (กม./ชม.) = ข้อมูลเส้นทางน่าสงสัย ให้ตัดทิ้ง */
export const MAX_PLAUSIBLE_SPEED_KMH = 150;

// ── คณิตศาสตร์ตัวชี้วัด ─────────────────────────────────────────────────────────

function roundTo(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/** Road Circuity Ratio = ระยะถนน ÷ ระยะเส้นตรง — คืน null เมื่อเส้นตรงสั้นเกินไปจนอัตราส่วนไร้ความหมาย */
export function computeRcr(roadKm: number, straightKm: number): number | null {
  if (!Number.isFinite(roadKm) || !Number.isFinite(straightKm) || straightKm <= 0.05) return null;
  return roundTo(roadKm / straightKm, 2);
}

/** ความเร็วเฉลี่ย (กม./ชม.) */
export function computeAvgSpeed(roadKm: number, travelTimeMin: number): number | null {
  if (!Number.isFinite(roadKm) || !Number.isFinite(travelTimeMin) || travelTimeMin <= 0) return null;
  return roundTo(roadKm / (travelTimeMin / 60), 1);
}

/** Travel Time Ratio = เวลาจริง ÷ เวลาอ้างอิง (ระยะเดียวกันที่ความเร็ว REFERENCE_SPEED_KMH) */
export function computeTtr(roadKm: number, travelTimeMin: number): number | null {
  if (!Number.isFinite(roadKm) || !Number.isFinite(travelTimeMin) || roadKm <= 0 || travelTimeMin <= 0) return null;
  const referenceMin = (roadKm / REFERENCE_SPEED_KMH) * 60;
  return roundTo(travelTimeMin / referenceMin, 2);
}

/** Effective Distance = ระยะถนน × TTR — "ภาระการเดินทางเทียบเท่าพื้นราบกี่กิโลเมตร" */
export function computeEffectiveDistance(roadKm: number, ttr: number): number | null {
  if (!Number.isFinite(roadKm) || !Number.isFinite(ttr) || roadKm <= 0 || ttr <= 0) return null;
  return roundTo(roadKm * ttr, 2);
}

/** อัตราส่วนการกระจัดต่อระยะทางจริง = เส้นตรง ÷ ถนน (0–1; ยิ่งต่ำ = ถนนอ้อมมาก) — ส่วนกลับของ RCR */
export function displacementRatio(straightKm: number, roadKm: number): number | null {
  if (!Number.isFinite(straightKm) || !Number.isFinite(roadKm) || straightKm <= 0.05 || roadKm <= 0) return null;
  return roundTo(straightKm / roadKm, 2);
}

// ── ตารางเกณฑ์ความรุนแรง (severity 0–4) ────────────────────────────────────────
// RCR และความเร็วเฉลี่ยตาม PRD ตรงตัว; TTR และความสูงสะสมตั้งช่วงล้อกัน (tunable — GIS_CRITERIA_VERSION)
// severity 0–4 จงใจให้ตรงกับ index ตัวเลือกของตัวชี้วัด 3.2 (0/4/6/8/10 คะแนน) พอดี

export const GIS_SEVERITY_LABELS = ["ปกติ", "เริ่มเข้าถึงยาก", "ยาก", "ยากมาก", "ยากมากที่สุด"] as const;

export function rcrSeverity(rcr: number | null): number | null {
  if (rcr === null || !Number.isFinite(rcr)) return null;
  if (rcr < 1.3) return 0;
  if (rcr < 1.5) return 1;
  if (rcr < 1.8) return 2;
  if (rcr < 2.1) return 3;
  return 4;
}

export function avgSpeedSeverity(speedKmh: number | null): number | null {
  if (speedKmh === null || !Number.isFinite(speedKmh)) return null;
  if (speedKmh > 60) return 0;
  if (speedKmh >= 45) return 1;
  if (speedKmh >= 30) return 2;
  if (speedKmh >= 20) return 3;
  return 4;
}

export function ttrSeverity(ttr: number | null): number | null {
  if (ttr === null || !Number.isFinite(ttr)) return null;
  if (ttr < 1.3) return 0;
  if (ttr < 1.6) return 1;
  if (ttr < 2.0) return 2;
  if (ttr < 2.5) return 3;
  return 4;
}

export function elevationGainSeverity(gainM: number | null): number | null {
  if (gainM === null || !Number.isFinite(gainM)) return null;
  if (gainM < 100) return 0;
  if (gainM < 300) return 1;
  if (gainM < 600) return 2;
  if (gainM < 1000) return 3;
  return 4;
}

// ── ความสูงสะสมตามเส้นทาง ───────────────────────────────────────────────────────

/**
 * รวมความสูงสะสมขาขึ้น/ขาลงจากลำดับความสูงตามเส้นทาง (เมตร)
 * ใช้จุดยึด (anchor): เลื่อนเมื่อความต่างสะสมถึง minDeltaM — วิธีนี้เก็บทางขึ้นยาว ๆ ที่ชันทีละน้อยได้ครบ
 * ขณะที่ตัด noise ของ DEM (Terrarium L14 คลาดเคลื่อนระดับเมตร) ที่แกว่งไปมา; ข้ามค่า NaN (ไทล์โหลดพลาด)
 */
export function elevationGainLoss(heights: number[], minDeltaM = 3): { gainM: number; lossM: number } {
  let gain = 0;
  let loss = 0;
  let anchor: number | null = null;
  for (const h of heights) {
    if (!Number.isFinite(h)) continue;
    if (anchor === null) {
      anchor = h;
      continue;
    }
    const delta = h - anchor;
    if (Math.abs(delta) >= minDeltaM) {
      if (delta > 0) gain += delta;
      else loss += -delta;
      anchor = h;
    }
  }
  return { gainM: Math.round(gain), lossM: Math.round(loss) };
}

// ── ประกอบผลวิเคราะห์เส้นทางจากวัตถุดิบดิบ ──────────────────────────────────────

/** วัตถุดิบดิบต่อเส้นทางที่ client ส่งมา — ratio ทุกตัวคำนวณใหม่จากค่าเหล่านี้เสมอ */
export interface RawGisRouteInput {
  destinationType: GisDestinationType;
  destinationName: string;
  destLat: number;
  destLng: number;
  /** ระยะทางดิบจาก OSRM (เมตร) */
  roadDistanceM: number;
  /** เวลาดิบจาก OSRM (วินาที) */
  durationS: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  selected: boolean;
}

/** เหตุผลที่เส้นทางถูกตัดทิ้ง (ภาษาไทย) — null = ผ่าน */
export function routePhysicsIssue(roadKm: number, straightKm: number, avgSpeedKmh: number | null): string | null {
  if (roadKm < straightKm * ROAD_VS_STRAIGHT_TOLERANCE) {
    return `ระยะถนน ${roadKm.toFixed(1)} กม. สั้นกว่าระยะเส้นตรง ${straightKm.toFixed(1)} กม. — เป็นไปไม่ได้ ตัดเส้นทางนี้ทิ้ง`;
  }
  if (avgSpeedKmh !== null && avgSpeedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
    return `ความเร็วเฉลี่ย ${avgSpeedKmh.toFixed(0)} กม./ชม. สูงผิดปกติ — ข้อมูลเส้นทางน่าสงสัย ตัดเส้นทางนี้ทิ้ง`;
  }
  return null;
}

/**
 * สร้าง GisRouteAnalysis เต็มรูปจากวัตถุดิบดิบ — คำนวณระยะเส้นตรง (haversine) + ratio ทุกตัวเอง
 * คืน null เมื่อพิกัด/ตัวเลขใช้ไม่ได้ (ผู้เรียกฝั่ง server ใช้ routePhysicsIssue แยกเพื่อรายงานเหตุผล)
 */
export function buildRouteAnalysis(
  centerLat: number,
  centerLng: number,
  raw: RawGisRouteInput,
  calculatedAt: string,
): GisRouteAnalysis | null {
  if (!isValidLat(raw.destLat) || !isValidLng(raw.destLng)) return null;
  if (!Number.isFinite(raw.roadDistanceM) || raw.roadDistanceM <= 0) return null;
  if (!Number.isFinite(raw.durationS) || raw.durationS <= 0) return null;

  const straightKm = roundTo(haversineM(centerLat, centerLng, raw.destLat, raw.destLng) / 1000, 2);
  const roadKm = roundTo(clampNum(raw.roadDistanceM / 1000, GIS_LIMITS.distanceKm), 2);
  const travelTimeMin = roundTo(clampNum(raw.durationS / 60, GIS_LIMITS.travelTimeMin), 1);

  const rcr = computeRcr(roadKm, straightKm);
  const ttr = computeTtr(roadKm, travelTimeMin);
  const avgSpeed = computeAvgSpeed(roadKm, travelTimeMin);
  const effective = ttr !== null ? computeEffectiveDistance(roadKm, ttr) : null;
  if (rcr === null || ttr === null || avgSpeed === null || effective === null) return null;

  return {
    destinationType: raw.destinationType,
    destinationName: raw.destinationName,
    destLat: raw.destLat,
    destLng: raw.destLng,
    straightDistanceKm: straightKm,
    roadDistanceKm: roadKm,
    travelTimeMin,
    roadCircuityRatio: rcr,
    travelTimeRatio: ttr,
    effectiveDistanceKm: effective,
    averageSpeedKmh: avgSpeed,
    elevationGainM: cleanNullableNum(raw.elevationGainM, GIS_LIMITS.gainM, 0),
    elevationLossM: cleanNullableNum(raw.elevationLossM, GIS_LIMITS.gainM, 0),
    routeSource: "osrm",
    selected: raw.selected === true,
    calculatedAt,
  };
}

// ── การ derive ค่ามิติ 3 (scoring v2) ───────────────────────────────────────────

/** เส้นทางหลักที่ใช้คิดตัวชี้วัด 3.1/3.2 — สำนักงานเขต/สกร.อำเภอ ถ้ามี ไม่งั้นศาลากลางจังหวัด */
export function primaryRoute(gis: GisAnalysis): GisRouteAnalysis | null {
  const byType = (type: GisDestinationType) => {
    const selected = gis.routes.find((r) => r.destinationType === type && r.selected);
    return selected ?? gis.routes.find((r) => r.destinationType === type) ?? null;
  };
  return byType("district_office") ?? byType("province_hall") ?? gis.routes[0] ?? null;
}

export function hospitalRoute(gis: GisAnalysis): GisRouteAnalysis | null {
  const selected = gis.routes.find((r) => r.destinationType === "hospital" && r.selected);
  return selected ?? gis.routes.find((r) => r.destinationType === "hospital") ?? null;
}

/**
 * ระดับความยากลำบากในการเข้าถึง (0–4) จากผล GIS — ค่าสูงสุด (worst-of) ของตัวชี้วัดที่มีข้อมูล
 * (RCR / TTR / ความเร็วเฉลี่ย / ความสูงสะสม) — index ตรงกับตัวเลือก 3.2 (0/4/6/8/10 คะแนน)
 */
export function derive32Severity(gis: GisAnalysis): number | null {
  const route = primaryRoute(gis);
  if (!route) return null;
  const severities = [
    rcrSeverity(route.roadCircuityRatio),
    ttrSeverity(route.travelTimeRatio),
    avgSpeedSeverity(route.averageSpeedKmh),
    elevationGainSeverity(route.elevationGainM),
  ].filter((s): s is number => s !== null);
  if (!severities.length) return null;
  return Math.max(...severities);
}

/**
 * แปลงผล GIS เป็นข้อมูลดิบของตัวชี้วัดมิติ 3 — ค่าที่ได้ไหลผ่าน scoreIndicator/เกณฑ์เดิมโดยไม่แก้ engine
 * 3.3 คืนเฉพาะเมื่อมีเส้นทางโรงพยาบาล (ไม่มี → กรอกเองตามเดิม)
 */
export function deriveD3Responses(gis: GisAnalysis): Partial<Record<IndicatorId, ResponseData>> {
  const out: Partial<Record<IndicatorId, ResponseData>> = {};
  const main = primaryRoute(gis);
  if (main) {
    out["3.1"] = {
      minutes: String(Math.round(main.travelTimeMin)),
      km: main.roadDistanceKm.toFixed(1),
    };
  }
  const severity = derive32Severity(gis);
  if (severity !== null) {
    out["3.2"] = { level: String(severity) };
  }
  const hosp = hospitalRoute(gis);
  if (hosp) {
    out["3.3"] = {
      minutes: String(Math.round(hosp.travelTimeMin)),
      unitName: hosp.destinationName.slice(0, 200),
    };
  }
  return out;
}

/** เวอร์ชันคะแนนที่มีผลจริง — "v2-gis" ต้องมีทั้ง flag และข้อมูล gis ครบ ไม่งั้นถือเป็น v1 */
export function effectiveScoringVersion(state: AssessmentState): ScoringVersion {
  return state.scoringVersion === "v2-gis" && state.gis ? "v2-gis" : "v1";
}

// ── Auto GIS Score (เต็ม 45 ตาม PRD FR-06) ─────────────────────────────────────
// คะแนนประกอบการพิจารณา ไม่รวมกับ 100 คะแนนทางการ; องค์ประกอบที่ไม่มีข้อมูล = null
// และไม่ถูกนับใน maxComputable — แสดงผลตรงไปตรงมาว่าคำนวณได้กี่ส่วน

const SEVERITY_TO_10 = [0, 3, 5, 8, 10] as const;
const SEVERITY_TO_5_SPEED = [0, 2, 3, 4, 5] as const;
/** severity 0–4 → คะแนนเต็ม 5 (ปัด 1.25×severity): ใช้กับความสูงสะสม */
const SEVERITY_TO_5_GAIN = [0, 1, 3, 4, 5] as const;

function elevationPoints(elevM: number | null): number | null {
  if (elevM === null || !Number.isFinite(elevM)) return null;
  if (elevM < 300) return 0;
  if (elevM < 500) return 1;
  if (elevM < 700) return 2;
  if (elevM < 1000) return 3;
  if (elevM < 1500) return 4;
  return 5;
}

/** ความลาดชัน (%) → 0–5 ตามชั้น LDD A–F */
function slopePoints(slopePct: number | null): number | null {
  if (slopePct === null || !Number.isFinite(slopePct)) return null;
  if (slopePct <= 2) return 0;
  if (slopePct <= 5) return 1;
  if (slopePct <= 12) return 2;
  if (slopePct <= 20) return 3;
  if (slopePct <= 35) return 4;
  return 5;
}

function serviceDistancePoints(roadKm: number | null): number | null {
  if (roadKm === null || !Number.isFinite(roadKm)) return null;
  if (roadKm <= 10) return 0;
  if (roadKm <= 25) return 2;
  if (roadKm <= 50) return 3;
  return 5;
}

const AUTO_SCORE_MAX = {
  elevation: 5,
  slopeGain: 5,
  rcr: 10,
  ttr: 10,
  avgSpeed: 5,
  serviceDistance: 5,
  borderMunicipality: 5,
} as const;

export function computeAutoGisScore(gis: GisAnalysis, calculatedAt: string): GisAutoScore | null {
  const route = primaryRoute(gis);
  const hosp = hospitalRoute(gis);

  const rcrSev = route ? rcrSeverity(route.roadCircuityRatio) : null;
  const ttrSev = route ? ttrSeverity(route.travelTimeRatio) : null;
  const speedSev = route ? avgSpeedSeverity(route.averageSpeedKmh) : null;
  const gainSev = route ? elevationGainSeverity(route.elevationGainM) : null;

  const slope = slopePoints(gis.elevation?.meanSlopePct ?? null);
  const gain = gainSev !== null ? SEVERITY_TO_5_GAIN[gainSev] : null;
  const slopeGain = slope !== null || gain !== null ? Math.max(slope ?? 0, gain ?? 0) : null;

  const components: GisAutoScore["components"] = {
    elevation: elevationPoints(gis.elevation?.schoolMarkerElevationM ?? null),
    slopeGain,
    rcr: rcrSev !== null ? SEVERITY_TO_10[rcrSev] : null,
    ttr: ttrSev !== null ? SEVERITY_TO_10[ttrSev] : null,
    avgSpeed: speedSev !== null ? SEVERITY_TO_5_SPEED[speedSev] : null,
    serviceDistance: serviceDistancePoints(hosp ? hosp.roadDistanceKm : null),
    borderMunicipality: null, // ยังไม่มีชั้นข้อมูลชายแดน/เขตเทศบาล
  };

  let total = 0;
  let maxComputable = 0;
  (Object.keys(components) as (keyof typeof components)[]).forEach((key) => {
    const value = components[key];
    if (value !== null) {
      total += value;
      maxComputable += AUTO_SCORE_MAX[key];
    }
  });
  if (maxComputable === 0) return null;

  return { total, maxComputable, max: 45, components, calculatedAt, version: GIS_CRITERIA_VERSION };
}

// ── คำอธิบายภาษาคน (ตาม PRD §11.2) ─────────────────────────────────────────────

export function severityLabelTh(severity: number | null): string {
  if (severity === null || severity < 0 || severity >= GIS_SEVERITY_LABELS.length) return "-";
  return GIS_SEVERITY_LABELS[severity];
}

export function explainRcrTh(rcr: number | null): string {
  if (rcr === null) return "";
  if (rcr < 1.3) return `เส้นทางถนนใกล้เคียงเส้นตรง (${rcr.toFixed(2)} เท่า) — โครงข่ายถนนเข้าถึงได้ตามปกติ`;
  return `ระยะทางตามถนนจริงยาวกว่าระยะเส้นตรง ${rcr.toFixed(2)} เท่า สะท้อนข้อจำกัดจากภูมิประเทศและโครงข่ายถนน`;
}

export function explainTtrTh(ttr: number | null): string {
  if (ttr === null) return "";
  if (ttr < 1.3) return `เวลาเดินทางใกล้เคียงพื้นที่ปกติ (${ttr.toFixed(2)} เท่า)`;
  return `ใช้เวลาเดินทางมากกว่าพื้นที่ปกติ ${ttr.toFixed(2)} เท่า (เทียบความเร็วอ้างอิง ${REFERENCE_SPEED_KMH} กม./ชม.)`;
}

// ── เกณฑ์เสนอเพิ่ม (อนาคต) — ไม่นับรวมในคะแนน 100 ─────────────────────────────
// F1 Displacement Ratio (มุมมองกลับของ RCR — severity ใช้ตาราง rcrSeverity เดิม กัน band drift)
// F2 Travel Time Ratio (severity ใช้ตาราง ttrSeverity เดิม)

export const FUTURE_INDICATOR_IDS = ["F1", "F2"] as const;
export type FutureIndicatorId = (typeof FUTURE_INDICATOR_IDS)[number];

export interface FutureIndicatorResult {
  id: FutureIndicatorId;
  title: string;
  valueLabel: string;
  severity: number;
  score: number;
  maxScore: number;
  explain: string;
}

/** คำนวณเกณฑ์เสนอเพิ่มจากเส้นทางหลัก (ที่ว่าการอำเภอ/ศาลากลาง) — คืน list ว่างเมื่อไม่มีข้อมูลพอ */
export function futureIndicators(gis: GisAnalysis): FutureIndicatorResult[] {
  const route = primaryRoute(gis);
  if (!route) return [];
  const out: FutureIndicatorResult[] = [];

  const dr = displacementRatio(route.straightDistanceKm, route.roadDistanceKm);
  const drSev = rcrSeverity(route.roadCircuityRatio);
  if (dr !== null && drSev !== null) {
    const detourPct = Math.max(0, Math.round((route.roadCircuityRatio - 1) * 100));
    out.push({
      id: "F1",
      title: "อัตราส่วนการกระจัดต่อระยะทางจริง (Displacement Ratio)",
      valueLabel: `${dr.toFixed(2)} (เส้นตรง ${route.straightDistanceKm.toFixed(1)} กม. / ถนนจริง ${route.roadDistanceKm.toFixed(1)} กม.)`,
      severity: drSev,
      score: drSev,
      maxScore: 4,
      explain:
        drSev === 0
          ? "เส้นทางถนนใกล้เคียงเส้นตรง — โครงข่ายถนนเข้าถึงได้ตามปกติ"
          : `ระยะเส้นตรงเพียง ${route.straightDistanceKm.toFixed(1)} กม. แต่ต้องเดินทางจริง ${route.roadDistanceKm.toFixed(1)} กม. (อ้อมกว่าเส้นตรง ${detourPct}%)`,
    });
  }

  const ttrSev = ttrSeverity(route.travelTimeRatio);
  if (ttrSev !== null) {
    out.push({
      id: "F2",
      title: "อัตราส่วนเวลาเดินทางเทียบพื้นที่ปกติ (Travel Time Ratio)",
      valueLabel: `${route.travelTimeRatio.toFixed(2)} เท่า`,
      severity: ttrSev,
      score: ttrSev,
      maxScore: 4,
      explain: explainTtrTh(route.travelTimeRatio),
    });
  }

  return out;
}

export function explainSpeedTh(speedKmh: number | null): string {
  if (speedKmh === null) return "";
  const label = severityLabelTh(avgSpeedSeverity(speedKmh));
  return `ความเร็วเฉลี่ยของเส้นทาง ${speedKmh.toFixed(0)} กม./ชม. — ระดับ${label === "ปกติ" ? "ปกติ" : ` ${label}`}`;
}

export function explainGainTh(gainM: number | null): string {
  if (gainM === null) return "";
  if (gainM < 100) return `เส้นทางไต่ระดับรวมเพียง ${Math.round(gainM)} ม. — ภูมิประเทศราบเรียบ`;
  return `เส้นทางต้องไต่ระดับสะสมรวม ${Math.round(gainM).toLocaleString()} ม. สะท้อนความยากของเส้นทางภูเขา`;
}

export function explainEffectiveTh(roadKm: number | null, effectiveKm: number | null): string {
  if (roadKm === null || effectiveKm === null) return "";
  if (Math.round(effectiveKm) <= Math.round(roadKm)) return "";
  return `ระยะทาง ${roadKm.toFixed(0)} กม. ของโรงเรียนนี้มีภาระการเดินทางเทียบเท่าพื้นราบระยะ ${effectiveKm.toFixed(0)} กม.`;
}

// ── sanitizer (allowlist เข้ม แบบเดียวกับ sanitizeState) ────────────────────────
// ⚠️ field ใหม่ทุกตัวใน GisAnalysis ต้องเพิ่มที่นี่ด้วย ไม่งั้นจะหายเงียบตอน round-trip ผ่าน DB

function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLng(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function clampNum(value: number, limit: { min: number; max: number }): number {
  return Math.min(limit.max, Math.max(limit.min, value));
}

function cleanNullableNum(value: unknown, limit: { min: number; max: number }, dp: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return roundTo(clampNum(value, limit), dp);
}

function cleanNum(value: unknown, limit: { min: number; max: number }, dp: number): number {
  return cleanNullableNum(value, limit, dp) ?? 0;
}

function cleanStr(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** จุดสูงสุดตามเส้นทาง — ต้องเป็นชุดตัวอย่างเดียวกับธงแดงบนแผนที่; พิกัด/ความสูงใช้ไม่ได้ → ตัดทิ้ง (null) */
function cleanHighestPoint(value: unknown): GisRouteHighestPoint | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (!isValidLat(p.lat) || !isValidLng(p.lng)) return null;
  const elevationM = cleanNullableNum(p.elevationM, GIS_LIMITS.elevationM, 0);
  if (elevationM === null) return null;
  return { lat: p.lat, lng: p.lng, elevationM };
}

function cleanRoute(item: unknown): GisRouteAnalysis | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  if (!isValidLat(r.destLat) || !isValidLng(r.destLng)) return null;
  const destinationType = (GIS_DESTINATION_TYPES as readonly string[]).includes(r.destinationType as string)
    ? (r.destinationType as GisDestinationType)
    : "other";
  const route: GisRouteAnalysis = {
    destinationType,
    destinationName: cleanStr(r.destinationName, 200),
    destLat: r.destLat,
    destLng: r.destLng,
    straightDistanceKm: cleanNum(r.straightDistanceKm, GIS_LIMITS.distanceKm, 2),
    roadDistanceKm: cleanNum(r.roadDistanceKm, GIS_LIMITS.distanceKm, 2),
    travelTimeMin: cleanNum(r.travelTimeMin, GIS_LIMITS.travelTimeMin, 1),
    roadCircuityRatio: cleanNum(r.roadCircuityRatio, GIS_LIMITS.ratio, 2),
    travelTimeRatio: cleanNum(r.travelTimeRatio, GIS_LIMITS.ratio, 2),
    effectiveDistanceKm: cleanNum(r.effectiveDistanceKm, GIS_LIMITS.distanceKm, 2),
    averageSpeedKmh: cleanNum(r.averageSpeedKmh, GIS_LIMITS.speedKmh, 1),
    elevationGainM: cleanNullableNum(r.elevationGainM, GIS_LIMITS.gainM, 0),
    elevationLossM: cleanNullableNum(r.elevationLossM, GIS_LIMITS.gainM, 0),
    routeSource: "osrm",
    selected: r.selected === true,
    calculatedAt: cleanStr(r.calculatedAt, 40),
  };
  const highestPoint = cleanHighestPoint(r.highestPoint);
  if (highestPoint) route.highestPoint = highestPoint;
  return route;
}

function cleanElevation(value: unknown): GisElevationInfo | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  return {
    // ยอมรับ legacy key เดิม schoolElevationM (ก่อน rename) แต่ round-trip ออกมาเป็น schoolMarkerElevationM เท่านั้น
    schoolMarkerElevationM: cleanNullableNum(
      e.schoolMarkerElevationM !== undefined ? e.schoolMarkerElevationM : e.schoolElevationM,
      GIS_LIMITS.elevationM,
      0,
    ),
    meanElevationM: cleanNullableNum(e.meanElevationM, GIS_LIMITS.elevationM, 0),
    minElevationM: cleanNullableNum(e.minElevationM, GIS_LIMITS.elevationM, 0),
    maxElevationM: cleanNullableNum(e.maxElevationM, GIS_LIMITS.elevationM, 0),
    reliefM: cleanNullableNum(e.reliefM, GIS_LIMITS.elevationM, 0),
    meanSlopePct: cleanNullableNum(e.meanSlopePct, GIS_LIMITS.slopePct, 1),
    maxSlopePct: cleanNullableNum(e.maxSlopePct, GIS_LIMITS.slopePct, 1),
    localMaxElevation1KmM: cleanNullableNum(e.localMaxElevation1KmM, GIS_LIMITS.elevationM, 0),
    slopeClass: cleanStr(e.slopeClass, 200),
    landformTh: cleanStr(e.landformTh, 200),
    terrainConfidence: "client",
    provinceAvgElev: cleanNullableNum(e.provinceAvgElev, GIS_LIMITS.elevationM, 0),
    // routeFullMaxElev = SSRA ทั้งเส้น; legacy key routeMaxElev map มาที่นี่
    routeFullMaxElev: cleanNullableNum(
      e.routeFullMaxElev !== undefined && e.routeFullMaxElev !== null ? e.routeFullMaxElev : e.routeMaxElev,
      GIS_LIMITS.elevationM,
      0,
    ),
    routeTailMaxElev: cleanNullableNum(e.routeTailMaxElev, GIS_LIMITS.elevationM, 0),
  };
}

const RADIUS_VALUES = [500, 1000, 1500] as const;

/** จำนวนอาคาร/ประชากรโดยประมาณในรัศมี 500/1,000/1,500 ม. — ทิ้งทั้งชุดถ้าตรวจไม่ผ่านแม้แถวเดียว (กันข้อมูลครึ่ง ๆ กลาง ๆ) */
function cleanRadiusSummaries(value: unknown): GisRadiusSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: GisRadiusSummary[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const r = item as Record<string, unknown>;
    if (!(RADIUS_VALUES as readonly number[]).includes(r.radiusM as number)) return undefined;
    const buildingCount = cleanNullableNum(r.buildingCount, { min: 0, max: 10_000_000 }, 0);
    if (buildingCount === null) return undefined;
    out.push({
      radiusM: r.radiusM as 500 | 1000 | 1500,
      buildingCount,
      estPopulation: cleanNullableNum(r.estPopulation, { min: 0, max: 100_000_000 }, 0),
      popDensityPerKm2: cleanNullableNum(r.popDensityPerKm2, { min: 0, max: 10_000_000 }, 0),
    });
  }
  return out.length > 0 ? out : undefined;
}

const GIS_BUILDING_SOURCES = ["Microsoft Building Footprints"] as const;
const GIS_POPULATION_METHODS = ["building-count-x-provincial-household-size"] as const;

/** แหล่งข้อมูลที่ใช้คำนวณผล GIS — metadata ล้วน ไม่มีผลต่อคะแนน แสดงเพื่อความโปร่งใสเท่านั้น */
function cleanDataSources(value: unknown): GisDataSources | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = value as Record<string, unknown>;
  if (d.terrain !== "Terrarium DEM" || d.routing !== "OSRM") return undefined;
  const buildings = (GIS_BUILDING_SOURCES as readonly string[]).includes(d.buildings as string)
    ? (d.buildings as GisDataSources["buildings"])
    : null;
  const populationMethod = (GIS_POPULATION_METHODS as readonly string[]).includes(d.populationMethod as string)
    ? (d.populationMethod as GisDataSources["populationMethod"])
    : null;
  return {
    terrain: "Terrarium DEM",
    routing: "OSRM",
    buildings,
    populationMethod,
    analyzedAt: cleanStr(d.analyzedAt, 40),
  };
}

function cleanAutoScore(value: unknown): GisAutoScore | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const rawComponents = (a.components && typeof a.components === "object" ? a.components : {}) as Record<string, unknown>;
  const componentLimit = { min: 0, max: 10 };
  const components: GisAutoScore["components"] = {
    elevation: cleanNullableNum(rawComponents.elevation, componentLimit, 0),
    slopeGain: cleanNullableNum(rawComponents.slopeGain, componentLimit, 0),
    rcr: cleanNullableNum(rawComponents.rcr, componentLimit, 0),
    ttr: cleanNullableNum(rawComponents.ttr, componentLimit, 0),
    avgSpeed: cleanNullableNum(rawComponents.avgSpeed, componentLimit, 0),
    serviceDistance: cleanNullableNum(rawComponents.serviceDistance, componentLimit, 0),
    borderMunicipality: cleanNullableNum(rawComponents.borderMunicipality, componentLimit, 0),
  };
  return {
    total: cleanNum(a.total, { min: 0, max: 45 }, 0),
    maxComputable: cleanNum(a.maxComputable, { min: 0, max: 45 }, 0),
    max: 45,
    components,
    calculatedAt: cleanStr(a.calculatedAt, 40),
    version: cleanStr(a.version, 40) || GIS_CRITERIA_VERSION,
  };
}

/** ข้อสรุปพื้นที่ (จากการวาด polygon) — settlementLabel คำนวณใหม่จากความหนาแน่นเสมอเพื่อความสอดคล้อง */
export function cleanAreaSummary(value: unknown): GisAreaSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const a = value as Record<string, unknown>;
  const areaKm2 = cleanNullableNum(a.areaKm2, { min: 0, max: 100000 }, 3);
  if (areaKm2 === null || areaKm2 <= 0) return undefined; // พื้นที่ต้อง > 0 ไม่งั้นข้อสรุปไร้ความหมาย
  const popDensity = cleanNullableNum(a.popDensityPerKm2, { min: 0, max: 10_000_000 }, 0);
  return {
    areaKm2,
    buildingCount: cleanNum(a.buildingCount, { min: 0, max: 10_000_000 }, 0),
    estPopulation: cleanNullableNum(a.estPopulation, { min: 0, max: 100_000_000 }, 0),
    buildingDensityPerKm2: cleanNum(a.buildingDensityPerKm2, { min: 0, max: 10_000_000 }, 0),
    popDensityPerKm2: popDensity,
    settlementLabel: popDensity !== null ? settlementClass(popDensity).label : cleanStr(a.settlementLabel, 100),
    calculatedAt: cleanStr(a.calculatedAt, 40),
  };
}

/**
 * Clamp/allowlist ก้อน gis เท่านั้น — ไม่คำนวณ autoScore/communityClass
 * (undefined = โครงหลักใช้ไม่ได้ = แถว v1)
 * ใช้ร่วมกับ finalizeGisAnalysis ผ่าน sanitizeGis หรือ POST /gis
 */
export function clampGisPayload(input: unknown): GisAnalysis | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const rawCenter = (raw.center && typeof raw.center === "object" ? raw.center : {}) as Record<string, unknown>;
  if (!isValidLat(rawCenter.lat) || !isValidLng(rawCenter.lng)) return undefined;

  const source = rawCenter.source === "unit" || rawCenter.source === "search" ? rawCenter.source : "map-pin";
  const routes = Array.isArray(raw.routes)
    ? raw.routes.map(cleanRoute).filter((r): r is GisRouteAnalysis => r !== null).slice(0, MAX_GIS_ROUTES)
    : [];

  const result: GisAnalysis = {
    center: {
      lat: rawCenter.lat,
      lng: rawCenter.lng,
      source,
      confirmedAt: cleanStr(rawCenter.confirmedAt, 40),
      nearestProvinceName: cleanStr(rawCenter.nearestProvinceName, 200),
    },
    elevation: cleanElevation(raw.elevation),
    routes,
    // autoScore จาก client ถูกละทิ้งตอน finalize — เก็บชั่วคราวเพื่อไม่ให้ type ขาดตอน clamp
    autoScore: cleanAutoScore(raw.autoScore),
    appliedToResponses: raw.appliedToResponses === true,
    savedAt: cleanStr(raw.savedAt, 40),
  };
  const areaSummary = cleanAreaSummary(raw.areaSummary);
  if (areaSummary) result.areaSummary = areaSummary;
  const radiusSummaries = cleanRadiusSummaries(raw.radiusSummaries);
  if (radiusSummaries) result.radiusSummaries = radiusSummaries;
  const dataSources = cleanDataSources(raw.dataSources);
  if (dataSources) result.dataSources = dataSources;
  return result;
}

export interface FinalizeGisOptions {
  /** เติม provinceAvgElev ถ้า elevation ยังไม่มี (เช่น จาก listProvinces ฝั่ง server) */
  provinceAvgElev?: number | null;
  /** timestamp สำหรับ autoScore + communityClass — default = gis.savedAt */
  calculatedAt?: string;
}

/**
 * จุดเดียวที่เขียน autoScore + communityClass (server-owned)
 * ลำดับ: เติม provinceAvgElev → computeAutoGisScore → computeCommunityClass
 * เรียกซ้ำได้ (idempotent ต่อ input เดียวกัน)
 */
export function finalizeGisAnalysis(gis: GisAnalysis, opts: FinalizeGisOptions = {}): GisAnalysis {
  const calculatedAt = opts.calculatedAt || gis.savedAt || "";
  let elevation = gis.elevation;
  const fillProvince =
    opts.provinceAvgElev !== undefined &&
    opts.provinceAvgElev !== null &&
    Number.isFinite(opts.provinceAvgElev);
  if (
    elevation &&
    fillProvince &&
    (elevation.provinceAvgElev === null || elevation.provinceAvgElev === undefined)
  ) {
    elevation = { ...elevation, provinceAvgElev: Math.round(opts.provinceAvgElev as number) };
  }

  const next: GisAnalysis = elevation !== gis.elevation ? { ...gis, elevation } : { ...gis };
  next.autoScore = computeAutoGisScore(next, calculatedAt);
  next.communityClass = computeCommunityClass(next, calculatedAt);
  return next;
}

/**
 * Clamp + finalize — ใช้ตอนอ่าน state จาก DB / payload ทั่วไป
 * (ไม่มี province override — ใช้ค่าใน elevation ตามที่มี)
 */
export function sanitizeGis(input: unknown): GisAnalysis | undefined {
  const clamped = clampGisPayload(input);
  if (!clamped) return undefined;
  return finalizeGisAnalysis(clamped, { calculatedAt: clamped.savedAt });
}
