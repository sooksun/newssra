// ทะเบียนองค์กรปกครองส่วนท้องถิ่น (อปท.) — โหลดจาก public/geo/lao-offices.json
//
// ไฟล์สร้างโดย scripts/fetch-lao-offices.mjs จากข้อมูลเปิดของกรมส่งเสริมการปกครองท้องถิ่น (สถ.)
// client-safe (ห้าม import cesium) แบบเดียวกับ lib/map/borders.ts
//
// ⚠️ ข้อมูลนี้เป็น "ที่ตั้งสำนักงาน + ขนาดพื้นที่ตามทะเบียน" ไม่ใช่ขอบเขต
// จึงบอกไม่ได้ว่าพิกัดหนึ่งอยู่ในเขต อปท. ใด และ **ห้าม** เอา areaKm2 ไปวาดวงกลมรอบสำนักงาน
// แทนขอบเขต — พื้นที่จริงไม่ได้เป็นวงกลมและสำนักงานก็ไม่ได้อยู่กึ่งกลางเขต

import { haversineM } from "./morphology";

export type LaoKind = "nakhon" | "mueang" | "thesaban_tambon" | "sao" | "special";

export interface LaoOffice {
  code: string;
  kind: LaoKind;
  name: string;
  province: string;
  amphoe: string;
  /** ขนาดพื้นที่ตามทะเบียน (ตร.กม.) — null = ทะเบียนไม่ได้ระบุ */
  areaKm2: number | null;
  lat: number;
  lng: number;
}

export interface LaoOfficeDoc {
  attribution: string;
  /** จำนวน อปท. ในทะเบียนทั้งหมด (รวมที่ไม่มีพิกัดจึงวางหมุดไม่ได้) */
  registeredCount: number;
  offices: LaoOffice[];
}

export interface LaoOfficeNearby extends LaoOffice {
  distanceM: number;
}

export const LAO_KIND_LABELS: Record<LaoKind, string> = {
  nakhon: "เทศบาลนคร",
  mueang: "เทศบาลเมือง",
  thesaban_tambon: "เทศบาลตำบล",
  sao: "อบต.",
  special: "ท้องถิ่นรูปแบบพิเศษ",
};

const LAO_KINDS = new Set<string>(Object.keys(LAO_KIND_LABELS));

/** ตัวเลขที่ใช้ได้จริงเท่านั้น — null/undefined/สตริงว่างต้องเป็น null ไม่ใช่ 0
 *  (Number(null) และ Number("") คืน 0 ซึ่งผ่าน isFinite: ถ้าปล่อยไว้ ทะเบียนที่ไม่ระบุพิกัด
 *  จะกลายเป็นหมุดที่ (0,0) และพื้นที่ที่ไม่ระบุจะแสดงเป็น "0 ตร.กม." ทั้งที่ไม่มีข้อมูล) */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ตรวจไฟล์ที่โหลดมา — แถวที่พิกัด/ประเภทใช้ไม่ได้ถูกทิ้งทั้งแถว (ไม่เดาแทน) */
export function parseLaoOffices(raw: unknown): LaoOfficeDoc {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(doc.offices) ? doc.offices : [];

  const offices = list.flatMap((entry): LaoOffice[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const kind = typeof item.kind === "string" && LAO_KINDS.has(item.kind) ? (item.kind as LaoKind) : null;
    const name = typeof item.name === "string" ? item.name : "";
    const lat = num(item.lat);
    const lng = num(item.lng);
    if (!kind || !name || lat === null || lng === null) return [];
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
    return [
      {
        code: typeof item.code === "string" ? item.code : "",
        kind,
        name,
        province: typeof item.province === "string" ? item.province : "",
        amphoe: typeof item.amphoe === "string" ? item.amphoe : "",
        areaKm2: num(item.areaKm2),
        lat,
        lng,
      },
    ];
  });

  return {
    attribution: typeof doc.attribution === "string" ? doc.attribution : "",
    registeredCount: num(doc.registeredCount) ?? offices.length,
    offices,
  };
}

/** ชื่อเต็มอย่างที่ราชการเรียก — ทะเบียนเก็บชื่อสั้นกับประเภทแยกกัน */
export function laoFullName(office: Pick<LaoOffice, "kind" | "name">): string {
  return office.kind === "sao" ? `อบต.${office.name}` : `${LAO_KIND_LABELS[office.kind]}${office.name}`;
}

/** อปท. ที่สำนักงานอยู่ในรัศมีจากจุดหนึ่ง เรียงจากใกล้ไปไกล */
export function officesNear(
  offices: readonly LaoOffice[],
  lat: number,
  lng: number,
  radiusM: number,
): LaoOfficeNearby[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(radiusM > 0)) return [];
  return offices
    .map((office) => ({ ...office, distanceM: haversineM(lat, lng, office.lat, office.lng) }))
    .filter((office) => office.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

let cache: LaoOfficeDoc | null = null;

export async function loadLaoOffices(signal?: AbortSignal): Promise<LaoOfficeDoc> {
  if (cache) return cache;
  const response = await fetch("/geo/lao-offices.json", { signal });
  if (!response.ok) throw new Error(`โหลดทะเบียน อปท. ไม่สำเร็จ (HTTP ${response.status})`);
  cache = parseLaoOffices(await response.json());
  return cache;
}
