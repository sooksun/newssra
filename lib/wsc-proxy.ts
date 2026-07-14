// ประมาณชั้นลุ่มน้ำ WSC 1–5 จากความลาดชัน (+ ความสูงประกอบ) — pure, ไม่มี raster ทางการ
// แหล่งแนวคิด: Tongdeenok 2023 / ชั้นคุณภาพลุ่มน้ำแห่งชาติ (slope-centred illustrative bands)
// สำคัญ: นี่คือ proxy ในแอป ห้ามเรียกว่า "ชั้นลุ่มน้ำราชการ" — แผนที่ WSC จริงใช้โมเดล multivariate

export type WscClass = 1 | 2 | 3 | 4 | 5;

export interface WscProxyResult {
  class: WscClass;
  labelTh: string;
  /** บอกชัดว่าเป็นประมาณการ ไม่ใช่ชั้นทางการ */
  hint: string;
  meanSlopePct: number | null;
  schoolElevationM: number | null;
}

/** ป้ายสั้นต่อชั้น — ใช้ UI / dashboard */
export const WSC_CLASS_LABELS: Record<WscClass, string> = {
  1: "WSC 1 — ภูเขาสูง/ต้นน้ำ (เปราะบางมาก)",
  2: "WSC 2 — ภูเขาสูง/สันเขา",
  3: "WSC 3 — ลาดเขา/เชิงเขา",
  4: "WSC 4 — เนิน/ที่ลุ่มเชิงเขา",
  5: "WSC 5 — พื้นราบ/ลาดน้อย (ค่าเริ่มต้นพื้นราบ)",
};

/**
 * แบ่งชั้นจากความลาดชันเฉลี่ย (เปอร์เซ็นต์) — ช่วงไม่ทับกัน
 * ปรับจากช่วงเชิงพรรณนาในเอกสาร (1:>50 · 2:~30–50 · 3:~25–35 · 4:~6–25 · 5:<~5)
 * ให้เป็นเกณฑ์ proxy ที่ทดสอบได้
 */
export function estimateWscClass(input: {
  meanSlopePct: number | null;
  schoolElevationM?: number | null;
}): WscProxyResult | null {
  const slope =
    input.meanSlopePct !== null &&
    input.meanSlopePct !== undefined &&
    Number.isFinite(input.meanSlopePct) &&
    input.meanSlopePct >= 0
      ? input.meanSlopePct
      : null;
  if (slope === null) return null;

  const elev =
    input.schoolElevationM !== null &&
    input.schoolElevationM !== undefined &&
    Number.isFinite(input.schoolElevationM)
      ? input.schoolElevationM
      : null;

  let cls: WscClass;
  // ภูเขาสูงมาก + ลาดปานกลางขึ้นไป ดึงเข้าชั้น 1 (โครงสร้าง upland ใกล้ต้นน้ำ)
  if (slope > 50 || (elev !== null && elev >= 1000 && slope >= 35)) {
    cls = 1;
  } else if (slope >= 35) {
    cls = 2;
  } else if (slope >= 20) {
    cls = 3;
  } else if (slope >= 6) {
    cls = 4;
  } else {
    cls = 5;
  }

  return {
    class: cls,
    labelTh: WSC_CLASS_LABELS[cls],
    hint:
      "ประมาณจากความลาดชันเฉลี่ยรอบจุด (และความสูงประกอบ) — ไม่ใช่ชั้นลุ่มน้ำราชการจากแผนที่ WSC เต็มรูปแบบ",
    meanSlopePct: Math.round(slope * 10) / 10,
    schoolElevationM: elev !== null ? Math.round(elev) : null,
  };
}

/** true ถ้าชั้น proxy ชี้โครงสร้างพื้นที่สูง/เปราะบาง (WSC 1–2) — ใช้ info flag เท่านั้น */
export function wscProxySuggestsUpland(cls: WscClass | null | undefined): boolean {
  return cls === 1 || cls === 2;
}

/** true ถ้าชั้น proxy ชี้พื้นราบ/ลาดน้อย (WSC 5) */
export function wscProxySuggestsFlat(cls: WscClass | null | undefined): boolean {
  return cls === 5;
}
