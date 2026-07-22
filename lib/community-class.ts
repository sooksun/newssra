// จำแนกชุมชน 3 แกน (A ภูมิประเทศ · B การเข้าถึง · C ความหนาแน่น) — pure, framework-free
// แยกจาก lib/gis.ts (คณิต ratio/severity) — ห้าม import lib/gis.ts (กัน circular กับ sanitizeGis)

import { settlementClass } from "./settlement";
import { estimateWscClass } from "./wsc-proxy";
import type { CommunityAxisATier, CommunityCompositeKey, GisAnalysis, GisCommunityClass, SettingType } from "./types";

// เวอร์ชันเกณฑ์จำแนกชุมชน 3 แกน — เปลี่ยนเมื่อปรับประตูความสูง/ป้าย composite
// cc-2: partial axis (A-only / B-only) → incomplete เท่านั้น (ไม่เดา flat_* หรือ highland_*)
// cc-3: เพิ่ม wscProxy (WSC 1–5 จากความลาดชัน — ไม่ใช่แผนที่ราชการ)
export const COMMUNITY_CLASS_VERSION = "cc-3";

/** เกณฑ์ความสูงขั้นต่ำ (ม.) ตาม SSRA/HRDI — "500 เมตรขึ้นไป" ใช้ ≥ */
export const COMMUNITY_HIGHLAND_MIN_M = 500;

/** ชั้น "ภูเขาสูง" (ม.) — สอดคล้อง morphology HIGH_MOUNTAIN_M และชั้นสูงของ HRDI */
export const COMMUNITY_HIGH_MOUNTAIN_M = 1000;

/** severity แกน B ≥ ค่านี้ = "เข้าถึงยาก" (หลอม composite) */
export const COMMUNITY_ACCESS_HARD_MIN = 2;

/** ป้าย severity 0–4 — ต้องตรง GIS_SEVERITY_LABELS ใน lib/gis.ts */
const ACCESS_SEVERITY_LABELS = ["ปกติ", "เริ่มเข้าถึงยาก", "ยาก", "ยากมาก", "ยากมากที่สุด"] as const;

/** ตาราง composite เดียว — ใช้ list filter, dashboard, classify, UI */
export const COMMUNITY_COMPOSITES: Record<
  CommunityCompositeKey,
  { labelTh: string; tone: GisCommunityClass["composite"]["tone"] }
> = {
  highland_remote: { labelTh: "พื้นที่สูง–เข้าถึงยาก", tone: "warn" },
  highland_accessible: { labelTh: "พื้นที่สูง–เข้าถึงได้", tone: "info" },
  flat_remote: { labelTh: "พื้นราบ–ห่างไกล", tone: "warn" },
  flat_normal: { labelTh: "พื้นราบ–ปกติ", tone: "ok" },
  incomplete: { labelTh: "ข้อมูลแกน A/B ไม่ครบ — ยังจำแนกไม่ได้", tone: "info" },
};

export const COMMUNITY_COMPOSITE_KEYS = Object.keys(COMMUNITY_COMPOSITES) as CommunityCompositeKey[];

/**
 * รายการ list ที่ยังไม่มี community_class_key ใน summary (ยังไม่ re-index หลังมีฟีเจอร์)
 * ไม่ใช่ CommunityCompositeKey ใน state — ใช้กรอง SQL เท่านั้น
 */
export const COMMUNITY_LIST_UNINDEXED_KEY = "unindexed" as const;
export const COMMUNITY_LIST_UNINDEXED_LABEL = "ยังไม่จัดดัชนีรายการ";

/** รวม "ยังไม่มี GIS" สำหรับ dashboard (ไม่ใช่ key ใน state) */
export const COMMUNITY_DASHBOARD_NONE_KEY = "none" as const;

export type CommunityDashboardKey = CommunityCompositeKey | typeof COMMUNITY_DASHBOARD_NONE_KEY;

export const COMMUNITY_DASHBOARD_ORDER: CommunityDashboardKey[] = [
  ...COMMUNITY_COMPOSITE_KEYS,
  COMMUNITY_DASHBOARD_NONE_KEY,
];

