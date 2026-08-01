// ตรวจว่าเส้นทางรถยนต์ตัดผ่านพรมแดนไทยหรือไม่ — เพื่อไม่ให้ระบบใช้เส้นทางที่วิ่งเข้าประเทศเพื่อนบ้าน
//
// เหตุผลเชิงเกณฑ์: ระยะทาง/เวลาที่นำไปคิดคะแนนด้านที่ 3 ต้องเป็นการเดินทางที่ทำได้จริงในประเทศ
// เส้นทางที่ OSRM เสนอบางเส้นลัดผ่านฝั่งเมียนมา/ลาว ซึ่งใช้เดินทางจริงไม่ได้ (ต้องผ่านด่าน/หนังสือผ่านแดน)
// จึงต้องคัดออกก่อน ไม่ใช่แค่เตือน
//
// วิธี: ตัดกันของส่วนของเส้นตรงบนระนาบ lng/lat — ที่ระยะไม่กี่ร้อยกิโลเมตรความคลาดเคลื่อนจากการ
// ไม่ใช้เรขาคณิตทรงกลมเล็กกว่าความละเอียดของแนวชายแดนเอง (ระยะห่างจุด 300–500 ม.) มาก

import type { LngLat, SharedBordersDoc } from "./borders";

export interface BorderCrossing {
  /** ชื่อประเทศ (อังกฤษ) ตามไฟล์แนวชายแดน */
  country: string;
  /** ชื่อประเทศภาษาไทย — ใช้ในข้อความแจ้งผู้ใช้ */
  countryTh: string;
  /** จุดที่เส้นทางตัดพรมแดน [lng, lat] */
  at: LngLat;
}

/** ขนาดช่องตาราง (องศา) ของดัชนีค้นหาส่วนของแนวชายแดน ~5 กม. */
const CELL_DEG = 0.05;

interface IndexedSegment {
  a: LngLat;
  b: LngLat;
  country: string;
  countryTh: string;
}

interface BorderIndex {
  cells: Map<string, IndexedSegment[]>;
}

// สร้างดัชนีครั้งเดียวต่อชุดข้อมูล — เส้นทางหนึ่งเส้นมีได้หลายพันจุด และแนวชายแดนรวมกันหมื่นกว่าจุด
// การไล่เทียบทุกคู่จะเป็นหลักสิบล้านครั้งต่อเส้น จึงต้องมีดัชนีเชิงพื้นที่
const indexCache = new WeakMap<SharedBordersDoc, BorderIndex>();

function cellKey(cx: number, cy: number): string {
  return `${cx}|${cy}`;
}

function cellRange(min: number, max: number): [number, number] {
  return [Math.floor(min / CELL_DEG), Math.floor(max / CELL_DEG)];
}

function buildIndex(doc: SharedBordersDoc): BorderIndex {
  const cells = new Map<string, IndexedSegment[]>();
  for (const border of doc.borders) {
    for (const chain of border.chains) {
      for (let i = 1; i < chain.length; i += 1) {
        const a = chain[i - 1];
        const b = chain[i];
        const segment: IndexedSegment = { a, b, country: border.name, countryTh: border.nameTh };
        const [x0, x1] = cellRange(Math.min(a[0], b[0]), Math.max(a[0], b[0]));
        const [y0, y1] = cellRange(Math.min(a[1], b[1]), Math.max(a[1], b[1]));
        for (let cx = x0; cx <= x1; cx += 1) {
          for (let cy = y0; cy <= y1; cy += 1) {
            const key = cellKey(cx, cy);
            const bucket = cells.get(key);
            if (bucket) bucket.push(segment);
            else cells.set(key, [segment]);
          }
        }
      }
    }
  }
  return { cells };
}

function orientation(p: LngLat, q: LngLat, r: LngLat): number {
  const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (value > 1e-12) return 1;
  if (value < -1e-12) return -1;
  return 0;
}

