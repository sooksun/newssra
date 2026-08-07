// เกณฑ์ความยากลำบากของพื้นที่ 5 ระดับ — รวมสัญญาณภูมิประเทศ · การเข้าถึง · ขนาดชุมชน · พื้นที่ป่า
// pure, framework-free — ห้าม import lib/gis.ts (กัน circular) และห้าม import cesium / next / node API
//
// สเปก: docs/superpowers/specs/2026-08-07-terrain-signature-classifier-design.md
//
// ระดับตามข้อกำหนด:
//   1 พื้นที่ราบ ชุมชนใหญ่                        → ไม่ยากลำบาก
//   2 ภูเขาสูง ราบกว้างบนภูเขา ชุมชนใหญ่          → ยากลำบากเล็กน้อย
//   3 ภูเขาสูง ชนบท                               → ยากลำบาก
//   4 ภูเขาสูง ชุมชนชนบท เข้าถึงยากหลายด้าน       → ยากลำบากมาก
//   5 ภูเขาสูงสลับซับซ้อน ชุมชนชนบท               → ยากลำบากที่สุด
//
// "สลับซับซ้อน" ตามนิยามที่กำหนด: มียอดเขา/หุบเขาที่ต่างระดับจากโรงเรียนเกิน 50 ม.
// มากกว่า 5 แห่ง ในรัศมี 1 กม. (นับจากธง 8 ทิศ — จุดสูงสุดและต่ำสุดของแต่ละทิศ รวมได้สูงสุด 16 จุด)
//
// ไม่มีผลต่อคะแนน 100 คะแนนทางการ — เป็นชั้นข้อมูลประกอบเช่นเดียวกับ Auto GIS Score

import { settlementClass } from "./settlement";
import { TS_HIGHLAND_MIN_M, TS_PROVINCE_MARGIN_M, TS_STEEP_SLOPE_PCT, TS_URBAN_DENSITY_CUT } from "./terrain-signature";
import type { GisAnalysis, GisRouteAnalysis, GisSectorElevation } from "./types";

/** เวอร์ชันเกณฑ์ — เปลี่ยนเมื่อแก้เงื่อนไขระดับหรือค่าคงที่ใด ๆ */
export const TERRAIN_DIFFICULTY_VERSION = "td-1";

/**
 * จำนวนยอด/หุบขั้นต่ำที่ทำให้เรียกว่า "สลับซับซ้อน"
 * ข้อกำหนดคือ "มากกว่า 5 แห่ง" → เกณฑ์คือ ≥ 6
 */
export const TD_RUGGED_MIN_POINTS = 6;

/** ความหนาแน่น (คน/ตร.กม.) ตั้งแต่นี้ขึ้นไป = "ชุมชนใหญ่" — ตรงกับจุดตัดกึ่งเมืองของ settlementClass */
export const TD_BIG_COMMUNITY_DENSITY = TS_URBAN_DENSITY_CUT;

/** ความลาดชันรอบโรงเรียน (%) ที่ยังถือว่า "ราบกว้างบนภูเขา" */
export const TD_PLATEAU_SLOPE_PCT = 5;

/** เกณฑ์รายด้านของการเข้าถึง — ครบกี่ด้านถึงเรียกว่า "เข้าถึงยากหลายด้าน" */
export const TD_HARD_ACCESS_SIGNALS = 3;

/** เส้นแบ่งรายสัญญาณการเข้าถึง (สอบเทียบกับ GIS_BANDS เดิมและเปอร์เซ็นไทล์ระยะทางจริงของประชากร) */
export const TD_ACCESS_CUTS = {
  /** ถนนคดเคี้ยว: ถนน ÷ เส้นตรง */
  circuity: 1.8,
  /** ความเร็วเฉลี่ยต่ำกว่านี้ (กม./ชม.) = ถนนแย่ */
  speedKmh: 30,
  /** เวลาเดินทางเทียบพื้นที่ปกติ */
  timeRatio: 2.0,
  /** ความสูงสะสมขาขึ้น (ม.) */
  gainM: 600,
  /** ระยะทางถนน (กม.) — P75 ของประชากรจริง 1,481 โรงเรียน */
  distanceKm: 146,
  /** สัดส่วนเส้นทางที่ผ่านภูมิประเทศภูเขา (%) */
  mountainPct: 50,
} as const;

