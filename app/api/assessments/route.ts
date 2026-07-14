import { NextResponse } from "next/server";
import { createAssessment, listAssessments } from "@/lib/repo";
import { requireApiUser } from "@/lib/api-auth";
import { makeBlankState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  try {
    const items = await listAssessments(guard.user);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[api] list assessments failed:", error);
    return NextResponse.json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, { status: 500 });
  }
}

export async function POST() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  try {
    const { uid, role, source, schoolCode } = guard.user;
    const id = await createAssessment(makeBlankState(), {
      userId: source === "local" ? uid : null,
      schoolCode: role === "school" ? schoolCode || null : null,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error("[api] create assessment failed:", error);
    return NextResponse.json({ error: "สร้างแบบประเมินไม่สำเร็จ" }, { status: 500 });
  }
}
