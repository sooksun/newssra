// ประตูคัดกรอง "เข้าข่ายโรงเรียนพื้นที่สูงให้พิจารณาต่อ" — pure, framework-free
//
// สัญญาณ: ความสูง สพฐ./HRDI · terrain highland · ชั้นป่า 3 ชั้น (Status core / Legal / Context)
// ห้ามยุบ Forest = 0/1 ตัวเดียว
//
// สเปก: docs/superpowers/specs/2026-08-07-forest-three-layers-highland-design.md
//       docs/superpowers/specs/2026-08-07-forest-boundary-highland-screen-design.md
// ห้าม import lib/gis.ts (กัน circular)

import { COMMUNITY_HIGHLAND_MIN_M, isCommunityElevHigh, landformSuggestsHighland } from "./community-class";
import {
  buildForestAnalysis,
  forestContextStrengthLabelTh,
  isHighElevLowForestContext,
  type ForestAnalysis,
  type ForestContextStrength,
} from "./forest-layers";
import type { ForestOverlayResult } from "./map/forestBoundaries";
import { FOREST_STATUS_LABELS } from "./map/forestBoundaries";

export const HIGHLAND_SCREEN_VERSION = "hs-2";

/** severity แกน B ≥ ค่านี้ = เข้าถึงยาก — ใช้คู่ forest context อ่อน / legal near */
export const HIGHLAND_SCREEN_ACCESS_HARD_MIN = 2;

export interface HighlandScreenInput {
  schoolElevationM: number | null;
  provinceAvgElev: number | null;
  /** ความสูงสุดตลอดเส้นทาง (SSRA route-high) */
  routeFullMaxElev: number | null;
  landformTh: string;
  /** 0–4 จาก derive32Severity; null = ยังไม่มี */
  accessSeverity: number | null;
  /**
   * ผล 3 ชั้นป่า (แนะนำ) — ถ้าไม่มี ใช้ legalOverlay อย่างเดียวได้
   */
  forestAnalysis?: ForestAnalysis | null;
  /** backward compat: Legal จาก OSM */
  forestOverlay?: ForestOverlayResult | null;
  /** ความหนาแน่นคน/ตร.กม. — ใช้จับ "เมืองบนดอย" */
  popDensityPerKm2?: number | null;
  /** กลุ่มเกาะจาก terrain-signature — ห้ามดัน highland จากป่าบนเกาะ */
  isIsland?: boolean;
}

export interface HighlandScreenResult {
  version: string;
  /** เข้าข่ายให้พิจารณาต่อในกลุ่มพื้นที่สูง/ทุรกันดาร */
  candidate: boolean;
  elevGate: boolean;
  terrainHighland: boolean;
  /** context ป่า: strong | weak | none | unknown */
  forestContext: ForestContextStrength;
  /** ใช้ status RFD ผ่านประตู */
  forestStatusContributes: boolean;
  /** ใช้ legal ทางการผ่านประตู */
  forestLegalContributes: boolean;
  /** เมืองบนดอย: สูง + ชุมชนใหญ่ + ป่าใน 1 กม. ต่ำ */
  highElevUrban: boolean;
  reasons: string[];
  reviewFlags: string[];
  forestMetrics: ForestAnalysis["metrics"] | null;
}

/**
 * คัดกรองเบื้องต้น — elevation ไม่พอเพียงลำพังเมื่อมีชั้นป่า
 *
 * candidate =
 *   elevGate OR terrainHighland
 *   OR (contextStrong && statusAuthority === rfd)
 *   OR (legalIn && legalAuthority === authoritative && !island)
 *   OR (contextWeak && (elevGate || terrainHighland || accessSev ≥ 2))
 *   OR (legacy: legal OSM in อย่างเดียว → ไม่ผ่านประตู)
 */