/** ป่าจะหนุนได้ต่อเมื่อรอบโรงเรียนเป็นป่าจริงในระดับนี้ */
export const TD_FOREST_SUPPORT_PCT_1KM = 60;
export const TD_FOREST_SUPPORT_PCT_3KM = 50;

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTY_LEVEL_LABELS: Record<DifficultyLevel, string> = {
  1: "ไม่ยากลำบาก",
  2: "ยากลำบากเล็กน้อย",
  3: "ยากลำบาก",
  4: "ยากลำบากมาก",
  5: "ยากลำบากที่สุด",
};

export interface TerrainDifficultyEvidence {
  label: string;
  value: string;
}

export interface TerrainDifficultyInput {
  /** ความสูงที่หมุดโรงเรียน (ม.) */
  schoolElevationM: number | null;
  provinceAvgElev: number | null;
  /** ความลาดชันรอบโรงเรียน (%) */
  innerSlopePct: number | null;
  /** ธง 8 ทิศ (deltaFromSchoolM คำนวณแล้วจาก deriveSectorMetrics) */
  sectors: readonly GisSectorElevation[] | null;
  /** ความหนาแน่นประชากรวงแหวนนอกสุด (คน/ตร.กม.) */
  popDensityPerKm2: number | null;
  roadCircuityRatio: number | null;
  averageSpeedKmh: number | null;
  travelTimeRatio: number | null;
  elevationGainM: number | null;
  roadDistanceKm: number | null;
  /** สัดส่วนเส้นทางที่ผ่านภูมิประเทศภูเขา (%) */
  routeMountainPct: number | null;
  /**
   * ตัวเลขป่ามาจากชั้นไหน — ตัดสินว่าใช้หนุนระดับได้หรือไม่
   *   "cover" = สภาพพื้นที่ป่าจริง (กรมป่าไม้) → ใช้หนุนได้
   *   "legal" = แนวเขตป่าสงวนตามกฎหมาย → **ใช้หนุนไม่ได้** (เขตประกาศเดิมอาจกลายเป็นชุมชนไปแล้ว)
   *   null    = ไม่ทราบที่มา → ไม่หนุน (ห้ามเดาว่าเป็นป่าจริง)
   */
  forestSource: "cover" | "legal" | null;
  /** อยู่ในเขตป่า (1) หรือไม่ (0) — null = ไม่มีข้อมูลชั้นป่า */
  forestInside: 0 | 1 | null;
  forestPct1km: number | null;
  forestPct3km: number | null;
}

