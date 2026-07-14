import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, maxSubmissionSeq, saveAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { canSubmit, levelFor, totalScore } from "@/lib/scoring";
import { sanitizeState } from "@/lib/state";
import type { AssessmentSummary, SubmittedInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const REF_MAX_ATTEMPTS = 8;

function isDupSubmittedRef(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "ER_DUP_ENTRY");
}

// ยื่นแบบประเมิน: server เป็นผู้ตัดสิน canSubmit และออกเลขที่อ้างอิงเอง (client แค่แสดงผล)
export async function POST(request: NextRequest, { params }: Ctx) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  }
  const guard = await requireAssessmentAccess(id);
  if (!guard.ok) return guard.response;

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
    const level = levelFor(total).label;
    const at = new Date().toISOString();
    const year = state.unit.year || "2569";

    // เลขที่อ้างอิงแบบรันต่อเนื่องต่อปี (พสศ-YYYY-NNNN) — ไม่ซ้ำ (บังคับด้วย UNIQUE key ที่ submitted_ref)
    // ถ้ามีการยื่นพร้อมกันจนเลขชน ให้ลองเลขถัดไปอัตโนมัติ (retry) แทนการสุ่มที่อาจซ้ำเงียบ ๆ
    let seq = await maxSubmissionSeq(year);
    let submitted: SubmittedInfo | null = null;
    let summary: AssessmentSummary | null = null;
    for (let attempt = 0; attempt < REF_MAX_ATTEMPTS; attempt++) {
      seq += 1;
      const candidate: SubmittedInfo = { at, ref: `พสศ-${year}-${String(seq).padStart(4, "0")}`, total, level };
      try {
        summary = await saveAssessment(id, { ...state, signed: true, submitted: candidate });
        submitted = candidate;
        break;
      } catch (error) {
        if (isDupSubmittedRef(error)) continue; // เลขนี้ถูกใช้ไปแล้ว ลองเลขถัดไป
        throw error;
      }
    }

    if (!submitted) {
      return NextResponse.json({ error: "ออกเลขที่อ้างอิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }, { status: 503 });
    }
    if (!summary) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    return NextResponse.json({ submitted, summary });
  } catch (error) {
    console.error("[api] submit assessment failed:", error);
    return NextResponse.json({ error: "ส่งแบบประเมินไม่สำเร็จ" }, { status: 500 });
  }
}