function onSegment(p: LngLat, q: LngLat, r: LngLat): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) &&
    q[0] >= Math.min(p[0], r[0]) &&
    q[1] <= Math.max(p[1], r[1]) &&
    q[1] >= Math.min(p[1], r[1])
  );
}

/** ส่วนของเส้นตรง p1p2 กับ q1q2 ตัดกันหรือไม่ (รวมกรณีแตะปลาย/ทับกันบางส่วน) */
export function segmentsIntersect(p1: LngLat, p2: LngLat, q1: LngLat, q2: LngLat): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, q1, p2)) return true;
  if (o2 === 0 && onSegment(p1, q2, p2)) return true;
  if (o3 === 0 && onSegment(q1, p1, q2)) return true;
  if (o4 === 0 && onSegment(q1, p2, q2)) return true;
  return false;
}

/** จุดแรกที่เส้นทางตัดพรมแดน — null = ไม่ตัดเลย (หรือไม่มีข้อมูลแนวชายแดนให้ตรวจ) */
export function findBorderCrossing(route: readonly LngLat[], doc: SharedBordersDoc | null): BorderCrossing | null {
  if (!doc || doc.borders.length === 0 || route.length < 2) return null;

  let index = indexCache.get(doc);
  if (!index) {
    index = buildIndex(doc);
    indexCache.set(doc, index);
  }

  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    if (!Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;

    const [x0, x1] = cellRange(Math.min(a[0], b[0]), Math.max(a[0], b[0]));
    const [y0, y1] = cellRange(Math.min(a[1], b[1]), Math.max(a[1], b[1]));
    const seen = new Set<IndexedSegment>();
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const bucket = index.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (const segment of bucket) {
          if (seen.has(segment)) continue;
          seen.add(segment);
          if (segmentsIntersect(a, b, segment.a, segment.b)) {
            return { country: segment.country, countryTh: segment.countryTh, at: b };
          }
        }
      }
    }
  }
  return null;
}

export interface DomesticRouteSplit<T> {
  /** เส้นทางที่อยู่ในประเทศทั้งเส้น เรียงตามลำดับเดิม */
  domestic: T[];
  /** เส้นทางที่ถูกคัดออก พร้อมจุด/ประเทศที่ตัดผ่าน */
  blocked: { route: T; crossing: BorderCrossing }[];
}

/** แยกเส้นทางที่ใช้ได้ (ไม่ข้ามพรมแดน) ออกจากเส้นทางที่ต้องคัดทิ้ง
 *  ไม่มีข้อมูลแนวชายแดน (doc = null) → ถือว่าใช้ได้ทุกเส้น เพื่อไม่ให้แผนที่ใช้ไม่ได้ทั้งหน้าเพราะไฟล์โหลดไม่ขึ้น */
export function filterDomesticRoutes<T extends { coords: LngLat[] }>(
  routes: readonly T[],
  doc: SharedBordersDoc | null,
): DomesticRouteSplit<T> {
  const domestic: T[] = [];
  const blocked: { route: T; crossing: BorderCrossing }[] = [];
  for (const route of routes) {
    const crossing = findBorderCrossing(route.coords, doc);
    if (crossing) blocked.push({ route, crossing });
    else domestic.push(route);
  }
  return { domestic, blocked };
}

/** ข้อความแจ้งผู้ใช้เมื่อไม่เหลือเส้นทางในประเทศให้ใช้เลย */
export function borderBlockedMessage(crossings: readonly BorderCrossing[]): string {
  const countries = Array.from(new Set(crossings.map((c) => c.countryTh)));
  const list = countries.length > 0 ? countries.join(" / ") : "ประเทศเพื่อนบ้าน";
  return `เส้นทางที่ค้นได้ทุกเส้นตัดผ่านพรมแดน${list} — ระบบไม่ใช้เส้นทางข้ามประเทศ กรุณาย้ายจุดหรือเลือกจุดหมายอื่น`;
}
