// นับลูกคลื่นภูเขาที่เส้นทางต้องข้ามกว่าจะถึงโรงเรียน — pure ล้วน (client เป็นผู้สุ่มความสูง)
// วัด 3 แนวขนาน: กลางถนน + ซ้าย/ขวา ±200 ม. เพื่อแยก "ข้ามสันเขาจริง" จาก "ถนนเลียบหุบ/เจาะช่องเขา"
// ห้าม import lib/gis.ts (วนกับ sanitizeGis) — import ได้แค่ geometry/morphology/types
//
// สเปก: docs/superpowers/specs/2026-08-08-route-ridge-crossings-design.md

import { haversineM } from "./morphology";

/** ไต่จากหุบ ≥ ค่านี้ + ลงจากยอด ≥ ค่านี้ = ภูเขา 1 ลูก (เท่าเกณฑ์สลับซับซ้อนของธง 8 ทิศ) */
export const RW_PROMINENCE_M = 50;
/** ระยะแนวข้างตั้งฉากจากถนน — ค่าคงที่ ไม่สุ่ม เพื่อให้กดบันทึกซ้ำได้ผลเดิมทุกครั้ง */
export const RW_SIDE_OFFSET_M = 200;
/** ยอดแนวข้างอยู่ห่างยอดแนวกลางตามแนวเส้นไม่เกินนี้ = ยืนยันเป็นสันเขาเดียวกัน */
export const RW_CONFIRM_WINDOW_M = 300;
export const RW_SPACING_M = 50;
export const RW_MAX_POINTS_PER_LINE = 1200;
export const RW_MAX_WAVES_STORED = 30;

const M_PER_DEG_LAT = 111_320;

export interface WaveLinePoint {
  lat: number;
  lng: number;
}

export interface WaveLines {
  /** ระยะสุ่มจริง (ม.) — เส้นยาวเกินเพดานจะกว้างกว่า RW_SPACING_M */
  spacingM: number;
  center: WaveLinePoint[];
  left: WaveLinePoint[];
  right: WaveLinePoint[];
  /** ระยะสะสมตามเส้นทาง (กม.) ต่อ index */
  cumKm: number[];
}

export interface RidgeWave {
  atKm: number;
  elevM: number;
  prominenceM: number;
  confirmed: boolean;
}

export interface RidgeCrossingsResult {
  count: number;
  confirmedCount: number;
  spacingM: number;
  sideOffsetM: number;
  prominenceM: number;
  waves: RidgeWave[];
}

function routeLengthM(coords: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return sum;
}

/** จุดทุก spacing เมตรตามเส้นทาง (interpolate ระหว่าง vertex) */
function resampleByDistance(
  coords: readonly [number, number][],
  spacingM: number,
): { pts: WaveLinePoint[]; cumKm: number[] } {
  const pts: WaveLinePoint[] = [{ lat: coords[0][1], lng: coords[0][0] }];
  const cumKm: number[] = [0];
  let carried = 0;
  let traveled = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng0, lat0] = coords[i - 1];
    const [lng1, lat1] = coords[i];
    const seg = haversineM(lat0, lng0, lat1, lng1);
    if (!(seg > 0)) continue;
    let along = spacingM - carried;
    while (along <= seg) {
      const t = along / seg;
      pts.push({ lat: lat0 + (lat1 - lat0) * t, lng: lng0 + (lng1 - lng0) * t });
      cumKm.push((traveled + along) / 1000);
      along += spacingM;
    }
    carried = seg - (along - spacingM);
    traveled += seg;
  }
  return { pts, cumKm };
}

/**
 * จุด 3 แนว (กลาง/ซ้าย/ขวา) ทุก RW_SPACING_M ตามเส้นทาง — เส้นยาวเกินเพดานขยาย spacing
 * แล้วรายงานระยะจริงใน spacingM; อินพุตใช้ไม่ได้ → null
 */
export function sampleWaveLines(coords: readonly [number, number][]): WaveLines | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lengthM = routeLengthM(coords);
  if (!(lengthM > 0)) return null;
  const spacingM = Math.max(RW_SPACING_M, Math.ceil(lengthM / RW_MAX_POINTS_PER_LINE));
  const { pts: center, cumKm } = resampleByDistance(coords, spacingM);
  if (center.length < 2) return null;

  const left: WaveLinePoint[] = [];
  const right: WaveLinePoint[] = [];
  for (let i = 0; i < center.length; i++) {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(center.length - 1, i + 1)];
    // ทิศเดินหน้าเป็นเวกเตอร์ระนาบเมตร (ชดเชย cos ที่ลองจิจูด) — พอสำหรับ offset ระดับ 200 ม.
    const cos = Math.max(0.01, Math.cos((center[i].lat * Math.PI) / 180));
    let dx = (next.lng - prev.lng) * M_PER_DEG_LAT * cos;
    let dy = (next.lat - prev.lat) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) {
      left.push(center[i]);
      right.push(center[i]);
      continue;
    }
    dx /= len;
    dy /= len;
    // ตั้งฉากซ้ายของทิศเดินหน้า = (-dy, dx)
    const offLatDeg = (dx * RW_SIDE_OFFSET_M) / M_PER_DEG_LAT;
    const offLngDeg = (-dy * RW_SIDE_OFFSET_M) / (M_PER_DEG_LAT * cos);
    left.push({ lat: center[i].lat + offLatDeg, lng: center[i].lng + offLngDeg });
    right.push({ lat: center[i].lat - offLatDeg, lng: center[i].lng - offLngDeg });
  }
  return { spacingM, center, left, right, cumKm };
}

