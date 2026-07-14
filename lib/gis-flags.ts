// ธง validation ที่เกี่ยวกับ GIS / จำแนกชุมชน — แยกจาก lib/scoring.ts (คะแนน + canSubmit)
// ทุกตัว info/warn เท่านั้น — ไม่ block การยื่น

import { computeCommunityClass, derive32Severity, hospitalRoute, primaryRoute } from "./gis";
import { wscProxySuggestsFlat, wscProxySuggestsUpland } from "./wsc-proxy";
import type { AssessmentState, Flag, GisRouteAnalysis, IndicatorId } from "./types";

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** V11 / V12 / V14 / V19 / V20 — เส้นทาง + ความสอดคล้อง 3.2 กับ GIS severity */
export function gisValidationFlags(state: AssessmentState): Flag[] {
  const gis = state.gis;
  if (!gis) return [];

  const items: Flag[] = [];

  if (
    gis.center.nearestProvinceName &&
    state.unit.province &&
    !state.unit.province.includes(gis.center.nearestProvinceName) &&
    !gis.center.nearestProvinceName.includes(state.unit.province)
  ) {
    items.push({
      code: "V11",
      id: null,
      tone: "warn",
      text: `พิกัดที่วิเคราะห์อยู่ใกล้ศาลากลาง${gis.center.nearestProvinceName} ไม่ตรงกับจังหวัดที่กรอก (${state.unit.province}) ควรตรวจสอบพิกัด`,
    });
  }

  const impossible = gis.routes.find((route) => route.roadDistanceKm < route.straightDistanceKm * 0.98);
  if (impossible) {
    items.push({
      code: "V12",
      id: "3.1",
      tone: "warn",
      text: `เส้นทางไป${impossible.destinationName || "จุดหมาย"} มีระยะถนน (${impossible.roadDistanceKm.toFixed(1)} กม.) สั้นกว่าระยะเส้นตรง (${impossible.straightDistanceKm.toFixed(1)} กม.) — ข้อมูลผิดปกติ`,
    });
  }

  const mainRoute = primaryRoute(gis);
  if (mainRoute && mainRoute.roadCircuityRatio > 3) {
    items.push({
      code: "V14",
      id: "3.1",
      tone: "info",
      text: `ค่าความคดเคี้ยวของเส้นทาง (RCR ${mainRoute.roadCircuityRatio.toFixed(2)}) สูงกว่า 3.0 ควรตรวจสอบเส้นทางที่ใช้จริง`,
    });
  }

  // V03 — เวลาเดินทางที่กรอกเอง สูงกว่าค่าที่คำนวณจากพิกัด (GIS) เกิน 50% (สเปก §8.5, ตัวชี้วัด 3.1/3.3)
  //  เทียบนาทีที่ผู้ใช้กรอกกับ travelTimeMin ของเส้นทางเดียวกับที่ deriveD3Responses ใช้
  //  ถ้า apply v2 แล้ว ค่าจะเท่ากัน (ไม่ติดธง) — ธงนี้จับเฉพาะกรณีกรอกเองแล้วสูงกว่า GIS มาก
  const V03_OVER_RATIO = 1.5; // เกิน 50%
  const V03_MIN_REF_MIN = 5; // ข้ามเส้นทางสั้นมาก (<5 นาที) — ส่วนต่างเป็น % ไม่มีนัยสำคัญ
  const travelChecks: { id: IndicatorId; route: GisRouteAnalysis | null; label: string }[] = [
    { id: "3.1", route: primaryRoute(gis), label: "อำเภอ/เขต/ศาลากลาง" },
    { id: "3.3", route: hospitalRoute(gis), label: "สถานพยาบาล" },
  ];
  for (const chk of travelChecks) {
    const ref = chk.route?.travelTimeMin ?? null;
    const manualRaw = state.responses[chk.id]?.minutes;
    if (ref === null || ref < V03_MIN_REF_MIN || isBlank(manualRaw)) continue;
    const manual = Number(manualRaw);
    if (!Number.isFinite(manual) || manual <= 0 || manual <= ref * V03_OVER_RATIO) continue;
    const overPct = Math.round(((manual - ref) / ref) * 100);
    items.push({
      code: "V03",
      id: chk.id,
      tone: "warn",
      text: `เวลาเดินทางที่กรอก (${manual} นาที) ไป${chk.label} สูงกว่าค่าที่คำนวณจากพิกัด GIS (${ref.toFixed(0)} นาที) ถึง ${overPct}% — ควรตรวจสอบเวลาที่กรอก`,
    });
  }

  const gisSeverity = derive32Severity(gis);
  const manualLevel = Number(state.responses["3.2"]?.level);
  if (gisSeverity !== null && !isBlank(state.responses["3.2"]?.level) && Number.isFinite(manualLevel)) {
    if (gisSeverity - manualLevel >= 2) {
      items.push({
        code: "V19",
        id: "3.2",
        tone: "warn",
        text: `ผล GIS บ่งชี้ความยากลำบากในการเข้าถึงระดับ ${gisSeverity} แต่เลือกไว้เพียงระดับ ${manualLevel} — ควรตรวจทานว่าเลือกต่ำเกินจริงหรือไม่`,
      });
    } else if (manualLevel - gisSeverity >= 2) {
      items.push({
        code: "V20",
        id: "3.2",
        tone: "warn",
        text: `เลือกความยากลำบากในการเข้าถึงระดับ ${manualLevel} แต่ผล GIS บ่งชี้เพียงระดับ ${gisSeverity} — ควรแนบหลักฐานประกอบเพิ่มเติม`,
      });
    }
  }

  return items;
}

