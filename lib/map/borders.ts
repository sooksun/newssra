import { haversineM } from "./morphology";

export type LngLat = [number, number];

export interface ThaiSharedBorder {
  name: string;
  nameTh: string;
  label: LngLat;
  chains: LngLat[][];
  pointCount: number;
}

export interface SharedBordersDoc {
  attribution: string;
  borders: ThaiSharedBorder[];
}

const BORDER_ORDER = ["Myanmar", "Laos", "Cambodia", "Malaysia"];

/**
 * แนวชายแดนถูกคำนวณไว้ล่วงหน้าโดย `scripts/fetch-borders.mjs` (ดึงจาก OpenStreetMap
 * ผ่าน Overpass API แล้วลดรูป) ฟังก์ชันนี้จึงมีหน้าที่แค่ตรวจความถูกต้องของไฟล์ที่โหลดมา
 * — ทิ้งพิกัดที่ไม่ใช่ตัวเลขจำกัด และเส้นที่สั้นเกินกว่าจะวาดได้ เพื่อไม่ให้ Cesium พังกลางทาง
 */
export function parseSharedBorders(raw: unknown): SharedBordersDoc {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const attribution = typeof doc.attribution === "string" ? doc.attribution : "";
  const list = Array.isArray(doc.borders) ? doc.borders : [];

  const borders = list.flatMap((entry): ThaiSharedBorder[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "";
    const nameTh = typeof item.nameTh === "string" ? item.nameTh : name;
    const label = toLngLat(item.label);
    if (!name || !label) return [];

    const chains = (Array.isArray(item.chains) ? item.chains : []).flatMap((chain): LngLat[][] => {
      const points = (Array.isArray(chain) ? chain : [])
        .map(toLngLat)
        .filter((point): point is LngLat => point !== null);
      return points.length >= 2 ? [points] : [];
    });
    if (chains.length === 0) return [];

    return [
      {
        name,
        nameTh,
        label,
        chains,
        pointCount: chains.reduce((sum, chain) => sum + chain.length, 0),
      },
    ];
  });

  borders.sort((a, b) => {
    const ai = BORDER_ORDER.indexOf(a.name);
    const bi = BORDER_ORDER.indexOf(b.name);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    }
    return a.name.localeCompare(b.name);
  });

  return { attribution, borders };
}

/**
 * ตำแหน่งวางป้ายชื่อประเทศ `count` จุด ที่อยู่ "บนเส้นชายแดนจริง" และกระจายห่างกันเท่า ๆ กัน
 *
 * แบ่งตาม **ระยะทางสะสมจริง** (haversine) ไม่ใช่ดัชนีจุด — ความหนาแน่นของจุดบนเส้นไม่สม่ำเสมอ
 * (ช่วงที่เส้นคดเคี้ยวมีจุดถี่กว่าช่วงตรงมาก) การหารด้วยจำนวนจุดจะทำให้ป้ายกระจุกอยู่ช่วงที่คดเคี้ยว
 *
 * จุดที่ได้อยู่ที่เศษส่วน i/(count+1) ของความยาวทั้งเส้น — count=3 → 25% / 50% / 75%
 * จึงไม่มีป้ายไปทับปลายเส้น (ซึ่งเป็นจุดสามเหลี่ยมพรมแดนที่ป้ายของสองประเทศจะชนกันพอดี)
 *
 * เส้นหลายท่อน (chains) ถูกนับต่อกันตามลำดับ โดยไม่ลากข้ามช่องว่างระหว่างท่อน — ทุกจุดที่คืนออกมา
 * จึงตกอยู่บนท่อนใดท่อนหนึ่งเสมอ คืน [] เมื่อเส้นสั้นเป็นศูนย์/ไม่มีข้อมูล (ผู้เรียก fallback เอง)
 */
export function borderLabelPoints(border: ThaiSharedBorder, count = 3): LngLat[] {
  if (!Number.isInteger(count) || count < 1) return [];

  // segment ทุกท่อนพร้อมระยะสะสม — เก็บเป็นรายการเดียวเพื่อเดินหาเศษส่วนเป้าหมายได้ในรอบเดียว
  const segments: { from: LngLat; to: LngLat; length: number; startAt: number }[] = [];
  let total = 0;
  for (const chain of border.chains) {
    for (let i = 0; i + 1 < chain.length; i++) {
      const from = chain[i];
      const to = chain[i + 1];
      const length = haversineM(from[1], from[0], to[1], to[0]);
      if (!Number.isFinite(length) || length <= 0) continue;
      segments.push({ from, to, length, startAt: total });
      total += length;
    }
  }
  if (total <= 0 || segments.length === 0) return [];

  const points: LngLat[] = [];
  let cursor = 0; // segment ที่กำลังพิจารณา — เศษส่วนเรียงจากน้อยไปมาก จึงเดินหน้าอย่างเดียวได้
  for (let i = 1; i <= count; i++) {
    const target = (total * i) / (count + 1);
    while (cursor < segments.length - 1 && segments[cursor].startAt + segments[cursor].length < target) {
      cursor++;
    }
    const seg = segments[cursor];
    const t = Math.min(1, Math.max(0, (target - seg.startAt) / seg.length));
    points.push([seg.from[0] + (seg.to[0] - seg.from[0]) * t, seg.from[1] + (seg.to[1] - seg.from[1]) * t]);
  }
  return points;
}

function toLngLat(raw: unknown): LngLat | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lng = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}
