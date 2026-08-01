import type { GisRouteHighestPoint } from "../types";

export type RouteCoordinate = [number, number];

/** จุดสูงสุดบนเส้นทาง — ใช้ type เดียวกับ GisRouteAnalysis.highestPoint เพื่อให้บันทึกลงแบบประเมินได้ตรงกันเป๊ะ */
export type RouteElevationPoint = GisRouteHighestPoint;

export interface RouteElevationProfile {
  schoolElevationM: number | null;
  highestPoint: RouteElevationPoint | null;
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
