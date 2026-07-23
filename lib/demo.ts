// ชุดตัวอย่างโรงเรียนสำหรับสาธิต/ทดสอบระบบ (ไม่ใช่ข้อมูลโรงเรียนจริง)
// ครอบคลุมทุกระดับผลลัพธ์: ผ่านเฉียดจุดตัด, ผ่านชัดเจน, ก้ำกึ่งต้องตรวจภาคสนาม, ระดับ 1, และไม่เข้าเกณฑ์

import { computeAutoGisScore, computeCommunityClass } from "./gis";
import { levelFor, totalScore } from "./scoring";
import { makeBlankState } from "./state";
import type { AssessmentState, GisAnalysis, IndicatorId } from "./types";

interface DemoProfileDef {
  id: string;
  name: string;
  hint: string;
  build: () => AssessmentState;
}

function withEvidence(state: AssessmentState, note12 = ""): AssessmentState {
  (Object.keys(state.evidence) as IndicatorId[]).forEach((id) => {
    state.evidence[id] = { ready: true, note: id === "1.2" ? note12 : "", files: [] };
  });
  // โปรไฟล์ที่มีผู้เรียนพักนอน (note12) แนบไฟล์ตัวอย่างให้ 1.2 เพื่อให้ผ่านธง V02 (ซึ่งยึดไฟล์จริง)
  // ไฟล์สาธิตเป็น PDF จึงแสดงเป็นชิป "PDF" สะอาด ๆ (ไม่ใช่รูปเสีย) — เป็นข้อมูลสมมติ ไม่มีบนดิสก์
  if (note12) {
    state.evidence["1.2"].files = [
      {
        id: "demo-1-2-duty-order",
        originalName: "คำสั่งเวรพักนอน-ตัวอย่าง.pdf",
        mimeType: "application/pdf",
        size: 245000,
        sha256: "demo",
        uploadedAt: "2569-01-15T09:00:00.000Z",
      },
    ];
  }
  return state;
}

