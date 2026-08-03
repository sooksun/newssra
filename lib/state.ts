// State factories + sanitizer — ใช้ทั้งฝั่ง client (ฟอร์ม) และ server (ตรวจ payload ก่อนบันทึก)

import { currentBuddhistYear } from "./assessment-year";
import { sanitizeGis } from "./gis";
import { MAX_FILES_PER_INDICATOR, MAX_SITE_SNAPSHOTS } from "./upload-constants";
import {
  FEEDBACK_OPINIONS,
  INDICATOR_IDS,
  SETTING_TYPES,
  SNAPSHOT_IMAGERY_SOURCES,
  SNAPSHOT_TERRAIN_SOURCES,
  UNIT_TYPES,
} from "./types";
import type {
  AssessmentState,
  EvidenceFile,
  EvidenceInfo,
  FeedbackOpinion,
  IndicatorFeedback,
  IndicatorId,
  ResponseData,
  SettingType,
  SnapshotFile,
  SnapshotImagerySource,
  SnapshotTerrainSource,
  SubmittedInfo,
  TerrainSuggestion,
  UnitInfo,
  UnitType,
} from "./types";

const MAX_TEXT = 500;
const MAX_NOTE = 2000;
const MAX_FILE_META_TEXT = 255;

export function makeBlankState(year: string = currentBuddhistYear()): AssessmentState {
  const responses = {} as Record<IndicatorId, ResponseData>;
  const evidence = {} as Record<IndicatorId, EvidenceInfo>;
  const feedback = {} as Record<IndicatorId, IndicatorFeedback>;
  INDICATOR_IDS.forEach((id) => {
    responses[id] = {};
    evidence[id] = { ready: false, note: "", files: [] };
    feedback[id] = { opinion: "agree", note: "" };
  });

  return {
    unit: {
      name: "",
      code: "",
      year,
      totalStudents: "",
      areaOffice: "",
      province: "",
      lat: "",
      lng: "",
      unitType: "โรงเรียน",
      settingType: "",
    },
    responses,
    evidence,
    feedback,
    generalFeedback: "",
    signed: false,
    submitted: null,
  };
}

function cleanString(value: unknown, max = MAX_TEXT): string {
  if (typeof value === "string") return value.slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * ตรวจ metadata ไฟล์หลักฐานที่มากับ payload — ไฟล์จริงถูกจัดการแยกผ่าน API อัปโหลดโดยเฉพาะ
 * (lib/uploads.ts) ฟังก์ชันนี้แค่กันไม่ให้ payload ปลอมแปลง metadata หรือยัดรายการเกินจำนวนที่กำหนด
 */
function cleanFiles(value: unknown): EvidenceFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, MAX_FILES_PER_INDICATOR)
    .map((item) => ({
      id: cleanString(item.id, 64),
      originalName: cleanString(item.originalName, MAX_FILE_META_TEXT),
      mimeType: cleanString(item.mimeType, 100),
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      sha256: cleanString(item.sha256, 64),
      uploadedAt: cleanString(item.uploadedAt, 40),
    }))
    .filter((file) => file.id.length > 0);
}

/** ตรวจ metadata ภาพ snapshot ที่มากับ payload (ไฟล์จริงจัดการแยกผ่าน route) — cap จำนวน + กันปลอม metadata */
function cleanSnapshotFiles(value: unknown): SnapshotFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, MAX_SITE_SNAPSHOTS)
    .map((item) => ({
      id: cleanString(item.id, 64),
      originalName: cleanString(item.originalName, MAX_FILE_META_TEXT),
      mimeType: cleanString(item.mimeType, 100),
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      sha256: cleanString(item.sha256, 64),
      uploadedAt: cleanString(item.uploadedAt, 40),
      viewKey: cleanString(item.viewKey, 32),
      viewLabel: cleanString(item.viewLabel, 64),
      // allowlist เข้ม: ค่านอกรายการ (หรือแถวเก่าที่ไม่มีฟีลด์นี้) → ไม่ใส่ key เลย
      // ห้ามเดาเป็นค่า default เด็ดขาด — เท่ากับสร้างหลักฐานเท็จว่าภาพมาจากแหล่งที่ไม่รู้จริง
      ...cleanSnapshotSource(item),
    }))
    .filter((f) => f.id.length > 0);
}

