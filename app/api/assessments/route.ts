import { NextResponse } from "next/server";
import { assessmentForSchoolYear, createAssessment, listAssessments } from "@/lib/repo";
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
  const { uid, role, source, schoolCode } = guard.user;
  const ownerSchoolCode = role === "school" ? schoolCode || null : null;
  const state = makeBlankState();
  try {
    const id = await createAssessment(state, {
      userId: source === "local" ? uid : null,
      schoolCode: ownerSchoolCode,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    // uq_owner_school_year: โรงเรียนนี้มีแบบประเมินของปีนี้อยู่แล้ว (ownerSchoolCode ว่าง/NULL ไม่ชนกัน จึงเช็คคู่กัน)
    if ((error as { code?: string } | null)?.code === "ER_DUP_ENTRY" && ownerSchoolCode) {
      const existing = await assessmentForSchoolYear(ownerSchoolCode, state.unit.year).catch(() => null);
      return NextResponse.json(
        {
          error: `โรงเรียนนี้มีแบบประเมินสำหรับปี ${state.unit.year} อยู่แล้ว ไม่สามารถสร้างซ้ำได้ (1 โรงเรียนสร้างได้ 1 แบบประเมินต่อปี)`,
          assessmentId: existing?.id ?? null,
        },
        { status: 409 }
      );
    }
    console.error("[api] create assessment failed:", error);
    return NextResponse.json({ error: "สร้างแบบประเมินไม่สำเร็จ" }, { status: 500 });
  }
}
