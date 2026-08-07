// ชั้น A — สภาพพื้นที่ป่า (Forest Status / Cover)
// pure, client+server safe — ห้าม import cesium / next / node fs
//
// รับ polygon ชั้นป่า (นิยามกรมป่าไม้: ป่าจริง ไม่นับสวนยาง/ผลไม้) แล้วคำนวณ
// inside · distance · % ในรัศมี 1/3/5 กม.
//
// ข้อมูลจริง: วางไฟล์ตาม data/forest-status/ (ดู README) — โมดูลนี้ไม่ดึง RFD เอง
// สเปก: docs/superpowers/specs/2026-08-07-forest-three-layers-highland-design.md

import type { ForestStatusLayer } from "../forest-layers";
import { FOREST_CONTEXT_RADII_M } from "../forest-layers";
import { pointInPolygon } from "./geometry";
import { haversineM } from "./morphology";
import { distancePointToRingM, type LngLat } from "./forestBoundaries";

const MIN_RING_POINTS = 4;

/** ชิ้นส่วนผืนป่าหนึ่งก้อน (outer rings; ไม่รองรับ hole ในเฟสนี้) */
export interface ForestCoverFeature {
  /** วง [lng,lat][] */
  rings: LngLat[][];
  /** รหัสชนิดป่า (ถ้าชั้นรวม type) */
  typeCode?: string | null;
  /** ป้ายชนิดป่าไทย */
  typeLabelTh?: string | null;
}

/** เอกสาร tile/cell ชั้นสถานภาพป่า */
export interface ForestStatusDoc {
  attribution: string;
  dataSource: string;
  /** ปี พ.ศ. ของชั้น (เช่น 2568) */
  yearBe: number;
  authority: "rfd-forest-cover" | "rfd-national-reserved-forest";
  /** legal-reserve-boundary = แนวเขตป่าสงวน (ไม่ใช่สถานภาพป่าจริง) */
  layerRole?: "forest-cover" | "legal-reserve-boundary" | string | null;
  gridResolutionM?: number | null;
  /**
   * true = ยืนยันแล้วว่าชุดข้อมูลติดตั้งครบทั้งพื้นที่ที่ค้นหา (จาก manifest ของชุดข้อมูล)
   * จึงแปล "ไม่พบ polygon" ว่า "ไม่มีป่าแถวนี้จริง" ได้ — ไม่ใช่ "ข้อมูลขาด"
   * ไม่มีค่า/false = ยังยืนยันไม่ได้ ต้องตอบว่าไม่ทราบ ห้ามเดาว่าไม่มีป่า
   */
  coverageConfirmed?: boolean;
  features: ForestCoverFeature[];
}

export const FOREST_STATUS_SAMPLE_RINGS = 6; // วงในจานสำหรับประมาณ %
export const FOREST_STATUS_SAMPLE_RAYS = 16; // รัศมีต่อวง → รวม ~1 + 6*16 จุด

function toLngLat(raw: unknown): LngLat | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lng = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 2) return ring;
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring;
}

function ringToLatLng(ring: LngLat[]): [number, number][] {
  return openRing(ring).map(([lng, lat]) => [lat, lng]);
}

