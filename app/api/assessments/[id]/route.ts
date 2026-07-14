import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteAssessment, getAssessment, saveAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { preserveServerOwned, sanitizeState } from "@/lib/state";
import { deleteAllEvidenceFiles } from "@/lib/uploads";
import type { AssessmentState } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  const guard = await requireAssessmentAccess(id);
  if (!guard.ok) return guard.response;
  try {
    const record = await getAssessment(id);
    if (!record) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    console.error("[api] get assessment failed:", error);
    return NextResponse.json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  const guard = await requireAssessmentAccess(id);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const incoming = sanitizeState((body as { state?: unknown })?.state);
  try {
    // ฟิลด์ที่ฝั่ง server เป็นเจ้าของ ถูก preserve จาก DB โดย preserveServerOwned
    // (evidence[].files, gis, scoringVersion) ส่วน submitted ที่ออกโดย POST .../submit เท่านั้น
    // ก็ preserve จาก DB ที่นี่ (กัน client ปลอมสถานะยื่นข้าม canSubmit)
    const existing = await getAssessment(id);
    if (!existing) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    const state: AssessmentState = preserveServerOwned(incoming, existing.state);
    state.submitted = existing.state.submitted;

    const summary = await saveAssessment(id, state);
    if (!summary) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("[api] save assessment failed:", error);
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  const guard = await requireAssessmentAccess(id);
  if (!guard.ok) return guard.response;
  try {
    const removed = await deleteAssessment(id);
    if (!removed) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
    await deleteAllEvidenceFiles(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api] delete assessment failed:", error);
    return NextResponse.json({ error: "ลบไม่สำเร็จ" }, { status: 500 });
  }
}
