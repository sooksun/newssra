import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiRole } from "@/lib/api-auth";
import { createUser, listUsers } from "@/lib/users-repo";
import { ROLES } from "@/lib/types";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,64}$/;

export async function GET() {
  const guard = await requireApiRole("admin");
  if (!guard.ok) return guard.response;
  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error("[api] list users failed:", error);
    return NextResponse.json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireApiRole("admin");
  if (!guard.ok) return guard.response;

  let body: { username?: unknown; password?: unknown; role?: unknown; displayName?: unknown; schoolCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = body.role as Role;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 120) : "";
  const schoolCode = typeof body.schoolCode === "string" ? body.schoolCode.trim().slice(0, 16) : null;

  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json(
      { error: "ชื่อบัญชีต้องยาว 3–64 ตัว ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด, ขีดล่าง" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" }, { status: 400 });
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: "บทบาทไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const id = await createUser({ username, password, role, displayName: displayName || username, schoolCode });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "DUP") {
      return NextResponse.json({ error: "ชื่อบัญชีนี้มีอยู่แล้ว" }, { status: 409 });
    }
    console.error("[api] create user failed:", error);
    return NextResponse.json({ error: "สร้างผู้ใช้ไม่สำเร็จ" }, { status: 500 });
  }
}