const PROFILE_DEFS: DemoProfileDef[] = [
  {
    id: "boundary-pass",
    name: "ผ่านเกณฑ์เฉียดจุดตัด",
    hint: "คะแนนรวมพอดี 70 — ต้องเข้าคิวตรวจภาคสนามตามธง V09",
    build: () => {
      const s = makeBlankState();
      s.unit = {
        name: "โรงเรียนบ้านห้วยเย็นวิทยา ห้องเรียนสาขาดอยผาแดง",
        code: "50100199",
        year: "2569",
        totalStudents: "128",
        areaOffice: "สพป.เชียงใหม่ เขต 3",
        province: "เชียงใหม่",
        lat: "18.789100",
        lng: "98.983200",
        unitType: "ห้องเรียนสาขา",
        settingType: "ภูเขาสูง",
      };
      s.responses = {
        "1.1": { count: "92" },
        "1.2": { count: "20" },
        "1.3": { count: "40" },
        "1.4": { langs: "3" },
        "2.1": { frame: "12", actual: "9" },
        "2.2": { level: "1" },
        "2.3": { rate: "22" },
        "3.1": { minutes: "145", km: "38" },
        "3.2": { level: "3" },
        "3.3": { minutes: "50", unitName: "รพ.สต.บ้านห้วยเย็น" },
        "4.1": { level: "2" },
        "4.2": { level: "1" },
        "4.3": { level: "2" },
        "5.1": { level: "1" },
        "5.2": { level: "1" },
      };
      return withEvidence(s, "มีคำสั่งเวรพักนอนและภาพเรือนนอนพร้อมพิกัด");
    },
  },
  {
    id: "severe-remote",
    name: "พื้นที่ทุรกันดารรุนแรง",
    hint: "คะแนนรวม 98 — แทบทุกด้านใกล้เพดาน ระดับ 3 ชัดเจน",
    build: () => {
      const s = makeBlankState();
      s.unit = {
        name: "โรงเรียนบ้านดอยสูงสุดขอบฟ้า สาขาห้วยน้ำริน",
        code: "58010025",
        year: "2569",
        totalStudents: "210",
        areaOffice: "สพป.แม่ฮ่องสอน เขต 2",
        province: "แม่ฮ่องสอน",
        lat: "19.302000",
        lng: "97.965400",
        unitType: "โรงเรียนสาขา",
        // ลักษณะที่ตั้ง (ข้อมูลประกอบ R2) — สอดคล้อง GIS ภูเขาสูง
        settingType: "ภูเขาสูง",
      };
      s.responses = {
        "1.1": { count: "180" },
        "1.2": { count: "45" },
        "1.3": { count: "48" },
        "1.4": { langs: "4" },
        "2.1": { frame: "10", actual: "6" },
        "2.2": { level: "3" },
        "2.3": { rate: "35" },
        "3.1": { minutes: "200", km: "72" },
        "3.2": { level: "4" },
        "3.3": { minutes: "130", unitName: "รพ.สต.ห้วยน้ำริน" },
        "4.1": { level: "3" },
        "4.2": { level: "3" },
        "4.3": { level: "3" },
        "5.1": { level: "2" },
        "5.2": { level: "2" },
      };
      // ตัวอย่างผลวิเคราะห์ GIS (scoring v2) — ตัวเลขสอดคล้องกับคำตอบด้านที่ 3 ที่กรอกไว้ข้างบนพอดี
      // (3.1: 200 นาที/72 กม., 3.2: severity 4 จาก TTR 2.78 + ไต่สะสม 1,350 ม., 3.3: รพ. 130 นาที)
      // จึงไม่ปลุกธง V19/V20 และคะแนนรวมยังคง 98 ตามที่ test ยึดไว้
      const gis: GisAnalysis = {
        center: {
          lat: 19.302,
          lng: 97.9654,
          source: "unit",
          confirmedAt: "2569-01-15T09:00:00.000Z",
          nearestProvinceName: "แม่ฮ่องสอน",
        },
        elevation: {
          schoolMarkerElevationM: 1180,
          meanElevationM: 1160,
          minElevationM: 1020,
          maxElevationM: 1350,
          reliefM: 330,
          meanSlopePct: 28,
          maxSlopePct: 42,
          localMaxElevation1KmM: 1240,
          slopeClass: "E: เนินเขา/ลาดชันสูง (20–35%)",
          landformTh: "ชุมชนบนภูเขาสูง",
          terrainConfidence: "client",
          provinceAvgElev: 400,
          routeFullMaxElev: 1400,
          routeTailMaxElev: 1250,
        },
        routes: [
          {
            destinationType: "province_hall",
            destinationName: "ศาลากลางจังหวัดแม่ฮ่องสอน",
            destLat: 19.032,
            destLng: 97.9654,
            straightDistanceKm: 30,
            roadDistanceKm: 72,
            travelTimeMin: 200,
            roadCircuityRatio: 2.4,
            travelTimeRatio: 2.78,
            effectiveDistanceKm: 200.16,
            averageSpeedKmh: 21.6,
            elevationGainM: 1350,
            elevationLossM: 620,
            routeSource: "osrm",
            selected: true,
            calculatedAt: "2569-01-15T09:00:00.000Z",
          },
          {
            destinationType: "hospital",
            destinationName: "รพ.สต.ห้วยน้ำริน",
            destLat: 19.122,
            destLng: 97.9654,
            straightDistanceKm: 20,
            roadDistanceKm: 48,
            travelTimeMin: 130,
            roadCircuityRatio: 2.4,
            travelTimeRatio: 2.71,
            effectiveDistanceKm: 130.08,
            averageSpeedKmh: 22.2,
            elevationGainM: 900,
            elevationLossM: 410,
            routeSource: "osrm",
            selected: true,
            calculatedAt: "2569-01-15T09:00:00.000Z",
          },
        ],
        autoScore: null,
        appliedToResponses: true,
        savedAt: "2569-01-15T09:00:00.000Z",
      };
      gis.autoScore = computeAutoGisScore(gis, "2569-01-15T09:00:00.000Z");
      gis.communityClass = computeCommunityClass(gis, "2569-01-15T09:00:00.000Z");
      s.gis = gis;
      s.scoringVersion = "v2-gis";
      return withEvidence(s, "มีคำสั่งเวรพักนอนและภาพเรือนนอนพร้อมพิกัด");
    },
  },
  {
    id: "borderline-review",
    name: "ก้ำกึ่ง ต้องตรวจภาคสนาม",
    hint: "คะแนนรวม 68 — อยู่ในแถบ 65-74 ต้องตรวจภาคสนาม 100% ตามธง V09",
    build: () => {
      const s = makeBlankState();
      s.unit = {
        name: "โรงเรียนบ้านท่าข้ามชายแดน",
        code: "63020015",
        year: "2569",
        totalStudents: "150",
        areaOffice: "สพป.ตาก เขต 2",
        province: "ตาก",
        lat: "16.700000",
        lng: "98.566700",
        unitType: "โรงเรียน",
        settingType: "พื้นราบห่างไกล",
      };
      s.responses = {
        "1.1": { count: "100" },
        "1.2": { count: "25" },
        "1.3": { count: "28" },
        "1.4": { langs: "5" },
        "2.1": { frame: "15", actual: "10" },
        "2.2": { level: "2" },
        "2.3": { rate: "18" },
        "3.1": { minutes: "145", km: "40" },
        "3.2": { level: "2" },
        "3.3": { minutes: "130", unitName: "รพ.สต.ท่าข้าม" },
        "4.1": { level: "1" },
        "4.2": { level: "1" },
        "4.3": { level: "1" },
        "5.1": { level: "1" },
        "5.2": { level: "0" },
      };
      return withEvidence(s, "มีคำสั่งเวรพักนอนและภาพเรือนนอนพร้อมพิกัด");
    },
  },
  {
    id: "level1-notpaid",
    name: "ระดับ 1 ยังไม่ได้รับเงินเพิ่ม",
    hint: "คะแนนรวม 55 — ขึ้นทะเบียนรอพิจารณา ยังไม่ถึงจุดตัด 70",
    build: () => {
      const s = makeBlankState();
      s.unit = {
        name: "โรงเรียนบ้านโป่งแยงใน",
        code: "57020033",
        year: "2569",
        totalStudents: "100",
        areaOffice: "สพป.เชียงราย เขต 3",
        province: "เชียงราย",
        lat: "19.910500",
        lng: "99.840600",
        unitType: "โรงเรียน",
        settingType: "",
      };
      s.responses = {
        "1.1": { count: "65" },
        "1.2": { count: "25" },
        "1.3": { count: "18" },
        "1.4": { langs: "5" },
        "2.1": { frame: "10", actual: "8" },
        "2.2": { level: "1" },
        "2.3": { rate: "35" },
        "3.1": { minutes: "150", km: "45" },
        "3.2": { level: "1" },
        "3.3": { minutes: "90", unitName: "รพ.สต.โป่งแยง" },
        "4.1": { level: "0" },
        "4.2": { level: "1" },
        "4.3": { level: "0" },
        "5.1": { level: "0" },
        "5.2": { level: "0" },
      };
      return withEvidence(s, "มีคำสั่งเวรพักนอนและภาพเรือนนอนพร้อมพิกัด");
    },
  },
  {
    id: "urban-fail",
    name: "โรงเรียนในเมือง ไม่เข้าเกณฑ์",
    hint: "คะแนนรวม 12 — สภาพปกติเกือบทุกด้าน ไม่ผ่านเกณฑ์ พ.ส.ศ.",
    build: () => {
      const s = makeBlankState();
      s.unit = {
        name: "โรงเรียนวัดโพธิ์ทอง",
        code: "73010008",
        year: "2569",
        totalStudents: "500",
        areaOffice: "สพป.นครปฐม เขต 1",
        province: "นครปฐม",
        lat: "13.819700",
        lng: "100.061900",
        unitType: "โรงเรียน",
        settingType: "อื่น ๆ",
      };
      s.responses = {
        "1.1": { count: "150" },
        "1.2": { count: "0" },
        "1.3": { count: "2" },
        "1.4": { langs: "0" },
        "2.1": { frame: "20", actual: "19" },
        "2.2": { level: "0" },
        "2.3": { rate: "12" },
        "3.1": { minutes: "35", km: "18" },
        "3.2": { level: "0" },
        "3.3": { minutes: "20", unitName: "รพ.นครปฐม" },
        "4.1": { level: "0" },
        "4.2": { level: "0" },
        "4.3": { level: "0" },
        "5.1": { level: "0" },
        "5.2": { level: "0" },
      };
      return withEvidence(s);
    },
  },
];

