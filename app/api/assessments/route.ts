import { NextResponse } from "next/server";
import { createAssessment, listAssessments } from "@/lib/repo";
import { makeBlankState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listAssessments();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[api] list assessments failed:", error);
    return NextResponse.json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const id = await createAssessment(makeBlankState());
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error("[api] create assessment failed:", error);
    return NextResponse.json({ error: "สร้างแบบประเมินไม่สำเร็จ" }, { status: 500 });
  }
}
