// ระบบยืนยันตัวตน (server-only) — ใช้ node:crypto ล้วน ไม่มี dependency เพิ่ม
// - รหัสผ่าน: scrypt + salt เฉพาะราย เก็บเป็น "scrypt$<saltHex>$<hashHex>"
// - session: cookie ที่เซ็นด้วย HMAC-SHA256 (stateless) รูปแบบ base64url(json).base64url(sig)
// ห้าม import ไฟล์นี้จาก client component (มันดึง next/headers + node:crypto)

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./auth-constants";
import { ROLES } from "./types";
import type { Role, SessionUser } from "./types";

export { SESSION_COOKIE };
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 วัน
const SCRYPT_KEYLEN = 64;

const DEV_FALLBACK_SECRET = "dev-insecure-secret-change-me";

let warnedSecret = false;
function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  const usable = Boolean(secret && secret.length >= 16 && secret !== DEV_FALLBACK_SECRET);
  if (usable) return secret as string;

  // บน production ห้าม fallback เด็ดขาด — session ที่เซ็นด้วยกุญแจที่รู้กันทั่วไปปลอมได้ทันที
  // fail closed: โยน error ให้ทุก request ที่แตะ session ล้มจนกว่าจะตั้งค่า AUTH_SECRET จริง
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[auth] ต้องตั้งค่า AUTH_SECRET (ยาว >= 16 ตัว และไม่ใช่ค่า default) บน production — สร้างด้วย: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  if (!warnedSecret) {
    console.warn(
      "[auth] AUTH_SECRET ไม่ได้ตั้งค่า (หรือสั้นเกินไป) — ใช้ค่า default สำหรับ dev เท่านั้น ห้ามใช้บน production",
    );
    warnedSecret = true;
  }
  return DEV_FALLBACK_SECRET;
}

// ---------- รหัสผ่าน ----------

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const actual = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------- session token ----------

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sign(body: string): string {
  return crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");
}

interface SessionPayload extends SessionUser {
  exp: number;
}

export function signSession(user: SessionUser, ttl = SESSION_TTL_SECONDS): string {
  const payload: SessionPayload = {
    uid: user.uid,
    role: user.role,
    name: user.name,
    source: user.source,
    schoolCode: user.schoolCode,
    exp: nowSeconds() + ttl,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySession(token: string): SessionUser | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = sign(body);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof payload.uid !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp < nowSeconds()) return null;
    if (!(ROLES as readonly string[]).includes(payload.role as string)) return null;
    return {
      uid: payload.uid,
      role: payload.role as Role,
      name: typeof payload.name === "string" ? payload.name : "",
      source: payload.source === "legacy" ? "legacy" : "local",
      schoolCode: typeof payload.schoolCode === "string" ? payload.schoolCode : "",
    };
  } catch {
    return null;
  }
}

// ---------- cookie ----------

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** สร้าง object ให้ NextResponse.cookies.set() ใช้ตอน login */
export function buildSessionCookie(user: SessionUser) {
  return { name: SESSION_COOKIE, value: signSession(user), ...sessionCookieOptions() };
}

/** cookie ว่างสำหรับล้าง session ตอน logout */
export function clearedSessionCookie() {
  return { name: SESSION_COOKIE, value: "", ...sessionCookieOptions(), maxAge: 0 };
}

// ---------- อ่าน session / guard ----------

/** อ่าน session ปัจจุบัน — ใช้ได้ทั้งใน Server Component และ Route Handler (Next 15) */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** สำหรับหน้า (Server Component): ไม่มี session → เด้งไป /login */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/** สำหรับหน้า: บทบาทไม่ตรง → เด้งกลับหน้าแรก */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}

/** school เข้าถึงได้เฉพาะแบบประเมินของโรงเรียนตน (จับคู่ด้วยรหัสโรงเรียน); admin/ssra_admin เข้าถึงได้ทั้งหมด
 *  หมายเหตุ: school ที่ไม่มี schoolCode (ยังไม่ผูกโรงเรียน) จะเข้าถึงไม่ได้เลย — และ null !== "" กัน owner ว่างหลุด */
export function canAccessAssessment(user: SessionUser, ownerSchoolCode: string | null): boolean {
  if (user.role !== "school") return true;
  return user.schoolCode.length > 0 && ownerSchoolCode === user.schoolCode;
}
