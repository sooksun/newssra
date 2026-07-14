import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiRole } from "@/lib/api-auth";
import { countAdmins, findById, updateUser } from "@/lib/users-repo";
import { ROLES } from "@/lib/types";
import type { Role } from "@/lib/types";
import type { UserUpdate } from "@/lib/users-repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// แก้ไขผู้ใช้ (admin เท่านั้น): เปลี่ยนบทบาท / ชื่อแสดง / เปิด-ปิดบัญชี / ตั้งรหัสผ่านใหม่
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole("admin");
  if (!guard.ok) return guard.response;

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });

  let body: { role?: unknown; displayName?: unknown; active?: unknown; password?: unknown; schoolCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const target = await findById(id);
  if (!target) return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });

  const patch: UserUpdate = {};
  if (body.role !== undefined) {
    if (!(ROLES as readonly string[]).includes(body.role as string)) {
      return NextResponse.json({ error: "บทบาทไม่ถูกต้อง" }, { status: 400 });
    }
    patch.role = body.role as Role;
  }
  if (body.displayName !== undefined) {
    patch.displayName = String(body.displayName).slice(0, 120);
  }
  if (body.schoolCode !== undefined) {
    patch.schoolCode = String(body.schoolCode).slice(0, 16);
  }
  if (body.active !== undefined) {
    patch.active = body.active === true;
  }
  if (body.password !== undefined) {
    const password = String(body.password);
    if (password.length < 6) {
      return NextResponse.json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" }, { status: 400 });
    }
    patch.password = password;
  }

  // กันล็อกตัวเองออกจากระบบ: ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ
  const removesActiveAdmin =
    target.role === "admin" && target.active && (patch.role === "school" || patch.role === "ssra_admin" || patch.active === false);
  if (removesActiveAdmin && (await countAdmins(true)) <= 1) {
    return NextResponse.json(
      { error: "ต้องมีผู้ดูแลระบบ (admin) ที่ใช้งานได้อย่างน้อย 1 บัญชี" },
      { status: 400 }
    );
  }

  try {
    const found = await updateUser(id, patch);
    if (!found) return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api] update user failed:", error);
    return NextResponse.json({ error: "แก้ไขผู้ใช้ไม่สำเร็จ" }, { status: 500 });
  }
}
