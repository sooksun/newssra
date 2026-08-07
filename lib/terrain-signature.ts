// ลายเซ็นภูมิประเทศ — จำแนก "ภูเขาสูง / ภูเขา / หุบเขาแคบ / หุบเขากว้าง / ที่ราบสูง / เชิงเขา / พื้นราบ / เนินเขา"
// pure, framework-free — ห้าม import lib/gis.ts (กัน circular กับ sanitizeGis) และห้าม import cesium / next / node API
//
// สเปก: docs/superpowers/specs/2026-08-07-terrain-signature-classifier-design.md
// หลักการ 4 ข้อ:
//   1) แยกแกน "ภูมิประเทศ" ออกจาก "ความยากในการเข้าถึง" และ "ความหนาแน่น" — ห้ามยุบเป็นเลขเดียว
//   2) รูปทรงท้องถิ่นวัดแบบ "สัมพัทธ์กับโรงเรียน" ไม่ใช่ความสูงสัมบูรณ์
//   3) ข้อมูลไม่พอ = ตอบว่าไม่พอ พร้อมรายการที่ขาด (ไม่เดา)
//   4) ทุกคำตอบแนบหลักฐาน + ระยะห่างจากเส้นแบ่ง (margin) เพื่อให้โต้แย้งได้เป็นรายค่า
//
// ไม่มีผลต่อคะแนน 100 คะแนนทางการ — เป็นชั้นข้อมูลประกอบเช่นเดียวกับ Auto GIS Score

import { settlementClass } from "./settlement";
import type { GisAnalysis, GisRouteAccessStatus, GisRouteAnalysis, GisSectorElevation } from "./types";

/** เวอร์ชันเกณฑ์ — เปลี่ยนเมื่อแก้ต้นไม้ตัดสินหรือค่าคงที่ใด ๆ ด้านล่าง */
export const TERRAIN_SIGNATURE_VERSION = "ts-1";

/** ความสูงที่หมุดโรงเรียน (ม.) ที่ถือว่า "ภูเขาสูง" — เจตนาเดียวกับ MORPHOLOGY_HIGH_MOUNTAIN_M
 *  แต่วัดที่หมุดโรงเรียน ไม่ใช่ค่าเฉลี่ยกริด (การตัดสินใจเชิงผลิตภัณฑ์ บันทึกไว้ใน spec) */
export const TS_HIGH_MOUNTAIN_M = 1000;

/** ความสูงสัมบูรณ์ (ม.) ที่ถือว่า "สูง" สำหรับจุดบนเส้นทาง — ตรงกับ MORPHOLOGY_HIGHLAND_MIN_M */
export const TS_HIGHLAND_MIN_M = 500;

/** ต้องสูงกว่าค่าเฉลี่ยจังหวัดเกินค่านี้ (ม.) จึงนับว่า "สูง" — กันจังหวัดพื้นราบที่ค่าเฉลี่ยต่ำจนสัญญาณรบกวน DEM ก็ข้ามเกณฑ์ */
export const TS_PROVINCE_MARGIN_M = 150;

/** ความสูงที่ต้องไต่/ลง (ม.) จึงนับว่า "มีสิ่งกีดขวางระหว่างทาง"
 *  เลขเดียวกับ band 2 ของ elevationGainSeverity แต่เป็นคนละปริมาณ (ที่นั่นคือ gain สะสม ที่นี่คือส่วนต่างสุทธิ) */
export const TS_CLIMB_K_M = 300;

/** ส่วนต่างระดับระหว่างทาง (ม.) ที่ยังถือว่า "ราบตลอดเส้นทาง" */
export const TS_FLAT_ROUTE_M = 100;

/** ต้องมีที่สูงกว่าโรงเรียนในรัศมี 1 กม. เกินค่านี้ (ม.) จึงนับว่าอยู่เชิงเขา */
export const TS_PROMINENCE_MIN_M = 100;

/** ความลาดชันรอบโรงเรียน (%) — ≤ ค่านี้ = ราบ (LDD A/B) */
export const TS_FLAT_SLOPE_PCT = 5;

/** ความลาดชันรอบโรงเรียน (%) — > ค่านี้ = ชัน (LDD D ขึ้นไป) */
export const TS_STEEP_SLOPE_PCT = 12;

/** ความสูงขั้นต่ำ (ม.) ที่ยอมให้ตัดสินเป็น "ภูเขา" จากภูมิประเทศไม่ราบเพียงอย่างเดียว
 *  ใช้ 600 ม. ตามนิยาม "ภูเขา" ในคู่มือ สพฐ. (ต่ำกว่าเกณฑ์ภูเขาสูง 1,000 ม. ของแอป) */
export const TS_MOUNTAIN_MIN_ALT_M = 600;

/** ความหนาแน่น (คน/ตร.กม.) ที่ถือว่าเข้าเขตกึ่งเมือง — ต้องเท่ากับจุดตัด "semi" ของ settlementClass เสมอ
 *  (lib/terrain-signature.test.ts บังคับความสัมพันธ์นี้ไว้ ห้ามแก้ค่าใดค่าหนึ่งฝ่ายเดียว) */
export const TS_URBAN_DENSITY_CUT = 750;