/** V21 / V22 / V23 — จำแนกชุมชน 3 แกน ประกอบดุลยพินิจ */
export function communityFlags(state: AssessmentState): Flag[] {
  const gis = state.gis;
  if (!gis) return [];

  const items: Flag[] = [];
  // คำนวณสดทุกครั้ง — เกณฑ์ cc-3/WSC proxy/ธงใหม่ต้องไม่พึ่ง JSON เก่าที่ยังไม่มี wscProxy
  const cc = computeCommunityClass(gis);
  const gisSeverity = derive32Severity(gis);
  const manualLevel = Number(state.responses["3.2"]?.level);

  if (
    cc.composite.key === "flat_normal" &&
    !isBlank(state.responses["3.2"]?.level) &&
    Number.isFinite(manualLevel) &&
    manualLevel >= 3
  ) {
    items.push({
      code: "V21",
      id: "3.2",
      tone: "warn",
      text: `GIS จำแนกเป็น "${cc.composite.labelTh}" แต่เลือกความยากลำบากในการเข้าถึงระดับ ${manualLevel} — ควรตรวจว่าภูมิประเทศ/เส้นทางสอดคล้องหรือไม่`,
    });
  }

  if (cc.axisA.highland && gisSeverity === 0) {
    items.push({
      code: "V22",
      id: null,
      tone: "info",
      text: `GIS เข้าเกณฑ์พื้นที่สูง (${cc.axisA.reasons[0] ?? cc.composite.labelTh}) แต่การเข้าถึงตามเส้นทางอยู่ในระดับปกติ — อาจเป็นที่สูงที่เดินทางสะดวก ใช้ประกอบดุลยพินิจ`,
    });
  }

  if (cc.axisA.highland && cc.axisC?.tone === "urban") {
    items.push({
      code: "V23",
      id: null,
      tone: "info",
      text: `ความหนาแน่นการตั้งถิ่นฐานเป็น "${cc.axisC.label}" แต่ยังอยู่ในพื้นที่สูง — ความเป็นเมืองไม่ตัดลักษณะพื้นที่สูง/ห่างไกล`,
    });
  }

  // V24 / V25 — WSC proxy 1–5 เทียบแกน A (info เท่านั้น; ชั้นนี้เป็นประมาณจาก slope ไม่ใช่แผนที่ราชการ)
  const wscClass = cc.wscProxy?.class ?? null;
  if (cc.axisA.highland && wscProxySuggestsFlat(wscClass)) {
    items.push({
      code: "V24",
      id: null,
      tone: "info",
      text: `เข้าเกณฑ์พื้นที่สูง (แกน A) แต่ประมาณชั้นลุ่มน้ำเป็น WSC 5 (ลาดน้อย) — อาจเป็นที่ราบสูง/ที่ราบระหว่างเขา ใช้ประกอบดุลยพินิจ (ไม่ใช่ชั้น WSC ทางการ)`,
    });
  }
  if (!cc.axisA.highland && wscProxySuggestsUpland(wscClass)) {
    items.push({
      code: "V25",
      id: null,
      tone: "info",
      text: `ประมาณชั้นลุ่มน้ำเป็น ${cc.wscProxy?.labelTh ?? "WSC 1–2"} แต่ยังไม่เข้าเกตพื้นที่สูง SSRA/HRDI — ลาดชันสูงอาจเป็นเนิน/เชิงเขาต่ำกว่า 500 ม. (proxy ไม่ใช่แผนที่ราชการ)`,
    });
  }

  // แทร็กเกาะ สพฐ. (ประเภท 2) — orthogonal กับเกตความสูง
  if (state.unit.settingType === "เกาะ") {
    items.push({
      code: "V26",
      id: null,
      tone: "info",
      text: `ระบุลักษณะที่ตั้งเป็น "เกาะ" — แทร็กพื้นที่พิเศษ สพฐ. ประเภท 2 (ไม่ใช้ประตูความสูง 500 ม. เป็นเงื่อนไขบังคับ) ใช้ประกอบดุลยพินิจคู่กับแกนการเข้าถึง`,
    });
  }

  return items;
}

/** รวมธง GIS ทั้งหมด (validation + community) — ใช้จาก flags() */
export function allGisFlags(state: AssessmentState): Flag[] {
  return [...gisValidationFlags(state), ...communityFlags(state)];
}