export function classifyHighlandScreen(input: HighlandScreenInput): HighlandScreenResult {
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
  const isIsland = input.isIsland === true;
  const density =
    input.popDensityPerKm2 !== null &&
    input.popDensityPerKm2 !== undefined &&
    Number.isFinite(input.popDensityPerKm2)
      ? input.popDensityPerKm2
      : null;

  const siteHigh = isCommunityElevHigh(schoolElevationM, provinceAvgElev);
  const routeHigh = isCommunityElevHigh(routeFullMaxElev, provinceAvgElev);
  const elevGate = siteHigh || routeHigh;
  const terrainHighland = landformSuggestsHighland(landformTh);

  const forest: ForestAnalysis | null =
    input.forestAnalysis ??
    (input.forestOverlay
      ? buildForestAnalysis({ legalOverlay: input.forestOverlay, calculatedAt: input.forestOverlay.calculatedAt })
      : null);

  const metrics = forest?.metrics ?? null;
  const context = forest?.contextStrength ?? "unknown";
  const statusAuth = forest?.status?.authority;
  const legalAuth = forest?.legal?.authority;
  const legalIn = forest?.legal?.inside === 1;
  const legalNear = forest?.legal?.inside === 0 && (forest?.legal?.distanceM ?? Infinity) <= 1000;

  const reasons: string[] = [];
  const reviewFlags: string[] = [];

  if (siteHigh && schoolElevationM !== null) {
    if (schoolElevationM >= COMMUNITY_HIGHLAND_MIN_M) {
      reasons.push(`ที่ตั้งสูง ${Math.round(schoolElevationM)} ม. (≥ ${COMMUNITY_HIGHLAND_MIN_M} ม.)`);
    } else if (provinceAvgElev !== null) {
      reasons.push(
        `ที่ตั้ง ${Math.round(schoolElevationM)} ม. สูงกว่าค่าเฉลี่ยจังหวัด (${Math.round(provinceAvgElev)} ม.)`,
      );
    }
  }
  if (routeHigh && routeFullMaxElev !== null) {
    reasons.push(`เส้นทางผ่านจุดสูงสุด ${Math.round(routeFullMaxElev)} ม.`);
  }
  if (terrainHighland && landformTh) {
    reasons.push(`ภูมิประเทศ: ${landformTh}`);
  }

  if (forest) {
    reasons.push(`บริบทป่า: ${forestContextStrengthLabelTh(context)}`);
    if (metrics?.forest_1km_pct !== null && metrics?.forest_1km_pct !== undefined) {
      reasons.push(
        `พื้นที่ป่าในรัศมี 1 กม. ${metrics.forest_1km_pct.toLocaleString("th-TH")}%` +
          (metrics.forest_3km_pct !== null ? ` · 3 กม. ${metrics.forest_3km_pct.toLocaleString("th-TH")}%` : "") +
          (metrics.forest_5km_pct !== null ? ` · 5 กม. ${metrics.forest_5km_pct.toLocaleString("th-TH")}%` : ""),
      );
    }
    if (metrics?.forest_type) {
      reasons.push(`ชนิดป่า: ${metrics.forest_type}`);
    }
    if (metrics?.insideSource === "status" && metrics.forest_inside === 1) {
      reasons.push("จุดที่ตั้งทับพื้นที่ป่าตามชั้นสถานภาพ (กรมป่าไม้)");
    } else if (metrics?.insideSource === "legal" && metrics.forest_inside === 1) {
      const auth = legalAuth === "authoritative" ? "ชั้นทางการ" : "อ้างอิง OSM — ไม่ใช่ประตูอย่างเดียว";
      reasons.push(`จุดที่ตั้งทับเขตตามกฎหมาย · ${auth}`);
    }
    if (metrics?.reserve_forest === 1) reasons.push("ในเขตป่าสงวนแห่งชาติ (ชั้นกฎหมาย)");
    if (metrics?.protected_area === 1) reasons.push("ในเขตคุ้มครอง (อุทยาน/เขตรักษาพันธุ์ ฯ)");
  }

  if (isIsland) {
    reasons.push("กลุ่มเกาะ — ไม่ใช้เขตป่า/ชายเลนเป็นตัวดันประตูพื้นที่สูง");
  }

  const largeCommunity = density !== null && density >= 750;
  const highElevUrban = isHighElevLowForestContext({
    elevGate,
    largeCommunity,
    forest1kmPct: metrics?.forest_1km_pct ?? null,
  });
  if (highElevUrban) {
    reviewFlags.push("ที่สูงแต่ชุมชนใหญ่และสัดส่วนป่าใน 1 กม. ต่ำ — อาจเป็นเมืองบนดอย ไม่ใช่ถิ่นทุรกันดารป่า");
  }

  let candidate = elevGate || terrainHighland;
  let forestStatusContributes = false;
  let forestLegalContributes = false;

  // สภาพป่าจริง (กรมป่าไม้ cover) — context แข็งผ่านประตูได้
  if (!isIsland && statusAuth === "rfd-forest-cover") {
    if (context === "strong") {
      candidate = true;
      forestStatusContributes = true;
    } else if (
      context === "weak" &&
      (elevGate || terrainHighland || (accessSeverity !== null && accessSeverity >= HIGHLAND_SCREEN_ACCESS_HARD_MIN))
    ) {
      candidate = true;
      forestStatusContributes = true;
    }
  }

  // แนวเขตป่าสงวน RFD (กฎหมาย) — ถือเป็น legal authoritative ผ่านประตูเมื่อ inside
  // ไม่ใช้ % รัศมีเป็น "ถูกล้อมด้วยป่าจริง" เพราะ polygon คือเขตตามกฎหมาย ไม่ใช่ cover
  const rfdReserveLegal =
    statusAuth === "rfd-national-reserved-forest" && forest?.metrics?.forest_inside === 1;
  if (!isIsland && rfdReserveLegal) {
    candidate = true;
    forestLegalContributes = true;
    reasons.push("อยู่ในแนวเขตป่าสงวนแห่งชาติ (ชั้นกรมป่าไม้ — เขตกฎหมายโดยประมาณ)");
  }

  if (!isIsland && legalAuth === "authoritative" && legalIn) {
    candidate = true;
    forestLegalContributes = true;
  } else if (
    !isIsland &&
    legalAuth === "authoritative" &&
    legalNear &&
    (elevGate || terrainHighland || (accessSeverity !== null && accessSeverity >= HIGHLAND_SCREEN_ACCESS_HARD_MIN))
  ) {
    candidate = true;
    forestLegalContributes = true;
  }

  // OSM legal อย่างเดียว — แนบเหตุผลแล้ว แต่ไม่ผ่านประตู (คง hs-1)
  if (legalAuth === "osm-reference" && (legalIn || legalNear) && !forestStatusContributes) {
    const overlayStatus = input.forestOverlay?.status;
    if (overlayStatus && overlayStatus !== "unknown" && overlayStatus !== "out") {
      reasons.push(`เขตกฎหมาย (OSM): ${FOREST_STATUS_LABELS[overlayStatus]} — ยังไม่ใช่ประตูเพียงลำพัง`);
    }
  }

  if (!candidate && reasons.length === 0) {
    if (schoolElevationM !== null) {
      reasons.push(
        `ที่ตั้ง ${Math.round(schoolElevationM)} ม. ยังไม่เข้าเกณฑ์ความสูง/ภูมิประเทศ/บริบทป่า (ทางการ)`,
      );
    } else {
      reasons.push("ยังไม่มีสัญญาณความสูง ภูมิประเทศ หรือชั้นป่าทางการที่ผ่านประตู");
    }
  }

  return {
    version: HIGHLAND_SCREEN_VERSION,
    candidate,
    elevGate,
    terrainHighland,
    forestContext: context,
    forestStatusContributes,
    forestLegalContributes,
    highElevUrban,
    reasons,
    reviewFlags,
    forestMetrics: metrics,
  };
}
