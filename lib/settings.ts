// ค่าตั้งค่าส่วนกลางของระบบ (admin ตั้ง มีผลทุกคน) — pure/client-safe
// ห้าม import lib/db.ts / lib/repo.ts / node:* เพราะ client component ใช้ label/description ด้วย
// เพิ่ม toggle ใหม่ = เพิ่ม entry ใน APP_SETTING_DEFS (ไม่ต้องแก้ schema — ตารางเป็น key/value)

export interface AppSettingDef {
  key: string;
  /** ป้ายไทยในหน้าตั้งค่า */
  label: string;
  /** คำอธิบายใต้ป้าย */
  description: string;
  /** ค่าที่ใช้เมื่อยังไม่มีแถวในตาราง */
  defaultValue: boolean;
}

export const SETTING_MAP_SHOW_PLACE_SEARCH = "map.showPlaceSearch";

export const APP_SETTING_DEFS: readonly AppSettingDef[] = [
  {
    key: SETTING_MAP_SHOW_PLACE_SEARCH,
    label: "แสดงช่องค้นหาสถานที่บนแผนที่",
    description:
      "ปิดเพื่อไม่ให้ผู้ใช้ค้นหาสถานที่เพื่อย้ายจุดวิเคราะห์ (ยังลากหมุดแดงบนแผนที่ได้ตามปกติ)",
    defaultValue: true,
  },
];

/** key → ค่าที่ผ่าน default แล้ว */
export type AppSettings = Record<string, boolean>;

export function isAppSettingKey(key: string): boolean {
  return APP_SETTING_DEFS.some((d) => d.key === key);
}

/** เก็บในฐานข้อมูลเป็น "1"/"0" — ค่าอื่นหรือไม่มีแถว ให้ใช้ default */
export function parseSettingValue(raw: string | undefined, def: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return def;
}

/** เติม default ให้ทุก key ใน allowlist และละทิ้งแถวที่ไม่รู้จัก */
export function resolveAppSettings(rows: Record<string, string>): AppSettings {
  const out: AppSettings = {};
  for (const def of APP_SETTING_DEFS) {
    out[def.key] = parseSettingValue(rows[def.key], def.defaultValue);
  }
  return out;
}