/** median หน้าต่าง 3 — spike ของ DEM หายโดยตำแหน่งยอดไม่เลื่อน */
function median3(values: readonly number[]): number[] {
  return values.map((v, i) => {
    const a = values[Math.max(0, i - 1)];
    const c = values[Math.min(values.length - 1, i + 1)];
    return [a, v, c].sort((x, y) => x - y)[1];
  });
}

interface ProfilePeak {
  index: number;
  elevM: number;
  prominenceM: number;
}

/**
 * เดินโปรไฟล์แบบ hysteresis: จำหุบต่ำสุดตั้งแต่ปิดลูกก่อนหน้า, เข้าสถานะไต่เมื่อสูงกว่าหุบ
 * ≥ prominence, ปิดลูกเมื่อลงจากยอด ≥ prominence; จบเส้นขณะไต่ = ลูกท้ายเส้น (เขาของโรงเรียนเอง)
 */
function findPeaks(elev: readonly number[], prominenceM: number): ProfilePeak[] {
  const peaks: ProfilePeak[] = [];
  if (elev.length === 0) return peaks;
  let valley = elev[0];
  let peak = elev[0];
  let peakIndex = 0;
  let climbing = false;
  for (let i = 1; i < elev.length; i++) {
    const v = elev[i];
    if (!climbing) {
      if (v < valley) valley = v;
      if (v - valley >= prominenceM) {
        climbing = true;
        peak = v;
        peakIndex = i;
      }
    } else {
      if (v > peak) {
        peak = v;
        peakIndex = i;
      }
      if (peak - v >= prominenceM) {
        peaks.push({ index: peakIndex, elevM: peak, prominenceM: peak - valley });
        valley = v;
        climbing = false;
      }
    }
  }
  if (climbing) peaks.push({ index: peakIndex, elevM: peak, prominenceM: peak - valley });
  return peaks;
}

/**
 * แนวข้างที่มี null (จุดที่สุ่มความสูงไม่สำเร็จ): แทนด้วยค่าล่าสุดที่วัดได้ กันยอดปลอมจากรอยต่อ
 * วัดได้ไม่ถึงครึ่งแนว → null ทั้งแนว (ไม่น่าเชื่อพอจะยืนยันสันเขา)
 */
function fillNulls(values: readonly (number | null)[]): number[] | null {
  let last: number | null = null;
  let known = 0;
  const out: number[] = [];
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) {
      last = v;
      known++;
    }
    out.push(last ?? 0);
  }
  return known * 2 >= values.length ? out : null;
}

export function countRidgeCrossings(
  lines: WaveLines,
  centerElev: readonly number[],
  leftElev: readonly (number | null)[],
  rightElev: readonly (number | null)[],
): RidgeCrossingsResult {
  const centerPeaks = findPeaks(median3(centerElev), RW_PROMINENCE_M);

  const sidePeakIndices: number[] = [];
  for (const side of [leftElev, rightElev]) {
    const filled = fillNulls(side);
    if (!filled) continue;
    for (const p of findPeaks(median3(filled), RW_PROMINENCE_M)) sidePeakIndices.push(p.index);
  }

  const windowIdx = Math.max(1, Math.round(RW_CONFIRM_WINDOW_M / lines.spacingM));
  const waves: RidgeWave[] = centerPeaks.map((p) => ({
    atKm: Math.round((lines.cumKm[Math.min(p.index, lines.cumKm.length - 1)] ?? 0) * 10) / 10,
    elevM: Math.round(p.elevM),
    prominenceM: Math.round(p.prominenceM),
    confirmed: sidePeakIndices.some((si) => Math.abs(si - p.index) <= windowIdx),
  }));

  return {
    count: waves.length,
    confirmedCount: waves.filter((w) => w.confirmed).length,
    spacingM: lines.spacingM,
    sideOffsetM: RW_SIDE_OFFSET_M,
    prominenceM: RW_PROMINENCE_M,
    waves: waves.slice(0, RW_MAX_WAVES_STORED),
  };
}
