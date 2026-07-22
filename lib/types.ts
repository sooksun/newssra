// ชนิดข้อมูลกลางของระบบประเมิน พ.ส.ศ. — ใช้ร่วมกันทั้ง client, API และ database layer

export const INDICATOR_IDS = [
  "1.1", "1.2", "1.3", "1.4",
  "2.1", "2.2", "2.3",
  "3.1", "3.2", "3.3",
  "4.1", "4.2", "4.3",
  "5.1", "5.2",
] as const;

export type IndicatorId = (typeof INDICATOR_IDS)[number];

/** สิทธิ์ผู้ใช้: admin = เห็น/แก้ทุกโรงเรียน + จัดการผู้ใช้, ssra_admin = เห็น/แก้ทุกโรงเรียน, school = เฉพาะของตนเอง */
export const ROLES = ["admin", "ssra_admin", "school"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "ผู้ดูแลระบบ",
  ssra_admin: "เจ้าหน้าที่ สพฐ.",
  school: "โรงเรียน",
};

/** แหล่งที่มาของบัญชี: local = ตาราง users (แฮชด้วย scrypt), legacy = ตาราง `user` เดิม (รหัสผ่าน plaintext) */
export type UserSource = "local" | "legacy";

/** ผู้ใช้ในระบบ — ไม่เก็บข้อมูลส่วนบุคคลของนักเรียนใด ๆ (มีแค่ชื่อบัญชี/บทบาท/ชื่อแสดง)
 *  schoolCode = รหัสโรงเรียน (8 หลัก) สำหรับบัญชีบทบาท school ใช้จำกัดขอบเขตข้อมูล (null = ยังไม่ผูกโรงเรียน) */
export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  schoolCode: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** ข้อมูลผู้ใช้ที่ฝังใน session cookie (เซ็นด้วย HMAC)
 *  - uid: id ในตาราง users (บัญชี local); บัญชี legacy = 0
 *  - source: local | legacy
 *  - schoolCode: รหัสโรงเรียนของบัญชีบทบาท school (ว่าง = ไม่ผูกโรงเรียน) — คีย์จำกัดขอบเขตแบบประเมิน */
export interface SessionUser {
  uid: number;
  role: Role;
  name: string;
  source: UserSource;
  schoolCode: string;
}

