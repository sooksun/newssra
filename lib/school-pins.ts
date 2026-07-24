// หมุดภาพรวมโรงเรียนบนแผนที่ผู้ดูแล — helper บริสุทธิ์ (client-safe, ไม่แตะ DB/cesium)
// แยกไว้เพื่อทดสอบ mapping สถานะ/พิกัดโดยไม่ต้องพึ่ง DB และไม่ดึง repo (server-only) เข้า test

export type SchoolPinStatus = "draft" | "pass" | "fail";

export interface SchoolPin {
  /** assessment id — ใช้ทำลิงก์ /map?assessment=ID ตอนคลิกหมุด */
  id: number;
  name: string;
  lat: number;
  lng: number;
  status: SchoolPinStatus;
}

/** สถานะหมุดจาก "ส่งแล้วหรือยัง" + ระดับคะแนน (คอลัมน์สรุป level_key)
 *  - ยังไม่ส่ง                       → draft (เทา)
 *  - ส่งแล้ว + คะแนน ≥50 (ไม่ใช่ neutral) → pass  (เขียว, ขึ้นทะเบียนได้)
 *  - ส่งแล้ว + neutral (คะแนน <50)      → fail  (แดง) */
export function schoolPinStatus(args: { submitted: boolean; levelKey: string }): SchoolPinStatus {
  if (!args.submitted) return "draft";
  return args.levelKey === "neutral" ? "fail" : "pass";
}

/** เลือกพิกัดที่ใช้ได้: พิกัดในแบบประเมินก่อน → fallback (ทะเบียนโรงเรียน) → null ถ้าไม่มีเลย
 *  ค่า (0,0) และค่าที่แปลงเป็นตัวเลขไม่ได้ ถือว่า "ไม่มีพิกัด" */
export function resolvePinCoord(
  rawLat: unknown,
  rawLng: unknown,
  fallback: { lat: number; lng: number } | null,
): { lat: number; lng: number } | null {
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng };
  }
  if (
    fallback &&
    Number.isFinite(fallback.lat) &&
    Number.isFinite(fallback.lng) &&
    (fallback.lat !== 0 || fallback.lng !== 0)
  ) {
    return { lat: fallback.lat, lng: fallback.lng };
  }
  return null;
}
