// State factories + sanitizer — ใช้ทั้งฝั่ง client (ฟอร์ม) และ server (ตรวจ payload ก่อนบันทึก)

import { MAX_FILES_PER_INDICATOR } from "./upload-constants";
import { FEEDBACK_OPINIONS, INDICATOR_IDS, UNIT_TYPES } from "./types";
import type {
  AssessmentState,
  EvidenceFile,
  EvidenceInfo,
  FeedbackOpinion,
  IndicatorFeedback,
  IndicatorId,
  ResponseData,
  SubmittedInfo,
  UnitInfo,
  UnitType,
} from "./types";

const MAX_TEXT = 500;
const MAX_NOTE = 2000;
const MAX_FILE_META_TEXT = 255;

export function makeBlankState(): AssessmentState {
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
      year: "2569",
      totalStudents: "",
      areaOffice: "",
      province: "",
      lat: "",
      lng: "",
      unitType: "โรงเรียน",
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

/**
 * แปลง payload ที่รับจากภายนอกให้เป็น AssessmentState ที่โครงถูกต้องเสมอ
 * — ตัด key แปลกปลอม, บังคับชนิดข้อมูล, จำกัดความยาวข้อความ
 */
export function sanitizeState(input: unknown): AssessmentState {
  const state = makeBlankState();
  if (!input || typeof input !== "object") return state;
  const raw = input as Record<string, unknown>;

  const rawUnit = (raw.unit && typeof raw.unit === "object" ? raw.unit : {}) as Record<string, unknown>;
  const unitKeys: Exclude<keyof UnitInfo, "unitType">[] = [
    "name", "code", "year", "totalStudents", "areaOffice", "province", "lat", "lng",
  ];
  unitKeys.forEach((key) => {
    state.unit[key] = cleanString(rawUnit[key]);
  });
  const unitType = cleanString(rawUnit.unitType);
  if ((UNIT_TYPES as readonly string[]).includes(unitType)) {
    state.unit.unitType = unitType as UnitType;
  }

  const rawResponses = (raw.responses && typeof raw.responses === "object" ? raw.responses : {}) as Record<string, unknown>;
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

  return state;
}
