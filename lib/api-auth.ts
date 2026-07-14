// ตัวช่วยตรวจสิทธิ์สำหรับ API route handlers (node runtime)
// รูปแบบผลลัพธ์: { ok:true, user } หรือ { ok:false, response } เพื่อให้ route คืน response ได้ทันที

import { NextResponse } from "next/server";
import { canAccessAssessment, getSession } from "./auth";
import { getAssessmentOwnerSchoolCode } from "./repo";
import type { Role, SessionUser } from "./types";

type Guard = { ok: true; user: SessionUser } | { ok: false; response: NextResponse };

/** ต้องเข้าสู่ระบบ — ไม่มี session → 401 */
export async function requireApiUser(): Promise<Guard> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  return { ok: true, user };
}

/** ต้องเข้าสู่ระบบ + บทบาทตรงตามที่กำหนด — บทบาทไม่ตรง → 403 */
export async function requireApiRole(...roles: Role[]): Promise<Guard> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard;
  if (!roles.includes(guard.user.role)) {
    return { ok: false, response: NextResponse.json({ error: "ไม่มีสิทธิ์ดำเนินการนี้" }, { status: 403 }) };
  }
  return guard;
}

/** ต้องเข้าสู่ระบบ + มีสิทธิ์เข้าถึงแบบประเมิน id นั้น (school = เฉพาะโรงเรียนตน) */
export async function requireAssessmentAccess(id: number): Promise<Guard> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard;

  const ownerSchoolCode = await getAssessmentOwnerSchoolCode(id);
  if (ownerSchoolCode === undefined) {
    return { ok: false, response: NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 }) };
  }
  if (!canAccessAssessment(guard.user, ownerSchoolCode)) {
    return { ok: false, response: NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงแบบประเมินนี้" }, { status: 403 }) };
  }
  return { ok: true, user: guard.user };
}
