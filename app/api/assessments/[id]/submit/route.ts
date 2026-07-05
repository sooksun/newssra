import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, saveAssessment } from "@/lib/repo";
import { canSubmit, levelFor, totalScore } from "@/lib/scoring";
import { sanitizeState } from "@/lib/state";
import type { SubmittedInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// ยื่นแบบประเมิน: server เป็นผู้ตัดสิน canSubmit และออกเลขที่อ้างอิงเอง (client แค่แสดงผล)
export async function POST(request: NextRequest, { params }: Ctx) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  }

  // รับ state ล่าสุดจาก client ถ้าส่งมา (กัน autosave ที่ยังค้างอยู่) ไม่งั้นใช้ของใน DB
  let state = null;
  try {
    const body = (await request.json()) as { state?: unknown };
    if (body?.state) state = sanitizeState(body.state);
  } catch {
    // ไม่มี body ก็ได้ — ใช้ state จากฐานข้อมูล
  }

  try {
    if (!state) {
      const record = await getAssessment(id);
      if (!record) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
      state = record.state;
    }

    if (!canSubmit(state)) {
      return NextResponse.json(
        { error: "ข้อมูลยังไม่ครบเงื่อนไขการส่ง (ตัวชี้วัด หลักฐาน ธงบล็อก หรือการลงนาม)" },
        { status: 422 }
      );
    }

    const total = totalScore(state);
    const submitted: SubmittedInfo = {
      at: new Date().toISOString(),
      ref: `พสศ-${state.unit.year || "2569"}-${Math.floor(Math.random() * 9000) + 1000}`,
      total,
      level: levelFor(total).label,
    };

    const next = { ...state, signed: true, submitted };
    const summary = await saveAssessment(id, next);
    if (!summary) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    return NextResponse.json({ submitted, summary });
  } catch (error) {
    console.error("[api] submit assessment failed:", error);
    return NextResponse.json({ error: "ส่งแบบประเมินไม่สำเร็จ" }, { status: 500 });
  }
}
