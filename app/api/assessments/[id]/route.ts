import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteAssessment, getAssessment, saveAssessment } from "@/lib/repo";
import { sanitizeState } from "@/lib/state";
import { deleteAllEvidenceFiles } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const state = sanitizeState((body as { state?: unknown })?.state);
  try {
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