export interface TerrainDifficultyResult {
  /** null = ข้อมูลไม่พอจะประเมิน */
  level: DifficultyLevel | null;
  difficultyLabelTh: string;
  /** ป้ายลักษณะพื้นที่ที่ประกอบจากสิ่งที่วัดได้จริง */
  areaLabelTh: string;
  highland: boolean | null;
  /** null = ธง 8 ทิศไม่ครบ ยังตัดสินความสลับซับซ้อนไม่ได้ */
  rugged: boolean | null;
  ruggedPoints: number | null;
  bigCommunity: boolean | null;
  /** จำนวนด้านของการเข้าถึงที่เข้าเกณฑ์ยาก */
  accessSignals: number;
  accessSignalLabels: string[];
  /** ป่าถูกใช้เป็นตัวหนุนระดับหรือไม่ */
  forestSupports: boolean;
  evidence: TerrainDifficultyEvidence[];
  missing: string[];
  version: string;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fmt(value: number | null, unit: string, digits = 0): string {
  return value === null ? "ไม่มีข้อมูล" : `${value.toFixed(digits)} ${unit}`.trim();
}

/**
 * นับยอดเขา/หุบเขาที่ต่างระดับจากโรงเรียนเกินเกณฑ์ (ค่าเริ่มต้น 50 ม. จาก SECTOR_RELIEF_K_M)
 * ในรัศมี 1 กม. — แต่ละทิศให้ได้สูงสุด 2 จุด (สูงสุด/ต่ำสุด) รวม 8 ทิศ = 16 จุด
 *
 * null = ธงไม่ครบพอจะนับ (ต้องอ่านได้ทั้ง 8 ทิศ ไม่งั้นจำนวนจุดจะต่ำกว่าจริงเสมอ)
 */
export function ruggedPointCount(sectors: readonly GisSectorElevation[] | null | undefined): number | null {
  if (!sectors || sectors.length < 8) return null;
  let count = 0;
  for (const sector of sectors) {
    if (sector.highest?.meetsThreshold) count += 1;
    if (sector.lowest?.meetsThreshold) count += 1;
  }
  return count;
}

/** ประเมินระดับความยากลำบากของพื้นที่ 5 ระดับ — ไม่แก้ไขค่าที่รับเข้ามา */
export function assessTerrainDifficulty(input: TerrainDifficultyInput): TerrainDifficultyResult {
  const alt = finite(input.schoolElevationM);
  const provinceAvg = finite(input.provinceAvgElev);
  const slope = finite(input.innerSlopePct);
  const density = finite(input.popDensityPerKm2);
  const circuity = finite(input.roadCircuityRatio);
  const speed = finite(input.averageSpeedKmh);
  const timeRatio = finite(input.travelTimeRatio);
  const gain = finite(input.elevationGainM);
  const distanceKm = finite(input.roadDistanceKm);
  const mountainPct = finite(input.routeMountainPct);
  const forestPct1 = finite(input.forestPct1km);
  const forestPct3 = finite(input.forestPct3km);

  const missing: string[] = [];

  // ── แกน A: ความเป็นภูมิประเทศภูเขา ──
  // ความสูงสัมบูรณ์อย่างเดียวไม่พอ: เขาต่ำที่ลาดชันจริง (บ้านนาตอน น่าน 220 ม. ลาดชัน 25%
  // หรือเขาภาคใต้แถบยะลา) จะถูกจัดเป็น "พื้นที่ราบ" ทั้งที่ภูมิประเทศเป็นภูเขาเต็มตัว
  // จึงนับความลาดชันรอบโรงเรียนเป็นหลักฐานภูเขาอีกทางหนึ่ง และแยกในป้ายว่าเป็นภูเขาด้วยเหตุใด
  const altHigh =
    alt === null
      ? null
      : alt >= TS_HIGHLAND_MIN_M || (provinceAvg !== null && alt > provinceAvg + TS_PROVINCE_MARGIN_M);
  const steepTerrain = slope !== null && slope > TS_STEEP_SLOPE_PCT;
  if (alt === null) missing.push("ความสูงที่หมุดโรงเรียน");

  // ── ความสลับซับซ้อน: ยอด/หุบต่างระดับเกิน 50 ม. มากกว่า 5 แห่งในรัศมี 1 กม. ──
  const ruggedPoints = ruggedPointCount(input.sectors);
  const rugged = ruggedPoints === null ? null : ruggedPoints >= TD_RUGGED_MIN_POINTS;
  if (ruggedPoints === null) missing.push("จุดสูงสุด/ต่ำสุดราย 8 ทิศ (ยังตัดสินความสลับซับซ้อนไม่ได้)");

  // ความสลับซับซ้อนก็เป็นหลักฐานภูมิประเทศภูเขาเช่นกัน: โรงเรียนที่ตั้งบน "ลานราบเล็กกลางภูเขา"
  // มีความลาดชันตรงจุดต่ำและอาจไม่สูงมาก แต่ถูกล้อมด้วยยอด/หุบต่างระดับเกิน 50 ม. หลายจุด
  // (เคสจริง: บ้านนาตอน 220 ม. ลาดชัน 5.9% แต่มี 7 จุดในรัศมี 1 กม.)
  const highland =
    altHigh === null && !steepTerrain && rugged !== true ? null : Boolean(altHigh) || steepTerrain || rugged === true;

  // ── แกน C: ขนาดชุมชน ──
  const bigCommunity = density === null ? null : density >= TD_BIG_COMMUNITY_DENSITY;
  if (density === null) missing.push("ความหนาแน่นของชุมชนรอบโรงเรียน");

  // ── แกน B: การเข้าถึง — นับเป็นรายด้าน ไม่ยุบเป็นเลขเดียว ──
  const accessSignalLabels: string[] = [];
  if (circuity !== null && circuity >= TD_ACCESS_CUTS.circuity) accessSignalLabels.push("ถนนคดเคี้ยวมาก");
  if (speed !== null && speed < TD_ACCESS_CUTS.speedKmh) accessSignalLabels.push("ความเร็วเดินทางต่ำ");
  if (timeRatio !== null && timeRatio >= TD_ACCESS_CUTS.timeRatio)
    accessSignalLabels.push("ใช้เวลาเดินทางนานกว่าปกติมาก");
  if (gain !== null && gain >= TD_ACCESS_CUTS.gainM) accessSignalLabels.push("ต้องไต่ระดับสะสมสูง");
  if (distanceKm !== null && distanceKm >= TD_ACCESS_CUTS.distanceKm) accessSignalLabels.push("ระยะทางไกล");
  if (mountainPct !== null && mountainPct >= TD_ACCESS_CUTS.mountainPct)
    accessSignalLabels.push("เส้นทางผ่านภูมิประเทศภูเขาเป็นส่วนใหญ่");
  const accessSignals = accessSignalLabels.length;
  const hardAccess = accessSignals >= TD_HARD_ACCESS_SIGNALS;

  // ที่มาของตัวเลขป่า — ต้องระบุในหลักฐานเสมอ ไม่ให้ผู้อ่านเข้าใจว่าเขตกฎหมายคือสภาพป่าจริง
  const forestSourceLabel =
    input.forestSource === "cover"
      ? "สภาพป่าจริง (กรมป่าไม้)"
      : input.forestSource === "legal"
        ? "แนวเขตป่าสงวน (กฎหมาย — ไม่ใช่สภาพป่าจริง)"
        : "ไม่ทราบที่มาของชั้นข้อมูล";
  if (input.forestSource === "legal") {
    missing.push("ข้อมูลสภาพพื้นที่ป่าจริง (มีแต่แนวเขตป่าสงวน — บันทึกจากแผนที่อีกครั้งเพื่ออัปเดต)");
  }

  const settlement = density === null ? null : settlementClass(density);
  const evidence: TerrainDifficultyEvidence[] = [
    { label: "ความสูงที่หมุดโรงเรียน", value: fmt(alt, "ม.") },
    { label: "ความสูงเฉลี่ยจังหวัด", value: fmt(provinceAvg, "ม.") },
    { label: "ความลาดชันรอบโรงเรียน", value: fmt(slope, "%", 1) },
    {
      label: "ยอดเขา/หุบเขาต่างระดับเกิน 50 ม. ในรัศมี 1 กม.",
      value: ruggedPoints === null ? "ไม่มีข้อมูล" : `${ruggedPoints} จุด (เกณฑ์สลับซับซ้อน ≥ ${TD_RUGGED_MIN_POINTS})`,
    },
    {
      label: "ขนาดชุมชนรอบโรงเรียน",
      value: density === null ? "ไม่มีข้อมูล" : `${Math.round(density)} คน/ตร.กม. — ${settlement?.label ?? ""}`,
    },
    { label: "ความคดเคี้ยวของถนน", value: circuity === null ? "ไม่มีข้อมูล" : `${circuity.toFixed(2)} เท่าของเส้นตรง` },
    { label: "ความเร็วเฉลี่ยที่ใช้เดินทาง", value: fmt(speed, "กม./ชม.", 1) },
    { label: "ความสูงสะสมขาขึ้น", value: fmt(gain, "ม.") },
    { label: "ระยะทางถนน", value: fmt(distanceKm, "กม.", 1) },
    { label: "สัดส่วนเส้นทางที่เป็นภูเขา", value: fmt(mountainPct, "%", 1) },
    {
      label: "พื้นที่ป่ารอบโรงเรียน",
      value:
        input.forestInside === null && forestPct1 === null
          ? "ไม่มีข้อมูล"
          : `${forestSourceLabel} · ${input.forestInside === 1 ? "อยู่ในพื้นที่ป่า" : "ไม่อยู่ในพื้นที่ป่า"} · ในรัศมี 1 กม. ${fmt(forestPct1, "%", 1)} · 3 กม. ${fmt(forestPct3, "%", 1)}`,
    },
    {
      label: "ด้านการเข้าถึงที่เข้าเกณฑ์ยาก",
      value: accessSignals === 0 ? "ไม่มี" : `${accessSignals} ด้าน — ${accessSignalLabels.join(" · ")}`,
    },
  ];

  const blank = (
    level: DifficultyLevel | null,
    areaLabelTh: string,
    forestSupports: boolean,
  ): TerrainDifficultyResult => ({
    level,
    difficultyLabelTh: level === null ? "ยังประเมินไม่ได้ — ข้อมูลไม่พอ" : DIFFICULTY_LEVEL_LABELS[level],
    areaLabelTh,
    highland,
    rugged,
    ruggedPoints,
    bigCommunity,
    accessSignals,
    accessSignalLabels,
    forestSupports,
    evidence,
    missing,
    version: TERRAIN_DIFFICULTY_VERSION,
  });

  // ความสูงและขนาดชุมชนอยู่ในนิยามของทุกระดับ — ขาดอย่างใดอย่างหนึ่งประเมินไม่ได้
  if (highland === null || bigCommunity === null) return blank(null, "ยังระบุลักษณะพื้นที่ไม่ได้", false);

  // ── ประกอบระดับ ──
  let level: DifficultyLevel;
  let terrainLabel: string;

  if (!highland) {
    // พื้นราบ — ระดับ 1 เว้นแต่ชุมชนชนบทและเข้าถึงยากหลายด้าน
    terrainLabel = "พื้นที่ราบ";
    level = !bigCommunity && hardAccess ? 3 : 1;
  } else {
    // ภูเขาเพราะระดับความสูง หรือเพราะความลาดชัน — ป้ายต้องบอกเหตุตรง ๆ ไม่เรียก 220 ม. ว่า "ภูเขาสูง"
    const mountainBase = altHigh
      ? "พื้นที่ภูเขาสูง"
      : steepTerrain
        ? "พื้นที่ภูเขา (ลาดชันสูง)"
        : "พื้นที่ภูเขา (ภูมิประเทศสลับซับซ้อนรอบด้าน)";
    if (rugged === true && !bigCommunity) {
      terrainLabel = altHigh ? "พื้นที่ภูเขาสูงสลับซับซ้อน" : "พื้นที่ภูเขาสลับซับซ้อน";
      level = 5;
    } else if (bigCommunity) {
      // ชุมชนใหญ่บนภูเขา — "ราบกว้างบนภูเขา" ต่อเมื่อรอบตัวราบจริง
      const plateau = slope !== null && slope <= TD_PLATEAU_SLOPE_PCT && rugged !== true;
      terrainLabel = plateau && altHigh ? "พื้นที่ภูเขาสูง ราบกว้างบนภูเขา" : mountainBase;
      level = 2;
    } else {
      terrainLabel = mountainBase;
      level = hardAccess ? 4 : 3;
    }
  }

  // ── ป่าไม้: สัญญาณหนุน ไม่ใช่ประตูตัดสินเดี่ยว ──
  // ดันได้มากสุด 1 ขั้น เฉพาะโรงเรียนบนที่สูงในชุมชนชนบท และดันได้ไม่เกินระดับ 4
  // (ระดับ 5 ต้องมาจากความสลับซับซ้อนของภูมิประเทศจริงเท่านั้น ตามนิยามที่กำหนด)
  //
  // ต้องเป็น "สภาพป่าจริง" เท่านั้น — แนวเขตป่าสงวนตอบคนละคำถาม (อยู่ในเขตประกาศ ≠ รอบตัวยังเป็นป่า)
  // polygon เขตสงวนเดิมที่กลายเป็นชุมชนไปแล้วจึงต้องไม่ได้แต้มหนุน
  const forestStrong =
    input.forestSource === "cover" &&
    input.forestInside === 1 &&
    ((forestPct1 !== null && forestPct1 >= TD_FOREST_SUPPORT_PCT_1KM) ||
      (forestPct3 !== null && forestPct3 >= TD_FOREST_SUPPORT_PCT_3KM));
  const forestSupports = forestStrong && highland && !bigCommunity && level < 4;
  if (forestSupports) level = (level + 1) as DifficultyLevel;

  const communityLabel = bigCommunity ? "ชุมชนใหญ่" : "ชุมชนชนบท";
  return blank(level, `${terrainLabel} ${communityLabel}`, forestSupports);
}

/**
 * แปลง authority ของชั้นข้อมูลที่บันทึกไว้ → ที่มาที่ตัวประเมินเข้าใจ
 * "unknown"/ไม่มีค่า = ไม่ทราบ ห้ามถือว่าเป็นสภาพป่าจริง
 */
function forestSourceFromAuthority(authority: string | null | undefined): TerrainDifficultyInput["forestSource"] {
  if (authority === "rfd-forest-cover") return "cover";
  if (authority === "rfd-national-reserved-forest") return "legal";
  return null;
}

/** บริบทเพิ่มเติมที่ตัวแปลงต้องใช้แต่ไม่ได้อยู่ในก้อน gis */
export interface TerrainDifficultyContext {
  /** เส้นทางหลัก (district_office → province_hall → เส้นแรก) */
  route: GisRouteAnalysis | null;
}

/**
 * ประเมินระดับความยากลำบากจากก้อน `gis` ที่บันทึกไว้ — ไม่ต้องเก็บข้อมูลเพิ่ม
 * ค่าที่ไม่มีในก้อน (เช่น แถวเก่าที่ยังไม่มี mountainPct) จะเป็น null และเข้ารายการ "ยังขาด" ตามปกติ
 */
export function terrainDifficultyFromGis(
  gis: GisAnalysis | null | undefined,
  ctx: TerrainDifficultyContext,
): TerrainDifficultyResult {
  const elevation = gis?.elevation ?? null;
  const forest = gis?.forestAnalysis ?? null;
  const forestStatus = forest?.status ?? null;
  const metrics = forest?.metrics ?? null;
  // วงแหวนนอกสุดคือมาตรวัด "เมือง" ที่ถูกต้อง (วงเล็กทำให้หมู่บ้านกระชับดูเป็นเมือง)
  const outerRing = gis?.radiusSummaries?.length ? gis.radiusSummaries[gis.radiusSummaries.length - 1] : null;

  return assessTerrainDifficulty({
    schoolElevationM: elevation?.schoolMarkerElevationM ?? null,
    provinceAvgElev: elevation?.provinceAvgElev ?? null,
    innerSlopePct: elevation?.innerSlopePct ?? elevation?.meanSlopePct ?? null,
    sectors: gis?.sectorElevations ?? null,
    popDensityPerKm2: outerRing?.popDensityPerKm2 ?? null,
    roadCircuityRatio: ctx.route?.roadCircuityRatio ?? null,
    averageSpeedKmh: ctx.route?.averageSpeedKmh ?? null,
    travelTimeRatio: ctx.route?.travelTimeRatio ?? null,
    elevationGainM: ctx.route?.elevationGainM ?? null,
    roadDistanceKm: ctx.route?.roadDistanceKm ?? null,
    routeMountainPct: ctx.route?.mountainPct ?? null,
    // ใช้ตัวเลขจากชั้น status เท่านั้น และพก authority มาด้วย เพื่อให้ตัวประเมินรู้ว่าเป็น
    // "สภาพป่าจริง" หรือ "แนวเขตป่าสงวน" — แถวที่บันทึกก่อนติดตั้งชั้นสภาพป่าจะเป็นอย่างหลัง
    // (metrics.forest_* ถอยมาใช้ไม่ได้ เพราะมันรวมค่าจาก legal โดยไม่บอกที่มาให้แยกได้)
    forestSource: forestSourceFromAuthority(forestStatus?.authority),
    forestInside: forestStatus?.inside ?? null,
    forestPct1km: forestStatus?.pct1km ?? null,
    forestPct3km: forestStatus?.pct3km ?? null,
  });
}
