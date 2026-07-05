// ชนิดข้อมูลกลางของระบบประเมิน พ.ส.ศ. — ใช้ร่วมกันทั้ง client, API และ database layer

export const INDICATOR_IDS = [
  "1.1", "1.2", "1.3", "1.4",
  "2.1", "2.2", "2.3",
  "3.1", "3.2", "3.3",
  "4.1", "4.2", "4.3",
  "5.1", "5.2",
] as const;

export type IndicatorId = (typeof INDICATOR_IDS)[number];

export const UNIT_TYPES = ["โรงเรียน", "โรงเรียนสาขา", "ห้องเรียนสาขา"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export interface UnitInfo {
  name: string;
  code: string;
  year: string;
  totalStudents: string;
  areaOffice: string;
  province: string;
  lat: string;
  lng: string;
  unitType: UnitType;
}

/** ข้อมูลดิบรายตัวชี้วัด — key ขึ้นกับชนิดตัวชี้วัด (count/langs/frame/actual/rate/minutes/km/unitName/level) */
export type ResponseData = Record<string, string | undefined>;

/** ไฟล์หลักฐานที่อัปโหลด — เก็บเฉพาะ metadata; ตัวไฟล์จริงอยู่บน filesystem (ดู lib/uploads.ts) */
export interface EvidenceFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  /** SHA-256 ของเนื้อไฟล์ ณ เวลาอัปโหลด — ใช้ตรวจสอบว่าไฟล์ไม่ถูกแก้ไขหลังยื่น ตามหลักข้อ 6.5 ของสเปก */
  sha256: string;
  uploadedAt: string;
}

export interface EvidenceInfo {
  ready: boolean;
  note: string;
  files: EvidenceFile[];
}

/** ระดับความเห็นของผู้ทดสอบ (stakeholder) ต่อตัวชี้วัดหนึ่ง ๆ — "เห็นด้วยทุกประการ" เป็นค่าตั้งต้น */
export const FEEDBACK_OPINIONS = ["agree", "agree-with-changes", "disagree"] as const;
export type FeedbackOpinion = (typeof FEEDBACK_OPINIONS)[number];

export const FEEDBACK_OPINION_LABELS: Record<FeedbackOpinion, string> = {
  agree: "เห็นด้วยทุกประการ",
  "agree-with-changes": "เห็นด้วยแต่ควรแก้ไข",
  disagree: "ไม่เห็นด้วย ไม่ควรมีเพราะ",
};

export interface IndicatorFeedback {
  opinion: FeedbackOpinion;
  /** เหตุผล/ข้อเสนอแนะ — กรอกเมื่อเลือก agree-with-changes หรือ disagree เท่านั้น (ฝั่ง UI) */
  note: string;
}

export interface SubmittedInfo {
  at: string;
  ref: string;
  total: number;
  level: string;
}

export interface AssessmentState {
  unit: UnitInfo;
  responses: Record<IndicatorId, ResponseData>;
  evidence: Record<IndicatorId, EvidenceInfo>;
  /** ความคิดเห็นของผู้ทดสอบ (stakeholder) ต่อรายตัวชี้วัด — ไม่บังคับกรอก ไม่มีผลต่อคะแนน */
  feedback: Record<IndicatorId, IndicatorFeedback>;
  /** ความคิดเห็นโดยรวมต่อทั้งแบบประเมิน — ไม่บังคับกรอก */
  generalFeedback: string;
  signed: boolean;
  submitted: SubmittedInfo | null;
}

export type FlagTone = "info" | "warn" | "block";

export interface Flag {
  code: string;
  id: IndicatorId | null;
  tone: FlagTone;
  text: string;
}

export type LevelKey = "neutral" | "level-1" | "level-2" | "level-3";

export interface LevelDescriptor {
  key: LevelKey;
  label: string;
  short: string;
  detail: string;
}

/** แถวสรุปสำหรับหน้ารายการ — มาจาก summary columns ในตาราง assessments */
export interface AssessmentSummary {
  id: number;
  unitName: string;
  unitCode: string;
  year: string;
  province: string;
  unitType: string;
  totalScore: number;
  levelKey: string;
  levelLabel: string;
  signed: boolean;
  submittedRef: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentRecord {
  id: number;
  state: AssessmentState;
  createdAt: string;
  updatedAt: string;
}