/** ตรวจและ parse เอกสารชั้นสถานภาพ — ทิ้ง geometry ใช้ไม่ได้ */
export function parseForestStatusDoc(raw: unknown): ForestStatusDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  const yearBe = Number(doc.yearBe);
  if (!Number.isFinite(yearBe) || yearBe < 2500 || yearBe > 2700) return null;

  const authorityRaw = typeof doc.authority === "string" ? doc.authority : "rfd-forest-cover";
  const authority =
    authorityRaw === "rfd-national-reserved-forest" ? "rfd-national-reserved-forest" : "rfd-forest-cover";

  const list = Array.isArray(doc.features) ? doc.features : [];
  const features: ForestCoverFeature[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const ringsRaw = Array.isArray(item.rings) ? item.rings : [];
    const rings: LngLat[][] = [];
    for (const ring of ringsRaw) {
      const pts = (Array.isArray(ring) ? ring : []).map(toLngLat).filter((p): p is LngLat => p !== null);
      if (pts.length >= MIN_RING_POINTS) rings.push(pts);
    }
    if (rings.length === 0) continue;
    features.push({
      rings,
      typeCode: typeof item.typeCode === "string" ? item.typeCode.slice(0, 40) : null,
      typeLabelTh: typeof item.typeLabelTh === "string" ? item.typeLabelTh.slice(0, 100) : null,
    });
  }
  if (features.length === 0) return null;

  return {
    attribution: typeof doc.attribution === "string" ? doc.attribution.slice(0, 300) : "กรมป่าไม้",
    dataSource:
      typeof doc.dataSource === "string" ? doc.dataSource.slice(0, 300) : "แผนที่สภาพพื้นที่ป่าไม้ (กรมป่าไม้)",
    yearBe: Math.round(yearBe),
    authority,
    ...(doc.coverageConfirmed === true ? { coverageConfirmed: true as const } : {}),
    layerRole: typeof doc.layerRole === "string" ? doc.layerRole : null,
    gridResolutionM:
      typeof doc.gridResolutionM === "number" && Number.isFinite(doc.gridResolutionM)
        ? Math.round(doc.gridResolutionM)
        : null,
    features,
  };
}

/**
 * ดัชนีวงพิกัดที่แปลงเป็น [lat,lng] แล้ว พร้อมกรอบสี่เหลี่ยมล้อม — สร้างครั้งเดียวต่อชุด features
 *
 * จำเป็นต่อสมรรถนะ ไม่ใช่การปรับจูนเล็กน้อย: ชั้นสภาพป่าทั้งประเทศมีหลายแสน vertex และ
 * `forestPctInRadius` ทดสอบเกือบ 100 จุดต่อรัศมี × 3 รัศมี ถ้าแปลงพิกัดใหม่ทุกครั้งที่ทดสอบจุด
 * จะกลายเป็นการจัดสรรหน่วยความจำนับร้อยล้านครั้ง (วัดได้จริง 14.7 วินาทีต่อคำขอที่เชียงใหม่)
 *
 * ใช้ WeakMap คีย์ด้วยตัวอาร์เรย์ features เอง จึงถูกเก็บกวาดเมื่อเอกสารถูกทิ้ง
 */