/** จำนวนทิศ (จาก 8) ที่ต้องมีที่สูงกว่าโรงเรียน จึงนับว่า "ถูกล้อม" */
export const TS_ENCLOSED_MIN_SECTORS = 5;

/** จำนวนทิศที่ยอมให้มีที่ต่ำกว่า ขณะยังนับว่าถูกล้อม */
export const TS_ENCLOSED_MAX_LOWER = 1;

/** จำนวนทิศที่ต้องอ่านค่าได้ครบ (จาก 8) จึงตัดสินความถูกล้อม/ความเป็นสันได้ */
export const TS_SECTOR_MIN_USABLE = 7;

/** ต้องมีองค์ประกอบความยากอย่างน้อยกี่ตัวที่ถึงระดับ 2 จึงเรียกว่า "ทุรกันดารหลายด้าน"
 *  กันไม่ให้ตัวแปรเดียว (เช่น ความชันสะสม) ชี้ขาดว่าโรงเรียนทุรกันดาร */
export const TS_SEVERE_COMPONENT_MIN = 2;

/** ค่าลักษณะที่ตั้งที่หมายถึงพื้นที่เกาะ — ต้องตรงกับ SETTING_TYPES ใน lib/types.ts */
export const TS_ISLAND_SETTING = "เกาะ";

/**
 * ความต่างระดับสูงสุด−ต่ำสุดของพื้นที่วิเคราะห์ (~2.8 กม.) ที่ยังถือว่าเป็น "ที่ราบผืนใหญ่" (ม.)
 *
 * สอบเทียบกับข้อมูลจริงในระบบ: โรงเรียนภูมิประเทศภูเขาวัดได้ 173–378 ม. และโรงเรียนที่ราบสูง
 * ค่อนข้างเรียบที่ยังทุรกันดารจริง (บ้านโคกงาม) วัดได้ 109 ม. — ตั้งไว้ต่ำกว่านั้นมากโดยเจตนา
 * เพื่อให้กฎกรองไม่มีทางแตะโรงเรียนกลุ่มนั้น
 */
export const TS_PLAIN_RELIEF_MAX_M = 60;

/** ความหนาแน่นขั้นต่ำ (คน/ตร.กม.) ที่ถือว่ามี "ชุมชนจริง" รอบโรงเรียน — ต่ำกว่านี้คือที่ราบที่ยังไม่มีคน */
export const TS_DEVELOPED_DENSITY_MIN = 300;

/**
 * บริการต้อง "ใกล้จริง" ทั้งเวลาและระยะ จึงจะกรองออกเป็นพื้นที่พัฒนาแล้วได้
 *
 * เขียนเป็นเงื่อนไขเชิงบวก (ต้องพิสูจน์ว่าใกล้) แทนเงื่อนไขเชิงลบ (ยกเว้นเมื่อไกล) โดยเจตนา —
 * แบบหลังจะกรองโรงเรียนระยะปานกลางออกโดยที่ไม่มีใครเคยตัดสินใจว่าให้กรอง
 */
export const TS_SERVICE_CLOSE_MIN = 45;
export const TS_SERVICE_CLOSE_KM = 40;

/** แถบความไม่แน่นอนรอบแต่ละเส้นแบ่ง — ตัดสินภายในแถบนี้ = ประทับ "ใกล้เส้นแบ่ง" */
const BANDS = {
  elevationM: 30,
  slopePct: 2,
  routeElevationM: 30,
  climbM: 50,
  prominenceM: 30,
  densityPct: 0.2,
} as const;

/** ค่าความลาดชันเฉลี่ยทั้งกริด (~2.8 กม.) ปนความชันของผนังหุบ/ไหล่เขาที่ไกลจากโรงเรียน จึงไม่แน่นอนกว่าค่ารอบโรงเรียน
 *  → ขยายแถบความไม่แน่นอนเป็นเท่านี้ เพื่อให้เคสก้ำกึ่งถูกส่งให้คนตรวจแทนที่จะตัดสินเงียบ ๆ */
const ANALYSIS_GRID_SLOPE_BAND_PCT = 4;

export type TerrainRuleId =
  "R-I" | "R0" | "R0b" | "R1" | "R2" | "R3" | "R4" | "R4b" | "R5" | "R6" | "R6b" | "R7" | "insufficient";

/** กลุ่มคำตอบเชิงนโยบาย — landform อย่างเดียวไม่พอ ต้องผ่านเกตความหนาแน่นและความยากด้วย
 *  `island` เป็นกลุ่มแยกเด็ดขาด: โรงเรียนพื้นที่เกาะไม่ถูกนับรวมกับพื้นที่สูงทุรกันดารไม่ว่าภูมิประเทศบนเกาะจะเป็นแบบใด */
export type TerrainGroup =
  "highland_remote" | "valley_flat" | "flat_normal" | "island" | "developed" | "other" | "unknown";

