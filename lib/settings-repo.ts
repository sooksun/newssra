// อ่าน/เขียนค่าตั้งค่าส่วนกลาง — server-only (แตะ MySQL); ค่าที่คืนผ่าน default แล้วเสมอ
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { resolveAppSettings } from "./settings";
import type { AppSettings } from "./settings";

interface SettingRow extends RowDataPacket {
  setting_key: string;
  setting_value: string;
}

/**
 * คืนค่าตั้งค่าทั้งชุด (เติม default ให้ key ที่ยังไม่มีแถว)
 * อ่านไม่ได้ (DB/ตารางมีปัญหา) → คืน default ทั้งชุด เพื่อไม่ให้หน้าที่เรียกใช้ล่ม
 */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const pool = await getPool();
    const [rows] = await pool.query<SettingRow[]>("SELECT setting_key, setting_value FROM app_settings");
    const map: Record<string, string> = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;
    return resolveAppSettings(map);
  } catch (error) {
    console.error("[settings] read failed — ใช้ค่าเริ่มต้นแทน:", error);
    return resolveAppSettings({});
  }
}

/** เขียนค่าเดียว (upsert) — เก็บเป็น "1"/"0"; ผู้เรียกต้อง validate key กับ allowlist มาก่อน */
export async function setAppSetting(key: string, value: boolean): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value ? "1" : "0"],
  );
}