interface IndexedRing {
  /** [lat,lng] สำหรับ pointInPolygon */
  points: [number, number][];
  /** [lng,lat] สำหรับ distancePointToRingM (รูปแบบเดิมของ forestBoundaries) */
  lngLat: LngLat[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const ringIndexCache = new WeakMap<readonly ForestCoverFeature[], IndexedRing[]>();

function indexRings(features: readonly ForestCoverFeature[]): IndexedRing[] {
  const cached = ringIndexCache.get(features);
  if (cached) return cached;

  const indexed: IndexedRing[] = [];
  for (const f of features) {
    for (const ring of f.rings) {
      const points = ringToLatLng(ring);
      if (points.length < 3) continue;
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;
      for (const [lat, lng] of points) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
      indexed.push({ points, lngLat: openRing(ring), minLat, maxLat, minLng, maxLng });
    }
  }
  ringIndexCache.set(features, indexed);
  return indexed;
}

/** จุดอยู่ในผืนป่าอย่างน้อยหนึ่งก้อนหรือไม่ */
export function pointInForestCover(lat: number, lng: number, features: readonly ForestCoverFeature[]): boolean {
  for (const ring of indexRings(features)) {
    // กรอบสี่เหลี่ยมก่อน: ตัดวงที่เป็นไปไม่ได้ออกด้วยการเทียบ 4 ครั้ง แทนการไล่ทุกด้านของรูป
    if (lat < ring.minLat || lat > ring.maxLat || lng < ring.minLng || lng > ring.maxLng) continue;
    if (pointInPolygon([lat, lng], ring.points)) return true;
  }
  return false;
}

/** ระยะจากจุดถึงกรอบสี่เหลี่ยม (องศา) — ขอบล่างของระยะจริงถึงวง ใช้ตัดวงที่ไกลเกินออกก่อนคำนวณจริง */
function bboxGapDeg(lat: number, lng: number, ring: IndexedRing): number {
  const dLat = lat < ring.minLat ? ring.minLat - lat : lat > ring.maxLat ? lat - ring.maxLat : 0;
  const dLng = lng < ring.minLng ? ring.minLng - lng : lng > ring.maxLng ? lng - ring.maxLng : 0;
  return Math.hypot(dLat, dLng);
}

/** ระยะถึงขอบป่าใกล้สุด (ม.); อยู่ในป่า → 0 */
export function distanceToForestCoverM(lat: number, lng: number, features: readonly ForestCoverFeature[]): number {
  if (pointInForestCover(lat, lng, features)) return 0;
  const rings = indexRings(features);
  // เรียงตามระยะขั้นต่ำจากกรอบก่อน เพื่อให้ได้ค่าที่ดีเร็วและตัดวงที่เหลือทิ้งได้มาก
  const order = rings.map((ring, i) => ({ i, gap: bboxGapDeg(lat, lng, ring) })).sort((a, b) => a.gap - b.gap);

  const M_PER_DEG = 111_320; // ใช้ประมาณค่าเพื่อ "ตัดทิ้ง" เท่านั้น ระยะจริงยังคำนวณด้วย haversine
  let min = Number.POSITIVE_INFINITY;
  for (const { i, gap } of order) {
    // กรอบของวงนี้อยู่ไกลกว่าค่าที่ดีที่สุดแล้ว — วงที่เหลือเรียงไกลกว่านี้ทั้งหมด
    if (gap * M_PER_DEG > min) break;
    const d = distancePointToRingM(lat, lng, rings[i].lngLat);
    if (d < min) min = d;
  }
  return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}

/**
 * ประมาณ % พื้นที่ป่าในรัศมี ด้วยจุดตัวอย่างบนจาน (polar grid)
 * ศูนย์กลาง + rings × rays — แม่นพอสำหรับตัวชี้วัดคัดกรอง ไม่ใช่ cadastral area
 */
export function forestPctInRadius(
  lat: number,
  lng: number,
  radiusM: number,
  features: readonly ForestCoverFeature[],
  options?: { rings?: number; rays?: number },
): number {
  if (!Number.isFinite(radiusM) || radiusM <= 0 || features.length === 0) return 0;

  const nRings = options?.rings ?? FOREST_STATUS_SAMPLE_RINGS;
  const nRays = options?.rays ?? FOREST_STATUS_SAMPLE_RAYS;
  let hit = 0;
  let total = 0;

  // ศูนย์กลาง
  total += 1;
  if (pointInForestCover(lat, lng, features)) hit += 1;

  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180));

  for (let r = 1; r <= nRings; r++) {
    const dist = (radiusM * r) / nRings;
    for (let k = 0; k < nRays; k++) {
      const bearing = (2 * Math.PI * k) / nRays;
      // equirectangular offset
      const dLat = (dist * Math.cos(bearing)) / mPerDegLat;
      const dLng = (dist * Math.sin(bearing)) / mPerDegLng;
      const plat = lat + dLat;
      const plng = lng + dLng;
      total += 1;
      if (pointInForestCover(plat, plng, features)) hit += 1;
    }
  }

  return Math.round(((100 * hit) / total) * 10) / 10;
}

/** ชนิดป่า ณ จุด (feature แรกที่ทับ) */
export function forestTypeAtPoint(
  lat: number,
  lng: number,
  features: readonly ForestCoverFeature[],
): { typeCode: string | null; typeLabelTh: string | null } | null {
  for (const f of features) {
    for (const ring of f.rings) {
      if (pointInPolygon([lat, lng], ringToLatLng(ring))) {
        return {
          typeCode: f.typeCode ?? null,
          typeLabelTh: f.typeLabelTh ?? null,
        };
      }
    }
  }
  return null;
}

/**
 * คำนวณชั้น Status ครบจากเอกสาร + พิกัดโรงเรียน
 * features ว่าง / พิกัดใช้ไม่ได้ → null (caller ใส่ missing)
 */