export interface DemoProfileOption {
  id: string;
  name: string;
  hint: string;
  total: number;
  levelLabel: string;
}

// รายการสำหรับ UI พร้อมคะแนน/ระดับที่คำนวณจริงจากข้อมูลตัวอย่าง (กันข้อความเพี้ยนจากตัวเลขจริง)
export const DEMO_PROFILES: DemoProfileOption[] = PROFILE_DEFS.map((def) => {
  const state = def.build();
  const total = totalScore(state);
  return { id: def.id, name: def.name, hint: def.hint, total, levelLabel: levelFor(total).label };
});

export function makeDemoState(profileId?: string): AssessmentState {
  const def = PROFILE_DEFS.find((p) => p.id === profileId) ?? PROFILE_DEFS[0];
  return def.build();
}

/**
 * เติม "เฉพาะข้อมูลตามเกณฑ์" ของโปรไฟล์ตัวอย่างลงบนแบบประเมินที่เปิดอยู่
 *
 * ข้อมูลโรงเรียน (unit: ชื่อ/รหัส/สังกัด/จังหวัด/พิกัด/จำนวนนักเรียน/ลักษณะที่ตั้ง) ไม่ถูกแตะเลย —
 * ผู้ใช้จึงลองคะแนนกับโรงเรียนจริงของตนได้โดยชื่อและพิกัดไม่ถูกทับด้วยโรงเรียนสมมติ
 *
 * สิ่งที่ "ไม่" เติมทับด้วยเช่นกัน เพราะเป็นข้อมูลของแถวจริงไม่ใช่คำตอบตามเกณฑ์:
 * - `evidence[].files` ไฟล์หลักฐานจริงที่อัปโหลดไว้ (ตัวอย่างเติมแค่สถานะพร้อม/หมายเหตุ)
 * - `gis`/`scoringVersion` ผลวิเคราะห์แผนที่ของโรงเรียนจริง (พิกัดตัวอย่างจะขัดกับ unit จริง)
 * - `feedback`/`generalFeedback`/`signed`/`submitted` ความเห็นและสถานะการยื่นของผู้ใช้
 */
