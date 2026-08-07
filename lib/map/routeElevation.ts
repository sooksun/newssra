import type { GisRouteHighestPoint } from "../types";

export type RouteCoordinate = [number, number];

/** จุดสูงสุดบนเส้นทาง — ใช้ type เดียวกับ GisRouteAnalysis.highestPoint เพื่อให้บันทึกลงแบบประเมินได้ตรงกันเป๊ะ */
export type RouteElevationPoint = GisRouteHighestPoint;

export interface RouteElevationProfile {
  schoolElevationM: number | null;
  highestPoint: RouteElevationPoint | null;
  /** สัดส่วนจุดตัวอย่างบนเส้นทางที่อยู่ในระดับภูเขา (%) — null = ไม่มีตัวอย่างที่อ่านค่าได้ */
  mountainPct: number | null;
}

/** ระดับความสูง (ม.) ที่ถือว่าจุดบนเส้นทางเป็น "ภูมิประเทศภูเขา" — ตรงกับ MORPHOLOGY_HIGHLAND_MIN_M */
export const ROUTE_MOUNTAIN_THRESHOLD_M = 500;

/**
 * สัดส่วนของเส้นทางที่ผ่านภูมิประเทศภูเขา (%)
 *
 * ต่างจากจุดสูงสุด (ยอดเดียวบอกไม่ได้ว่าต้องอยู่บนที่สูงนานแค่ไหน) และต่างจากความสูงสะสม
 * (นับเนินเล็ก ๆ รวมกันได้เยอะทั้งที่ไม่เคยขึ้นที่สูงเลย)
 *
 * ค่าที่อ่านไม่ได้ (NaN จากไทล์ DEM ที่โหลดไม่สำเร็จ) ถูกข้าม ไม่นับเป็น 0 ม.
 * ไม่มีตัวอย่างที่ใช้ได้เลย → null (ไม่ทราบ) ไม่ใช่ 0
 */
export function routeMountainPercent(
  heights: ArrayLike<number>,
  thresholdM: number = ROUTE_MOUNTAIN_THRESHOLD_M,
): number | null {
  let usable = 0;
  let mountain = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const value = heights[index];
    if (!Number.isFinite(value)) continue;
    usable += 1;
    if (value >= thresholdM) mountain += 1;
  }
  if (usable === 0) return null;
  return Math.round(((100 * mountain) / usable) * 10) / 10;
}

export function sampleRouteCoordinates(coords: readonly RouteCoordinate[], maxCount: number): RouteCoordinate[] {
  if (!Number.isInteger(maxCount) || maxCount < 2) {
    throw new RangeError("maxCount must be an integer of at least 2");
  }
  if (coords.length <= maxCount) return coords.map(([lng, lat]) => [lng, lat]);

  return Array.from({ length: maxCount }, (_, index) => {
    const sourceIndex = Math.round((index * (coords.length - 1)) / (maxCount - 1));
    const [lng, lat] = coords[sourceIndex];
    return [lng, lat];
  });
}

export function routeElevationSampleCoordinates(
  coords: readonly RouteCoordinate[],
  schoolCoordinate: RouteCoordinate,
  maxCount: number,
): RouteCoordinate[] {
  const sampled = sampleRouteCoordinates(coords, maxCount);
  const school: RouteCoordinate = [schoolCoordinate[0], schoolCoordinate[1]];

  if (sampled.length === 0) return [school];
  sampled[sampled.length - 1] = school;
  return sampled;
}

export function buildRouteElevationProfile(
  coords: readonly RouteCoordinate[],
  heights: ArrayLike<number>,
  options?: { mountainThresholdM?: number },
): RouteElevationProfile {
  let highestPoint: RouteElevationPoint | null = null;
  const pairedLength = Math.min(coords.length, heights.length);

  for (let index = 0; index < pairedLength; index += 1) {
    const elevationM = heights[index];
    if (!Number.isFinite(elevationM)) continue;
    if (!highestPoint || elevationM > highestPoint.elevationM) {
      highestPoint = { lng: coords[index][0], lat: coords[index][1], elevationM };
    }
  }

  const schoolIndex = coords.length - 1;
  const schoolHeight = schoolIndex >= 0 && schoolIndex < heights.length ? heights[schoolIndex] : Number.NaN;
  return {
    schoolElevationM: Number.isFinite(schoolHeight) ? schoolHeight : null,
    highestPoint,
    mountainPct: routeMountainPercent(heights, options?.mountainThresholdM ?? ROUTE_MOUNTAIN_THRESHOLD_M),
  };
}

export function formatElevationMeters(value: number): string {
  return `${Math.round(value).toLocaleString("th-TH")} ม.`;
}

export function formatRouteHighestLabel(value: number): string {
  return `จุดสูงสุดบนเส้นทาง\nระดับความสูง ${formatElevationMeters(value)}`;
}

/** จุดสูงสุดที่ผู้ใช้ชี้เอง (คลิกขวาบนแผนที่) — ดูค่าอย่างเดียว ไม่บันทึกลงฐานข้อมูล */
export interface ManualHighPoint {
  lat: number;
  lng: number;
  /** null = อ่านระดับความสูงจากภูมิประเทศตรงจุดนั้นไม่ได้ (นอกขอบข้อมูล/หมดเวลา) */
  elevationM: number | null;
  /** กำลังสุ่มความสูงจาก terrain provider อยู่ — แยกจากกรณีสุ่มแล้วไม่ได้ค่า */
  sampling?: boolean;
}

/** ข้อความบนป้ายหมุดจุดสูงสุดที่ชี้เอง — ระดับความสูงใช้แหล่งเดียวกับหมุดโรงเรียน/จุดสูงสุดเส้นทาง */
export function formatManualHighPointLabel(point: ManualHighPoint): string {
  if (point.sampling) return "จุดสูงสุด\nกำลังอ่านระดับความสูง…";
  const elevation =
    point.elevationM !== null && Number.isFinite(point.elevationM)
      ? `ระดับความสูง ${formatElevationMeters(point.elevationM)}`
      : "ไม่มีข้อมูลระดับความสูงตรงจุดนี้";
  return `จุดสูงสุด\n${elevation}`;
}