/** คัดเฉพาะ imagerySource/terrainSource ที่อยู่ในรายการที่รู้จัก — คืน object ว่างเมื่อไม่มี/ไม่ถูกต้อง */
function cleanSnapshotSource(item: Record<string, unknown>): Partial<SnapshotFile> {
  const out: Partial<SnapshotFile> = {};
  const imagery = cleanString(item.imagerySource, 16);
  if ((SNAPSHOT_IMAGERY_SOURCES as readonly string[]).includes(imagery)) {
    out.imagerySource = imagery as SnapshotImagerySource;
  }
  const terrain = cleanString(item.terrainSource, 24);
  if ((SNAPSHOT_TERRAIN_SOURCES as readonly string[]).includes(terrain)) {
    out.terrainSource = terrain as SnapshotTerrainSource;
  }
  return out;
}

const CONFIDENCE_SET = ["high", "medium", "low"] as const;

/** ตรวจ metadata คำแนะนำ AI — คืน undefined เมื่อ settingType/confidence ไม่ถูกต้อง (กันปลอม) */
function cleanSettingSuggestion(value: unknown): TerrainSuggestion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const settingType = cleanString(v.settingType, 32);
  if (!(SETTING_TYPES as readonly string[]).includes(settingType)) return undefined;
  const confidence = cleanString(v.confidence, 10);
  if (!(CONFIDENCE_SET as readonly string[]).includes(confidence)) return undefined;
  return {
    settingType: settingType as SettingType,
    rationale: cleanString(v.rationale, 500),
    confidence: confidence as TerrainSuggestion["confidence"],
    analyzedAt: cleanString(v.analyzedAt, 40),
  };
}

/**
 * แปลง payload ที่รับจากภายนอกให้เป็น AssessmentState ที่โครงถูกต้องเสมอ
 * — ตัด key แปลกปลอม, บังคับชนิดข้อมูล, จำกัดความยาวข้อความ
 */
export function sanitizeState(input: unknown): AssessmentState {
  const state = makeBlankState();
  if (!input || typeof input !== "object") return state;
  const raw = input as Record<string, unknown>;

  const rawUnit = (raw.unit && typeof raw.unit === "object" ? raw.unit : {}) as Record<string, unknown>;
  const unitKeys: Exclude<keyof UnitInfo, "unitType" | "settingType" | "siteSnapshots" | "settingSuggestion">[] = [
    "name",
    "code",
    "year",
    "totalStudents",
    "areaOffice",
    "province",
    "lat",
    "lng",
  ];
  unitKeys.forEach((key) => {
    state.unit[key] = cleanString(rawUnit[key]);
  });
  const unitType = cleanString(rawUnit.unitType);
  if ((UNIT_TYPES as readonly string[]).includes(unitType)) {
    state.unit.unitType = unitType as UnitType;
  }
  const settingType = cleanString(rawUnit.settingType);
  if ((SETTING_TYPES as readonly string[]).includes(settingType)) {
    state.unit.settingType = settingType as SettingType;
  } else {
    state.unit.settingType = "";
  }
  const rawSnapshots = (rawUnit as Record<string, unknown>).siteSnapshots;
  if (Array.isArray(rawSnapshots)) {
    const cleaned = cleanSnapshotFiles(rawSnapshots);
    if (cleaned.length > 0) state.unit.siteSnapshots = cleaned;
  }
  const rawSuggestion = (rawUnit as Record<string, unknown>).settingSuggestion;
  const cleanedSuggestion = cleanSettingSuggestion(rawSuggestion);
  if (cleanedSuggestion) state.unit.settingSuggestion = cleanedSuggestion;

  const rawResponses = (raw.responses && typeof raw.responses === "object" ? raw.responses : {}) as Record<
    string,
    unknown
  >;
  const rawEvidence = (raw.evidence && typeof raw.evidence === "object" ? raw.evidence : {}) as Record<string, unknown>;
  const rawFeedback = (raw.feedback && typeof raw.feedback === "object" ? raw.feedback : {}) as Record<string, unknown>;

  INDICATOR_IDS.forEach((id) => {
    const res = rawResponses[id];
    if (res && typeof res === "object") {
      const clean: ResponseData = {};
      Object.entries(res as Record<string, unknown>).forEach(([key, value]) => {
        if (/^[a-zA-Z]{1,32}$/.test(key)) clean[key] = cleanString(value);
      });
      state.responses[id] = clean;
    }
    const ev = rawEvidence[id];
    if (ev && typeof ev === "object") {
      const evObj = ev as Record<string, unknown>;
      state.evidence[id] = {
        ready: evObj.ready === true,
        note: cleanString(evObj.note, MAX_NOTE),
        files: cleanFiles(evObj.files),
      };
    }
    const fb = rawFeedback[id];
    if (typeof fb === "string") {
      // รูปแบบเดิมก่อนมี opinion (แค่ข้อความ) — เก็บข้อความเดิมไว้เป็นหมายเหตุ
      state.feedback[id] = { opinion: "agree", note: cleanString(fb, MAX_NOTE) };
    } else if (fb && typeof fb === "object") {
      const fbObj = fb as Record<string, unknown>;
      const opinion = (FEEDBACK_OPINIONS as readonly string[]).includes(fbObj.opinion as string)
        ? (fbObj.opinion as FeedbackOpinion)
        : "agree";
      state.feedback[id] = { opinion, note: cleanString(fbObj.note, MAX_NOTE) };
    }
  });

  state.generalFeedback = cleanString(raw.generalFeedback, MAX_NOTE);
  state.signed = raw.signed === true;

  const sub = raw.submitted;
  if (sub && typeof sub === "object") {
    const s = sub as Record<string, unknown>;
    if (typeof s.ref === "string" && typeof s.at === "string") {
      const submitted: SubmittedInfo = {
        at: cleanString(s.at, 40),
        ref: cleanString(s.ref, 40),
        total: typeof s.total === "number" && Number.isFinite(s.total) ? s.total : 0,
        level: cleanString(s.level, 120),
      };
      state.submitted = submitted;
    }
  }

  // ผล GIS + เวอร์ชันคะแนน (v2) — ทั้งคู่ optional: ไม่ผ่านเกณฑ์ = ไม่มี key = แถว v1 เดิม round-trip
  // เหมือนเดิมทุก byte; "v2-gis" ยอมรับเฉพาะเมื่อมีก้อน gis ที่ใช้ได้จริงเท่านั้น
  const gis = sanitizeGis(raw.gis);
  if (gis) state.gis = gis;
  if (raw.scoringVersion === "v2-gis" && gis) state.scoringVersion = "v2-gis";

  return state;
}