export const TERRAIN_RULE_LABELS: Record<TerrainRuleId, string> = {
  "R-I": "โรงเรียนพื้นที่เกาะ",
  R0: "โรงเรียนในพื้นที่เมือง/กึ่งเมือง",
  R0b: "โรงเรียนในที่ราบผืนใหญ่ที่พัฒนาแล้ว",
  R1: "โรงเรียนบนภูเขาสูง",
  R2: "โรงเรียนบนภูเขา/ไหล่เขา",
  R3: "โรงเรียนในหุบเขาแคบ",
  R4: "โรงเรียนพื้นราบในหุบเขากว้าง",
  R4b: "โรงเรียนบนที่ราบสูง",
  R5: "โรงเรียนเชิงเขา/ที่ลาดเชิงเขา",
  R6: "โรงเรียนพื้นราบปกติ",
  R6b: "โรงเรียนพื้นราบ (มีสันกั้นระดับต่ำระหว่างทาง)",
  R7: "โรงเรียนบนเนินเขา/ลอนลาด",
  insufficient: "ข้อมูลไม่พอ — ยังจำแนกภูมิประเทศไม่ได้",
};

export const TERRAIN_GROUP_LABELS: Record<TerrainGroup, string> = {
  highland_remote: "ภูเขาสูง/ภูเขา — ทุรกันดารหลายด้าน",
  valley_flat: "พื้นราบในหุบเขา",
  flat_normal: "พื้นราบปกติ/เขตเมือง",
  island: "พื้นที่เกาะ (แยกจากพื้นที่สูงทุรกันดาร)",
  developed: "พื้นที่พัฒนาแล้ว/เข้าถึงสะดวก — ไม่เข้าเกณฑ์ทุรกันดาร",
  other: "ลักษณะอื่น (ไม่เข้าสามกลุ่มหลัก)",
  unknown: "ยังสรุปกลุ่มไม่ได้ — ข้อมูลประกอบไม่ครบ",
};

/** ระดับความยาก 0–4 แยกรายองค์ประกอบ (จาก derive32Severity) — ใช้ตัดสินว่า "ยากหลายด้าน" หรือยากตัวเดียว */
export interface TerrainSeverityComponents {
  rcr: number | null;
  ttr: number | null;
  avgSpeed: number | null;
  gain: number | null;
}

export interface TerrainSignatureInput {
  /** ALT — ความสูง terrain ที่หมุดโรงเรียน (ม.) */
  schoolElevationM: number | null;
  /** ความลาดชันเฉลี่ยรอบโรงเรียน (%) — ควรวัดเฉพาะกริดชั้นใน ไม่ใช่ทั้งผืน (ผนังหุบทำให้ก้นหุบดูชัน) */
  innerSlopePct: number | null;
  /**
   * ขอบเขตที่ค่าความลาดชันข้างต้นถูกวัด — ต้องบอกตรง ๆ ในหลักฐาน ห้ามให้ผู้อ่านเข้าใจผิดว่าเป็นรอบโรงเรียน
   * ค่าที่บันทึกไว้ในระบบวันนี้เป็นค่าเฉลี่ยทั้งกริดวิเคราะห์ (~2.8 กม.) จึงเป็นค่าตั้งต้น
   */
  slopeSource?: "inner-500m" | "analysis-grid";
  /** ธง 8 ทิศ (deltaFromSchoolM ต้องคำนวณมาแล้วจาก deriveSectorMetrics) */
  sectors: readonly GisSectorElevation[] | null;
  /** ความต่างระดับสูงสุด−ต่ำสุดของพื้นที่วิเคราะห์ ~2.8 กม. (ม.) — ใช้แยก "ที่ราบผืนใหญ่" ออกจาก "ลานราบเล็กกลางภูเขา" */
  gridReliefM?: number | null;
  /** ความสูงสุดในรัศมี 1 กม. (ม.) */
  localMaxElevation1KmM: number | null;
  /** ความสูงสุดช่วง 5 กม.สุดท้ายของเส้นทาง (ม.) */
  routeTailMaxElev: number | null;
  /** ความสูงสุดตลอดเส้นทางทั้งเส้น (ม.) */
  routeFullMaxElev: number | null;
  /** ความสูงสะสมขาขึ้นตลอดเส้นทาง (ม.) */
  routeGainM: number | null;
  provinceAvgElev: number | null;
  /** ความหนาแน่นประชากรวงแหวนนอกสุด (คน/ตร.กม.) */
  popDensityPerKm2: number | null;
  /** 0–4 จาก derive32Severity */
  accessSeverity: number | null;
  severityComponents?: TerrainSeverityComponents | null;
  routeAccessStatus?: GisRouteAccessStatus | null;
  /** เส้นทางต้องข้ามเรือข้ามฟาก — หลักฐานพื้นที่เกาะที่วัดได้จากเส้นทาง */
  hasFerry?: boolean;
  /** ลักษณะที่ตั้งที่ผู้กรอกระบุ (`unit.settingType`) — "เกาะ" คือคำประกาศของผู้รับผิดชอบข้อมูล */
  declaredSettingType?: string | null;
  /** ลักษณะที่ตั้งที่ AI เสนอจากภาพ 3 มิติ (`unit.settingSuggestion`) — สัญญาณอิสระอีกทาง */
  aiSettingType?: string | null;
  /** เวลาเดินทางจริงของเส้นทางหลัก (นาที) — ใช้กันไม่ให้โรงเรียนที่ "ไกลจริง" ถูกกรองออกเพราะถนนดี */
  primaryRouteMinutes?: number | null;
  /** ระยะทางถนนของเส้นทางหลัก (กม.) */
  primaryRouteKm?: number | null;
}

