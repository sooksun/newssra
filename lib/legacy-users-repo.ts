// เข้าถึงตารางผู้ใช้เดิม `user` (ระบบ SSRA เดิม) เพื่อให้โรงเรียนเข้าสู่ระบบด้วยบัญชีเดิม
// ⚠️ `user` เป็น reserved word ของ MySQL → ต้องครอบ backtick เสมอ
// ⚠️ รหัสผ่านในตารางนี้เป็น plaintext (5–6 ตัว) ตามระบบเดิม — ตรวจแบบเทียบตรง (ดูหมายเหตุความปลอดภัยใน login route)
// ตารางนี้เป็น read-only สำหรับแอปนี้ (ไม่แก้ไข/ลบ) — มีข้อมูลจริงของสถานศึกษาหลายพันแห่ง

import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";

export interface LegacyUser {
  code: string; // คอลัมน์ `user` — รหัสเข้าสู่ระบบ 8 หลัก (ใช้เป็นรหัสโรงเรียนสำหรับจำกัดขอบเขต)
  name: string; // ชื่อสถานศึกษา
  scId: number | null; // รหัสสถานศึกษาอ้างอิง (sc_id)
  password: string; // plaintext (ระบบเดิม)
}

interface LegacyRow extends RowDataPacket {
  user: string;
  name: string | null;
  sc_id: number | null;
  password: string | null;
}

/** ค้นบัญชีเดิมด้วยรหัสเข้าสู่ระบบ (คอลัมน์ `user`); ไม่พบ/ตารางไม่มี → null */
export async function findLegacyUser(code: string): Promise<LegacyUser | null> {
  const pool = await getPool();
  try {
    const [rows] = await pool.query<LegacyRow[]>(
      "SELECT `user`, name, sc_id, password FROM `user` WHERE `user` = ? LIMIT 1",
      [code],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      code: r.user,
      name: (r.name ?? "").trim() || r.user,
      scId: r.sc_id ?? null,
      password: r.password ?? "",
    };
  } catch (error) {
    // ฐานข้อมูล dev ที่ไม่มีตาราง `user` เดิม → ถือว่าไม่มีบัญชี legacy (ไม่ให้ล้มทั้ง login)
    console.warn("[legacy-users] lookup failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
