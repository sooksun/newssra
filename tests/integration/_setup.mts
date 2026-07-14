// Harness สำหรับ integration test ที่แตะ "ของจริง": MySQL จริง + route handler จริง
//   • mock เฉพาะ next/headers (คุม session cookie ที่ getSession() อ่าน) — ที่เหลือรันจริงทั้งหมด
//   • ต้องรันด้วย flag --experimental-test-module-mocks (mock.module) ผ่าน `npm run test:integration`
//   • ถ้าเชื่อม MySQL ไม่ได้ → ทุก test จะถูก skip (ไม่ทำให้ suite ล้ม) เพื่อคงสัญญา "npm test ไม่ต้องมี DB"
//
// สำคัญ: ไฟล์นี้ต้องถูก import ก่อน (เป็น static import แรก) เพื่อให้ mock.module ทำงานก่อน
// route/lib ใด ๆ ที่ดึง next/headers ถูกโหลด — จึง import route แบบ dynamic ภายใน test เท่านั้น

import { mock } from "node:test";
import mysql from "mysql2/promise";
import type { SessionUser } from "../../lib/types.ts";

process.env.DB_HOST ??= "127.0.0.1";
process.env.DB_PORT ??= "3306";
process.env.DB_USER ??= "root";
process.env.DB_PASSWORD ??= "";
process.env.DB_NAME ??= "newssra";
// secret คงที่ (>=16 ตัว, ไม่ใช่ค่า dev default) เพื่อให้ signSession/verifySession ทำงานแบบ deterministic
process.env.AUTH_SECRET ??= "integration-tests-fixed-secret-0123456789abcdef";

// ── mock next/headers: cookies().get(SESSION_COOKIE) คืน token ที่เราเซ็นไว้ ──
let currentToken: string | null = null;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (currentToken ? { name, value: currentToken } : undefined),
      has: () => currentToken !== null,
      set: () => {},
      delete: () => {},
    }),
  },
});

/** ตั้ง session ที่ route จะ "เห็น" (null = ไม่ล็อกอิน) — เซ็น token จริงด้วย signSession */
export async function actAs(user: SessionUser | null): Promise<void> {
  if (!user) {
    currentToken = null;
    return;
  }
  const { signSession } = await import("../../lib/auth.ts");
  currentToken = signSession(user);
}

const dbCfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

/** เชื่อม MySQL ได้ไหม — ใช้ตัดสินว่าจะรันหรือ skip ทั้ง suite */
export async function dbAvailable(): Promise<boolean> {
  try {
    const c = await mysql.createConnection(dbCfg);
    await c.query("SELECT 1");
    await c.end();
    return true;
  } catch {
    return false;
  }
}

/** ลบแถวทดสอบตรง ๆ (เผื่อ cleanup หลุด) ตามคำนำหน้ารหัสโรงเรียน/username ทดสอบ */
export async function rawExec(sql: string, args: unknown[] = []): Promise<void> {
  const c = await mysql.createConnection(dbCfg);
  try {
    await c.query(sql, args);
  } finally {
    await c.end();
  }
}

export async function rawQuery<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
  const c = await mysql.createConnection(dbCfg);
  try {
    const [rows] = await c.query(sql, args);
    return rows as T[];
  } finally {
    await c.end();
  }
}

// session ต้นแบบสำหรับทดสอบขอบเขตการเข้าถึง (รหัสโรงเรียนขึ้นต้น TEST เพื่อ cleanup ง่าย)
export const SESSIONS: Record<"schoolA" | "schoolB" | "admin" | "ssra", SessionUser> = {
  schoolA: { uid: 900001, role: "school", name: "รร.ทดสอบ A", source: "local", schoolCode: "TESTAAAA" },
  schoolB: { uid: 900002, role: "school", name: "รร.ทดสอบ B", source: "local", schoolCode: "TESTBBBB" },
  admin: { uid: 900003, role: "admin", name: "ผู้ดูแลทดสอบ", source: "local", schoolCode: "" },
  ssra: { uid: 900004, role: "ssra_admin", name: "สพฐ.ทดสอบ", source: "local", schoolCode: "" },
};

/** สร้าง NextRequest จำลอง (มี body JSON + header ที่ต้องการ) */
export function jsonRequest(
  NextRequest: typeof import("next/server").NextRequest,
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({ "content-type": "application/json", ...(init.headers ?? {}) });
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** ctx.params ของ route handler (Next 16 = Promise) */
export function ctx(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) };
}