export const COMMUNITY_DASHBOARD_LABELS: Record<CommunityDashboardKey, string> = {
  highland_remote: COMMUNITY_COMPOSITES.highland_remote.labelTh,
  highland_accessible: COMMUNITY_COMPOSITES.highland_accessible.labelTh,
  flat_remote: COMMUNITY_COMPOSITES.flat_remote.labelTh,
  flat_normal: COMMUNITY_COMPOSITES.flat_normal.labelTh,
  incomplete: COMMUNITY_COMPOSITES.incomplete.labelTh,
  none: "ยังไม่มี GIS",
};

/** ความสูง "สูง" ตามเกณฑ์พื้นที่สูง: ≥ 500 ม. หรือสูงกว่าค่าเฉลี่ยจังหวัด (ถ้ามี) */
export function isCommunityElevHigh(elevM: number | null, provinceAvgElev: number | null): boolean {
  if (elevM === null || !Number.isFinite(elevM)) return false;
  if (elevM >= COMMUNITY_HIGHLAND_MIN_M) return true;
  if (provinceAvgElev !== null && Number.isFinite(provinceAvgElev) && elevM > provinceAvgElev) return true;
  return false;
}

/**
 * landform จาก morphology บ่งชี้พื้นที่สูง (ไม่ใช้ "เนินเขา" เดี่ยว — คลุมเครือ)
 * ตัด "พื้นราบ" ออกแม้ข้อความจะมีคำอื่นปน
 */
export function landformSuggestsHighland(landformTh: string): boolean {
  const t = landformTh.trim();
  if (!t || t.includes("พื้นราบ")) return false;
  if (t.includes("ภูเขาสูง") || t.includes("บนภูเขา")) return true;
  if (t.includes("หุบเขา") || t.includes("เชิงเขา")) return true;
  return false;
}

export interface ClassifyCommunityInput {
  schoolElevationM: number | null;
  provinceAvgElev: number | null;
  /** ความสูงสุดตลอดเส้นทางทั้งเส้น (SSRA) */
  routeFullMaxElev: number | null;
  landformTh: string;
  /** 0–4 จาก derive32Severity; null = ยังไม่มีเส้นทาง */
  accessSeverity: number | null;
  popDensityPerKm2?: number | null;
  /** ความลาดชันเฉลี่ย (%) — สำหรับ WSC 1–5 proxy */
  meanSlopePct?: number | null;
  calculatedAt?: string;
}

function accessSeverityLabel(severity: number | null): string {
  if (severity === null || severity < 0 || severity >= ACCESS_SEVERITY_LABELS.length) {
    return "ยังไม่มีข้อมูลเส้นทาง";
  }
  return ACCESS_SEVERITY_LABELS[severity];
}

/**
 * จำแนกชุมชน 3 แกนจากวัตถุดิบดิบ — pure; ใช้ทั้ง unit test และ computeCommunityClass
 */
