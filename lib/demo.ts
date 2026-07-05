// ชุดตัวอย่างโรงเรียนสำหรับสาธิต/ทดสอบระบบ (ไม่ใช่ข้อมูลโรงเรียนจริง)
// ครอบคลุมทุกระดับผลลัพธ์: ผ่านเฉียดจุดตัด, ผ่านชัดเจน, ก้ำกึ่งต้องตรวจภาคสนาม, ระดับ 1, และไม่เข้าเกณฑ์

import { levelFor, totalScore } from "./scoring";
import { makeBlankState } from "./state";
import type { AssessmentState, IndicatorId } from "./types";

interface DemoProfileDef {
  id: string;
  name: string;
  hint: string;
  build: () => AssessmentState;
}

function withEvidence(state: AssessmentState, note12 = ""): AssessmentState {
  (Object.keys(state.evidence) as IndicatorId[]).forEach((id) => {
    state.evidence[id] = { ready: true, note: id === "1.2" ? note12 : "" };
  });
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