export function applyDemoCriteria(current: AssessmentState, profileId?: string): AssessmentState {
  const demo = makeDemoState(profileId);
  const responses = scaleHeadcounts(demo, current.unit.totalStudents);
  const evidence = {} as AssessmentState["evidence"];
  (Object.keys(current.evidence) as IndicatorId[]).forEach((id) => {
    evidence[id] = {
      ...current.evidence[id],
      ready: demo.evidence[id]?.ready ?? current.evidence[id].ready,
      note: demo.evidence[id]?.note ?? current.evidence[id].note,
      files: current.evidence[id].files, // ไฟล์จริงเป็นของฝั่งเซิร์ฟเวอร์ — ห้ามล้างหรือยัดไฟล์สมมติ
    };
  });
  return { ...current, responses, evidence };
}

/**
 * ตัวชี้วัดที่ให้คะแนนจาก "ร้อยละของผู้เรียนทั้งหมด" (ดู `scoreIndicator` ใน lib/scoring.ts)
 * — ค่าดิบจึงมีความหมายเฉพาะกับจำนวนผู้เรียนของโปรไฟล์นั้น ต้องปรับตามสัดส่วนก่อนใช้กับโรงเรียนอื่น
 *
 * ข้อ 1.2 (ผู้เรียนพักนอน) ไม่อยู่ในกลุ่มนี้: แถบคะแนนของมันเป็น "จำนวนคน" ล้วน ๆ (≤10, ≤20, ≤30 …)
 * ถ้าไปคูณตามสัดส่วนจะเลื่อนแถบคะแนนจนคะแนนรวมไม่ตรงกับที่โปรไฟล์ระบุ
 */
