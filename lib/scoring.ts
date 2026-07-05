// เอนจินคะแนน พ.ส.ศ. — pure functions ใช้ซ้ำทั้ง client (แสดงผลทันที) และ server (คำนวณจริงก่อนบันทึก)
// กติกาสำคัญ: ผู้ใช้กรอกข้อมูลดิบเท่านั้น ระบบเป็นผู้แปลงเป็นคะแนน (ห้ามมีช่องกรอกคะแนนตรง)

import { DIMENSIONS, INDICATORS, PASS_THRESHOLD } from "./criteria";
import type { DimensionDef } from "./criteria";
import { INDICATOR_IDS } from "./types";
import type { AssessmentState, Flag, IndicatorId, LevelDescriptor } from "./types";

export function num(value: unknown): number {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** คะแนนของตัวชี้วัดหนึ่งรายการ — null = ยังไม่กรอกข้อมูล */
export function scoreIndicator(id: IndicatorId, state: AssessmentState): number | null {
  const data = state.responses[id] || {};
  const total = num(state.unit.totalStudents);

  switch (id) {
    case "1.1": {
      if (isBlank(data.count) || total <= 0) return null;
      const percent = (num(data.count) / total) * 100;
      if (percent < 5) return 0;
      if (percent <= 20) return 2;
      if (percent <= 40) return 4;
      if (percent <= 60) return 6;
      if (percent <= 80) return 8;
      return 10;
    }
    case "1.2": {
      if (isBlank(data.count)) return null;
      const count = num(data.count);
      if (count <= 0) return 0;
      if (count <= 10) return 4;
      if (count <= 20) return 6;
      if (count <= 30) return 7;
      if (count <= 40) return 8;
      if (count <= 60) return 9;
      return 10;
    }
    case "1.3": {
      if (isBlank(data.count) || total <= 0) return null;
      const percent = (num(data.count) / total) * 100;
      if (percent < 1) return 0;
      if (percent <= 6) return 1;
      if (percent <= 11) return 2;
      if (percent <= 16) return 3;
      if (percent <= 21) return 4;
      return 5;
    }
    case "1.4": {
      if (isBlank(data.langs)) return null;
      return clamp(Math.floor(num(data.langs)), 0, 5);
    }
    case "2.1": {
      if (isBlank(data.frame) || isBlank(data.actual)) return null;
      const frame = num(data.frame);
      if (frame <= 0) return 0;
      const deficit = ((frame - num(data.actual)) / frame) * 100;
      if (deficit <= 0) return 0;
      if (deficit <= 10) return 1;
      if (deficit <= 20) return 2;
      return 3;
    }
    case "2.2":
    case "3.2":
    case "4.1":
    case "4.2":
    case "4.3":
    case "5.1":
    case "5.2": {
      if (isBlank(data.level)) return null;
      const indicator = INDICATORS[id];
      if (indicator.kind !== "level") return null;
      const option = indicator.options[Number(data.level)];
      return option ? option.points : null;
    }
    case "2.3": {
      if (isBlank(data.rate)) return null;
      const rate = num(data.rate);
      if (rate < 10) return 0;
      if (rate <= 20) return 1;
      if (rate <= 30) return 2;
      return 3;
    }
    case "3.1": {
      if (isBlank(data.minutes)) return null;
      const minutes = num(data.minutes);
      if (minutes <= 30) return 0;
      if (minutes <= 60) return 3;
      if (minutes <= 120) return 6;
      if (minutes <= 180) return 8;
      return 10;
    }
    case "3.3": {
      if (isBlank(data.minutes)) return null;
      const minutes = num(data.minutes);
      if (minutes <= 15) return 0;
      if (minutes <= 30) return 3;
      if (minutes <= 60) return 6;
      if (minutes <= 120) return 8;
      return 10;
    }
    default:
      return null;
  }
}

export function totalScore(state: AssessmentState): number {
  return INDICATOR_IDS.reduce((sum, id) => {
    const score = scoreIndicator(id, state);
    return sum + (score === null ? 0 : score);
  }, 0);
}

export function dimScore(dimension: DimensionDef, state: AssessmentState): number {
  return dimension.ids.reduce((sum, id) => {
    const score = scoreIndicator(id, state);
    return sum + (score === null ? 0 : score);
  }, 0);
}

export function answeredCount(state: AssessmentState): number {
  return INDICATOR_IDS.filter((id) => scoreIndicator(id, state) !== null).length;
}

export function levelFor(score: number): LevelDescriptor {
  if (score >= PASS_THRESHOLD) {
    return {
      key: "level-3",
      label: "ระดับ 3 ยุ่งยากมากที่สุด",
      short: "ได้รับ พ.ส.ศ. 2,000 บาท/เดือน",
      detail: `ผ่านเกณฑ์ ${PASS_THRESHOLD} คะแนน`,
    };
  }
  if (score >= 60) {
    return {
      key: "level-2",
      label: "ระดับ 2 ยุ่งยากมาก",
      short: "ขึ้นทะเบียนรอพิจารณา",
      detail: `ต้องการอีก ${PASS_THRESHOLD - score} คะแนนเพื่อถึงระดับ 3`,
    };
  }
  if (score >= 50) {
    return {
      key: "level-1",
      label: "ระดับ 1 ยุ่งยาก",
      short: "ขึ้นทะเบียนรอพิจารณา",
      detail: `ต้องการอีก ${PASS_THRESHOLD - score} คะแนนเพื่อถึงระดับ 3`,
    };
  }
  return {
    key: "neutral",
    label: "ยังไม่จัดระดับ",
    short: "ยังไม่เข้าเกณฑ์รับเงินเพิ่ม พ.ส.ศ.",
    detail: `ต้องการอีก ${PASS_THRESHOLD - score} คะแนนเพื่อถึงระดับ 3`,
  };
}

export function indicatorPercent(id: IndicatorId, state: AssessmentState): number | null {
  const total = num(state.unit.totalStudents);
  if (total <= 0) return null;
  return (num(state.responses[id]?.count) / total) * 100;
}

/** ธงตรวจทานอัตโนมัติ (subset ของตาราง V01–V10 ในสเปก §8.5 + V00 เฉพาะแอป) */
export function flags(state: AssessmentState): Flag[] {
  const items: Flag[] = [];
  const total = num(state.unit.totalStudents);

  (["1.1", "1.2", "1.3"] as IndicatorId[]).forEach((id) => {
    const count = state.responses[id]?.count;
    if (!isBlank(count) && total > 0 && num(count) > total) {
      items.push({
        code: "V00",
        id,
        tone: "block",
        text: `${id} จำนวนที่กรอกมากกว่าผู้เรียนทั้งหมด ต้องตรวจแก้ก่อนส่ง`,
      });
    }
  });

  if (num(state.responses["1.2"]?.count) >= 1 && !state.evidence["1.2"]?.ready) {
    items.push({
      code: "V02",
      id: "1.2",
      tone: "block",
      text: "มีผู้เรียนพักนอน แต่ยังไม่ยืนยันคำสั่งเวรพักนอนและหลักฐานเรือนนอน",
    });
  }

  if (
    Number(state.responses["3.2"]?.level) >= 3 &&
    !isBlank(state.responses["3.1"]?.minutes) &&
    num(state.responses["3.1"]?.minutes) <= 30
  ) {
    items.push({
      code: "V04",
      id: "3.2",
      tone: "warn",
      text: "เลือกความยากลำบากการเข้าถึงระดับสูง แต่เวลาเดินทางจากเขตไม่เกิน 30 นาที",
    });
  }

  const electricity = Number(state.responses["4.1"]?.level);
  const internet = Number(state.responses["4.3"]?.level);
  if ((electricity === 2 || electricity === 3) && internet === 0) {
    items.push({
      code: "V06",
      id: "4.1",
      tone: "warn",
      text: "ระบุว่าไม่มีไฟฟ้าสาธารณะ แต่อินเทอร์เน็ตใช้งานปกติ กรรมการควรตรวจประกอบ",
    });
  }

  if (internet === 3) {
    items.push({
      code: "V07",
      id: "4.3",
      tone: "info",
      text: "ระบุว่าไม่มีสัญญาณสื่อสาร ระบบควรบันทึกสถานที่ที่ใช้ยื่นแบบออนไลน์",
    });
  }

  const score = totalScore(state);
  if (score >= 65 && score <= 74) {
    items.push({
      code: "V09",
      id: null,
      tone: "info",
      text: "คะแนนรวมอยู่ในแถบ 65-74 ต้องเข้าคิวตรวจภาคสนาม 100% ก่อนประกาศผล",
    });
  }

  return items;
}

export function unitComplete(state: AssessmentState): boolean {
  const unit = state.unit;
  return Boolean(
    unit.name && unit.code && unit.year && num(unit.totalStudents) > 0 && unit.areaOffice && unit.province
  );
}

export function canSubmit(state: AssessmentState): boolean {
  return (
    unitComplete(state) &&
    answeredCount(state) === INDICATOR_IDS.length &&
    state.signed &&
    !flags(state).some((item) => item.tone === "block")
  );
}

export interface ComputedLine {
  text: string;
  tone: "" | "good" | "warn";
}

/** ข้อความสรุปผลคำนวณใต้ตัวชี้วัด */
export function computedText(id: IndicatorId, state: AssessmentState, score: number | null): ComputedLine {
  const response = state.responses[id] || {};
  if (score === null) return { text: "ยังไม่กรอกข้อมูล", tone: "" };

  if (id === "1.1" || id === "1.3") {
    const percent = indicatorPercent(id, state);
    if (percent === null) return { text: "ต้องกรอกผู้เรียนทั้งหมดก่อนคำนวณ", tone: "warn" };
    return {
      text: `${percent.toFixed(2)}% ของผู้เรียนทั้งหมด - ได้ ${score} คะแนน`,
      tone: score > 0 ? "good" : "",
    };
  }

  if (id === "2.1") {
    const frame = num(response.frame);
    const deficit = frame <= 0 ? 0 : Math.max(0, ((frame - num(response.actual)) / frame) * 100);
    return {
      text: `ขาดแคลน ${deficit.toFixed(1)}% - ได้ ${score} คะแนน`,
      tone: score > 0 ? "good" : "",
    };
  }

  return { text: `ได้ ${score} คะแนน`, tone: score > 0 ? "good" : "" };
}

export interface ComputedAll {
  scores: Record<IndicatorId, number | null>;
  total: number;
  level: LevelDescriptor;
  dims: { no: number; short: string; max: number; earned: number }[];
  flags: Flag[];
  answered: number;
  totalIndicators: number;
  unitOk: boolean;
  submittable: boolean;
}

/** คำนวณทุกอย่างในรอบเดียว — ใช้ใน useMemo ฝั่ง client */
export function computeAll(state: AssessmentState): ComputedAll {
  const scores = {} as Record<IndicatorId, number | null>;
  INDICATOR_IDS.forEach((id) => {
    scores[id] = scoreIndicator(id, state);
  });
  const total = totalScore(state);
  return {
    scores,
    total,
    level: levelFor(total),
    dims: DIMENSIONS.map((dim) => ({ no: dim.no, short: dim.short, max: dim.max, earned: dimScore(dim, state) })),
    flags: flags(state),
    answered: answeredCount(state),
    totalIndicators: INDICATOR_IDS.length,
    unitOk: unitComplete(state),
    submittable: canSubmit(state),
  };
}
