// ถ้อยคำภูมิประเทศ สพฐ./HRDI vs แอป — pure copy helpers สำหรับ UI tooltip (Phase 2)
// แยกจาก lib/gis.ts และ lib/community-class.ts — ไม่มี logic คะแนน/เส้นทาง

import {
  COMMUNITY_HIGHLAND_MIN_M,
  COMMUNITY_HIGH_MOUNTAIN_M,
  communityAxisATierLabelTh,
} from "./community-class";
import type { CommunityAxisATier } from "./types";

/** เนินเขา (คู่มือ สพฐ.): ~150–600 ม. */
export const SSRA_HILL_ELEV_MIN_M = 150;
/** ขอบบนเชิงพรรณนาของเนินเขา / ขอบล่างของ "ภูเขา" ในคู่มือ สพฐ. */
export const SSRA_MOUNTAIN_ELEV_MIN_M = 600;

/** รายการ legend เปรียบเทียบถ้อยคำ สพฐ./HRDI กับเกณฑ์แอป — ใช้ใน tooltip UI */
export function landformThresholdLegendRows(): { term: string; rule: string }[] {
  return [
    {
      term: "เนินเขา (สพฐ.)",
      rule: `สูงประมาณ ${SSRA_HILL_ELEV_MIN_M}–${SSRA_MOUNTAIN_ELEV_MIN_M} ม. + มีความลาดชัน (เชิงพรรณนาในคู่มือคัดกรอง)`,
    },
    {
      term: "ภูเขา (สพฐ.)",
      rule: `สูง ≥ ${SSRA_MOUNTAIN_ELEV_MIN_M} ม. + มีความลาดชัน — ไม่ใช่เกตคัดกรองหลัก`,
    },
    {
      term: "พื้นที่สูง / เกต SSRA·HRDI",
      rule: `≥ ${COMMUNITY_HIGHLAND_MIN_M} ม. เหนือ ม.ป.ท. หรือสูงกว่าค่าเฉลี่ยจังหวัด หรือเส้นทางผ่านที่สูง (แอปใช้เกตนี้ในจำแนกชุมชน แกน A)`,
    },
    {
      term: "ภูเขาสูง (แอป + ชั้นสูง HRDI)",
      rule: `≥ ${COMMUNITY_HIGH_MOUNTAIN_M} ม. — ป้าย "ชุมชนบนภูเขาสูง" ในแผนที่; ไม่ได้ลดลงเหลือ 600 ม. (ต่างจากนิยามภูเขา สพฐ.)`,
    },
  ];
}

/**
 * แถบความสูงเทียบเกณฑ์ทางการ + แอป
 * ใช้ประกอบป้าย landform — ไม่เปลี่ยนผล morphologyFromGrid
 */
export function officialElevBandTh(elevM: number | null): string | null {
  if (elevM === null || !Number.isFinite(elevM)) return null;
  if (elevM < SSRA_HILL_ELEV_MIN_M) {
    return `ต่ำกว่าช่วงเนินเขาของ สพฐ. (~${SSRA_HILL_ELEV_MIN_M} ม.)`;
  }
  if (elevM < COMMUNITY_HIGHLAND_MIN_M) {
    return `ช่วงเนินเขา (สพฐ. ~${SSRA_HILL_ELEV_MIN_M}–${SSRA_MOUNTAIN_ELEV_MIN_M} ม.) — ยังต่ำกว่าเกตพื้นที่สูง ${COMMUNITY_HIGHLAND_MIN_M} ม. (ยกเว้นเทียบค่าเฉลี่ยจังหวัด/เส้นทาง)`;
  }
  if (elevM < SSRA_MOUNTAIN_ELEV_MIN_M) {
    return `เข้าเกตพื้นที่สูง (≥${COMMUNITY_HIGHLAND_MIN_M} ม.) — ยังต่ำกว่านิยาม "ภูเขา" ของ สพฐ. (≥${SSRA_MOUNTAIN_ELEV_MIN_M} ม.)`;
  }
  if (elevM < COMMUNITY_HIGH_MOUNTAIN_M) {
    return `ระดับภูเขาตาม สพฐ. (≥${SSRA_MOUNTAIN_ELEV_MIN_M} ม.) / พื้นที่สูงปานกลาง — ยังไม่ถึงชั้น "ภูเขาสูง" ของแอป (${COMMUNITY_HIGH_MOUNTAIN_M} ม.)`;
  }
  return `ภูเขาสูงตามแอป/HRDI (≥${COMMUNITY_HIGH_MOUNTAIN_M} ม.)`;
}

/** คำอธิบายสั้นของป้าย landform แอป เทียบถ้อยคำทางการ */
export function landformAppLabelNoteTh(landformTh: string): string {
  const t = landformTh.trim();
  if (!t) return "ยังไม่มีป้ายภูมิประเทศจากแผนที่";
  if (t.includes("ภูเขาสูง")) {
    return `ป้ายแอป "ภูเขาสูง" = mean elev ≥ ${COMMUNITY_HIGH_MOUNTAIN_M} ม. (ชั้นบน) — นิยาม "ภูเขา" ในคู่มือ สพฐ. เริ่มที่ ${SSRA_MOUNTAIN_ELEV_MIN_M} ม.`;
  }
  if (t.includes("บนภูเขา")) {
    return `ป้ายแอป "บนภูเขา" = ผ่านเกตความสูง/เส้นทาง (มัก ≥ ${COMMUNITY_HIGHLAND_MIN_M} ม. หรือ > ค่าเฉลี่ยจังหวัด) แต่ยังต่ำกว่า ${COMMUNITY_HIGH_MOUNTAIN_M} ม.`;
  }
  if (t.includes("หุบเขา")) {
    return 'ป้ายแอป "ในหุบเขา" = จุดตั้งไม่สูงแต่เส้นทางเข้าถึงผ่านที่สูง (เงื่อนไขหุบเขาของ สพฐ.)';
  }
  if (t.includes("เชิงเขา")) {
    return 'ป้ายแอป "เชิงเขา" = จุดตั้งสูงแต่เส้นทางช่วงท้ายยังไม่สูงตลอด (ที่ลาดเชิงเขา)';
  }
  if (t.includes("เนินเขา")) {
    return `ป้ายแอป "เนินเขา" = ลาดชันเล็กน้อยโดยไม่เข้าเกตภูเขา/หุบเขา — ใกล้เคียงเนินเขา สพฐ. (~${SSRA_HILL_ELEV_MIN_M}–${SSRA_MOUNTAIN_ELEV_MIN_M} ม.) แต่ไม่ได้ยืนยันเกต 500 ม.`;
  }
  if (t.includes("พื้นราบ")) {
    return 'ป้ายแอป "พื้นราบ" = ความลาดชันต่ำและไม่ผ่านเกตความสูง/เส้นทาง — ชุมชนพื้นราบปกติในแง่ภูมิประเทศ';
  }
  return `ป้ายภูมิประเทศจากแผนที่: ${t}`;
}

/** re-export tier label for UI that only imports legend module */
export { communityAxisATierLabelTh };
export type { CommunityAxisATier };