export function classifyCommunity(input: ClassifyCommunityInput): GisCommunityClass {
  const schoolElevationM =
    input.schoolElevationM !== null && Number.isFinite(input.schoolElevationM) ? input.schoolElevationM : null;
  const provinceAvgElev =
    input.provinceAvgElev !== null && Number.isFinite(input.provinceAvgElev) ? input.provinceAvgElev : null;
  const routeFullMaxElev =
    input.routeFullMaxElev !== null && Number.isFinite(input.routeFullMaxElev) ? input.routeFullMaxElev : null;
  const landformTh = typeof input.landformTh === "string" ? input.landformTh.slice(0, 200) : "";
  const accessSeverity =
    input.accessSeverity !== null &&
    Number.isFinite(input.accessSeverity) &&
    input.accessSeverity >= 0 &&
    input.accessSeverity <= 4
      ? Math.round(input.accessSeverity)
      : null;

  const reasons: string[] = [];
  const siteHigh = isCommunityElevHigh(schoolElevationM, provinceAvgElev);
  const routeHigh = isCommunityElevHigh(routeFullMaxElev, provinceAvgElev);
  const landHigh = landformSuggestsHighland(landformTh);

  if (siteHigh) {
    if (schoolElevationM !== null && schoolElevationM >= COMMUNITY_HIGHLAND_MIN_M) {
      reasons.push(`ที่ตั้งสูง ${Math.round(schoolElevationM)} ม. (≥ ${COMMUNITY_HIGHLAND_MIN_M} ม.)`);
    } else if (schoolElevationM !== null && provinceAvgElev !== null) {
      reasons.push(
        `ที่ตั้ง ${Math.round(schoolElevationM)} ม. สูงกว่าค่าเฉลี่ยจังหวัด (${Math.round(provinceAvgElev)} ม.)`,
      );
    }
  }
  if (routeHigh) {
    if (routeFullMaxElev !== null && routeFullMaxElev >= COMMUNITY_HIGHLAND_MIN_M) {
      reasons.push(
        `เส้นทางทั้งเส้นผ่านจุดสูงสุด ${Math.round(routeFullMaxElev)} ม. (≥ ${COMMUNITY_HIGHLAND_MIN_M} ม. · เกต SSRA)`,
      );
    } else if (routeFullMaxElev !== null && provinceAvgElev !== null) {
      reasons.push(
        `เส้นทางทั้งเส้นผ่านจุดสูงสุด ${Math.round(routeFullMaxElev)} ม. สูงกว่าค่าเฉลี่ยจังหวัด (${Math.round(provinceAvgElev)} ม.)`,
      );
    }
  }
  if (landHigh) reasons.push(`ลักษณะภูมิประเทศ: ${landformTh}`);

  const highland = siteHigh || routeHigh || landHigh;
  if (!highland) {
    if (schoolElevationM !== null) {
      reasons.push(
        `ที่ตั้ง ${Math.round(schoolElevationM)} ม. ต่ำกว่าเกณฑ์พื้นที่สูง (${COMMUNITY_HIGHLAND_MIN_M} ม.)`,
      );
    } else if (!landformTh) {
      reasons.push("ยังไม่มีข้อมูลความสูง/ภูมิประเทศ");
    } else {
      reasons.push(`ลักษณะภูมิประเทศ: ${landformTh || "—"} (ไม่เข้าเกณฑ์พื้นที่สูง)`);
    }
  }

  let tier: CommunityAxisATier = "low";
  if (highland) {
    const highMountain =
      (schoolElevationM !== null && schoolElevationM >= COMMUNITY_HIGH_MOUNTAIN_M) || landformTh.includes("ภูเขาสูง");
    tier = highMountain ? "high" : "mid";
  }

  // ต้องมีทั้งแกน A (ภูมิประเทศ) และ B (การเข้าถึง) ถึงจะได้ป้าย flat_*/highland_* — ห้ามเดาจากแกนเดียว
  const hasASignal = schoolElevationM !== null || routeFullMaxElev !== null || landformTh.length > 0;
  const hasBSignal = accessSeverity !== null;

  let compositeKey: CommunityCompositeKey;
  if (!hasASignal || !hasBSignal) {
    compositeKey = "incomplete";
  } else {
    const hard = accessSeverity! >= COMMUNITY_ACCESS_HARD_MIN;
    if (highland && hard) compositeKey = "highland_remote";
    else if (highland && !hard) compositeKey = "highland_accessible";
    else if (!highland && hard) compositeKey = "flat_remote";
    else compositeKey = "flat_normal";
  }

  const meta = COMMUNITY_COMPOSITES[compositeKey];

  let axisC: GisCommunityClass["axisC"] = null;
  const dens = input.popDensityPerKm2;
  if (dens !== null && dens !== undefined && Number.isFinite(dens) && dens >= 0) {
    const sc = settlementClass(dens);
    axisC = { label: sc.label, tone: sc.tone, popDensityPerKm2: dens };
  }

  const meanSlopePct =
    input.meanSlopePct !== null && input.meanSlopePct !== undefined && Number.isFinite(input.meanSlopePct)
      ? input.meanSlopePct
      : null;
  const wsc = estimateWscClass({ meanSlopePct, schoolElevationM });
  const wscProxy: GisCommunityClass["wscProxy"] = wsc
    ? {
        class: wsc.class,
        labelTh: wsc.labelTh,
        hint: wsc.hint,
        meanSlopePct: wsc.meanSlopePct,
        schoolElevationM: wsc.schoolElevationM,
      }
    : null;

  return {
    axisA: {
      highland,
      tier,
      schoolElevationM,
      provinceAvgElev,
      routeFullMaxElev,
      landformTh,
      reasons: reasons.slice(0, 8),
    },
    axisB: {
      severity: accessSeverity,
      label: accessSeverityLabel(accessSeverity),
    },
    axisC,
    composite: {
      key: compositeKey,
      labelTh: meta.labelTh,
      tone: meta.tone,
    },
    wscProxy,
    version: COMMUNITY_CLASS_VERSION,
    calculatedAt: input.calculatedAt ?? "",
  };
}

