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
 * เติมเฉพาะฟิลด์ unit ที่มีแหล่งข้อมูลจริงจากทะเบียนโรงเรียน (master data) — "name"/"code"/"province"/"year"/"lat"/"lng"
 * เติมเฉพาะเมื่อค่าปัจจุบัน "ว่าง" (trim แล้วเป็นสตริงว่าง) เท่านั้น ไม่เคยทับค่าที่ผู้ใช้กรอกไว้แล้ว
 * totalStudents / areaOffice ไม่แตะเลย — ไม่มีแหล่งข้อมูลจริงให้เดา (ผู้ใช้ต้องกรอกเอง)
 * ใช้ได้ทั้งตอนสร้างแบบประเมินใหม่ (state เปล่า → ทุกฟิลด์ว่าง → เติมครบ) และตอนปรับปรุงฉบับร่างเดิมที่มีอยู่แล้ว
 * (state บางส่วนอาจกรอกแล้วบางส่วนว่าง → เติมเฉพาะส่วนที่ว่าง)
 */
export function fillBlankUnitFromMaster(
  state: AssessmentState,
  master: SchoolAssessmentMaster,
  year: string,
): AssessmentState {
  const isBlank = (value: string) => value.trim() === "";
  return {
    ...state,
    unit: {
      ...state.unit,
      name: isBlank(state.unit.name) ? master.name : state.unit.name,
      code: isBlank(state.unit.code) ? master.code : state.unit.code,
      province: isBlank(state.unit.province) ? master.province : state.unit.province,
      year: isBlank(state.unit.year) ? year : state.unit.year,
      lat: isBlank(state.unit.lat) ? master.lat.toFixed(6) : state.unit.lat,
      lng: isBlank(state.unit.lng) ? master.lng.toFixed(6) : state.unit.lng,
    },
  };
}

/**
 * สร้าง state เปล่าแล้วเติมฟิลด์ unit ที่มีแหล่งข้อมูลจริงจากทะเบียนโรงเรียน (master data)
 * totalStudents / areaOffice คงว่างเสมอ — ไม่มีแหล่งข้อมูลจริงให้เดา
 * (state เปล่าทุกฟิลด์ว่างอยู่แล้ว จึง fillBlankUnitFromMaster เติมครบทุกฟิลด์เสมอ — กติกาเดียวกับตอนปรับปรุงฉบับร่างเดิม)
 */
export function prefillMapAssessmentState(master: SchoolAssessmentMaster, year: string): AssessmentState {
  return fillBlankUnitFromMaster(makeBlankState(), master, year);
}

/**
 * รวมผล GIS เข้ากับ state ที่มีอยู่ — เติมคำตอบมิติที่ 3 (deriveD3Responses) โดยไม่แตะคำตอบมิติอื่น
 * รักษา areaSummary/radiusSummaries/dataSources เดิมไว้ถ้า payload ใหม่ไม่ได้ส่งมา (กันข้อมูลหายเมื่อบันทึกแยกจังหวะกัน)
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
    ...(gis.dataSources
      ? { dataSources: gis.dataSources }
      : state.gis?.dataSources
        ? { dataSources: state.gis.dataSources }
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

/** รูปแบบ JSON ที่ POST /api/assessments/from-map ตอบกลับ client (แผนที่ใช้ตอนบันทึกครั้งเดียว) */
export interface MapAssessmentSaveResponse {
  assessmentId: number;
  action: MapAssessmentSaveAction;
  gis: GisAnalysis | null;
  droppedRoutes: string[];
}

export interface SaveAssessmentFromMapInput {
  ownerUserId: number | null;
  schoolCode: string;
  year: string;
  /** state ตั้งต้นเมื่อยังไม่มีแบบประเมินของปีนี้ (จาก prefillMapAssessmentState) — ไม่ใช้ถ้ามีแถวเดิมอยู่แล้ว */
  initialState: AssessmentState;
  gis: GisAnalysis;
  syncUnitLocation: boolean;
  /** ข้อมูลโรงเรียนจากทะเบียน — เมื่อระบุ ใช้เติมฟิลด์ unit ที่ว่างของ "ฉบับร่างเดิม" ด้วย fillBlankUnitFromMaster
   *  (สาขา INSERT ใช้ initialState ที่เติมมาแล้วจาก prefillMapAssessmentState อยู่แล้ว ไม่ต้องใช้ค่านี้) */
  master?: SchoolAssessmentMaster;
}
