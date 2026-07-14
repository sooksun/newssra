import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteAssessment, getAssessment, saveAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { sanitizeState } from "@/lib/state";
import { deleteAllEvidenceFiles } from "@/lib/uploads";
import { INDICATOR_IDS } from "@/lib/types";
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
    // ฟิลด์ที่ฝั่ง server เป็นเจ้าของ — autosave PUT ต้องไม่เขียนทับด้วยค่าจาก client:
    //  - submitted: ออกเลขที่อ้างอิงโดย POST .../submit เท่านั้น (กัน client ปลอมสถานะยื่นข้าม canSubmit)
    //  - evidence[].files: จัดการโดย route อัปโหลด/ลบไฟล์เท่านั้น (กัน snapshot autosave ที่ค้างมาทับจนไฟล์ที่เพิ่งอัปโหลดหาย)
    //  - gis / scoringVersion: เขียนโดย POST .../gis เท่านั้น (server เป็นผู้คำนวณ ratio ทั้งหมดเอง)
    //    conditional spread เพื่อให้แถว v1 ไม่งอก key — round-trip เหมือนเดิมทุก byte
    const existing = await getAssessment(id);
    if (!existing) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    const evidence = {} as AssessmentState["evidence"];
    INDICATOR_IDS.forEach((eid) => {
      evidence[eid] = { ...incoming.evidence[eid], files: existing.state.evidence[eid]?.files ?? [] };
    });
    const state: AssessmentState = { ...incoming, submitted: existing.state.submitted, evidence };
    delete state.gis;
    delete state.scoringVersion;
    if (existing.state.gis) state.gis = existing.state.gis;
    if (existing.state.scoringVersion) state.scoringVersion = existing.state.scoringVersion;

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