/**
 * คำนวณจาก gis + accessSeverity ที่ caller ส่งมา (มัก derive32Severity จาก lib/gis)
 * แยก severity ออกนอกโมดูลนี้เพื่อไม่ให้ community-class import gis
 */
export function computeCommunityClass(
  gis: GisAnalysis,
  accessSeverity: number | null,
  calculatedAt?: string,
): GisCommunityClass {
  const elev = gis.elevation;
  return classifyCommunity({
    schoolElevationM: elev?.schoolMarkerElevationM ?? null,
    provinceAvgElev: elev?.provinceAvgElev ?? null,
    routeFullMaxElev: elev?.routeFullMaxElev ?? null,
    landformTh: elev?.landformTh ?? "",
    accessSeverity,
    popDensityPerKm2: gis.areaSummary?.popDensityPerKm2 ?? null,
    meanSlopePct: elev?.meanSlopePct ?? null,
    calculatedAt: calculatedAt ?? gis.savedAt ?? "",
  });
}

/** ป้ายชั้นแกน A (mid-band wording) — ใช้แสดงใต้ composite */
export function communityAxisATierLabelTh(tier: CommunityAxisATier): string {
  if (tier === "high") {
    return `ชั้นภูเขาสูง (≥${COMMUNITY_HIGH_MOUNTAIN_M} ม. ตามแอป/HRDI)`;
  }
  if (tier === "mid") {
    return `ชั้นพื้นที่สูง (${COMMUNITY_HIGHLAND_MIN_M}–${COMMUNITY_HIGH_MOUNTAIN_M - 1} ม. · สพฐ. เรียก "ภูเขา" เมื่อ ≥600 ม.)`;
  }
  return `ไม่เข้าเกณฑ์พื้นที่สูง (ต่ำกว่า ${COMMUNITY_HIGHLAND_MIN_M} ม. ยกเว้นเทียบจังหวัด/เส้นทาง/landform)`;
}

/**
 * แนะนำ unit.settingType จากผล GIS
 * ใช้ communityClass ที่มีอยู่แล้ว ถ้าไม่มีจะ classify จาก accessSeverity ที่ส่งมา
 */
export function suggestSettingTypeFromGis(gis: GisAnalysis, accessSeverity: number | null = null): SettingType | null {
  const cc = gis.communityClass ?? computeCommunityClass(gis, accessSeverity);
  const landform = (gis.elevation?.landformTh ?? cc.axisA.landformTh ?? "").trim();

  if (landform.includes("หุบเขา")) return "หุบเขา";
  if (landform.includes("เชิงเขา")) return "เชิงเขา";
  if (landform.includes("ภูเขาสูง") || landform.includes("บนภูเขา") || cc.axisA.tier === "high") return "ภูเขาสูง";
  if (cc.axisA.highland && cc.axisA.tier === "mid") return "ภูเขาสูง";
  if (cc.composite.key === "flat_remote") return "พื้นราบห่างไกล";
  if (cc.composite.key === "flat_normal" && landform.includes("พื้นราบ")) return "อื่น ๆ";
  if (cc.composite.key === "highland_remote" || cc.composite.key === "highland_accessible") {
    return "ภูเขาสูง";
  }
  return null;
}

/** ตรวจว่า string เป็น CommunityCompositeKey ที่รู้จัก (กรอง list/SQL) */
export function isCommunityCompositeKey(value: string | null | undefined): value is CommunityCompositeKey {
  return Boolean(value && value in COMMUNITY_COMPOSITES);
}