const PERCENT_OF_STUDENTS_IDS: IndicatorId[] = ["1.1", "1.3"];

/** ข้อที่นับ "จำนวนคน" ตรง ๆ — คงค่าดิบไว้ เพียงแต่ต้องไม่เกินผู้เรียนทั้งหมดจริง */
const HEADCOUNT_IDS: IndicatorId[] = ["1.2"];

/**
 * ปรับจำนวนผู้เรียนในด้านที่ 1 ให้เข้ากับขนาดโรงเรียนจริง
 *
 * 1.1/1.3 คิดเป็นร้อยละ การคัดลอกค่าดิบของโรงเรียนสมมติ (เช่น 92 คนจากทั้งหมด 128) ไปวางบนโรงเรียน
 * ที่มีผู้เรียน 241 คน จะได้ร้อยละคนละแถบคะแนน — ตัวอย่างที่บอกว่า "70 คะแนน" ก็จะไม่ได้ 70 อีกต่อไป
 * การคูณตามสัดส่วนรักษาร้อยละเดิมไว้ จึงได้แถบคะแนนตามที่โปรไฟล์ระบุไม่ว่าโรงเรียนจะใหญ่หรือเล็ก
 *
 * ทุกข้อถูกจำกัดไม่ให้เกินผู้เรียนทั้งหมดจริง มิฉะนั้นธง V00 (จำนวนเกินผู้เรียนทั้งหมด, tone "block")
 * จะขึ้นจนส่งแบบประเมินไม่ได้ กรณีนี้เกิดกับ 1.2 ของโรงเรียนที่เล็กมาก และคะแนนข้อนั้นจะต่ำกว่า
 * ที่โปรไฟล์ระบุ — ยอมให้คะแนนเพี้ยนดีกว่าปล่อยให้ตัวอย่างสร้างแบบประเมินที่ส่งไม่ได้
 *
 * ผู้เรียนทั้งหมดยังว่างอยู่ (ยังไม่กรอกข้อมูลโรงเรียน) → คัดลอกค่าดิบตามเดิม เพราะไม่มีฐานให้เทียบ
 */
function scaleHeadcounts(demo: AssessmentState, realTotalRaw: string): AssessmentState["responses"] {
  const realTotal = Number.parseFloat(realTotalRaw);
  const demoTotal = Number.parseFloat(demo.unit.totalStudents);
  const responses = { ...demo.responses };
  if (!Number.isFinite(realTotal) || realTotal <= 0 || !Number.isFinite(demoTotal) || demoTotal <= 0) {
    return responses;
  }
  const cap = Math.floor(realTotal);
  for (const id of [...PERCENT_OF_STUDENTS_IDS, ...HEADCOUNT_IDS]) {
    const count = Number.parseFloat(demo.responses[id]?.count ?? "");
    if (!Number.isFinite(count)) continue;
    const scaled = PERCENT_OF_STUDENTS_IDS.includes(id) ? Math.round((count / demoTotal) * realTotal) : count;
    responses[id] = { ...responses[id], count: String(Math.min(scaled, cap)) };
  }
  return responses;
}
