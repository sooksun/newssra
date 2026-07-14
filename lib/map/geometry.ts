// เรขาคณิตพื้นฐานสำหรับ polygon ที่ผู้ใช้วาดเอง — แยกจาก lib/map/morphology.ts (เรื่อง elevation/landform)
// พิกัดทุกจุดเป็น [lat, lng]
import { haversineM } from "./morphology";

/** ray-casting (even-odd rule) — ใช้ lng เป็น x, lat เป็น y (แนบราบพอสำหรับ polygon ≤10 จุด ระยะไม่กี่ กม.) */
export function pointInPolygon(point: [number, number], vertices: [number, number][]): boolean {
  const [py, px] = point;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [yi, xi] = vertices[i];
    const [yj, xj] = vertices[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** จุดศูนย์กลางแบบค่าเฉลี่ยเลขคณิต (ไม่ได้ถ่วงน้ำหนักตามพื้นที่) — พอสำหรับใช้เป็นจุดศูนย์กลาง bounding circle */
export function polygonCentroid(vertices: [number, number][]): [number, number] {
  const sum = vertices.reduce((acc, [lat, lng]) => [acc[0] + lat, acc[1] + lng], [0, 0]);
  return [sum[0] / vertices.length, sum[1] / vertices.length];
}

/** ระยะไกลสุด (haversine) จาก centroid ไปยัง vertex ใดๆ — ใช้เป็นรัศมีคำขอ /api/buildings */
export function polygonBoundingRadiusM(vertices: [number, number][], centroid: [number, number]): number {
  let max = 0;
  for (const [lat, lng] of vertices) {
    const d = haversineM(centroid[0], centroid[1], lat, lng);
    if (d > max) max = d;
  }
  return max;
}

/**
 * พื้นที่ polygon เป็นตารางเมตร (สูตร shoelace บนระนาบ)
 * แปลง lat/lng → เมตรที่ละติจูดกลางของรูป (equirectangular) — แม่นพอสำหรับรูป ≤10 จุด ระยะไม่กี่ กม.
 * รูปที่มี < 3 จุด (ยังปิดไม่ได้) → 0
 */
export function polygonAreaM2(vertices: [number, number][]): number {
  if (vertices.length < 3) return 0;
  const M_PER_DEG_LAT = 111320;
  const latMean = vertices.reduce((sum, [lat]) => sum + lat, 0) / vertices.length;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((latMean * Math.PI) / 180);
  let acc = 0;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i][1] * mPerDegLng;
    const yi = vertices[i][0] * M_PER_DEG_LAT;
    const xj = vertices[j][1] * mPerDegLng;
    const yj = vertices[j][0] * M_PER_DEG_LAT;
    acc += xj * yi - xi * yj;
  }
  return Math.abs(acc) / 2;
}