export interface TerrainMargin {
  key: string;
  label: string;
  value: number;
  threshold: number;
  /** ค่า − เกณฑ์ (ลบ = ต่ำกว่าเกณฑ์) */
  marginM: number;
  band: number;
  near: boolean;
  unit: string;
}

export interface TerrainEvidenceItem {
  label: string;
  value: string;
}

export interface TerrainSignature {
  ruleId: TerrainRuleId;
  labelTh: string;
  group: TerrainGroup;
  groupLabelTh: string;
  /** true = มีเงื่อนไขตัดสินอย่างน้อยหนึ่งข้ออยู่ในแถบความไม่แน่นอน → ควรให้คนตรวจซ้ำ */
  nearBoundary: boolean;
  margins: TerrainMargin[];
  evidence: TerrainEvidenceItem[];
  /** ข้อมูลที่ขาด — มีค่าได้แม้จำแนกสำเร็จ (เช่น จำแนกภูมิประเทศได้ แต่ยังสรุปกลุ่มไม่ได้) */
  missing: string[];
  /** เหตุที่ควรให้คนตรวจซ้ำ — กรณีที่กฎอัตโนมัติ "เกือบ" ตัดสินไปทางหนึ่ง แต่มีเหตุให้ไม่ตัดสินเอง */
  reviewFlags: string[];
  version: string;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fmt(value: number | null, unit: string, digits = 0): string {
  if (value === null) return "ไม่มีข้อมูล";
  return `${value.toFixed(digits)} ${unit}`;
}

/** ตัวสะสม margin — บันทึกเฉพาะเงื่อนไขที่ถูกประเมินจริงบนเส้นทางตัดสิน ไม่ใช่ทุกเกณฑ์ในตาราง */
class MarginLog {
  readonly items: TerrainMargin[] = [];