/**
 * รวม state ที่รับจาก client เข้ากับฟิลด์ที่ฝั่ง server เป็นเจ้าของ (ดึงจาก DB)
 * ใช้ร่วมกันทั้ง PUT autosave และ POST submit เพื่อกันไม่ให้ payload จาก client เขียนทับ:
 *  - evidence[].files: จัดการโดย route อัปโหลด/ลบไฟล์เท่านั้น (กัน snapshot ค้างมาทับจนไฟล์หาย/ปลอม)
 *  - gis / scoringVersion: เขียนโดย POST .../gis เท่านั้น (server คำนวณ ratio ทั้งหมดเอง)
 * conditional spread เพื่อให้แถว v1 (ไม่มี gis) ไม่งอก key — round-trip เหมือนเดิมทุก byte
 * หมายเหตุ: ไม่ยุ่งกับ `submitted` — ผู้เรียกจัดการเอง (PUT preserve จาก DB, submit ออกเลขใหม่)
 */
export function preserveServerOwned(incoming: AssessmentState, existing: AssessmentState): AssessmentState {
  const evidence = {} as AssessmentState["evidence"];
  INDICATOR_IDS.forEach((id) => {
    evidence[id] = { ...incoming.evidence[id], files: existing.evidence[id]?.files ?? [] };
  });
  const merged: AssessmentState = { ...incoming, unit: { ...incoming.unit }, evidence };
  delete merged.gis;
  delete merged.scoringVersion;
  if (existing.gis) merged.gis = existing.gis;
  if (existing.scoringVersion) merged.scoringVersion = existing.scoringVersion;
  delete merged.unit.siteSnapshots;
  if (existing.unit.siteSnapshots) {
    merged.unit = { ...merged.unit, siteSnapshots: existing.unit.siteSnapshots };
  }
  delete merged.unit.settingSuggestion;
  if (existing.unit.settingSuggestion) {
    merged.unit = { ...merged.unit, settingSuggestion: existing.unit.settingSuggestion };
  }
  return merged;
}