export const UNIT_TYPES = ["โรงเรียน", "โรงเรียนสาขา", "ห้องเรียนสาขา"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/**
 * ลักษณะที่ตั้ง (ข้อมูลประกอบ — ไม่ใช่เงื่อนไขตัดสิทธิ์ พ.ส.ศ. ตาม R2)
 * ตาม docs/ข้อเสนอเกณฑ์… § ด้านที่ 3
 */
export const SETTING_TYPES = [
  "เกาะ",
  "ภูเขาสูง",
  "หุบเขา",
  "เชิงเขา",
  "พื้นราบห่างไกล",
  "อื่น ๆ",
] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const SETTING_TYPE_LABELS: Record<SettingType, string> = {
  เกาะ: "เกาะ",
  ภูเขาสูง: "ภูเขาสูง",
  หุบเขา: "หุบเขา",
  เชิงเขา: "เชิงเขา",
  พื้นราบห่างไกล: "พื้นราบห่างไกล",
  "อื่น ๆ": "อื่น ๆ",
};

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
  /**
   * ลักษณะที่ตั้ง (บริบทภูมิประเทศ) — ว่าง = ยังไม่ระบุ
   * GIS อาจแนะนำค่าเมื่อ apply scoring v2 ถ้าช่องว่าง; ผู้ใช้แก้ได้เสมอ
   */
  settingType: SettingType | "";
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

/** ประเภทจุดหมายของเส้นทางวิเคราะห์ GIS */
export const GIS_DESTINATION_TYPES = ["province_hall", "district_office", "hospital", "other"] as const;
export type GisDestinationType = (typeof GIS_DESTINATION_TYPES)[number];

export const GIS_DESTINATION_LABELS: Record<GisDestinationType, string> = {
  province_hall: "ศาลากลางจังหวัด",
  district_office: "สำนักงานเขต/สกร.อำเภอ",
  hospital: "โรงพยาบาล/หน่วยฉุกเฉิน",
  other: "อื่น ๆ",
};

/** เวอร์ชันการให้คะแนน — ไม่มีค่า (undefined) ใน state = v1 (พฤติกรรมเดิมทุกประการ) */
export type ScoringVersion = "v1" | "v2-gis";

/** ผลวิเคราะห์เส้นทางหนึ่งเส้น — ratio ทุกตัว server คำนวณใหม่จากวัตถุดิบดิบเสมอ (ไม่เชื่อ client) */
export interface GisRouteAnalysis {
  destinationType: GisDestinationType;
  destinationName: string;
  destLat: number;
  destLng: number;
  /** ระยะเส้นตรงทางอากาศ (haversine) — server คำนวณจากพิกัดเอง */
  straightDistanceKm: number;
  /** ระยะทางตามถนนจริงจาก OSRM */
  roadDistanceKm: number;
  /** เวลาเดินทางจาก OSRM */
  travelTimeMin: number;
  /** RCR = ระยะถนน ÷ ระยะเส้นตรง */
  roadCircuityRatio: number;
  /** TTR = เวลาจริง ÷ เวลาอ้างอิงพื้นที่ปกติ (60 กม./ชม.) */
  travelTimeRatio: number;
  /** ระยะทางสมมูล = ระยะถนน × TTR */
  effectiveDistanceKm: number;
  averageSpeedKmh: number;
  /** ความสูงสะสมขาขึ้น/ลงตามเส้นทาง — สุ่มจาก DEM ฝั่ง browser; null = ไม่ได้สุ่ม */
  elevationGainM: number | null;
  elevationLossM: number | null;
  routeSource: "osrm";
  /** เส้นที่ผู้ใช้เลือกจากทางเลือก OSRM (ใช้คิดคะแนน) */
  selected: boolean;
  calculatedAt: string;
  /** จุดสูงสุดที่สุ่มได้ตามเส้นทางนี้ (พิกัด + ความสูง) — ชุดเดียวกับธงจุดสูงสุดบนแผนที่; null = ยังไม่ได้สุ่ม */
  highestPoint?: GisRouteHighestPoint | null;
}

/** จุดสูงสุดที่สุ่มได้ตามเส้นทาง — ใช้ทั้งธงแดงบนแผนที่และค่าที่บันทึกลงแบบประเมิน (ต้องเป็นชุดตัวอย่างเดียวกัน) */
export interface GisRouteHighestPoint {
  lat: number;
  lng: number;
  elevationM: number;
}

/** สรุปอาคาร/ประชากรโดยประมาณในรัศมีรอบจุดวิเคราะห์ (500/1,000/1,500 ม.) */
export interface GisRadiusSummary {
  radiusM: 500 | 1000 | 1500;
  buildingCount: number;
  estPopulation: number | null;
  popDensityPerKm2: number | null;
}

/** แหล่งข้อมูลที่ใช้คำนวณผล GIS — แสดงประกอบเพื่อความโปร่งใส ไม่ใช่ข้อมูลที่มีผลต่อคะแนน */
export interface GisDataSources {
  terrain: "Terrarium DEM";
  routing: "OSRM";
  buildings: "Microsoft Building Footprints" | null;
  populationMethod: "building-count-x-provincial-household-size" | null;
  analyzedAt: string;
}

export interface GisElevationInfo {
  /** ความสูงที่จุดตั้งหมุดโรงเรียนจริง (ม.) — มาจากจุดปลายทางใน route elevation profile เท่านั้น ห้ามใช้ค่าเฉลี่ยพื้นที่แทน */
  schoolMarkerElevationM: number | null;
  /** ความสูงเฉลี่ยของกริดพื้นที่วิเคราะห์ (ม.) */
  meanElevationM: number | null;
  /** ความสูงต่ำสุดของกริดพื้นที่วิเคราะห์ (ม.) */
  minElevationM: number | null;
  /** ความสูงสูงสุดของกริดพื้นที่วิเคราะห์ (ม.) */
  maxElevationM: number | null;
  /** ผลต่างความสูงสูงสุด−ต่ำสุดของกริด (ม.) */
  reliefM: number | null;
  meanSlopePct: number | null;
  /** ความลาดชันสูงสุดของกริด (%) */
  maxSlopePct: number | null;
  /** ความสูงสุดในรัศมี 1 กม. รอบจุดตั้ง (ม.); null = ไม่ได้คำนวณ */
  localMaxElevation1KmM: number | null;
  slopeClass: string;
  landformTh: string;
  /** ความสูงสุ่มได้เฉพาะฝั่ง browser (Terrarium DEM) — ระบุที่มาอย่างโปร่งใส */
  terrainConfidence: "client";
  /** ความสูงเฉลี่ยจังหวัด (ม.) จากตาราง province — ใช้ประตูพื้นที่สูงเทียบค่าเฉลี่ยจังหวัด (SSRA) */
  provinceAvgElev?: number | null;
  /**
   * ความสูงสุดตลอดเส้นทางหลักทั้งเส้น (ม.) — เกต SSRA "ผ่านเนิน/ภูเขา"
   * (sanitize ยอมรับ legacy key `routeMaxElev` แล้ว map มาที่นี่)
   */
  routeFullMaxElev?: number | null;
  /** ความสูงสุดช่วง 5 กม.สุดท้าย (ม.) — ใช้จำแนก landform ภูเขา/หุบเขา/เชิงเขา */
  routeTailMaxElev?: number | null;
}

/** แกน A ชั้นความสูง: low = ไม่เข้าเกณฑ์พื้นที่สูง · mid = พื้นที่สูง · high = ภูเขาสูง ≥1000 ม. */
export type CommunityAxisATier = "low" | "mid" | "high";

/** ป้ายหลอมแกน A (ภูมิประเทศ) + B (การเข้าถึง) — ตั้งฉากกับความหนาแน่น (แกน C) */
export type CommunityCompositeKey =
  | "highland_remote"
  | "highland_accessible"
  | "flat_remote"
  | "flat_normal"
  | "incomplete";

/**
 * จำแนกชุมชน 3 แกน (วิจัย SSRA/HRDI + ความหนาแน่น) — เขียน server-side ผ่าน sanitizeGis/POST /gis
 * ไม่รวมกับคะแนน พ.ส.ศ. 100 และไม่ใช่เงื่อนไขตัดสิทธิ์ (R2)
 */
export interface GisCommunityClass {
  axisA: {
    highland: boolean;
    tier: CommunityAxisATier;
    schoolElevationM: number | null;
    provinceAvgElev: number | null;
    /** ความสูงสุดตลอดเส้นทางทั้งเส้น (SSRA) */
    routeFullMaxElev: number | null;
    landformTh: string;
    /** เหตุผลภาษาไทยว่าทำไมเข้า/ไม่เข้าประตูพื้นที่สูง */
    reasons: string[];
  };
  axisB: {
    /** 0–4 จาก derive32Severity; null = ยังไม่มีเส้นทาง */
    severity: number | null;
    label: string;
  };
  /** null = ยังไม่มีข้อสรุปพื้นที่ (ผังอาคาร) */
  axisC: {
    label: string;
    tone: "sparse" | "rural" | "semi" | "urban" | null;
    popDensityPerKm2: number | null;
  } | null;
  composite: {
    key: CommunityCompositeKey;
    labelTh: string;
    tone: "ok" | "info" | "warn";
  };
  /**
   * ประมาณชั้นลุ่มน้ำ WSC 1–5 จากความลาดชัน (proxy) — ไม่ใช่แผนที่ราชการ
   * null = ยังไม่มี meanSlopePct
   */
  wscProxy: {
    class: 1 | 2 | 3 | 4 | 5;
    labelTh: string;
    hint: string;
    meanSlopePct: number | null;
    schoolElevationM: number | null;
  } | null;
  /** เวอร์ชันตารางเกณฑ์จำแนกชุมชน */
  version: string;
  calculatedAt: string;
}

/** คะแนน GIS อัตโนมัติ (เต็ม 45 ตาม PRD FR-06) — แสดงประกอบเท่านั้น ไม่รวมกับ 100 คะแนนทางการ */
export interface GisAutoScore {
  /** ผลรวมเฉพาะองค์ประกอบที่คำนวณได้ */
  total: number;
  /** เพดานเฉพาะองค์ประกอบที่มีข้อมูล — แสดงเป็น "total / maxComputable (จากเต็ม 45)" */
  maxComputable: number;
  max: number;
  components: {
    elevation: number | null;
    slopeGain: number | null;
    rcr: number | null;
    ttr: number | null;
    avgSpeed: number | null;
    serviceDistance: number | null;
    /** ยังไม่มีชั้นข้อมูลชายแดน/เขตเทศบาล — null เสมอในเวอร์ชันนี้ */
    borderMunicipality: number | null;
  };
  calculatedAt: string;
  /** เวอร์ชันตารางเกณฑ์ GIS ที่ใช้คำนวณ */
  version: string;
}

/** ข้อสรุปพื้นที่จากการประมวลผลผังอาคาร (polygon ที่วาดบนแผนที่) — ส่งจากแผนที่มาแนบกับแบบประเมิน */
export interface GisAreaSummary {
  /** พื้นที่ polygon (ตร.กม.) */
  areaKm2: number;
  buildingCount: number;
  estPopulation: number | null;
  buildingDensityPerKm2: number;
  popDensityPerKm2: number | null;
  /** ป้ายจำแนกลักษณะการตั้งถิ่นฐาน — server คำนวณใหม่จากความหนาแน่นประชากรให้สอดคล้อง */
  settlementLabel: string;
  calculatedAt: string;
}

/** ผลวิเคราะห์ GIS ทั้งชุดของแบบประเมินหนึ่งฉบับ — เขียนผ่าน POST /api/assessments/[id]/gis เท่านั้น */
export interface GisAnalysis {
  center: {
    lat: number;
    lng: number;
    source: "unit" | "search" | "map-pin";
    confirmedAt: string;
    /** ชื่อจังหวัดที่ศาลากลางใกล้ที่สุด — server เติม ใช้ตรวจ V11 แบบ pure */
    nearestProvinceName: string;
  };
  elevation: GisElevationInfo | null;
  routes: GisRouteAnalysis[];
  autoScore: GisAutoScore | null;
  /** ข้อสรุปพื้นที่/ประชากรจากการวาด polygon (ไม่บังคับ — undefined = ยังไม่ได้ส่งมา) */
  areaSummary?: GisAreaSummary;
  /**
   * จำแนกชุมชน 3 แกน (A ภูมิประเทศ / B การเข้าถึง / C ความหนาแน่น) — server คำนวณใหม่เสมอ
   * undefined บนแถวเก่าที่ยังไม่เคย sanitize หลังเพิ่มฟีเจอร์; หลังอ่านผ่าน sanitizeGis จะถูกเติม
   */
  communityClass?: GisCommunityClass;
  /** จำนวนอาคาร/ประชากรโดยประมาณในรัศมี 500/1,000/1,500 ม. — ไม่บังคับ (undefined = ยังไม่ได้ส่งมา) */
  radiusSummaries?: GisRadiusSummary[];
  /** แหล่งข้อมูลที่ใช้คำนวณผล GIS ชุดนี้ — ไม่บังคับ (undefined = แถวเก่าก่อนมีฟิลด์นี้) */
  dataSources?: GisDataSources;
  /** true = derive ค่าลง responses ด้านที่ 3 แล้ว (scoring v2) */
  appliedToResponses: boolean;
  savedAt: string;
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
  /** ผลวิเคราะห์ GIS — undefined = ยังไม่เคยวิเคราะห์ (แถว v1 เดิมไม่มี key นี้เลย) */
  gis?: GisAnalysis;
  /** "v2-gis" เมื่อนำผล GIS ไปคำนวณคะแนนด้านที่ 3 แล้ว — undefined = v1 */
  scoringVersion?: ScoringVersion;
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
  ownerUserId: number | null;
  ownerSchoolCode: string | null;
  createdAt: string;
  updatedAt: string;
  /** จำแนกชุมชน composite key (เช่น highland_remote) — null = ยังไม่มี GIS */
  communityClassKey: string | null;
  /** ป้ายไทยของ composite */
  communityClassLabel: string | null;
  /** ลักษณะที่ตั้ง (unit.settingType) */
  settingType: string | null;
}

export interface AssessmentRecord {
  id: number;
  state: AssessmentState;
  ownerUserId: number | null;
  ownerSchoolCode: string | null;
  createdAt: string;
  updatedAt: string;
}