export function computeForestStatusLayer(lat: number, lng: number, doc: ForestStatusDoc): ForestStatusLayer | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!doc.features.length) {
    // ไม่พบ polygon: เป็นคำตอบจริง ("ไม่อยู่ในป่า") ก็ต่อเมื่อยืนยันความครอบคลุมของชุดข้อมูลแล้วเท่านั้น
    if (doc.coverageConfirmed !== true) return null;
    return {
      inside: 0,
      distanceM: null, // ไกลเกินขอบเขต cell ที่โหลด — ไม่ใช่ 0 และไม่ใช่ "ไม่ทราบ"
      pct1km: 0,
      pct3km: 0,
      pct5km: 0,
      yearBe: doc.yearBe,
      gridResolutionM: doc.gridResolutionM ?? null,
      authority: doc.authority,
      dataSource: doc.dataSource,
      attribution: doc.attribution,
    };
  }

  const inside = pointInForestCover(lat, lng, doc.features) ? 1 : 0;
  const dist = distanceToForestCoverM(lat, lng, doc.features);
  const distanceM = Number.isFinite(dist) && dist < 1e12 ? Math.round(dist) : null;

  const [r1, r3, r5] = FOREST_CONTEXT_RADII_M;
  return {
    inside,
    distanceM,
    pct1km: forestPctInRadius(lat, lng, r1, doc.features),
    pct3km: forestPctInRadius(lat, lng, r3, doc.features),
    pct5km: forestPctInRadius(lat, lng, r5, doc.features),
    yearBe: doc.yearBe,
    gridResolutionM: doc.gridResolutionM ?? null,
    authority: doc.authority,
    dataSource: doc.dataSource,
    attribution: doc.attribution,
  };
}

/** รวม features จากหลาย cell (dedupe ไม่ทำ — ซ้อนทับนับซ้ำใน point-in โอเค) */
export function mergeForestStatusDocs(docs: readonly ForestStatusDoc[]): ForestStatusDoc | null {
  if (!docs.length) return null;
  const features = docs.flatMap((d) => d.features);
  if (!features.length) return null;
  const first = docs[0];
  return {
    attribution: first.attribution,
    dataSource: first.dataSource,
    yearBe: first.yearBe,
    authority: first.authority,
    layerRole: first.layerRole ?? null,
    gridResolutionM: first.gridResolutionM ?? null,
    features,
  };
}

/**
 * คีย์ cell ~0.5° — ใช้จัดไฟล์ data/forest-status/cells/{key}.json
 * ตัวอย่าง: lat 18.8 lng 98.9 → "18.5_98.5"
 */
export function forestStatusCellKey(lat: number, lng: number, cellDeg = 0.5): string {
  const step = cellDeg;
  const latCell = Math.floor(lat / step) * step;
  const lngCell = Math.floor(lng / step) * step;
  // ปัดทศนิยมกัน -0
  const fmt = (n: number) => (Object.is(n, -0) ? 0 : n).toFixed(1);
  return `${fmt(latCell)}_${fmt(lngCell)}`;
}

/** cell keys ที่ครอบรัศมี (ม.) รอบจุด — สำหรับโหลดหลายไฟล์ */
export function forestStatusCellKeysAround(lat: number, lng: number, radiusM: number, cellDeg = 0.5): string[] {
  const dLat = radiusM / 110_540;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const keys = new Set<string>();
  // มุมสี่มุม + กลาง
  const samples: [number, number][] = [
    [lat, lng],
    [lat + dLat, lng + dLng],
    [lat + dLat, lng - dLng],
    [lat - dLat, lng + dLng],
    [lat - dLat, lng - dLng],
  ];
  for (const [la, ln] of samples) {
    keys.add(forestStatusCellKey(la, ln, cellDeg));
  }
  return [...keys];
}

/** ช่วยเทสต์: สร้างวงสี่เหลี่ยม [lng,lat] รอบจุด */
export function squareRingLngLat(lat: number, lng: number, halfSizeDeg: number): LngLat[] {
  const h = halfSizeDeg;
  return [
    [lng - h, lat - h],
    [lng + h, lat - h],
    [lng + h, lat + h],
    [lng - h, lat + h],
    [lng - h, lat - h],
  ];
}

// re-export haversine for tests that need distance sanity
export { haversineM };