  check(key: string, label: string, value: number, threshold: number, band: number, unit: string): number {
    const marginM = Math.round((value - threshold) * 100) / 100;
    this.items.push({
      key,
      label,
      value,
      threshold,
      marginM,
      band,
      near: Math.abs(marginM) < band,
      unit,
    });
    return marginM;
  }
}

function insufficient(
  missing: string[],
  evidence: TerrainEvidenceItem[],
  reviewFlags: string[] = [],
): TerrainSignature {
  return {
    ruleId: "insufficient",
    labelTh: TERRAIN_RULE_LABELS.insufficient,
    group: "unknown",
    groupLabelTh: TERRAIN_GROUP_LABELS.unknown,
    nearBoundary: false,
    margins: [],
    evidence,
    missing,
    reviewFlags,
    version: TERRAIN_SIGNATURE_VERSION,
  };
}

/**
 * จำแนกลายเซ็นภูมิประเทศจากค่าดิบ — first match wins ตามลำดับ R-I → R0 → R1 → R2 → R3 → R4 → R4b → R5 → R6 → R6b → R7
 * ไม่แก้ไขค่าที่รับเข้ามา และไม่แทนค่าที่ขาดด้วยค่าสมมติใด ๆ
 */
export function classifyTerrainSignature(input: TerrainSignatureInput): TerrainSignature {
  const alt = finite(input.schoolElevationM);
  const slope = finite(input.innerSlopePct);
  const local1km = finite(input.localMaxElevation1KmM);
  const routeTail = finite(input.routeTailMaxElev);
  const routeFull = finite(input.routeFullMaxElev);
  const gain = finite(input.routeGainM);
  const provinceAvg = finite(input.provinceAvgElev);
  const density = finite(input.popDensityPerKm2);
  const severity = finite(input.accessSeverity);
  const gridRelief = finite(input.gridReliefM);
  const routeMinutes = finite(input.primaryRouteMinutes);
  const routeKm = finite(input.primaryRouteKm);
  const margins = new MarginLog();
  const missing: string[] = [];
  const reviewFlags: string[] = [];

  // ── เกตข้อมูลประกอบ (ไม่บล็อกการจำแนกภูมิประเทศ แต่บล็อกการสรุปกลุ่ม) ──
  const urbanTone = density === null ? null : settlementClass(density).tone;
  if (density === null) missing.push("ความหนาแน่นประชากรรอบโรงเรียน (ยังยืนยันว่าไม่ใช่เขตเมืองไม่ได้)");

  const components = input.severityComponents ?? null;
  const componentValues = components
    ? [components.rcr, components.ttr, components.avgSpeed, components.gain].map(finite)
    : [];
  const knownComponents = componentValues.filter((v): v is number => v !== null);
  const severeComponentCount = knownComponents.filter((v) => v >= 2).length;
  const severeManyWays = knownComponents.length > 0 ? severeComponentCount >= TS_SEVERE_COMPONENT_MIN : null;
  if (severeManyWays === null) missing.push("ระดับความยากรายองค์ประกอบของเส้นทาง");

  const slopeLabel =
    input.slopeSource === "inner-500m"
      ? "ความลาดชันรอบโรงเรียน (รัศมี 500 ม.)"
      : "ความลาดชันเฉลี่ยของพื้นที่วิเคราะห์ (~2.8 กม.)";

  const evidence: TerrainEvidenceItem[] = [
    { label: "ความสูงที่หมุดโรงเรียน", value: fmt(alt, "ม.") },
    { label: slopeLabel, value: fmt(slope, "%", 1) },
    { label: "จุดสูงสุดในรัศมี 1 กม.", value: fmt(local1km, "ม.") },
    { label: "จุดสูงสุด 5 กม.สุดท้ายของเส้นทาง", value: fmt(routeTail, "ม.") },
    { label: "จุดสูงสุดตลอดเส้นทาง", value: fmt(routeFull, "ม.") },
    { label: "ความสูงสะสมขาขึ้น", value: fmt(gain, "ม.") },
    { label: "ความสูงเฉลี่ยจังหวัด", value: fmt(provinceAvg, "ม.") },
    { label: "ความหนาแน่นประชากรรอบโรงเรียน", value: fmt(density, "คน/ตร.กม.") },
    { label: "ระดับความยากของเส้นทาง (0–4)", value: severity === null ? "ไม่มีข้อมูล" : String(severity) },
  ];

  const finish = (ruleId: Exclude<TerrainRuleId, "insufficient">): TerrainSignature => {
    const group = resolveGroup(ruleId, { severeManyWays, urbanKnown: urbanTone !== null });
    return {
      ruleId,
      labelTh: TERRAIN_RULE_LABELS[ruleId],
      group,
      groupLabelTh: TERRAIN_GROUP_LABELS[group],
      nearBoundary: margins.items.some((m) => m.near) || reviewFlags.length > 0,
      margins: margins.items,
      evidence,
      missing,
      reviewFlags,
      version: TERRAIN_SIGNATURE_VERSION,
    };
  };

  // ── R-I: พื้นที่เกาะ — ตรวจก่อนทุกกฎ และเป็นกลุ่มแยกเด็ดขาด ──
  // เกาะที่มีภูเขาสูงยังคงเป็น "เกาะ" ไม่ใช่ "ภูเขาสูงทุรกันดาร": ทั้งสองกลุ่มมีลักษณะความยากคนละแบบ
  // (ข้ามน้ำ vs ไต่เขา) การนับรวมกันจะทำให้เปรียบเทียบคะแนนข้ามกลุ่มไม่มีความหมาย
  //
  // "หาเส้นทางถนนไม่พบ" ไม่ใช่หลักฐานว่าเป็นเกาะ — โรงเรียนภูเขาที่ยังไม่มีถนนก็ได้ผลแบบเดียวกัน
  // (กรณีเส้นทางเป็น null ถูกกันไม่ให้ไหลลงกิ่งพื้นราบด้วยเกตข้อมูลไม่พอด้านล่างอยู่แล้ว)
  const islandEvidence: string[] = [];
  if (input.declaredSettingType === TS_ISLAND_SETTING) islandEvidence.push("ผู้กรอกระบุลักษณะที่ตั้งเป็นเกาะ");
  if (input.aiSettingType === TS_ISLAND_SETTING) islandEvidence.push("AI วิเคราะห์ภาพ 3 มิติว่าเป็นเกาะ");
  if (input.hasFerry === true) islandEvidence.push("เส้นทางต้องข้ามเรือข้ามฟาก");
  if (islandEvidence.length > 0) {
    evidence.push({ label: "หลักฐานพื้นที่เกาะ", value: islandEvidence.join(" · ") });
    return finish("R-I");
  }

  if (alt === null) {
    return insufficient(["ความสูงที่หมุดโรงเรียน (สุ่มจาก DEM ที่จุดหมุด)"], evidence, reviewFlags);
  }

  // ── รูปทรงท้องถิ่นจากธง 8 ทิศ (สัมพัทธ์กับโรงเรียนเสมอ) ──
  const sectors = input.sectors ?? null;
  const usableSectors = sectors
    ? sectors.filter(
        (s) =>
          s.highest?.deltaFromSchoolM !== null &&
          s.highest?.deltaFromSchoolM !== undefined &&
          s.lowest?.deltaFromSchoolM !== null &&
          s.lowest?.deltaFromSchoolM !== undefined,
      )
    : [];
  const sectorUsable = usableSectors.length >= TS_SECTOR_MIN_USABLE;

  let nHigher = 0;
  let nLower = 0;
  for (const sector of usableSectors) {
    if ((sector.highest?.deltaFromSchoolM ?? 0) >= 0 && sector.highest?.meetsThreshold) nHigher += 1;
    if ((sector.lowest?.deltaFromSchoolM ?? 0) <= 0 && sector.lowest?.meetsThreshold) nLower += 1;
  }
  const isEnclosed = sectorUsable && nHigher >= TS_ENCLOSED_MIN_SECTORS && nLower <= TS_ENCLOSED_MAX_LOWER;
  const isRidge = sectorUsable && nLower >= TS_ENCLOSED_MIN_SECTORS && nHigher <= TS_ENCLOSED_MAX_LOWER;
  if (sectorUsable) {
    evidence.push({ label: "ทิศที่มีที่สูงกว่าโรงเรียน", value: `${nHigher} / 8 ทิศ` });
    evidence.push({ label: "ทิศที่มีที่ต่ำกว่าโรงเรียน", value: `${nLower} / 8 ทิศ` });
  }

  // ── R0: เขตเมือง/กึ่งเมือง — ตัดออกจากทุกกลุ่มทุรกันดารก่อนดูภูมิประเทศ ──
  if (density !== null) {
    margins.check(
      "popDensityPerKm2",
      "ความหนาแน่นเข้าเกณฑ์กึ่งเมือง",
      density,
      TS_URBAN_DENSITY_CUT,
      TS_URBAN_DENSITY_CUT * BANDS.densityPct,
      "คน/ตร.กม.",
    );
    if (urbanTone === "semi" || urbanTone === "urban") return finish("R0");
  }

  // ── R0b: ที่ราบผืนใหญ่ที่พัฒนาแล้ว — "อยู่สูง" ไม่ได้แปลว่า "ลำบาก" ──
  //
  // เมืองที่เจริญบางแห่งตั้งอยู่บนที่ราบผืนใหญ่ที่ระดับความสูงมาก ถ้าใช้ความสูงอย่างเดียวจะถูกจัดเป็น
  // "ภูเขาสูง" ทั้งที่พื้นที่ราบทุกทิศ ถนนดี และบริการอยู่ใกล้ กฎนี้จึงกรองออกด้วย "เงื่อนไขร่วมทั้ง 6 ข้อ"
  // ที่ต้องเป็นจริงพร้อมกันและต้องรู้ค่าครบทุกตัว — ขาดข้อใดข้อหนึ่งหรือไม่รู้ค่า = ไม่กรอง
  //
  // ออกแบบให้พลาดไปทางไม่กรองดีกว่ากรองผิด: การกรองโรงเรียนที่ลำบากจริงออกคือความเสียหายที่แก้ไม่ได้
  // ส่วนการไม่กรองเมืองที่ควรถูกกรอง ยังมีผู้ตรวจและแกนความยากคอยจับได้อีกชั้น
  const plainRoadEasy =
    components !== null &&
    [finite(components.rcr), finite(components.ttr), finite(components.avgSpeed)].every((v) => v !== null && v <= 1);
  const plainOpen = sectorUsable && nHigher <= 1 && nLower <= 1;
  const plainFlat = slope !== null && slope <= TS_FLAT_SLOPE_PCT;
  const plainLowRelief = gridRelief !== null && gridRelief < TS_PLAIN_RELIEF_MAX_M;
  const plainSettled = density !== null && density >= TS_DEVELOPED_DENSITY_MIN;
  const plainServiceClose =
    routeMinutes !== null && routeKm !== null && routeMinutes <= TS_SERVICE_CLOSE_MIN && routeKm <= TS_SERVICE_CLOSE_KM;

  if (plainFlat && plainLowRelief && plainOpen && plainRoadEasy && plainSettled) {
    margins.check(
      "gridReliefM",
      "ความต่างระดับพื้นที่เข้าเกณฑ์ที่ราบผืนใหญ่",
      gridRelief,
      TS_PLAIN_RELIEF_MAX_M,
      BANDS.elevationM,
      "ม.",
    );
    if (plainServiceClose) {
      evidence.push({
        label: "เหตุที่กรองออกจากกลุ่มทุรกันดาร",
        value: `พื้นที่ราบต่อเนื่อง (ต่างระดับ ${Math.round(gridRelief)} ม.) · ถนนเข้าถึงสะดวก · มีชุมชน ${Math.round(density)} คน/ตร.กม. · ถึงบริการใน ${Math.round(routeMinutes)} นาที`,
      });
      return finish("R0b");
    }
    // ราบ + เจริญ + ถนนดี แต่พิสูจน์ไม่ได้ว่าบริการอยู่ใกล้ → ไม่ตัดสินเอง ส่งให้ผู้ตรวจ
    reviewFlags.push(
      routeMinutes === null || routeKm === null
        ? "พื้นที่ราบผืนใหญ่ที่พัฒนาแล้ว แต่ยังไม่รู้ระยะ/เวลาเดินทางถึงบริการ จึงยังไม่กรองออก"
        : `พื้นที่ราบผืนใหญ่ที่พัฒนาแล้ว แต่บริการไม่ได้อยู่ใกล้ (${Math.round(routeMinutes)} นาที / ${Math.round(routeKm)} กม.) จึงไม่กรองออก`,
    );
  }

  // ── R1: ภูเขาสูง (ตัดสินได้แม้ไม่มีค่าอื่น) ──
  margins.check("schoolElevationM", "ความสูงเข้าเกณฑ์ภูเขาสูง", alt, TS_HIGH_MOUNTAIN_M, BANDS.elevationM, "ม.");
  if (alt >= TS_HIGH_MOUNTAIN_M) return finish("R1");

  if (slope === null) {
    return insufficient(["ความลาดชันรอบโรงเรียน (กริดความสูงรอบจุดหมุด)", ...missing], evidence, reviewFlags);
  }
  if (routeTail === null || routeFull === null) {
    return insufficient(
      ["ความสูงตามเส้นทางเข้าโรงเรียน (จุดสูงสุดช่วงท้ายและตลอดเส้น)", ...missing],
      evidence,
      reviewFlags,
    );
  }

  // ── สิ่งกีดขวางระหว่างทาง: ต้องข้ามที่สูง หรือไต่ขึ้น/ลงมากพอ ──
  margins.check(
    "routeTailMaxElev",
    "จุดสูงสุดช่วงท้ายเข้าเกณฑ์พื้นที่สูง",
    routeTail,
    TS_HIGHLAND_MIN_M,
    BANDS.routeElevationM,
    "ม.",
  );
  let routeHigh = routeTail > TS_HIGHLAND_MIN_M;
  if (!routeHigh && provinceAvg !== null) {
    const provinceGate = provinceAvg + TS_PROVINCE_MARGIN_M;
    margins.check(
      "routeTailVsProvince",
      "จุดสูงสุดช่วงท้ายสูงกว่าค่าเฉลี่ยจังหวัด",
      routeTail,
      provinceGate,
      BANDS.routeElevationM,
      "ม.",
    );
    routeHigh = routeTail > provinceGate;
  }

  const climb = Math.max(0, routeFull - alt);
  margins.check("climb", "ต้องลงจากจุดสูงสุดของเส้นทาง", climb, TS_CLIMB_K_M, BANDS.climbM, "ม.");
  const climbHigh = climb >= TS_CLIMB_K_M;

  const gainHigh = gain !== null && gain >= TS_CLIMB_K_M;
  if (gain !== null) {
    margins.check("routeGainM", "ความสูงสะสมขาขึ้นเข้าเกณฑ์", gain, TS_CLIMB_K_M, BANDS.climbM, "ม.");
  }

  const barrier = routeHigh || climbHigh || gainHigh;

  const slopeBand = input.slopeSource === "inner-500m" ? BANDS.slopePct : ANALYSIS_GRID_SLOPE_BAND_PCT;
  margins.check("innerSlopePct", "ความลาดชันเข้าเกณฑ์ราบ", slope, TS_FLAT_SLOPE_PCT, slopeBand, "%");
  const isFlatLocal = slope <= TS_FLAT_SLOPE_PCT;

  // ราบ + สูง + ไม่ต้องลงจากที่สูง → ต้องรู้ความสูงสะสมขาขึ้น ไม่งั้นแยก "ที่ราบสูง" จาก "พื้นราบ" ไม่ได้
  if (isFlatLocal && gain === null && !climbHigh && alt >= TS_HIGHLAND_MIN_M) {
    return insufficient(
      ["ความสูงสะสมขาขึ้นตลอดเส้นทาง (แยกที่ราบสูงจากพื้นราบไม่ได้)", ...missing],
      evidence,
      reviewFlags,
    );
  }

  if (barrier && !sectorUsable) {
    return insufficient(
      [`จุดสูงสุด/ต่ำสุดราย 8 ทิศ (อ่านได้ ${usableSectors.length}/${TS_SECTOR_MIN_USABLE} ทิศที่ต้องการ)`, ...missing],
      evidence,
      reviewFlags,
    );
  }

  // ── R2: ภูเขา/ไหล่เขา — "ถูกล้อม" ตัดออกก่อน เพราะก้นหุบไม่ใช่ไหล่เขาแม้ผนังหุบจะทำให้ชัน ──
  if (barrier && !isEnclosed) {
    margins.check("innerSlopePctSteep", "ความลาดชันเข้าเกณฑ์ชัน", slope, TS_STEEP_SLOPE_PCT, slopeBand, "%");
    const isSteep = slope > TS_STEEP_SLOPE_PCT;
    if (isRidge || isSteep || (alt >= TS_MOUNTAIN_MIN_ALT_M && !isFlatLocal)) return finish("R2");
  }

  // ── R3: หุบเขาแคบ — ผนังเขาโผล่ในรัศมี 1 กม. เกือบทุกทิศ ──
  if (barrier && isEnclosed) return finish("R3");

  // ── R4 / R4b: พื้นราบที่ต้องข้ามภูมิประเทศเข้ามา — แยกด้วย "ทิศของการเดินทางแนวดิ่ง" ──
  if (isFlatLocal && !isEnclosed) {
    if (climbHigh) return finish("R4");
    if (gainHigh && alt >= TS_HIGHLAND_MIN_M) return finish("R4b");
  }

  // ── R5: เชิงเขา — มีที่สูงกว่าอย่างมีนัยข้างเคียง แต่ทางเข้าไม่ต้องข้ามที่สูง ──
  if (local1km !== null && !barrier) {
    const prominence = local1km - alt;
    margins.check(
      "prominence",
      "ที่สูงข้างเคียงเหนือโรงเรียน",
      prominence,
      TS_PROMINENCE_MIN_M,
      BANDS.prominenceM,
      "ม.",
    );
    if (prominence >= TS_PROMINENCE_MIN_M) return finish("R5");
  }

  // ── R6 / R6b: ครอบครัวพื้นราบ — โรงเรียนราบต้องไม่มีทางตกไปกิ่ง "เนินเขา" ──
  if (isFlatLocal) {
    margins.check("climbFlat", "ส่วนต่างระดับระหว่างทางยังถือว่าราบ", climb, TS_FLAT_ROUTE_M, BANDS.climbM, "ม.");
    const gainFlat = gain === null || gain < TS_FLAT_ROUTE_M;
    if (gain !== null) {
      margins.check("gainFlat", "ความสูงสะสมขาขึ้นยังถือว่าราบ", gain, TS_FLAT_ROUTE_M, BANDS.climbM, "ม.");
    }
    return climb < TS_FLAT_ROUTE_M && gainFlat ? finish("R6") : finish("R6b");
  }

  return finish("R7");
}

/** บริบทที่ผู้เรียกต้องเตรียม — แยกออกมาเพื่อไม่ให้โมดูลนี้ต้อง import lib/gis.ts (กัน circular) */
export interface TerrainSignatureContext {
  /** เส้นทางหลักที่ใช้ตัดสิน (ผู้เรียกเลือกด้วย primaryRoute ของ lib/gis.ts — แหล่งความจริงเดียว) */
  route: GisRouteAnalysis | null;
  accessSeverity: number | null;
  severityComponents: TerrainSeverityComponents | null;
  /** `state.unit.settingType` — คำประกาศของผู้กรอกว่าเป็นพื้นที่เกาะหรือไม่ */
  declaredSettingType?: string | null;
  /** `state.unit.settingSuggestion.settingType` — ผลวิเคราะห์ภาพ 3 มิติของ AI */
  aiSettingType?: string | null;
}

/** แปลงผล GIS ที่บันทึกไว้ → อินพุตตัวจำแนก (อ่านอย่างเดียว ไม่แก้ไข gis) */
export function terrainSignatureInputFromGis(gis: GisAnalysis, ctx: TerrainSignatureContext): TerrainSignatureInput {
  const elevation = gis.elevation;
  // ใช้วงแหวนนอกสุดที่มีข้อมูล — ความเป็นเมืองต้องดูบริบทรอบโรงเรียน ไม่ใช่เฉพาะรั้วโรงเรียน
  const outerRing = (gis.radiusSummaries ?? [])
    .filter((r) => finite(r.popDensityPerKm2) !== null)
    .sort((a, b) => b.radiusM - a.radiusM)[0];

  // ค่ารอบโรงเรียนมาก่อนเสมอ — ถอยไปใช้ค่าเฉลี่ยทั้งกริดเฉพาะแถวเก่าที่ยังไม่ได้วัด และต้องประกาศที่มาให้ชัด
  const innerSlope = finite(elevation?.innerSlopePct ?? null);
  const gridSlope = finite(elevation?.meanSlopePct ?? null);

  return {
    schoolElevationM: elevation?.schoolMarkerElevationM ?? null,
    innerSlopePct: innerSlope ?? gridSlope,
    slopeSource: innerSlope !== null ? "inner-500m" : "analysis-grid",
    gridReliefM: elevation?.reliefM ?? null,
    primaryRouteMinutes: ctx.route?.travelTimeMin ?? null,
    primaryRouteKm: ctx.route?.roadDistanceKm ?? null,
    sectors: gis.sectorElevations ?? null,
    localMaxElevation1KmM: elevation?.localMaxElevation1KmM ?? null,
    routeTailMaxElev: elevation?.routeTailMaxElev ?? null,
    routeFullMaxElev: elevation?.routeFullMaxElev ?? null,
    routeGainM: ctx.route?.elevationGainM ?? null,
    provinceAvgElev: elevation?.provinceAvgElev ?? null,
    popDensityPerKm2: outerRing?.popDensityPerKm2 ?? null,
    accessSeverity: ctx.accessSeverity,
    severityComponents: ctx.severityComponents,
    routeAccessStatus: gis.routeAccess?.status ?? null,
    declaredSettingType: ctx.declaredSettingType ?? null,
    aiSettingType: ctx.aiSettingType ?? null,
  };
}

/** จำแนกลายเซ็นภูมิประเทศจากผล GIS ที่บันทึกไว้ */
export function terrainSignatureFromGis(gis: GisAnalysis, ctx: TerrainSignatureContext): TerrainSignature {
  return classifyTerrainSignature(terrainSignatureInputFromGis(gis, ctx));
}

function resolveGroup(
  ruleId: Exclude<TerrainRuleId, "insufficient">,
  ctx: { severeManyWays: boolean | null; urbanKnown: boolean },
): TerrainGroup {
  // เกาะเป็นกลุ่มแยกเด็ดขาด — ไม่ขึ้นกับเกตความหนาแน่น/ความยาก และไม่ไหลไปรวมกับกลุ่มอื่นได้เลย
  if (ruleId === "R-I") return "island";
  if (ruleId === "R0b") return "developed";
  if (ruleId === "R0" || ruleId === "R6" || ruleId === "R6b") return "flat_normal";
  if (ruleId === "R3" || ruleId === "R4") return "valley_flat";
  if (ruleId === "R1" || ruleId === "R2") {
    // ข้อกล่าวอ้าง "ทุรกันดาร" ต้องผ่านทั้งเกตเมืองและความยากหลายด้าน — ขาดอย่างใดอย่างหนึ่ง = ยังสรุปไม่ได้
    if (!ctx.urbanKnown || ctx.severeManyWays === null) return "unknown";
    return ctx.severeManyWays ? "highland_remote" : "other";
  }
  return "other";
}
