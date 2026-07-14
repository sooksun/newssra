// Repository ของผู้ใช้ระบบ — จุดเดียวที่แตะตาราง users
// ไม่เก็บข้อมูลส่วนบุคคลของนักเรียน (ตาม PDPA) — มีแค่ชื่อบัญชี/บทบาท/ชื่อแสดง/สถานะ

import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";
import { hashPassword } from "./auth";
import { ROLES } from "./types";
import type { Role, User } from "./types";

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  display_name: string;
  school_code: string | null;
  active: number;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeRole(role: string): Role {
  return (ROLES as readonly string[]).includes(role) ? (role as Role) : "school";
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: normalizeRole(row.role),
    schoolCode: row.school_code ?? null,
    active: row.active === 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const USER_COLUMNS =
  "id, username, password_hash, role, display_name, school_code, active, created_at, updated_at";

/** ใช้ตอน login — คืนทั้ง password_hash เพื่อตรวจรหัสผ่าน */
export async function findByUsername(username: string): Promise<UserRow | null> {
  const pool = await getPool();
  const [rows] = await pool.query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows.length ? rows[0] : null;
}

export async function findById(id: number): Promise<User | null> {
  const pool = await getPool();
  const [rows] = await pool.query<UserRow[]>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function listUsers(): Promise<User[]> {
  const pool = await getPool();
  const [rows] = await pool.query<UserRow[]>(`SELECT ${USER_COLUMNS} FROM users ORDER BY id ASC`);
  return rows.map(rowToUser);
}

export async function countAdmins(activeOnly = true): Promise<number> {
  const pool = await getPool();
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin'${activeOnly ? " AND active = 1" : ""}`
  );
  return rows[0]?.n ?? 0;
}

export interface NewUser {
  username: string;
  password: string;
  role: Role;
  displayName: string;
  schoolCode?: string | null;
}

/** สร้างผู้ใช้ใหม่ — คืน id; โยน error ที่มี code "DUP" ถ้าชื่อบัญชีซ้ำ */
export async function createUser(input: NewUser): Promise<number> {
  const pool = await getPool();
  // school_code เก็บเฉพาะบทบาท school (บทบาทอื่นเห็นทุกโรงเรียนอยู่แล้ว ไม่ต้องผูกรหัส)
  const schoolCode = normalizeRole(input.role) === "school" ? input.schoolCode?.trim() || null : null;
  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO users (username, password_hash, role, display_name, school_code, active) VALUES (?, ?, ?, ?, ?, 1)`,
      [input.username, hashPassword(input.password), normalizeRole(input.role), input.displayName, schoolCode]
    );
    return result.insertId;
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "ER_DUP_ENTRY") {
      const dup = new Error("ชื่อบัญชีนี้มีอยู่แล้ว");
      (dup as Error & { code: string }).code = "DUP";
      throw dup;
    }
    throw error;
  }
}

export interface UserUpdate {
  role?: Role;
  displayName?: string;
  schoolCode?: string | null;
  active?: boolean;
  password?: string;
}

/** แก้ไขผู้ใช้ — อัปเดตเฉพาะฟิลด์ที่ส่งมา; คืน true ถ้าพบแถว */
export async function updateUser(id: number, patch: UserUpdate): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.role !== undefined) {
    sets.push("role = ?");
    values.push(normalizeRole(patch.role));
  }
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    values.push(patch.displayName);
  }
  if (patch.schoolCode !== undefined) {
    sets.push("school_code = ?");
    values.push(patch.schoolCode?.trim() || null);
  }
  if (patch.active !== undefined) {
    sets.push("active = ?");
    values.push(patch.active ? 1 : 0);
  }
  if (patch.password !== undefined) {
    sets.push("password_hash = ?");
    values.push(hashPassword(patch.password));
  }
  if (sets.length === 0) return true;

  const pool = await getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
    [...values, id]
  );
  return result.affectedRows > 0;
}

/** รหัสผ่านตั้งต้นของบัญชี seed — dev ใช้ค่าที่จำง่าย, production ต้องมาจาก env หรือสุ่มให้แข็งแรง
 *  (ห้าม default เป็นค่าที่รู้กันทั่วไปบน production — สร้าง random แล้ว log ครั้งเดียวให้ผู้ดูแลนำไปเปลี่ยน) */
function seedPassword(envValue: string | undefined, username: string, devDefault: string): string {
  if (envValue && envValue.length >= 6) return envValue;
  if (process.env.NODE_ENV === "production") {
    const generated = randomBytes(9).toString("base64url"); // ~12 ตัวอักษร คาดเดายาก
    console.warn(
      `[users] ไม่ได้ตั้งรหัสผ่าน seed ของบัญชี "${username}" บน production — สุ่มให้อัตโนมัติ: ${generated}\n` +
        `        โปรดเข้าสู่ระบบด้วยรหัสนี้แล้วเปลี่ยนทันทีที่หน้า "จัดการผู้ใช้" (ค่านี้จะไม่แสดงอีก)`
    );
    return generated;
  }
  return devDefault;
}

/** สร้างบัญชีผู้ดูแลตั้งต้น (idempotent) — เรียกครั้งแรกที่แอปเชื่อมต่อฐานข้อมูล
 *  หมายเหตุ: บทบาท school ไม่ seed ที่นี่ — โรงเรียนเข้าสู่ระบบผ่านตาราง `user` เดิม (ดู lib/legacy-users-repo.ts) */
export async function seedDefaultUsers(pool: Pool): Promise<void> {
  const seeds: { username: string; role: Role; displayName: string; password: string }[] = [
    { username: "admin", role: "admin", displayName: "ผู้ดูแลระบบ", password: seedPassword(process.env.SEED_ADMIN_PASSWORD, "admin", "admin123") },
    { username: "ssra_admin", role: "ssra_admin", displayName: "เจ้าหน้าที่ สพฐ.", password: seedPassword(process.env.SEED_SSRA_PASSWORD, "ssra_admin", "ssra123") },
  ];
  for (const seed of seeds) {
    // INSERT IGNORE ให้เป็น no-op ถ้าชื่อบัญชีมีอยู่แล้ว (ไม่ทับรหัสผ่านที่ผู้ดูแลอาจเปลี่ยนไปแล้ว)
    await pool.query<ResultSetHeader>(
      `INSERT IGNORE INTO users (username, password_hash, role, display_name, active) VALUES (?, ?, ?, ?, 1)`,
      [seed.username, hashPassword(seed.password), seed.role, seed.displayName]
    );
  }
}
