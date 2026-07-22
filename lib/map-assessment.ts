// Pure helpers ที่รวมข้อมูลจากแผนที่ 3 มิติเข้ากับแบบประเมิน (prefill + merge ผล GIS)
// ต้องเป็น framework-free เหมือน lib/scoring.ts / lib/gis.ts — import ได้แค่ lib/state.ts, lib/gis.ts, lib/types.ts
// (ห้าม import lib/repo.ts/lib/db.ts เพื่อให้ unit test รันได้โดยไม่ต้องมี DB)
// ตัว transaction ที่คุยกับฐานข้อมูลจริง (saveAssessmentFromMapAtomic) อยู่ใน lib/repo.ts และเรียกใช้ฟังก์ชันที่นี่

import { deriveD3Responses, suggestSettingTypeFromGis } from "./gis";
import { makeBlankState } from "./state";
import type { AssessmentState, GisAnalysis } from "./types";

/** ข้อมูลโรงเรียนจากทะเบียนที่เชื่อถือได้ (ไม่ใช่จาก client) — ใช้ prefill แบบประเมินใหม่จากแผนที่ */
export interface SchoolAssessmentMaster {
  code: string;
  name: string;
  province: string;
  lat: number;
  lng: number;
}

/**
 * สร้าง state เปล่าแล้วเติมเฉพาะฟิลด์ที่มีแหล่งข้อมูลจริงจากทะเบียนโรงเรียน (master data)
 * totalStudents / areaOffice คงว่างเสมอ — ไม่มีแหล่งข้อมูลจริงให้เดา
 */
export function prefillMapAssessmentState(master: SchoolAssessmentMaster, year: string): AssessmentState {
  const state = makeBlankState();
  state.unit = {
    ...state.unit,
    name: master.name,
    code: master.code,
    year,
    province: master.province,
    lat: master.lat.toFixed(6),
    lng: master.lng.toFixed(6),
    totalStudents: "",
    areaOffice: "",
  };
  return state;
}

/**
 * รวมผล GIS เข้ากับ state ที่มีอยู่ — เติมคำตอบมิติที่ 3 (deriveD3Responses) โดยไม่แตะคำตอบมิติอื่น
 * รักษา areaSummary/radiusSummaries เดิมไว้ถ้า payload ใหม่ไม่ได้ส่งมา (กันข้อมูลหายเมื่อบันทึกแยกจังหวะกัน)
 */
export function applyMapGisToState(
  state: AssessmentState,
  gis: GisAnalysis,
  options: { syncUnitLocation: boolean },
): AssessmentState {
  const derived = deriveD3Responses(gis);
  const suggested = state.unit.settingType || suggestSettingTypeFromGis(gis) || "";
  const mergedGis: GisAnalysis = {
    ...gis,
    ...(gis.areaSummary
      ? { areaSummary: gis.areaSummary }
      : state.gis?.areaSummary
        ? { areaSummary: state.gis.areaSummary }
        : {}),
    ...(gis.radiusSummaries
      ? { radiusSummaries: gis.radiusSummaries }
      : state.gis?.radiusSummaries
        ? { radiusSummaries: state.gis.radiusSummaries }
        : {}),
  };
  return {
    ...state,
    unit: {
      ...state.unit,
      settingType: suggested,
      ...(options.syncUnitLocation
        ? { lat: gis.center.lat.toFixed(6), lng: gis.center.lng.toFixed(6) }
        : {}),
    },
    gis: { ...mergedGis, appliedToResponses: Object.keys(derived).length > 0 },
    responses: { ...state.responses, ...derived },
    scoringVersion: "v2-gis",
  };
}

/** ผลของการบันทึกแบบประเมินจากแผนที่: สร้างใหม่ / ปรับปรุงฉบับร่างเดิม / ฉบับปีปัจจุบันถูกล็อกเพราะยื่นแล้ว */
export type MapAssessmentSaveAction = "created" | "updated" | "locked";

export interface MapAssessmentSaveResult {
  assessmentId: number;
  action: MapAssessmentSaveAction;
  state: AssessmentState;
}

export interface SaveAssessmentFromMapInput {
  ownerUserId: number | null;
  schoolCode: string;
  year: string;
  /** state ตั้งต้นเมื่อยังไม่มีแบบประเมินของปีนี้ (จาก prefillMapAssessmentState) — ไม่ใช้ถ้ามีแถวเดิมอยู่แล้ว */
  initialState: AssessmentState;
  gis: GisAnalysis;
  syncUnitLocation: boolean;
}
